import { describe, expect, it } from "vitest";
import { layerQuery, parseStats, rowsFrom } from "../../src/tools/portal_layer_query/handler";
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
});
