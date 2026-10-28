import { describe, expect, it } from "vitest";
import { VERSION } from "../../src/pages/identity";
import { findLayer, popupFor, unionExtent, webmap } from "../../src/tools/portal_map/handler";
import { fakeCtx, ID, ID2, silence, SVC, USER } from "../helpers";

describe("portal_map", () => {
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
		expect(saved).toMatchObject({ authoringApp: "ArcGIS Web MCP", authoringAppVersion: VERSION });
	});

	it("refuses layer URLs outside the portal and non-web-map items", async () => {
		const { ctx } = fakeCtx({ [`/content/items/${ID}`]: () => ({ id: ID, type: "CSV" }) });
		await expect(webmap(ctx, { action: "create", title: "M", layers: ["https://evil.example.com/x/FeatureServer/0"] }))
			.rejects.toMatchObject({ code: "host_not_allowed" });
		await expect(webmap(ctx, { action: "describe", item_id: ID })).rejects.toThrow(/not a Web Map/);
	});
});
