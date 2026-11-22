import { describe, expect, it } from "vitest";
import { capRows, layerQuery, parseStats, rowsFrom, spatialFilter } from "../../src/tools/portal_layer_query/handler";
import { iso } from "../../src/tools/shared/format";
import { fakeCtx, SVC } from "../helpers";

describe("portal_layer_query", () => {
	it("parses stats shorthand", () => {
		expect(parseStats(["sum:POP", "Avg:INCOME"])).toEqual([
			{ statisticType: "sum", onStatisticField: "POP", outStatisticFieldName: "sum_POP" },
			{ statisticType: "avg", onStatisticField: "INCOME", outStatisticFieldName: "avg_INCOME" },
		]);
		expect(() => parseStats(["median:POP"])).toThrow(/Bad stat/);
	});

	it("rows: dates to ISO, big geometries replaced", () => {
		const rows = rowsFrom([
			{ attributes: { OBJECTID: 1, SEEN: 1700000000000 }, geometry: { x: 1, y: 2 } },
			{ attributes: { OBJECTID: 2, SEEN: null }, geometry: { rings: [Array(3000).fill([1.123456, 2.123456])] } },
		], [{ name: "SEEN", type: "esriFieldTypeDate" }], true);
		expect(rows[0]).toEqual({ OBJECTID: 1, SEEN: "2023-11-14T22:13:20Z", _geometry: { x: 1, y: 2 } });
		expect((rows[1]._geometry as any).note).toMatch(/omitted/);
		expect(iso(-1)).toBeNull();
	});

	it("query pages and caps the limit; describe includes the count", async () => {
		const { ctx, calls } = fakeCtx({
			"/FeatureServer/0/query": (p) => p.returnCountOnly ? { count: 42 } : {
				fields: [{ name: "WHEN", type: "esriFieldTypeDate" }],
				features: Array.from({ length: 2 }, (_, i) => ({ attributes: { OBJECTID: i, WHEN: 0 } })),
			},
			"/FeatureServer/0": () => ({ name: "pts", type: "Feature Layer", objectIdField: "OBJECTID",
				fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }], capabilities: "Query" }),
		});
		const q: any = await layerQuery(ctx, { target: `${SVC}/0`, limit: 2, offset: 10, fields: ["OBJECTID", "WHEN"] });
		expect(q).toMatchObject({ count: 2, offset: 10, next_offset: 12, dates: "ISO 8601 UTC (stored as epoch ms)" });
		expect(calls.at(-1)!.params).toMatchObject({ outFields: "OBJECTID,WHEN", resultOffset: 10, resultRecordCount: 2,
			returnGeometry: false });
		await layerQuery(ctx, { target: `${SVC}/0`, limit: 999999 });
		expect(calls.at(-1)!.params.resultRecordCount).toBe(1000);
		const d: any = await layerQuery(ctx, { target: `${SVC}/0`, action: "describe" });
		expect(d).toMatchObject({ name: "pts", count: 42, fields: [{ name: "OBJECTID", type: "OID" }] });
		await expect(layerQuery(ctx, { target: `${SVC}/0`, action: "stats" })).rejects.toThrow(/stats is required/);
	});

	it("attachments: queryAttachments when supported, per feature otherwise, refused without attachments", async () => {
		const grouped = fakeCtx({
			[`${SVC}/0`]: () => ({ name: "pts", hasAttachments: true, advancedQueryCapabilities: { supportsQueryAttachments: true } }),
			[`${SVC}/0/queryAttachments`]: () => ({ attachmentGroups: [{ parentObjectId: 1,
				attachmentInfos: [{ id: 7, name: "note.txt", contentType: "text/plain", size: 19 }] }] }),
		});
		const out: any = await layerQuery(grouped.ctx, { target: `${SVC}/0`, action: "attachments", object_ids: [1] });
		expect(out.groups).toEqual([{ object_id: 1, attachments: [{ id: 7, name: "note.txt", content_type: "text/plain", size: 19,
			keywords: null, url: `${SVC}/0/1/attachments/7` }] }]);
		expect(grouped.calls.at(-1)!.params).toMatchObject({ objectIds: "1" });

		const perFeature = fakeCtx({
			[`${SVC}/0`]: () => ({ name: "pts", hasAttachments: true }),
			[`${SVC}/0/2/attachments`]: () => ({ attachmentInfos: [{ id: 9, name: "a.jpg", contentType: "image/jpeg", size: 5 }] }),
		});
		const one: any = await layerQuery(perFeature.ctx, { target: `${SVC}/0`, action: "attachments", object_ids: [2] });
		expect(one.groups[0]).toMatchObject({ object_id: 2, attachments: [{ id: 9, name: "a.jpg" }] });

		const none = fakeCtx({ [`${SVC}/0`]: () => ({ name: "pts", hasAttachments: false }) });
		await expect(layerQuery(none.ctx, { target: `${SVC}/0`, action: "attachments", object_ids: [1] }))
			.rejects.toMatchObject({ code: "no_attachments" });
	});

	it("related: picks the relationship by id or name and converts dates", async () => {
		const { ctx, calls } = fakeCtx({
			[`${SVC}/0`]: () => ({ name: "requests", relationships: [{ id: 0, name: "Comments", relatedTableId: 1 }] }),
			[`${SVC}/0/queryRelatedRecords`]: () => ({ fields: [{ name: "WHEN", type: "esriFieldTypeDate" }],
				relatedRecordGroups: [{ objectId: 5, relatedRecords: [{ attributes: { TEXT: "ok", WHEN: 1700000000000 } }] }] }),
		});
		const out: any = await layerQuery(ctx, { target: `${SVC}/0`, action: "related", object_ids: [5], relationship_id: "comments" });
		expect(calls.at(-1)!.params).toMatchObject({ objectIds: "5", relationshipId: 0 });
		expect(out).toMatchObject({ relationship: { id: 0, name: "Comments" },
			groups: [{ object_id: 5, records: [{ TEXT: "ok", WHEN: "2023-11-14T22:13:20Z" }] }] });
		await expect(layerQuery(ctx, { target: `${SVC}/0`, action: "related", object_ids: [5], relationship_id: 9 }))
			.rejects.toThrow(/No relationship '9'/);
	});

	it("spatial filters: point, box and geometry JSON, with a distance", () => {
		expect(spatialFilter({})).toEqual({});
		expect(spatialFilter({ geometry: [31.24, 30.04], distance: 2, units: "kilometers" })).toEqual({
			geometry: { x: 31.24, y: 30.04 }, geometryType: "esriGeometryPoint", inSR: 4326, spatialRel: "esriSpatialRelIntersects",
			distance: 2, units: "esriSRUnit_Kilometer" });
		expect(spatialFilter({ geometry: [32, 31, 30, 29] })).toMatchObject({ geometryType: "esriGeometryEnvelope",
			geometry: { xmin: 30, ymin: 29, xmax: 32, ymax: 31 } });
		const ring = { rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]], spatialReference: { wkid: 102100 } };
		expect(spatialFilter({ geometry: ring, spatial_rel: "within", geometry_sr: 4326 })).toMatchObject({
			geometryType: "esriGeometryPolygon", inSR: 102100, spatialRel: "esriSpatialRelWithin" });
		expect(() => spatialFilter({ geometry: [1, 2, 3] })).toThrow(/point \[x, y\]/);
		expect(() => spatialFilter({ geometry: { foo: 1 } })).toThrow(/Esri geometry JSON/);
		expect(() => spatialFilter({ distance: 5 })).toThrow(/need a geometry/);
		expect(() => spatialFilter({ geometry: [1, 2], distance: 0 })).toThrow(/greater than 0/);
	});

	it("count sends the spatial filter and says what it did", async () => {
		const { ctx, calls } = fakeCtx({ "/FeatureServer/0/query": () => ({ count: 7 }) });
		const out: any = await layerQuery(ctx, { target: `${SVC}/0`, action: "count", geometry: [31.24, 30.04], distance: 500 });
		expect(calls[0].params).toMatchObject({ geometryType: "esriGeometryPoint", distance: 500, units: "esriSRUnit_Meter",
			returnCountOnly: true });
		expect(out).toEqual({ where: "1=1", spatial: { geometry: "point", relation: "intersects", sr: 4326, within: "500 meters" }, count: 7 });
		await expect(layerQuery(ctx, { target: `${SVC}/0`, action: "count", geometry: [1] })).rejects.toMatchObject({ code: "bad_argument" });
		expect(calls).toHaveLength(1);
	});

	it("rows are capped by size: what does not fit is the next page, and the answer says so", async () => {
		expect(capRows([{ a: "x".repeat(50) }, { a: "y".repeat(50) }], 10)).toHaveLength(1); // never empty
		const { ctx } = fakeCtx({ "/FeatureServer/0/query": () => ({ fields: [],
			features: Array.from({ length: 40 }, (_, i) => ({ attributes: { OBJECTID: i, NOTE: "n".repeat(200) } })) }) });
		const small: any = await layerQuery(ctx, { target: `${SVC}/0`, limit: 100, max_chars: 2000 });
		expect(small.count).toBeLessThan(40);
		expect(JSON.stringify(small.rows).length).toBeLessThanOrEqual(2000);
		expect(small.next_offset).toBe(small.count);
		expect(small.truncated).toMatch(new RegExp(`^${small.count} of 40 fit in max_chars=2000; continue with offset=next_offset`));
		const whole: any = await layerQuery(ctx, { target: `${SVC}/0`, limit: 100 });
		expect(whole).toMatchObject({ count: 40, next_offset: null });
		expect(whole.truncated).toBeUndefined();
	});

	// The three answers below are the ones a hosted layer on ArcGIS Online gave (Landscape_Trees, 2026-11).
	it("distinct: one field gives its values, several give rows; no paging parameters are sent", async () => {
		const { ctx, calls } = fakeCtx({ "/FeatureServer/0/query": () => ({ objectIdFieldName: "FID", geometryType: "esriGeometryPoint",
			fields: [{ name: "Cmn_Name", type: "esriFieldTypeString", alias: "Cmn_Name", length: 254 }],
			features: [{ attributes: { Cmn_Name: "Alsaka cedar" } }, { attributes: { Cmn_Name: "American elm" } }] }) });
		const out: any = await layerQuery(ctx, { target: `${SVC}/0`, action: "distinct", fields: ["Cmn_Name"], where: "FID < 50" });
		expect(out).toEqual({ where: "FID < 50", fields: ["Cmn_Name"], count: 2, values: ["Alsaka cedar", "American elm"], more: null });
		expect(calls[0].params).toEqual({ where: "FID < 50", outFields: "Cmn_Name", returnDistinctValues: true, returnGeometry: false,
			orderByFields: "Cmn_Name" });
		const two: any = await layerQuery(ctx, { target: `${SVC}/0`, action: "distinct", fields: ["Cmn_Name", "Status"], limit: 1 });
		expect(two).toMatchObject({ count: 1, rows: [{ Cmn_Name: "Alsaka cedar" }], more: "there are more values: narrow where" });
		await expect(layerQuery(ctx, { target: `${SVC}/0`, action: "distinct" })).rejects.toThrow(/fields is required/);
	});

	it("extent: count and bounding box in WGS84; null when nothing matches", async () => {
		const { ctx, calls } = fakeCtx({ "/FeatureServer/0/query": (p) => (p.where === "1=0" ? { count: 0, extent: null } : { count: 1148,
			extent: { xmin: -82.445687603401652, ymin: 35.609320279638105, xmax: -82.436520070059061, ymax: 35.615074208230787,
				spatialReference: { wkid: 4326, latestWkid: 4326 } } }) });
		const out: any = await layerQuery(ctx, { target: `${SVC}/0`, action: "extent" });
		expect(out).toEqual({ where: "1=1", count: 1148, sr: 4326, order: "[xmin, ymin, xmax, ymax]",
			extent: [-82.445687603401652, 35.609320279638105, -82.436520070059061, 35.615074208230787] });
		expect(calls[0].params).toEqual({ where: "1=1", returnExtentOnly: true, returnCountOnly: true, outSR: 4326 });
		expect(await layerQuery(ctx, { target: `${SVC}/0`, action: "extent", where: "1=0" })).toMatchObject({ count: 0, extent: null, sr: null });
	});

	it("format=geojson asks the service for GeoJSON and pages by its exceededTransferLimit", async () => {
		const { ctx, calls } = fakeCtx({ "/FeatureServer/0/query": () => ({ type: "FeatureCollection",
			crs: { type: "name", properties: { name: "EPSG:4326" } }, properties: { exceededTransferLimit: true },
			features: [{ type: "Feature", geometry: { type: "Point", coordinates: [-82.4411930023927, 35.6104483150623] },
				properties: { Cmn_Name: "Siberian elm" } }] }) });
		const out: any = await layerQuery(ctx, { target: `${SVC}/0`, format: "geojson", fields: ["Cmn_Name"], limit: 5 });
		expect(calls[0].params).toMatchObject({ f: "geojson", outSR: 4326, returnGeometry: true, outFields: "Cmn_Name", resultRecordCount: 5 });
		expect(out).toMatchObject({ format: "geojson", count: 1, offset: 0, next_offset: 1 });
		expect(out.geojson).toEqual({ type: "FeatureCollection", features: [{ type: "Feature",
			geometry: { type: "Point", coordinates: [-82.4411930023927, 35.6104483150623] }, properties: { Cmn_Name: "Siberian elm" } }] });
	});

	it("describe reads the layer and its count together", async () => {
		let open = 0;
		let most = 0;
		const slow = async (value: unknown) => {
			most = Math.max(most, ++open);
			await new Promise((r) => setTimeout(r, 5));
			open--;
			return value;
		};
		const { ctx } = fakeCtx({ "/FeatureServer/0/query": () => slow({ count: 3 }), "/FeatureServer/0": () => slow({ name: "pts" }) });
		expect(await layerQuery(ctx, { target: `${SVC}/0`, action: "describe" })).toMatchObject({ name: "pts", count: 3 });
		expect(most).toBe(2);
	});
});
