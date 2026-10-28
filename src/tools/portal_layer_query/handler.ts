/**
 * portal_layer_query: read a feature layer or table: describe (fields, capabilities, count) | query (paged rows,
 * dates as ISO UTC) | count | stats ("sum:POP" shorthand, group_by). query, count and stats also filter by place:
 * a point, a box or any geometry, optionally within a distance of it.
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { iso } from "../shared/format";
import { resolveLayerUrl } from "../shared/lookup";

export const MAX_ROWS = 1000;

export type LayerQueryArgs = {
	action?: "describe" | "query" | "count" | "stats" | "attachments" | "related";
	object_ids?: number[];
	relationship_id?: number | string;
	target: string;
	layer?: number | string;
	where?: string;
	fields?: string[];
	limit?: number;
	offset?: number;
	order_by?: string;
	return_geometry?: boolean;
	stats?: (string | Record<string, unknown>)[];
	group_by?: string;
	out_sr?: number;
} & SpatialArgs;

export type SpatialArgs = {
	geometry?: number[] | Record<string, unknown>;
	geometry_sr?: number;
	spatial_rel?: keyof typeof SPATIAL_RELS;
	distance?: number;
	units?: keyof typeof DISTANCE_UNITS;
};

export const SPATIAL_RELS = { intersects: "esriSpatialRelIntersects", contains: "esriSpatialRelContains",
	within: "esriSpatialRelWithin", crosses: "esriSpatialRelCrosses", touches: "esriSpatialRelTouches",
	overlaps: "esriSpatialRelOverlaps", envelope_intersects: "esriSpatialRelEnvelopeIntersects" } as const;
export const DISTANCE_UNITS = { meters: "esriSRUnit_Meter", kilometers: "esriSRUnit_Kilometer", feet: "esriSRUnit_Foot",
	miles: "esriSRUnit_StatuteMile" } as const;

/**
 * The query parameters of a spatial filter: geometry is a point [x, y], a box [xmin, ymin, xmax, ymax] or Esri
 * geometry JSON (x/y, rings, paths, points or xmin...), in longitude/latitude unless geometry_sr (or the geometry's
 * own spatialReference) says otherwise. distance turns it into "within that distance of the geometry".
 */
export function spatialFilter(args: SpatialArgs): Record<string, unknown> {
	if (args.geometry === undefined) {
		if (args.distance !== undefined || args.spatial_rel) {
			throw new ArcGISError("distance and spatial_rel need a geometry (e.g. [31.24, 30.04] for a point).", "bad_argument");
		}
		return {};
	}
	const g = args.geometry;
	let geometry: Record<string, unknown>;
	let geometryType: string | null = null;
	if (Array.isArray(g)) {
		if (!g.every((n) => typeof n === "number" && Number.isFinite(n))) throw new ArcGISError("geometry numbers must be finite.", "bad_argument");
		if (g.length === 2) [geometry, geometryType] = [{ x: g[0], y: g[1] }, "esriGeometryPoint"];
		else if (g.length === 4) {
			[geometry, geometryType] = [{ xmin: Math.min(g[0], g[2]), ymin: Math.min(g[1], g[3]), xmax: Math.max(g[0], g[2]),
				ymax: Math.max(g[1], g[3]) }, "esriGeometryEnvelope"];
		} else geometry = {};
	} else {
		geometry = g;
		geometryType = g.rings ? "esriGeometryPolygon" : g.paths ? "esriGeometryPolyline" : g.points ? "esriGeometryMultipoint"
			: "xmin" in g ? "esriGeometryEnvelope" : "x" in g && "y" in g ? "esriGeometryPoint" : null;
	}
	if (!geometryType) {
		throw new ArcGISError("geometry must be a point [x, y], a box [xmin, ymin, xmax, ymax], or Esri geometry JSON "
			+ "(x/y, rings, paths, points or xmin/ymin/xmax/ymax).", "bad_argument");
	}
	const rel = SPATIAL_RELS[args.spatial_rel ?? "intersects"];
	if (!rel) throw new ArcGISError(`spatial_rel must be ${Object.keys(SPATIAL_RELS).join(" | ")}.`, "bad_argument");
	const sr = (geometry.spatialReference as any)?.wkid ?? (geometry.spatialReference as any)?.latestWkid ?? args.geometry_sr ?? 4326;
	const out: Record<string, unknown> = { geometry, geometryType, inSR: sr, spatialRel: rel };
	if (args.distance !== undefined) {
		if (!(args.distance > 0)) throw new ArcGISError("distance must be greater than 0.", "bad_argument");
		const units = DISTANCE_UNITS[args.units ?? "meters"];
		if (!units) throw new ArcGISError(`units must be ${Object.keys(DISTANCE_UNITS).join(" | ")}.`, "bad_argument");
		Object.assign(out, { distance: args.distance, units });
	}
	return out;
}

/** What a spatial filter did, in the answer. */
function spatialNote(sp: Record<string, unknown>, args: SpatialArgs) {
	if (!sp.geometryType) return {};
	return { spatial: { geometry: String(sp.geometryType).replace("esriGeometry", "").toLowerCase(), relation: args.spatial_rel ?? "intersects",
		sr: sp.inSR, ...(sp.distance ? { within: `${sp.distance} ${args.units ?? "meters"}` } : {}) } };
}

export function parseStats(stats: (string | Record<string, unknown>)[]): Record<string, unknown>[] {
	const kinds: Record<string, string> = { avg: "avg", mean: "avg", sum: "sum", min: "min", max: "max", count: "count",
		stddev: "stddev", var: "var" };
	return stats.map((s) => {
		if (typeof s === "object" && s) return s;
		const [kindRaw, field] = String(s).split(":", 2);
		const kind = kinds[(kindRaw ?? "").toLowerCase()];
		if (!kind || !field) {
			throw new ArcGISError(`Bad stat '${s}'; use kind:field (sum|avg|min|max|count|stddev|var).`, "bad_argument");
		}
		return { statisticType: kind, onStatisticField: field, outStatisticFieldName: `${kind}_${field}`.slice(0, 30) };
	});
}

/** Feature JSON -> attribute rows; date fields -> ISO 8601 UTC; huge geometries are replaced by a note. */
export function rowsFrom(features: any[], fields: any[] | undefined, withGeometry: boolean): Record<string, unknown>[] {
	const dates = new Set((fields ?? []).filter((f) => f.type === "esriFieldTypeDate").map((f) => f.name));
	return features.map((f) => {
		const row: Record<string, unknown> = { ...(f.attributes ?? {}) };
		for (const k of Object.keys(row)) if (dates.has(k)) row[k] = iso(row[k]);
		if (withGeometry && f.geometry) {
			const text = JSON.stringify(f.geometry);
			row._geometry = text.length <= 4000 ? f.geometry : { note: `geometry of ${text.length} chars omitted` };
		}
		return row;
	});
}

const MAX_PER_FEATURE_CALLS = 20; // per-feature fallback when the layer cannot queryAttachments

function attachmentCard(layerUrl: string, oid: number, a: any) {
	return { id: a.id, name: a.name, content_type: a.contentType ?? null, size: a.size ?? null, keywords: a.keywords || null,
		url: `${layerUrl}/${oid}/attachments/${a.id}` };
}

/** Attachments per feature: queryAttachments when the layer supports it, otherwise <oid>/attachments per feature. */
async function attachments(ctx: Ctx, url: string, args: LayerQueryArgs) {
	const p = await ctx.request(url);
	if (!p.hasAttachments) {
		throw new ArcGISError("This layer has no attachments (portal_layer_schema action=enable_attachments can turn them on).",
			"no_attachments");
	}
	const ids = (args.object_ids ?? []).map(Number).filter(Number.isInteger);
	if (!ids.length && !args.where) throw new ArcGISError("object_ids or where is required.", "bad_argument");
	if (p.advancedQueryCapabilities?.supportsQueryAttachments) {
		const res = await ctx.request(`${url}/queryAttachments`, {
			objectIds: ids.length ? ids.join(",") : undefined, definitionExpression: ids.length ? undefined : args.where,
			returnMetadata: false,
		});
		const groups = (res.attachmentGroups ?? []).map((g: any) => ({ object_id: g.parentObjectId,
			attachments: (g.attachmentInfos ?? []).map((a: any) => attachmentCard(url, g.parentObjectId, a)) }));
		return { layer: p.name, features: groups.length, groups, download: "Each url needs your sign-in (token)." };
	}
	let list = ids;
	if (!list.length) list = ((await ctx.request(`${url}/query`, { where: args.where, returnIdsOnly: true })).objectIds ?? []);
	const capped = list.slice(0, MAX_PER_FEATURE_CALLS);
	const groups = await Promise.all(capped.map(async (oid: number) => {
		const res = await ctx.request(`${url}/${oid}/attachments`);
		return { object_id: oid, attachments: (res.attachmentInfos ?? []).map((a: any) => attachmentCard(url, oid, a)) };
	}));
	return { layer: p.name, features: groups.length, groups,
		truncated: list.length > capped.length ? `only the first ${capped.length} of ${list.length} features` : null };
}

/** Records related to some features through one of the layer's relationships (id or name). */
async function related(ctx: Ctx, url: string, args: LayerQueryArgs) {
	const ids = (args.object_ids ?? []).map(Number).filter(Number.isInteger);
	if (!ids.length) throw new ArcGISError("object_ids is required.", "bad_argument");
	const p = await ctx.request(url);
	const rels: any[] = p.relationships ?? [];
	if (!rels.length) throw new ArcGISError("This layer has no relationships.", "no_relationships");
	const ref = args.relationship_id ?? rels[0].id;
	const rel = rels.find((r) => String(r.id) === String(ref) || String(r.name).toLowerCase() === String(ref).toLowerCase());
	if (!rel) {
		throw new ArcGISError(`No relationship '${ref}'. The layer has: ${rels.map((r) => `${r.id} (${r.name})`).join(", ")}.`,
			"bad_argument");
	}
	const res = await ctx.request(`${url}/queryRelatedRecords`, {
		objectIds: ids.join(","), relationshipId: rel.id, outFields: args.fields?.length ? args.fields.join(",") : "*",
		returnGeometry: false,
	});
	const groups = (res.relatedRecordGroups ?? []).map((g: any) => ({ object_id: g.objectId,
		records: rowsFrom((g.relatedRecords ?? []).slice(0, MAX_ROWS), res.fields, false) }));
	return { layer: p.name, relationship: { id: rel.id, name: rel.name, related_table_id: rel.relatedTableId }, groups };
}

function describeFields(fields: any[] = []) {
	return fields.map((f) => ({
		name: f.name, type: String(f.type ?? "").replace("esriFieldType", ""), alias: f.alias ?? null,
		nullable: f.nullable ?? null, editable: f.editable ?? null, length: f.length ?? null,
		domain: f.domain ? { name: f.domain.name, type: f.domain.type, codes: f.domain.codedValues?.length ?? null,
			range: f.domain.range ?? null } : null,
	}));
}

export async function layerQuery(ctx: Ctx, args: LayerQueryArgs) {
	const action = args.action ?? "query";
	const sp = spatialFilter(args); // checked before any request
	const url = await resolveLayerUrl(ctx, args.target, args.layer ?? 0);
	const where = args.where?.trim() || "1=1";
	if (action === "describe") {
		const p = await ctx.request(url);
		const count = await ctx.request(`${url}/query`, { where: "1=1", returnCountOnly: true });
		return {
			name: p.name, type: p.type, url, geometryType: p.geometryType ?? null, objectIdField: p.objectIdField ?? null,
			globalIdField: p.globalIdField || null, displayField: p.displayField || null, count: count.count ?? null,
			capabilities: p.capabilities ?? null, maxRecordCount: p.maxRecordCount ?? null,
			hasAttachments: p.hasAttachments ?? null, editorTracking: p.editFieldsInfo ?? null,
			viewDefinitionQuery: p.viewDefinitionQuery || null, isView: p.isView ?? null,
			spatialReference: p.extent?.spatialReference ?? null, fields: describeFields(p.fields),
			relationships: (p.relationships ?? []).map((r: any) => ({ id: r.id, name: r.name, related_table_id: r.relatedTableId,
				cardinality: r.cardinality ?? null, role: r.role ?? null, key_field: r.keyField ?? null })),
		};
	}
	if (action === "attachments") return attachments(ctx, url, args);
	if (action === "related") return related(ctx, url, args);
	if (action === "count") {
		const res = await ctx.request(`${url}/query`, { where, ...sp, returnCountOnly: true });
		return { where, ...spatialNote(sp, args), count: res.count ?? null };
	}
	if (action === "stats") {
		if (!args.stats?.length) {
			throw new ArcGISError('stats is required, e.g. ["sum:POP", "avg:INCOME", "count:OBJECTID"].', "bad_argument");
		}
		const res = await ctx.request(`${url}/query`, {
			where, ...sp, outStatistics: parseStats(args.stats), groupByFieldsForStatistics: args.group_by,
			orderByFields: args.order_by, returnGeometry: false,
		});
		return { where, ...spatialNote(sp, args), group_by: args.group_by ?? null, rows: rowsFrom((res.features ?? []).slice(0, MAX_ROWS), [], false) };
	}
	if (action !== "query") {
		throw new ArcGISError("action must be describe | query | count | stats | attachments | related.", "bad_action");
	}
	const limit = Math.max(1, Math.min(Math.trunc(args.limit ?? 50), MAX_ROWS));
	const offset = Math.max(0, Math.trunc(args.offset ?? 0));
	const res = await ctx.request(`${url}/query`, {
		where, ...sp, outFields: args.fields?.length ? args.fields.join(",") : "*", returnGeometry: Boolean(args.return_geometry),
		outSR: args.return_geometry ? args.out_sr : undefined, resultOffset: offset, resultRecordCount: limit, orderByFields: args.order_by,
	});
	const rows = rowsFrom(res.features ?? [], res.fields, Boolean(args.return_geometry));
	const more = rows.length >= limit || Boolean(res.exceededTransferLimit);
	const hasDates = (res.fields ?? []).some((f: any) => f.type === "esriFieldTypeDate");
	return {
		where, ...spatialNote(sp, args), count: rows.length, offset, next_offset: more ? offset + rows.length : null, rows,
		dates: hasDates ? "ISO 8601 UTC (stored as epoch ms)" : null,
	};
}
