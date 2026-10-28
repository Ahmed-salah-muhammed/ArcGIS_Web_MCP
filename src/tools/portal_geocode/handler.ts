/**
 * portal_geocode: an address -> places (findAddressCandidates) and a place -> its address (reverseGeocode), with the
 * org's own geocoder (portals/self helperServices.geocode; ArcGIS Online's World geocoder otherwise). forStorage is
 * never sent: these lookups are for reading and spend no credits; saving many geocoded rows into a layer is
 * portal_publish with address_fields, which asks first because it spends credits.
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { portalSelf } from "../shared/items";
import { requireAllowed } from "../shared/lookup";

export const WORLD_GEOCODER = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";
const WGS84 = { wkid: 4326 };

export type GeocodeArgs = {
	action?: "find" | "reverse";
	address?: string;
	location?: number[];
	near?: number[];
	country?: string;
	max_results?: number;
};

/** The org's first geocoder; the token only goes to it when it is on the portal or its service hosts. */
export async function geocoderUrl(ctx: Ctx): Promise<string> {
	const self = await portalSelf(ctx);
	const url = String(self.helperServices?.geocode?.[0]?.url ?? (self.isPortal ? "" : WORLD_GEOCODER)).replace(/\/+$/, "");
	if (!url) throw new ArcGISError("Your portal has no geocoder (helperServices.geocode).", "not_found");
	try {
		requireAllowed(ctx, url);
	} catch {
		throw new ArcGISError(`Your geocoder is on ${new URL(url).hostname}; add that host to ARCGIS_EXTRA_HOSTS to use it here.`,
			"host_not_allowed");
	}
	return url;
}

function lonLat(v: number[] | undefined, what: string): { x: number; y: number } {
	if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite) || Math.abs(v[0]) > 180 || Math.abs(v[1]) > 90) {
		throw new ArcGISError(`${what} must be [longitude, latitude], e.g. [31.2357, 30.0444].`, "bad_argument");
	}
	return { x: v[0], y: v[1] };
}

export async function geocode(ctx: Ctx, args: GeocodeArgs) {
	const action = args.action ?? "find";
	if (action === "reverse") {
		const point = lonLat(args.location, "location");
		const url = await geocoderUrl(ctx);
		const res = await ctx.request(`${url}/reverseGeocode`, { location: { ...point, spatialReference: WGS84 }, outSR: 4326 });
		const a = res.address ?? {};
		return { location: [point.x, point.y], address: a.LongLabel || a.Match_addr || null, type: a.Addr_type ?? null,
			parts: { city: a.City || null, region: a.Region || null, postal: a.Postal || null, country: a.CntryName || a.CountryCode || null },
			found_at: res.location ? [res.location.x, res.location.y] : null };
	}
	if (action !== "find") throw new ArcGISError("action must be find | reverse.", "bad_action");
	const address = args.address?.trim();
	if (!address) throw new ArcGISError("address is required.", "bad_argument");
	const near = args.near ? lonLat(args.near, "near") : null;
	const url = await geocoderUrl(ctx);
	const res = await ctx.request(`${url}/findAddressCandidates`, {
		SingleLine: address, maxLocations: Math.max(1, Math.min(Math.trunc(args.max_results ?? 5), 20)), outSR: 4326,
		outFields: "Match_addr,Addr_type,City,Region,Country", sourceCountry: args.country,
		location: near ? { ...near, spatialReference: WGS84 } : undefined,
	});
	const candidates = (res.candidates ?? []).map((c: any) => ({ address: c.address, score: c.score ?? null,
		location: c.location ? [c.location.x, c.location.y] : null, type: c.attributes?.Addr_type ?? null,
		city: c.attributes?.City || null, country: c.attributes?.Country || null }));
	return { address, count: candidates.length, candidates, coordinates: "[longitude, latitude], WGS84" };
}
