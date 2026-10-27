import { describe, expect, it } from "vitest";
import { TOOLS } from "../../src/tools";
import { batch, resolve } from "../../src/tools/portal_batch/handler";
import type { Envelope, ToolSpec } from "../../src/tools/shared/mcp";
import { fakeCtx, ID, ID2 } from "../helpers";

const registry = new Map(TOOLS.filter((t) => t.name !== "portal_batch").map((t) => [t.name, t] as [string, ToolSpec]));

describe("portal_batch", () => {
	it("resolves {{callN.path}} keeping the type, and interpolates inside strings", () => {
		const results: Envelope[] = [{ ok: true, data: { items: [{ id: ID, n: 3 }] } }];
		expect(resolve({ item_id: "{{call0.data.items.0.id}}", n: "{{prev.data.items.0.n}}", note: "n={{call0.data.items.0.n}}" }, results, 1))
			.toEqual({ item_id: ID, n: 3, note: "n=3" });
		expect(() => resolve("{{call1.data}}", results, 1)).toThrow(/has not run/);
		expect(() => resolve("{{call0.data.missing}}", results, 1)).toThrow(/no 'missing'/);
	});

	it("runs calls in order, feeding results forward", async () => {
		const { ctx, calls } = fakeCtx({
			"/sharing/rest/search": () => ({ total: 1, results: [{ id: ID, title: "Pts", type: "Feature Service" }] }),
			[`/content/items/${ID}`]: () => ({ id: ID, title: "Pts", type: "CSV", tags: [] }),
		});
		const out: any = await batch(ctx, { calls: [
			{ tool: "portal_search", args: { query: "pts" } },
			{ tool: "portal_item", args: { item_id: "{{call0.data.items.0.id}}" } },
		] }, registry);
		expect(out).toMatchObject({ calls: 2, completed: 2, all_ok: true, stopped_at: null });
		expect(out.results[1]).toMatchObject({ tool: "portal_item", ok: true, data: { id: ID, title: "Pts" } });
		expect(calls.map((c) => c.url.split("/rest/")[1])).toEqual(["search", `content/items/${ID}`]);
	});

	it("validates each call like a direct call and stops at the first failure", async () => {
		const { ctx, calls } = fakeCtx({});
		const out: any = await batch(ctx, { calls: [
			{ tool: "portal_item", args: { item_id: 42 } },
			{ tool: "portal_whoami" },
		] }, registry);
		expect(out).toMatchObject({ completed: 1, all_ok: false, stopped_at: 0, skipped: [{ index: 1, tool: "portal_whoami" }] });
		expect(out.results[0]).toMatchObject({ ok: false, code: "bad_argument" });
		expect(calls).toHaveLength(0);
	});

	it("a call that needs confirmation stops the batch with its preview", async () => {
		const { ctx, urls } = fakeCtx({
			[`/content/items/${ID}`]: () => ({ id: ID, owner: "jdoe_gis", title: "Pts", type: "CSV" }),
			[`/content/items/${ID}/dependencies/listDependentsTo`]: () => ({ list: [] }),
		});
		const out: any = await batch(ctx, { calls: [
			{ tool: "portal_item", args: { item_id: ID, action: "delete" } },
			{ tool: "portal_item", args: { item_id: ID2, action: "delete", confirm: true } },
		] }, registry);
		expect(out.results[0]).toMatchObject({ ok: false, code: "confirm_required", preview: { item: { id: ID } } });
		expect(out.stopped_at).toBe(0);
		expect(urls().some((u) => u.endsWith("/delete"))).toBe(false);
	});

	it("refuses unknown tools, nesting, too many calls, and placeholders in parallel mode", async () => {
		const { ctx } = fakeCtx({});
		await expect(batch(ctx, { calls: [{ tool: "portal_nope" }] }, registry)).rejects.toThrow(/Unknown tool/);
		await expect(batch(ctx, { calls: [{ tool: "portal_batch" }] }, registry)).rejects.toThrow(/Unknown tool/);
		await expect(batch(ctx, { calls: Array(11).fill({ tool: "portal_whoami" }) }, registry)).rejects.toMatchObject({ code: "too_many" });
		await expect(batch(ctx, { parallel: true, calls: [{ tool: "portal_whoami" },
			{ tool: "portal_item", args: { item_id: "{{call0.data.username}}" } }] }, registry)).rejects.toThrow(/in order/);
	});

	it("is registered last, after every tool it can call", () => {
		expect(TOOLS.map((t) => t.name).at(-1)).toBe("portal_batch");
		expect(TOOLS).toHaveLength(13);
	});
});
