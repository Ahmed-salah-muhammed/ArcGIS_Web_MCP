import { describe, expect, it, vi } from "vitest";
import type { ArcGISProps } from "../src/arcgis";
import { folders, itemWrite, publish, resolveGroupId, serviceName, share } from "../src/content";
import { groups } from "../src/groups";
import { buildRenderer, edit, schema } from "../src/layer-writes";
import { findLayer, popupFor, unionExtent, webmap } from "../src/maps";
import type { Ctx } from "../src/portal";
import { operationOf, rest, restUrl } from "../src/rest";
import { ConfirmRequired, requireConfirm } from "../src/safety";
import { run } from "../src/tools";

const ID = "a".repeat(32);
const ID2 = "b".repeat(32);
const SVC = "https://services1.arcgis.com/ORG/arcgis/rest/services/pts/FeatureServer";
const ADMIN = "https://services1.arcgis.com/ORG/arcgis/rest/admin/services/pts/FeatureServer";
const USER = "/sharing/rest/content/users/jdoe_gis";

const props: ArcGISProps = {
	username: "jdoe_gis", fullName: "Jane Doe", role: "org_publisher", orgId: "ORG", orgName: "Example Org",
	isPortal: false, portal: "https://www.arcgis.com", accessToken: "ACCESS-TOKEN-XYZ", refreshToken: "REFRESH-TOKEN-XYZ",
	expiresAt: Date.now() + 1_800_000,
};

type Route = (params: Record<string, unknown>) => unknown;
type Call = { via: "request" | "get" | "upload"; url: string; params: Record<string, unknown>; file?: unknown };

/** Routes match by URL suffix (longest wins); every call is recorded so tests can prove what was NOT sent. */
function fakeCtx(routes: Record<string, Route>, p: ArcGISProps = props) {
	const calls: Call[] = [];
	const answer = (via: Call["via"], url: string, params: Record<string, unknown> = {}, file?: unknown) => {
		calls.push({ via, url, params, file });
		const key = Object.keys(routes).filter((k) => url.endsWith(k)).sort((a, b) => b.length - a.length)[0];
		if (!key) throw new Error(`unexpected ${via} ${url}`);
		return routes[key](params);
	};
	const ctx: Ctx = {
		props: p,
		request: async (url, params) => answer("request", url, params),
		get: async (url, params) => answer("get", url, params),
		upload: async (url, params, file) => answer("upload", url, params, file),
		wait: async () => {},
	};
	const urls = () => calls.map((c) => c.url);
	return { ctx, calls, urls };
}

const silence = () => vi.spyOn(console, "log").mockImplementation(() => {});

describe("confirm rail", () => {
	it("ConfirmRequired carries a preview and the envelope shows it", async () => {
		expect(() => requireConfirm(false, "Deleting X", { n: 1 }, "careful")).toThrow(ConfirmRequired);
		expect(() => requireConfirm(true, "Deleting X", { n: 1 })).not.toThrow();
		const out = await run(props, async () => requireConfirm(undefined, "Deleting X", { n: 1 }, "careful"));
		expect(JSON.parse(out.content[0].text)).toMatchObject({ ok: false, code: "confirm_required",
			preview: { n: 1 }, hint: "careful" });
	});
});

describe("folders", () => {
	it("delete previews the items inside and needs confirm", async () => {
		silence();
		const { ctx, urls } = fakeCtx({
			[USER]: () => ({ folders: [{ id: "f1", title: "mcp_test_f" }] }),
			[`${USER}/f1`]: () => ({ total: 2, items: [{ title: "one" }, { title: "two" }] }),
			[`${USER}/f1/delete`]: () => ({ success: true }),
		});
		await expect(folders(ctx, { action: "delete", name: "MCP_TEST_F" })).rejects.toMatchObject({
			code: "confirm_required", preview: { items_inside: 2, sample: ["one", "two"] } });
		expect(urls().some((u) => u.endsWith("/delete"))).toBe(false);
		expect(await folders(ctx, { action: "delete", name: "mcp_test_f", confirm: true })).toEqual({ deleted: true, folder: "mcp_test_f" });
	});

	it("create is a no-op when the folder exists", async () => {
		const { ctx, urls } = fakeCtx({ [USER]: () => ({ folders: [{ id: "f1", title: "Data" }] }) });
		expect(await folders(ctx, { action: "create", name: "data" })).toMatchObject({ id: "f1", created: false });
		expect(urls().some((u) => u.endsWith("/createFolder"))).toBe(false);
	});
});

describe("item writes", () => {
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

describe("sharing", () => {
	it("refuses an ambiguous group title", async () => {
		const { ctx } = fakeCtx({ "/community/groups": () => ({ results: [
			{ id: ID, title: "Team", owner: "a" }, { id: ID2, title: "team", owner: "b" }] }) });
		await expect(resolveGroupId(ctx, "Team")).rejects.toMatchObject({ code: "ambiguous" });
	});

	it("public sharing needs confirm before any share request", async () => {
		const { ctx, urls } = fakeCtx({});
		await expect(share(ctx, { item_ids: [ID], level: "public" })).rejects.toMatchObject({ code: "confirm_required" });
		expect(urls()).toHaveLength(0);
	});

	it("org sharing sets org=true, everyone=false and checks the result", async () => {
		silence();
		let access = "private";
		const { ctx, calls } = fakeCtx({
			[`/content/items/${ID}`]: () => ({ id: ID, owner: "jdoe_gis", title: "Pts", access }),
			[`/content/items/${ID}/groups`]: () => ({ admin: [], member: [], other: [] }),
			[`${USER}/items/${ID}/share`]: () => {
				access = "org";
				return { notSharedWith: [] };
			},
		});
		const out = await share(ctx, { item_ids: [ID], level: "org" });
		expect(calls.find((c) => c.url.endsWith("/share"))!.params).toEqual({ groups: "", everyone: false, org: true });
		expect(out).toMatchObject({ all_ok: true, results: [{ before: { level: "private" }, after: { level: "org" } }] });
	});
});

describe("publish", () => {
	const pubRoutes = (statuses: string[]) => ({
		[`${USER}/addItem`]: () => ({ id: ID, success: true }),
		"/content/features/analyze": () => ({ publishParameters: { name: "x", locationType: "none" } }),
		"/portals/ORG/isServiceNameAvailable": () => ({ available: true }),
		[`${USER}/publish`]: () => ({ services: [{ serviceItemId: ID2, jobId: "j1", serviceurl: SVC }] }),
		[`${USER}/items/${ID2}/status`]: () => ({ status: statuses.shift() ?? "completed" }),
		[`/content/items/${ID2}`]: () => ({ id: ID2, title: "Cities", type: "Feature Service", owner: "jdoe_gis", url: SVC }),
		"/FeatureServer": () => ({ layers: [{ id: 0, name: "cities" }] }),
		[`${USER}/items/${ID}/delete`]: () => ({ success: true }),
	});

	it("uploads the CSV as a file, publishes by coordinates and waits for the job", async () => {
		silence();
		const { ctx, calls } = fakeCtx(pubRoutes(["processing", "completed"]));
		const out: any = await publish(ctx, { title: "mcp test cities!", csv_text: "NAME,LAT,LON\nA,30,31\nB,29,30",
			latitude_field: "LAT", longitude_field: "LON" });
		const upload = calls.find((c) => c.via === "upload")!;
		expect(upload.params).toMatchObject({ type: "CSV", title: "mcp test cities!" });
		expect(upload.file).toMatchObject({ name: "mcp_test_cities.csv", type: "text/csv" });
		expect(calls.find((c) => c.url.endsWith("/publish"))!.params).toMatchObject({ itemid: ID, filetype: "csv",
			publishParameters: { name: "mcp_test_cities", locationType: "coordinates", latitudeFieldName: "LAT",
				longitudeFieldName: "LON" } });
		expect(calls.filter((c) => c.url.endsWith("/status"))).toHaveLength(2);
		expect(out).toMatchObject({ source_item_id: ID, status: "completed", layers: [{ url: `${SVC}/0` }] });
	});

	it("asks before geocoding addresses - and before uploading anything", async () => {
		const { ctx, calls } = fakeCtx(pubRoutes([]));
		await expect(publish(ctx, { title: "t", csv_text: "ADDR\n1 Main St\n2 Main St", address_fields: { Address: "ADDR" } }))
			.rejects.toMatchObject({ code: "confirm_required", preview: { estimated_credits: 0.08 } });
		expect(calls).toHaveLength(0);
	});

	it("removes its upload when analyze finds addresses and there is no confirm", async () => {
		const routes = { ...pubRoutes([]), "/content/features/analyze": () => ({ publishParameters: { locationType: "address" } }) };
		const { ctx, urls } = fakeCtx(routes);
		await expect(publish(ctx, { title: "t", csv_text: "ADDR\n1 Main St" })).rejects.toMatchObject({ code: "confirm_required" });
		expect(urls().at(-1)).toMatch(new RegExp(`/items/${ID}/delete$`));
		expect(urls().some((u) => u.endsWith("/publish"))).toBe(false);
	});

	it("validates the source before any request", async () => {
		const { ctx, calls } = fakeCtx({});
		await expect(publish(ctx, { title: "t" })).rejects.toMatchObject({ code: "bad_argument" });
		await expect(publish(ctx, { title: "t", csv_text: "a", geojson_text: "{}" })).rejects.toMatchObject({ code: "bad_argument" });
		await expect(publish(ctx, { title: "t", url: "http://example.com/a.csv" })).rejects.toThrow(/https/);
		expect(calls).toHaveLength(0);
		expect(serviceName("  Cairo / Schools (2026) ")).toBe("Cairo_Schools_2026");
	});
});

describe("layer edits", () => {
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
});

describe("layer schema", () => {
	it("add_field maps types, skips existing fields, posts to the admin URL and refuses views", async () => {
		silence();
		let fields = [{ name: "OBJECTID" }, { name: "NAME" }];
		const routes = {
			[`${SVC}/0`]: () => ({ name: "pts", fields }),
			[SVC]: () => ({ isView: false }),
			[`${ADMIN}/0/addToDefinition`]: (p: Record<string, unknown>) => {
				fields = [...fields, ...(p.addToDefinition as any).fields];
				return { success: true };
			},
		};
		const { ctx, calls } = fakeCtx(routes);
		const out: any = await schema(ctx, { action: "add_field", target: `${SVC}/0`,
			fields: [{ name: "STATUS" }, { name: "name" }, { name: "SCORE", type: "double" }] });
		expect((calls.find((c) => c.url.endsWith("/addToDefinition"))!.params.addToDefinition as any).fields).toEqual([
			{ name: "STATUS", type: "esriFieldTypeString", alias: "STATUS", nullable: true, editable: true, length: 256 },
			{ name: "SCORE", type: "esriFieldTypeDouble", alias: "SCORE", nullable: true, editable: true },
		]);
		expect(out).toMatchObject({ added: ["STATUS", "SCORE"], already_existed: ["name"], not_added: null });
		await expect(schema(ctx, { action: "add_field", target: `${SVC}/0`, fields: [{ name: "1bad" }] })).rejects.toThrow(/Bad field name/);
		const view = fakeCtx({ ...routes, [SVC]: () => ({ isView: true }) });
		await expect(schema(view.ctx, { action: "add_field", target: `${SVC}/0`, fields: [{ name: "X" }] }))
			.rejects.toMatchObject({ code: "is_view" });
	});

	it("labels merge into the existing drawingInfo instead of replacing the renderer", async () => {
		silence();
		const { ctx, calls } = fakeCtx({
			[`${SVC}/0`]: () => ({ name: "pts", geometryType: "esriGeometryPolygon", drawingInfo: { renderer: { type: "simple" } } }),
			[SVC]: () => ({}),
			[`${ADMIN}/0/updateDefinition`]: () => ({ success: true }),
		});
		await schema(ctx, { action: "labels", target: `${SVC}/0`, label_field: "NAME" });
		const drawing = (calls.at(-1)!.params.updateDefinition as any).drawingInfo;
		expect(drawing.renderer).toEqual({ type: "simple" });
		expect(drawing.labelingInfo[0]).toMatchObject({ labelExpressionInfo: { expression: "$feature.NAME" },
			labelPlacement: "esriServerPolygonPlacementAlwaysHorizontal" });
	});

	it("create_view: createService -> addToDefinition -> filter on the view layer", async () => {
		silence();
		const VIEW = "https://services1.arcgis.com/ORG/arcgis/rest/services/pts_view/FeatureServer";
		const VIEW_ADMIN = "https://services1.arcgis.com/ORG/arcgis/rest/admin/services/pts_view/FeatureServer";
		const { ctx, calls } = fakeCtx({
			[`${SVC}/0`]: () => ({ name: "pts", objectIdField: "OBJECTID", extent: { spatialReference: { wkid: 4326 } },
				fields: [{ name: "OBJECTID" }, { name: "NAME" }, { name: "POP" }] }),
			[SVC]: () => ({}),
			[`${USER}/createService`]: () => ({ serviceurl: VIEW, itemId: ID2 }),
			[`${VIEW_ADMIN}/addToDefinition`]: () => ({ success: true }),
			[`${VIEW_ADMIN}/0/updateDefinition`]: () => ({ success: true }),
			[`${VIEW}/0/query`]: () => ({ count: 4 }),
		});
		const out = await schema(ctx, { action: "create_view", target: `${SVC}/0`, view_name: "pts view",
			view_where: "POP > 40", view_fields: ["NAME"] });
		const layerDef = (calls.find((c) => c.url.endsWith("/addToDefinition"))!.params.addToDefinition as any).layers[0];
		expect(layerDef.adminLayerInfo.viewLayerDefinition).toEqual({ sourceServiceName: "pts", sourceLayerId: 0, sourceLayerFields: "*" });
		expect(calls.find((c) => c.url.endsWith("/0/updateDefinition"))!.params.updateDefinition).toEqual({
			viewDefinitionQuery: "POP > 40",
			fields: [{ name: "OBJECTID", visible: true }, { name: "NAME", visible: true }, { name: "POP", visible: false }] });
		expect(out).toMatchObject({ view_item_id: ID2, view_url: `${VIEW}/0`, view_count: 4 });
	});

	it("renderers: unique values from counts, quantile class breaks, raw JSON passed through", async () => {
		const { ctx } = fakeCtx({ [`${SVC}/0/query`]: (p) => p.outStatistics
			? { features: [{ attributes: { TYPE: "b", n: 1 } }, { attributes: { TYPE: "a", n: 9 } }] }
			: { features: [1, 2, 3, 4, 5, 6, 7, 8].map((v) => ({ attributes: { POP: v } })) } });
		const u: any = await buildRenderer(ctx, `${SVC}/0`, "esriGeometryPoint", { type: "unique", field: "TYPE" });
		expect(u.uniqueValueInfos.map((i: any) => i.value)).toEqual(["a", "b"]);
		const cb: any = await buildRenderer(ctx, `${SVC}/0`, "esriGeometryPolygon", { type: "class_breaks", field: "POP", classes: 4 });
		expect(cb.classBreakInfos.map((i: any) => i.classMaxValue)).toEqual([2, 4, 6, 8]);
		expect(cb.minValue).toBe(1);
		const raw = { type: "heatmap", colorStops: [] };
		expect(await buildRenderer(ctx, `${SVC}/0`, undefined, raw)).toBe(raw);
	});
});

describe("web maps", () => {
	it("helpers: popups hide system fields, layers found by title/index, extents unioned", () => {
		const p = popupFor({ name: "pts", displayField: "NAME", fields: [{ name: "OBJECTID" }, { name: "NAME", alias: "Name" }] });
		expect(p.title).toBe("{NAME}");
		expect(p.fieldInfos).toEqual([{ fieldName: "OBJECTID", label: "OBJECTID", visible: false },
			{ fieldName: "NAME", label: "Name", visible: true }]);
		const layers = [{ title: "Roads", id: "r1" }, { title: "Pts", id: "p1" }];
		expect(findLayer(layers, "pts")).toBe(1);
		expect(findLayer(layers, "0")).toBe(0);
		expect(() => findLayer(layers, 5)).toThrow(/out of range/);
		expect(unionExtent([[[0, 0], [1, 1]], null, [[-1, 0.5], [0.5, 2]]])).toEqual([[-1, 0], [1, 2]]);
	});

	it("create builds layers with popups on the org default basemap", async () => {
		silence();
		let saved: unknown = null;
		const { ctx, calls } = fakeCtx({
			[`/content/items/${ID}`]: () => ({ id: ID, title: "Pts", type: "Feature Service", url: SVC, extent: [[0, 0], [1, 1]] }),
			[SVC]: () => ({ layers: [{ id: 0, name: "pts" }] }),
			[`${SVC}/0`]: () => ({ name: "pts", fields: [{ name: "NAME" }] }),
			"/portals/self": () => ({ defaultBasemap: { title: "Topographic", baseMapLayers: [{ id: "b" }] } }),
			[`${USER}/addItem`]: (p) => {
				saved = p.text;
				return { id: ID2, success: true };
			},
			[`/content/items/${ID2}/data`]: () => saved,
			[`/content/items/${ID2}`]: () => ({ id: ID2, title: "M", type: "Web Map", owner: "jdoe_gis" }),
		});
		const out: any = await webmap(ctx, { action: "create", title: "M", layers: [ID] });
		expect(calls.find((c) => c.url.endsWith("/addItem"))!.params).toMatchObject({ type: "Web Map", extent: "0,0,1,1" });
		expect(out).toMatchObject({ basemap: "Topographic", layers: [{ title: "Pts", url: `${SVC}/0`, popup: true }] });
	});

	it("refuses layer URLs outside the portal and non-web-map items", async () => {
		const { ctx } = fakeCtx({ [`/content/items/${ID}`]: () => ({ id: ID, type: "CSV" }) });
		await expect(webmap(ctx, { action: "create", title: "M", layers: ["https://evil.example.com/x/FeatureServer/0"] }))
			.rejects.toMatchObject({ code: "host_not_allowed" });
		await expect(webmap(ctx, { action: "describe", item_id: ID })).rejects.toThrow(/not a Web Map/);
	});
});

describe("groups", () => {
	it("public groups need confirm; delete needs confirm", async () => {
		silence();
		const { ctx, urls } = fakeCtx({
			"/community/createGroup": (p) => ({ group: { id: ID, title: p.title, access: p.access } }),
			[`/community/groups/${ID}`]: () => ({ id: ID, title: "mcp_test_g" }),
			[`/community/groups/${ID}/delete`]: () => ({ success: true }),
		});
		await expect(groups(ctx, { action: "create", title: "g", access: "public" })).rejects.toMatchObject({ code: "confirm_required" });
		expect(urls()).toHaveLength(0);
		expect(await groups(ctx, { action: "create", title: "g" })).toMatchObject({ group: { access: "private" } });
		await expect(groups(ctx, { action: "delete", group: ID })).rejects.toMatchObject({ code: "confirm_required" });
		expect(await groups(ctx, { action: "delete", group: ID, confirm: true })).toMatchObject({ deleted: true });
	});
});

describe("raw REST", () => {
	it("resolves paths, reads the operation, and gates writes", async () => {
		silence();
		expect(restUrl("https://www.arcgis.com", "/portals/self")).toBe("https://www.arcgis.com/sharing/rest/portals/self");
		expect(operationOf(`${SVC}/0/query/`)).toBe("query");
		const { ctx, calls } = fakeCtx({
			"/portals/self": () => ({ id: "ORG" }),
			[`${SVC}/0/query`]: () => ({ features: [], exceededTransferLimit: false }),
			[`${USER}/items/${ID}/delete`]: () => ({ success: true }),
		});
		expect(await rest(ctx, { path: "portals/self" })).toMatchObject({ method: "GET", response: { id: "ORG" } });
		expect(calls.at(-1)!.via).toBe("get");
		await rest(ctx, { path: `${SVC}/0/query`, method: "POST", params: { where: "1=1" } });
		await expect(rest(ctx, { path: `content/users/jdoe_gis/items/${ID}/delete`, method: "POST" }))
			.rejects.toMatchObject({ code: "confirm_required" });
		expect(calls.some((c) => c.url.endsWith("/delete"))).toBe(false);
		await expect(rest(ctx, { path: "https://evil.example.com/arcgis/rest/info" })).rejects.toMatchObject({ code: "host_not_allowed" });
	});
});
