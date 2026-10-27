import { describe, expect, it } from "vitest";
import { edit } from "../../src/tools/portal_layer_edit/handler";
import { fakeCtx, props, type Route, silence, SVC } from "../helpers";

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
});
