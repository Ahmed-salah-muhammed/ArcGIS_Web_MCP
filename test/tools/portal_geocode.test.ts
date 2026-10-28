import { describe, expect, it } from "vitest";
import { geocode, WORLD_GEOCODER } from "../../src/tools/portal_geocode/handler";
import { fakeCtx, props } from "../helpers";

const ORG_GEOCODER = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

describe("portal_geocode", () => {
	it("find uses the org's geocoder, never forStorage, and answers [lon, lat]", async () => {
		const { ctx, calls } = fakeCtx({
			"/portals/self": () => ({ helperServices: { geocode: [{ url: `${ORG_GEOCODER}/` }] } }),
			"/findAddressCandidates": () => ({ candidates: [{ address: "Cairo University", score: 98,
				location: { x: 31.2, y: 30.02 }, attributes: { Addr_type: "POI", City: "Giza", Country: "EGY" } }] }),
		});
		const out: any = await geocode(ctx, { address: " Cairo University ", country: "EGY", near: [31.2, 30] });
		const sent = calls.find((c) => c.url.endsWith("/findAddressCandidates"))!;
		expect(sent.url).toBe(`${ORG_GEOCODER}/findAddressCandidates`);
		expect(sent.params).toMatchObject({ SingleLine: "Cairo University", maxLocations: 5, outSR: 4326, sourceCountry: "EGY",
			location: { x: 31.2, y: 30, spatialReference: { wkid: 4326 } } });
		expect(sent.params).not.toHaveProperty("forStorage");
		expect(out.candidates).toEqual([{ address: "Cairo University", score: 98, location: [31.2, 30.02], type: "POI",
			city: "Giza", country: "EGY" }]);
	});

	it("reverse answers the address; ArcGIS Online falls back to the World geocoder", async () => {
		const { ctx, calls } = fakeCtx({
			"/portals/self": () => ({}),
			"/reverseGeocode": () => ({ address: { LongLabel: "Tahrir Square, Cairo, EGY", Addr_type: "PointAddress", City: "Cairo" },
				location: { x: 31.2357, y: 30.0444 } }),
		});
		const out: any = await geocode(ctx, { action: "reverse", location: [31.2357, 30.0444] });
		expect(calls.at(-1)!.url).toBe(`${WORLD_GEOCODER}/reverseGeocode`);
		expect(out).toMatchObject({ address: "Tahrir Square, Cairo, EGY", type: "PointAddress", parts: { city: "Cairo" } });
	});

	it("checks coordinates first, and keeps the token off a geocoder on another host", async () => {
		const { ctx, calls } = fakeCtx({});
		await expect(geocode(ctx, { action: "reverse", location: [30, 200] })).rejects.toMatchObject({ code: "bad_argument" });
		await expect(geocode(ctx, { address: "" })).rejects.toMatchObject({ code: "bad_argument" });
		expect(calls).toHaveLength(0);
		const enterprise = fakeCtx({ "/portals/self": () => ({ isPortal: true,
			helperServices: { geocode: [{ url: "https://geo.other.example/arcgis/rest/services/Loc/GeocodeServer" }] } }) },
		{ ...props, portal: "https://gis.example.com/portal", isPortal: true });
		await expect(geocode(enterprise.ctx, { address: "x" })).rejects.toThrow(/ARCGIS_EXTRA_HOSTS/);
		expect(enterprise.calls.map((c) => c.url)).toEqual(["https://gis.example.com/portal/sharing/rest/portals/self"]);
	});
});
