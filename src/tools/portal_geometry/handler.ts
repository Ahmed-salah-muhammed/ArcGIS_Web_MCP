/**
 * portal_geometry: geometry work that needs no layer: project between coordinate systems, buffer, measure (area and
 * perimeter of polygons, length of lines) and the distance between two geometries. It runs on the organization's
 * geometry service (portals/self helperServices.geometry) and spends no credits. Request and response shapes were
 * measured on Esri's public geometry service (utility.arcgisonline.com, 2026-11).
 */
import { ArcGISError, hostAllowed } from "../../arcgis";
import type { Call, Ctx } from "../shared/context";
import { portalSelf } from "../shared/items";
import { capRows, esriGeometry } from "../portal_layer_query/handler";

export const GEOMETRY_SERVICE = "https://utility.arcgisonline.com/arcgis/rest/services/Geometry/GeometryServer";
/** Esri's own public utility services: they take no token, so none is sent. */
const ESRI_PUBLIC_HOSTS = new Set(["utility.arcgisonline.com", "utility.arcgis.com"]);

/** esriSRUnitType codes. */
export const LENGTH_UNITS = { meters: 9001, kilometers: 9036, feet: 9002, miles: 9093 } as const;
export const AREA_UNITS = { square_meters: "esriSquareMeters", square_kilometers: "esriSquareKilometers", hectares: "esriHectares",
	acres: "esriAcres", square_miles: "esriSquareMiles", square_feet: "esriSquareFeet" } as const;

export const MAX_GEOMETRIES = 50;
const MAX_OUT_CHARS = 60_000; // a buffer is a polygon of ~170 vertices: about 7,000 characters each

export type GeometryArgs = {
	action: "project" | "buffer" | "measure" | "distance";
	geometries: (number[] | Record<string, unknown>)[];
	in_sr?: number;
	out_sr?: number;
	distance?: number;
	units?: keyof typeof LENGTH_UNITS;
	area_units?: keyof typeof AREA_UNITS;
	union?: boolean;
};

/**
 * The geometry service and how to call it: with the user's token when it is on the portal or its service hosts,
 * without any token when it is Esri's public utility service (the default of ArcGIS Online and of most portals).
 */
export async function geometryService(ctx: Ctx): Promise<{ url: string; call: Call }> {
	const self = await portalSelf(ctx);
	const url = String(self.helperServices?.geometry?.url ?? (self.isPortal ? "" : GEOMETRY_SERVICE)).replace(/\/+$/, "");
	if (!url) throw new ArcGISError("Your portal has no geometry service (helperServices.geometry).", "not_found");
	if (hostAllowed(url, ctx.props.portal, ctx.extraHosts)) return { url, call: ctx.request };
	let parsed: URL | null = null;
	try {
		parsed = new URL(url);
	} catch { /* refused below */ }
	if (parsed?.protocol === "https:" && ESRI_PUBLIC_HOSTS.has(parsed.hostname.toLowerCase()) && ctx.publicPost) {
		return { url, call: ctx.publicPost };
	}
	throw new ArcGISError(`Your geometry service is on ${parsed?.hostname ?? url}; add that host to ARCGIS_EXTRA_HOSTS to use it here.`,
		"host_not_allowed");
}

/** A box as the polygon it outlines (buffer and measure take polygons, not envelopes). */
function ringOf(g: Record<string, unknown>): Record<string, unknown> {
	const { xmin, ymin, xmax, ymax } = g as Record<string, number>;
	return { rings: [[[xmin, ymin], [xmin, ymax], [xmax, ymax], [xmax, ymin], [xmin, ymin]]] };
}

/** The geometries in Esri JSON, all of one type, and the coordinate system they are in. */
function read(args: GeometryArgs, boxesAsPolygons: boolean) {
	const list = args.geometries ?? [];
	if (!list.length) throw new ArcGISError("geometries is required, e.g. [[31.24, 30.04]] for a point.", "bad_argument");
	if (list.length > MAX_GEOMETRIES) throw new ArcGISError(`At most ${MAX_GEOMETRIES} geometries per call.`, "too_many");
	const parsed = list.map((g) => {
		const { geometry, geometryType } = esriGeometry(g);
		return boxesAsPolygons && geometryType === "esriGeometryEnvelope"
			? { geometry: ringOf(geometry), geometryType: "esriGeometryPolygon" } : { geometry, geometryType };
	});
	const types = [...new Set(parsed.map((p) => p.geometryType))];
	const own = (parsed[0].geometry.spatialReference as any) ?? {};
	const sr = args.in_sr ?? own.wkid ?? own.latestWkid ?? 4326;
	// the coordinate system goes once, as a parameter: stripped from each geometry so two cannot disagree
	const geometries = parsed.map(({ geometry }) => {
		const { spatialReference: _, ...rest } = geometry;
		return rest;
	});
	return { geometries, types, sr: Number(sr) };
}

function oneType(types: string[], action: string): string {
	if (types.length > 1) {
		throw new ArcGISError(`${action} takes geometries of one type per call; these are ${types.map(short).join(", ")}.`, "bad_argument");
	}
	return types[0];
}

const short = (type: string) => type.replace("esriGeometry", "").toLowerCase();

function lengthUnit(args: GeometryArgs): { name: keyof typeof LENGTH_UNITS; code: number } {
	const name = args.units ?? "meters";
	const code = LENGTH_UNITS[name];
	if (!code) throw new ArcGISError(`units must be ${Object.keys(LENGTH_UNITS).join(" | ")}.`, "bad_argument");
	return { name, code };
}

/** Geometries out, capped by size: a polygon with thousands of vertices is not something to read back whole. */
function capped(geometries: unknown[]) {
	const kept = capRows(geometries, MAX_OUT_CHARS);
	return { count: geometries.length, geometries: kept,
		...(kept.length < geometries.length ? { truncated: `${kept.length} of ${geometries.length} returned (size); send fewer geometries per call` } : {}) };
}

export async function geometry(ctx: Ctx, args: GeometryArgs) {
	const action = args.action;
	if (!["project", "buffer", "measure", "distance"].includes(action)) {
		throw new ArcGISError("action must be project | buffer | measure | distance.", "bad_action");
	}
	// everything about the input is checked before the service is looked up
	const { geometries, types, sr } = read(args, action === "buffer" || action === "measure");
	if (action === "project") {
		const type = oneType(types, action);
		if (!args.out_sr) throw new ArcGISError("out_sr is required: the WKID to project to, e.g. 3857 or 4326.", "bad_argument");
		const { url, call } = await geometryService(ctx);
		const res = await call(`${url}/project`, { geometries: { geometryType: type, geometries }, inSR: sr, outSR: args.out_sr });
		return { in_sr: sr, out_sr: args.out_sr, geometry: short(type), ...capped(res.geometries ?? []) };
	}
	if (action === "buffer") {
		const type = oneType(types, action);
		if (!(Number(args.distance) > 0)) throw new ArcGISError("distance is required and must be greater than 0.", "bad_argument");
		const unit = lengthUnit(args);
		const outSr = args.out_sr ?? sr;
		const { url, call } = await geometryService(ctx);
		const res = await call(`${url}/buffer`, { geometries: { geometryType: type, geometries }, inSR: sr, outSR: outSr,
			distances: args.distance, unit: unit.code, geodesic: true, unionResults: Boolean(args.union) });
		return { distance: args.distance, units: unit.name, sr: outSr, union: Boolean(args.union), ...capped(res.geometries ?? []),
			use: "Each polygon works as geometry in portal_layer_query (features within it), or as a feature's geometry in portal_layer_edit." };
	}
	if (action === "measure") {
		const type = oneType(types, action);
		const unit = lengthUnit(args);
		if (type === "esriGeometryPolygon") {
			const areaName = args.area_units ?? "square_meters";
			const areaUnit = AREA_UNITS[areaName];
			if (!areaUnit) throw new ArcGISError(`area_units must be ${Object.keys(AREA_UNITS).join(" | ")}.`, "bad_argument");
			const { url, call } = await geometryService(ctx);
			const res = await call(`${url}/areasAndLengths`, { polygons: geometries, sr, lengthUnit: unit.code,
				areaUnit: { areaUnit }, calculationType: "geodesic" });
			return { geometry: "polygon", area_units: areaName, length_units: unit.name, method: "geodesic",
				measures: geometries.map((_, i) => ({ area: res.areas?.[i] ?? null, perimeter: res.lengths?.[i] ?? null })) };
		}
		if (type === "esriGeometryPolyline") {
			const { url, call } = await geometryService(ctx);
			const res = await call(`${url}/lengths`, { polylines: geometries, sr, lengthUnit: unit.code, calculationType: "geodesic" });
			return { geometry: "polyline", length_units: unit.name, method: "geodesic",
				measures: geometries.map((_, i) => ({ length: res.lengths?.[i] ?? null })) };
		}
		throw new ArcGISError("measure takes polygons (area + perimeter), boxes or lines (length); for two points use action=distance.",
			"bad_argument");
	}
	if (geometries.length !== 2) throw new ArcGISError("distance takes exactly two geometries.", "bad_argument");
	const unit = lengthUnit(args);
	const { url, call } = await geometryService(ctx);
	const res = await call(`${url}/distance`, { sr,
		geometry1: { geometryType: types[0], geometry: geometries[0] },
		geometry2: { geometryType: types.length > 1 ? types[1] : types[0], geometry: geometries[1] },
		distanceUnit: unit.code, geodesic: true });
	return { distance: res.distance ?? null, units: unit.name, method: "geodesic" };
}
