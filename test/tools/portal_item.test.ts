import { describe, expect, it } from "vitest";
import { exportItem, item, itemWrite, suggestMetadata } from "../../src/tools/portal_item/handler";
import { fakeCtx, ID, ID2, silence, SVC, USER } from "../helpers";

describe("portal_item: read", () => {
	it("get lists a feature service's layers and tables with their index", async () => {
		const { ctx } = fakeCtx({
			[`/content/items/${ID}`]: () => ({ id: ID, title: "Pts", type: "Feature Service", url: SVC,
				typeKeywords: ["Hosted Service"], tags: [] }),
			"/FeatureServer": () => ({ layers: [{ id: 0, name: "pts", geometryType: "esriGeometryPoint" }],
				tables: [{ id: 3, name: "visits" }] }),
		});
		const out: any = await item(ctx, { item_id: ID });
		expect(out.is_hosted).toBe(true);
		expect(out.layers).toEqual([
			{ index: 0, kind: "layer", id: 0, name: "pts", geometryType: "esriGeometryPoint", url: `${SVC}/0` },
			{ index: 1, kind: "table", id: 3, name: "visits", geometryType: null, url: `${SVC}/3` },
		]);
	});

	it("data is truncated to max_chars", async () => {
		const { ctx } = fakeCtx({ [`/content/items/${ID}/data`]: () => ({ big: "x".repeat(5000) }) });
		const out: any = await item(ctx, { item_id: ID, action: "data", max_chars: 1000 });
		expect(out.chars).toBeGreaterThan(5000);
		expect(typeof out.data).toBe("string");
		expect(out.data).toContain("more chars");
	});
});

describe("portal_item: write", () => {
	it("update sends only updatable keys, joins tags, and reports before/after", async () => {
		silence();
		let state: Record<string, unknown> = { id: ID, owner: "jdoe_gis", title: "Old", tags: ["a"], type: "CSV" };
		const { ctx, calls } = fakeCtx({
			[`/content/items/${ID}`]: () => state,
			[`${USER}/items/${ID}/update`]: (p) => {
				state = { ...state, title: p.title, tags: String(p.tags).split(",") };
				return { success: true };
			},
		});
		const out: any = await itemWrite(ctx, { action: "update", item_id: ID,
			properties: { title: "New", tags: ["x", "y"], owner: "someone_else" } });
		expect(calls.find((c) => c.url.endsWith("/update"))!.params).toEqual({ title: "New", tags: "x,y" });
		expect(out).toMatchObject({ updated: true, before: { title: "Old" }, after: { title: "New", tags: ["x", "y"] },
			rejected_keys: ["owner"] });
		await expect(itemWrite(ctx, { action: "update", item_id: ID, properties: { owner: "x" } }))
			.rejects.toMatchObject({ code: "nothing_to_do" });
	});

	it("delete refuses protected items and otherwise needs confirm", async () => {
		silence();
		let isProtected = true;
		const { ctx, urls } = fakeCtx({
			[`/content/items/${ID}`]: () => ({ id: ID, owner: "jdoe_gis", title: "Pts", type: "Feature Service", protected: isProtected }),
			[`/content/items/${ID}/dependencies/listDependentsTo`]: () => ({ list: [{ id: ID2 }] }),
			[`${USER}/items/${ID}/delete`]: () => ({ success: true }),
		});
		await expect(itemWrite(ctx, { action: "delete", item_id: ID, confirm: true })).rejects.toMatchObject({ code: "protected" });
		isProtected = false;
		await expect(itemWrite(ctx, { action: "delete", item_id: ID })).rejects.toMatchObject({
			code: "confirm_required", preview: { items_that_use_it: 1 }, hint: "Items that use it will break." });
		expect(urls().some((u) => u.endsWith("/delete"))).toBe(false);
		expect(await itemWrite(ctx, { action: "delete", item_id: ID, confirm: true })).toEqual({ item_id: ID, deleted: true });
	});

	it("move with no folder goes to the root", async () => {
		silence();
		const { ctx, calls } = fakeCtx({
			[`/content/items/${ID}`]: () => ({ id: ID, owner: "jdoe_gis" }),
			[`${USER}/items/${ID}/move`]: () => ({ success: true }),
		});
		await itemWrite(ctx, { action: "move", item_id: ID });
		expect(calls.at(-1)!.params).toEqual({ folder: "/" });
	});
});

describe("portal_item: export and metadata", () => {
	it("export starts the job in the user's content, waits for it, and returns a download link", async () => {
		silence();
		const statuses = ["processing", "completed"];
		const { ctx, calls } = fakeCtx({
			[`/content/items/${ID}`]: () => ({ id: ID, title: "Pts", type: "Feature Service", tags: ["a"] }),
			[`${USER}/export`]: () => ({ exportItemId: ID2, jobId: "j1", type: "CSV" }),
			[`${USER}/items/${ID2}/status`]: () => ({ status: statuses.shift() ?? "completed" }),
			[`/content/items/${ID2}`]: () => ({ id: ID2, title: "Pts_csv", type: "CSV", owner: "jdoe_gis" }),
		});
		const out: any = await exportItem(ctx, { item_id: ID, format: "csv" });
		expect(calls.find((c) => c.url.endsWith("/export"))!.params).toMatchObject({ itemId: ID, exportFormat: "CSV", title: "Pts_csv" });
		expect(out).toMatchObject({ status: "completed", format: "CSV", export_item: { id: ID2 },
			download_url: `https://www.arcgis.com/sharing/rest/content/items/${ID2}/data` });
		await expect(exportItem(ctx, { item_id: ID, format: "pdf" })).rejects.toMatchObject({ code: "bad_argument" });
	});

	it("export refuses items that are not feature layers", async () => {
		const { ctx } = fakeCtx({ [`/content/items/${ID}`]: () => ({ id: ID, title: "M", type: "Web Map" }) });
		await expect(exportItem(ctx, { item_id: ID, format: "csv" })).rejects.toMatchObject({ code: "unsupported" });
	});

	it("suggest_metadata reads the layers, and apply merges the tags into the item", async () => {
		silence();
		const { ctx, calls } = fakeCtx({
			[`/content/items/${ID}`]: () => ({ id: ID, title: "Roads", type: "Feature Service", url: SVC, owner: "jdoe_gis", tags: ["mine"] }),
			"/FeatureServer": () => ({ layers: [{ id: 0, name: "roads" }] }),
			[`${SVC}/0`]: () => ({ name: "roads", geometryType: "esriGeometryPolyline", fields: [{ name: "OBJECTID" }, { name: "SPEED" }, { name: "LANES" }] }),
			[`${SVC}/0/query`]: () => ({ count: 42 }),
			[`${USER}/items/${ID}/update`]: () => ({ success: true }),
		});
		const draft: any = await suggestMetadata(ctx, { item_id: ID });
		expect(draft).toMatchObject({ applied: false, suggestion: { theme: "transportation" } });
		expect(draft.suggestion.summary).toContain("(42 features)");
		const applied: any = await suggestMetadata(ctx, { item_id: ID, apply: true });
		const sent = calls.find((c) => c.url.endsWith("/update"))!.params;
		expect(String(sent.tags).split(",")[0]).toBe("mine");
		expect(applied.applied).toBe(true);
	});
});
