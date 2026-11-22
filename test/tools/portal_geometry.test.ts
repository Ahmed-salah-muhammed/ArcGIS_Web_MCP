import { describe, expect, it } from "vitest";
import { geometry, GEOMETRY_SERVICE } from "../../src/tools/portal_geometry/handler";
import { fakeCtx, props } from "../helpers";

// Every answer below is what Esri's public geometry service returned for these inputs (2026-11).
const online = (more: Record<string, (p: Record<string, unknown>) => unknown>) => fakeCtx({ "/portals/self": () => ({ isPortal: false }), ...more });

describe("portal_geometry", () => {
	it("project: one geometry type and the coordinate systems as parameters, without the token", async () => {
		const { ctx, calls } = online({ "/GeometryServer/project": () => ({ geometries: [{ x: 3477142.2185714557, y: 3509258.327182014 }] }) });
		const out: any = await geometry(ctx, { action: "project", geometries: [[31.2357, 30.0444]], out_sr: 3857 });
		expect(out).toEqual({ in_sr: 4326, out_sr: 3857, geometry: "point", count: 1,
			geometries: [{ x: 3477142.2185714557, y: 3509258.327182014 }] });
		const sent = calls.at(-1)!;
		expect(sent).toMatchObject({ via: "public", url: `${GEOMETRY_SERVICE}/project` }); // Esri's utility host is not the portal
		expect(sent.params).toEqual({ geometries: { geometryType: "esriGeometryPoint", geometries: [{ x: 31.2357, y: 30.0444 }] },
			inSR: 4326, outSR: 3857 });
	});

	it("uses the user's token only when the geometry service is on the portal", async () => {
		const enterprise = { ...props, isPortal: true, portal: "https://gis.example.com/portal" };
		const own = fakeCtx({
			"/portals/self": () => ({ isPortal: true, helperServices: { geometry: { url: "https://gis.example.com/server/rest/services/Utilities/Geometry/GeometryServer" } } }),
			"/GeometryServer/project": () => ({ geometries: [{ x: 1, y: 2 }] }),
		}, enterprise);
		await geometry(own.ctx, { action: "project", geometries: [[31, 30]], out_sr: 3857 });
		expect(own.calls.at(-1)!.via).toBe("request");

		const elsewhere = fakeCtx({ "/portals/self": () => ({ isPortal: true,
			helperServices: { geometry: { url: "https://other.example.org/arcgis/rest/services/Geometry/GeometryServer" } } }) }, enterprise);
		await expect(geometry(elsewhere.ctx, { action: "project", geometries: [[31, 30]], out_sr: 3857 }))
			.rejects.toMatchObject({ code: "host_not_allowed" });
		expect(elsewhere.calls).toHaveLength(1); // only portals/self: nothing was sent to the other host

		const none = fakeCtx({ "/portals/self": () => ({ isPortal: true }) }, enterprise);
		await expect(geometry(none.ctx, { action: "project", geometries: [[31, 30]], out_sr: 3857 })).rejects.toMatchObject({ code: "not_found" });
	});

	it("buffer: geodesic, in the chosen units, boxes as polygons; the coordinate system is sent once", async () => {
		const ring = { rings: [[[31.2357, 30.0534], [31.236, 30.0534], [31.2357, 30.0534]]] };
		const { ctx, calls } = online({ "/GeometryServer/buffer": () => ({ geometries: [ring] }) });
		const out: any = await geometry(ctx, { action: "buffer", geometries: [{ x: 31.2357, y: 30.0444, spatialReference: { wkid: 4326 } }],
			distance: 1, units: "kilometers", union: true });
		expect(calls.at(-1)!.params).toEqual({ geometries: { geometryType: "esriGeometryPoint", geometries: [{ x: 31.2357, y: 30.0444 }] },
			inSR: 4326, outSR: 4326, distances: 1, unit: 9036, geodesic: true, unionResults: true });
		expect(out).toMatchObject({ distance: 1, units: "kilometers", sr: 4326, union: true, count: 1, geometries: [ring] });
		await geometry(ctx, { action: "buffer", geometries: [[31, 30, 32, 31]], distance: 100 });
		expect(calls.at(-1)!.params).toMatchObject({ unit: 9001,
			geometries: { geometryType: "esriGeometryPolygon", geometries: [{ rings: [[[31, 30], [31, 31], [32, 31], [32, 30], [31, 30]]] }] } });
	});

	it("measure: area and perimeter of polygons, length of lines", async () => {
		const { ctx, calls } = online({
			"/GeometryServer/areasAndLengths": () => ({ areas: [10642.455822267155], lengths: [413.7117660337538] }),
			"/GeometryServer/lengths": () => ({ lengths: [146.64719941935303] }),
		});
		const square = { rings: [[[31, 30], [31, 31], [32, 31], [32, 30], [31, 30]]] };
		const area: any = await geometry(ctx, { action: "measure", geometries: [square], units: "kilometers", area_units: "square_kilometers" });
		expect(calls.at(-1)!.params).toEqual({ polygons: [square], sr: 4326, lengthUnit: 9036, areaUnit: { areaUnit: "esriSquareKilometers" },
			calculationType: "geodesic" });
		expect(area).toEqual({ geometry: "polygon", area_units: "square_kilometers", length_units: "kilometers", method: "geodesic",
			measures: [{ area: 10642.455822267155, perimeter: 413.7117660337538 }] });
		const line: any = await geometry(ctx, { action: "measure", geometries: [{ paths: [[[31, 30], [32, 31]]] }], units: "kilometers" });
		expect(calls.at(-1)!.params).toEqual({ polylines: [{ paths: [[[31, 30], [32, 31]]] }], sr: 4326, lengthUnit: 9036, calculationType: "geodesic" });
		expect(line.measures).toEqual([{ length: 146.64719941935303 }]);
	});

	it("distance: exactly two geometries", async () => {
		const { ctx, calls } = online({ "/GeometryServer/distance": () => ({ distance: 91.122345141469651 }) });
		const out: any = await geometry(ctx, { action: "distance", geometries: [[31, 30], [32, 31]], units: "miles" });
		expect(calls.at(-1)!.params).toEqual({ sr: 4326, geometry1: { geometryType: "esriGeometryPoint", geometry: { x: 31, y: 30 } },
			geometry2: { geometryType: "esriGeometryPoint", geometry: { x: 32, y: 31 } }, distanceUnit: 9093, geodesic: true });
		expect(out).toEqual({ distance: 91.122345141469651, units: "miles", method: "geodesic" });
	});

	it("refuses bad input before any request", async () => {
		const { ctx, calls } = online({});
		await expect(geometry(ctx, { action: "project", geometries: [[31, 30]] })).rejects.toThrow(/out_sr is required/);
		await expect(geometry(ctx, { action: "project", geometries: [[31, 30], [31, 30, 32, 31]], out_sr: 3857 })).rejects.toThrow(/one type per call/);
		await expect(geometry(ctx, { action: "buffer", geometries: [[31, 30]] })).rejects.toThrow(/distance is required/);
		await expect(geometry(ctx, { action: "measure", geometries: [[31, 30]] })).rejects.toThrow(/measure takes polygons/);
		await expect(geometry(ctx, { action: "distance", geometries: [[31, 30]] })).rejects.toThrow(/exactly two/);
		await expect(geometry(ctx, { action: "project", geometries: [], out_sr: 3857 })).rejects.toThrow(/geometries is required/);
		await expect(geometry(ctx, { action: "buffer", geometries: [{ nope: 1 }], distance: 1 })).rejects.toMatchObject({ code: "bad_argument" });
		expect(calls).toHaveLength(0);
	});
});
