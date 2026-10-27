import { describe, expect, it } from "vitest";
import { schema } from "../../src/tools/portal_layer_schema/handler";
import { buildRenderer } from "../../src/tools/shared/renderer";
import { ADMIN, fakeCtx, ID2, silence, SVC, USER } from "../helpers";

describe("portal_layer_schema", () => {
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

	it("enable_attachments turns them on through the admin URL, and never on a view", async () => {
		silence();
		let has = false;
		const routes = {
			[`${SVC}/0`]: () => ({ name: "pts", hasAttachments: has }),
			[SVC]: () => ({ isView: false }),
			[`${ADMIN}/0/updateDefinition`]: (p: Record<string, unknown>) => {
				has = (p.updateDefinition as any).hasAttachments;
				return { success: true };
			},
		};
		const { ctx, calls } = fakeCtx(routes);
		expect(await schema(ctx, { action: "enable_attachments", target: `${SVC}/0` })).toEqual({ layer: "pts", has_attachments: true, changed: true });
		expect(calls.find((c) => c.url.endsWith("/updateDefinition"))!.params).toEqual({ updateDefinition: { hasAttachments: true } });
		expect(await schema(ctx, { action: "enable_attachments", target: `${SVC}/0` })).toMatchObject({ changed: false });
		const view = fakeCtx({ ...routes, [SVC]: () => ({ isView: true }) });
		await expect(schema(view.ctx, { action: "enable_attachments", target: `${SVC}/0` })).rejects.toMatchObject({ code: "is_view" });
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
