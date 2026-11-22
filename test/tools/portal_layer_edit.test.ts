import { describe, expect, it } from "vitest";
import { edit } from "../../src/tools/portal_layer_edit/handler";
import { fakeCtx, ID, props, type Route, silence, SVC } from "../helpers";

const layerRoutes = (extra: Record<string, Route> = {}) => ({
	[`${SVC}/0`]: () => ({ name: "pts", objectIdField: "OBJECTID", globalIdField: "GlobalID", geometryType: "esriGeometryPoint",
		fields: [{ name: "OBJECTID" }, { name: "NAME" }] }),
	[`${SVC}/0/query`]: (p: Record<string, unknown>) => p.returnCountOnly ? { count: 3 }
		: p.returnIdsOnly ? { objectIds: [4, 5] }
			: { features: [{ attributes: { OBJECTID: 1, NAME: "old" } }] },
	[`${SVC}/0/applyEdits`]: (p: Record<string, unknown>) => ({
		addResults: JSON.parse(JSON.stringify(p.adds ?? [])).map((_: unknown, i: number) => ({ success: i !== 1, objectId: i,
			error: i === 1 ? { description: "bad" } : undefined })),
		updateResults: (p.updates as unknown[] ?? []).map(() => ({ success: true })),
		deleteResults: String(p.deletes ?? "").split(",").filter(Boolean).map(() => ({ success: true })),
	}),
	...extra,
});

// Shapes from Esri's REST reference for the layer Append operation and the ArcGIS API for Python's FeatureLayer.append
// (appendSourceInfo = the publishParameters of features/analyze, for CSV and Excel); not yet run against a live layer.
describe("portal_layer_edit: append", () => {
	const JOB = `${SVC}/0/append/jobs/abc`;
	const appendRoutes = (type: string, statuses: string[], layer: Record<string, unknown> = {}) => {
		let count = 3;
		return {
			[`${SVC}/0`]: () => ({ name: "pts", objectIdField: "OBJECTID", globalIdField: "GlobalID", supportsAppend: true,
				supportedAppendFormats: "shapefile,geojson,csv,featureCollection,excel,filegdb", ...layer }),
			[`${SVC}/0/query`]: () => ({ count }),
			[`/content/items/${ID}`]: () => ({ id: ID, title: "more points", type, owner: "jdoe_gis" }),
			"/content/features/analyze": () => ({ publishParameters: { locationType: "coordinates", latitudeFieldName: "LAT" } }),
			[`${SVC}/0/append`]: () => ({ statusUrl: JOB }),
			[JOB]: () => {
				const status = statuses.shift() ?? "Completed";
				if (status === "Completed") count = 10;
				return { status, layerName: "pts" };
			},
		};
	};

	it("asks first with a preview, then starts the job, waits for it and reports the rows", async () => {
		silence();
		const { ctx, calls, urls } = fakeCtx(appendRoutes("CSV", ["Processing", "Completed"]));
		await expect(edit(ctx, { target: `${SVC}/0`, action: "append", source_item_id: ID })).rejects.toMatchObject({
			code: "confirm_required", preview: { layer: "pts", rows_now: 3, format: "csv", upsert: false } });
		expect(urls().some((u) => u.endsWith("/append"))).toBe(false);
		const dry: any = await edit(ctx, { target: `${SVC}/0`, action: "append", source_item_id: ID, dry_run: true });
		expect(dry).toMatchObject({ dry_run: true, preview: { source: { id: ID } } });

		const out: any = await edit(ctx, { target: `${SVC}/0`, action: "append", source_item_id: ID, confirm: true });
		expect(calls.find((c) => c.url.endsWith("/append"))!.params).toEqual({ appendItemId: ID, appendUploadFormat: "csv",
			appendSourceInfo: { locationType: "coordinates", latitudeFieldName: "LAT" }, upsert: false, upsertMatchingField: undefined,
			updateGeometry: true, rollbackOnFailure: true });
		expect(calls.filter((c) => c.url === JOB)).toHaveLength(2);
		expect(out).toMatchObject({ layer: "pts", format: "csv", rows_before: 3, rows_after: 10, status: "completed" });
	});

	it("upsert matches on the global id unless a field is given; other files need no analyze", async () => {
		silence();
		const { ctx, calls, urls } = fakeCtx(appendRoutes("GeoJson", []));
		await edit(ctx, { target: `${SVC}/0`, action: "append", source_item_id: ID, upsert: true, confirm: true });
		expect(calls.find((c) => c.url.endsWith("/append"))!.params).toMatchObject({ appendUploadFormat: "geojson", upsert: true,
			upsertMatchingField: "GlobalID", appendSourceInfo: undefined });
		expect(urls().some((u) => u.endsWith("/analyze"))).toBe(false);
		const keyed = fakeCtx(appendRoutes("Shapefile", []));
		await edit(keyed.ctx, { target: `${SVC}/0`, action: "append", source_item_id: ID, upsert: true, match_field: "ASSET_ID", confirm: true });
		expect(keyed.calls.find((c) => c.url.endsWith("/append"))!.params.upsertMatchingField).toBe("ASSET_ID");
	});

	it("wait=false returns the job's status URL; a failed job is an error", async () => {
		silence();
		const later = fakeCtx(appendRoutes("GeoJson", ["Processing"]));
		const out: any = await edit(later.ctx, { target: `${SVC}/0`, action: "append", source_item_id: ID, confirm: true, wait: false });
		expect(out).toMatchObject({ status: "still processing", status_url: JOB, rows_after: null });
		expect(later.calls.some((c) => c.url === JOB)).toBe(false);
		const failing = fakeCtx({ ...appendRoutes("GeoJson", []), [JOB]: () => ({ status: "Failed", error: { description: "bad geometry" } }) });
		await expect(edit(failing.ctx, { target: `${SVC}/0`, action: "append", source_item_id: ID, confirm: true }))
			.rejects.toMatchObject({ code: "append_failed", message: "The append failed: bad geometry" });
	});

	it("refuses what the layer cannot take, before asking or writing", async () => {
		const noAppend = fakeCtx(appendRoutes("CSV", [], { supportsAppend: false }));
		await expect(edit(noAppend.ctx, { target: `${SVC}/0`, action: "append", source_item_id: ID, confirm: true }))
			.rejects.toMatchObject({ code: "unsupported" });
		const webMap = fakeCtx(appendRoutes("Web Map", []));
		await expect(edit(webMap.ctx, { target: `${SVC}/0`, action: "append", source_item_id: ID, confirm: true }))
			.rejects.toThrow(/A Web Map item cannot be appended/);
		const narrow = fakeCtx(appendRoutes("CSV", [], { supportedAppendFormats: "geojson,shapefile" }));
		await expect(edit(narrow.ctx, { target: `${SVC}/0`, action: "append", source_item_id: ID, confirm: true }))
			.rejects.toThrow(/appends geojson, shapefile, not csv/);
		const noKey = fakeCtx(appendRoutes("GeoJson", [], { globalIdField: "" }));
		await expect(edit(noKey.ctx, { target: `${SVC}/0`, action: "append", source_item_id: ID, upsert: true, confirm: true }))
			.rejects.toThrow(/upsert needs match_field/);
		await expect(edit(noKey.ctx, { target: `${SVC}/0`, action: "append" })).rejects.toThrow(/source_item_id is required/);
		for (const c of [noAppend, webMap, narrow, noKey]) expect(c.urls().some((u) => u.endsWith("/append"))).toBe(false);
	});
});

describe("portal_layer_edit", () => {
	it("updates need the object id; dry_run shows a diff without writing", async () => {
		const { ctx, urls } = fakeCtx(layerRoutes());
		await expect(edit(ctx, { target: `${SVC}/0`, updates: [{ NAME: "x" }] })).rejects.toThrow(/OBJECTID/);
		const out: any = await edit(ctx, { target: `${SVC}/0`, updates: [{ OBJECTID: 1, NAME: "new" }], dry_run: true });
		expect(out.preview.update_diff).toEqual([{ id: 1, changes: { NAME: { from: "old", to: "new" } } }]);
		expect(urls().some((u) => u.endsWith("/applyEdits"))).toBe(false);
	});

	it("deletes by where need confirm; adds are batched and every result is checked", async () => {
		silence();
		const { ctx, calls } = fakeCtx(layerRoutes());
		await expect(edit(ctx, { target: `${SVC}/0`, where: "NAME = 'x'" })).rejects.toMatchObject({
			code: "confirm_required", preview: { deletes: 2 } });
		const del: any = await edit(ctx, { target: `${SVC}/0`, where: "NAME = 'x'", confirm: true });
		expect(calls.at(-1)!.params.deletes).toBe("4,5");
		expect(del.all_ok).toBe(true);
		const adds = Array.from({ length: 5 }, (_, i) => ({ NAME: `n${i}` }));
		const out: any = await edit(ctx, { target: `${SVC}/0`, adds, batch_size: 2 });
		expect(calls.filter((c) => c.url.endsWith("/applyEdits") && c.params.adds)).toHaveLength(3);
		expect(out.all_ok).toBe(false);
		expect(out.failures[0]).toMatchObject({ kind: "adds", error: { description: "bad" } });
	});

	it("caps the edits per call and refuses truncate off hosted services", async () => {
		const { ctx } = fakeCtx({ ...layerRoutes(),
			"https://gis.example.com/server/rest/services/x/FeatureServer/0": () => ({ name: "x" }) });
		await expect(edit(ctx, { target: `${SVC}/0`, adds: Array(5001).fill({ NAME: "a" }) })).rejects.toMatchObject({ code: "too_many" });
		const onPrem = fakeCtx({ "/FeatureServer/0": () => ({ name: "x" }) },
			{ ...props, portal: "https://gis.example.com/portal", isPortal: true });
		await expect(edit(onPrem.ctx, { target: "https://gis.example.com/server/rest/services/x/FeatureServer/0", action: "truncate",
			confirm: true })).rejects.toMatchObject({ code: "not_hosted" });
	});

	it("calculate previews the affected count before writing", async () => {
		const { ctx, urls } = fakeCtx(layerRoutes());
		await expect(edit(ctx, { target: `${SVC}/0`, action: "calculate", where: "1=1",
			expressions: [{ field: "NAME", value: "z" }] })).rejects.toMatchObject({ code: "confirm_required", preview: { rows_affected: 3 } });
		expect(urls().some((u) => u.endsWith("/calculate"))).toBe(false);
	});

	it("add_attachment uploads the bytes under the 'attachment' field; delete needs confirm", async () => {
		silence();
		const { ctx, calls, urls } = fakeCtx({
			[`${SVC}/0`]: () => ({ name: "pts", hasAttachments: true }),
			[`${SVC}/0/1/addAttachment`]: () => ({ addAttachmentResult: { objectId: 7, success: true } }),
			[`${SVC}/0/1/deleteAttachments`]: () => ({ deleteAttachmentResults: [{ objectId: 7, success: true }] }),
		});
		const out: any = await edit(ctx, { target: `${SVC}/0`, action: "add_attachment", object_id: 1, file_name: "note.txt",
			content_base64: btoa("hello"), content_type: "text/plain" });
		const upload = calls.find((c) => c.via === "upload")!;
		expect(upload.file).toMatchObject({ name: "note.txt", type: "text/plain", field: "attachment" });
		expect(new TextDecoder().decode((upload.file as any).content)).toBe("hello");
		expect(out).toMatchObject({ attachment_id: 7, bytes: 5, url: `${SVC}/0/1/attachments/7` });
		await expect(edit(ctx, { target: `${SVC}/0`, action: "delete_attachments", object_id: 1, attachment_ids: [7] }))
			.rejects.toMatchObject({ code: "confirm_required" });
		expect(urls().some((u) => u.endsWith("/deleteAttachments"))).toBe(false);
		const del: any = await edit(ctx, { target: `${SVC}/0`, action: "delete_attachments", object_id: 1, attachment_ids: [7], confirm: true });
		expect(del).toMatchObject({ deleted: [7], failed: null });
	});

	it("attachments need a layer with attachments and valid content", async () => {
		const off = fakeCtx({ [`${SVC}/0`]: () => ({ name: "pts", hasAttachments: false }) });
		await expect(edit(off.ctx, { target: `${SVC}/0`, action: "add_attachment", object_id: 1, file_name: "a", content_text: "x" }))
			.rejects.toMatchObject({ code: "no_attachments" });
		const on = fakeCtx({ [`${SVC}/0`]: () => ({ name: "pts", hasAttachments: true }) });
		await expect(edit(on.ctx, { target: `${SVC}/0`, action: "add_attachment", object_id: 1, file_name: "a", content_base64: "%%%" }))
			.rejects.toThrow(/not valid base64/);
	});
});
