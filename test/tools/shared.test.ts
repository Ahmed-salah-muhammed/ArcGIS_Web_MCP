import { afterEach, describe, expect, it, vi } from "vitest";
import { Budget, makeCtx } from "../../src/tools/shared/context";
import { orRemove } from "../../src/tools/shared/items";
import { resolveLayerUrl, requireId } from "../../src/tools/shared/lookup";
import { run } from "../../src/tools/shared/mcp";
import { ConfirmRequired, requireConfirm } from "../../src/tools/shared/safety";
import { fakeCtx, ID, props, SVC } from "../helpers";

describe("confirm rail", () => {
	it("ConfirmRequired carries a preview and the envelope shows it", async () => {
		expect(() => requireConfirm(false, "Deleting X", { n: 1 }, "careful")).toThrow(ConfirmRequired);
		expect(() => requireConfirm(true, "Deleting X", { n: 1 })).not.toThrow();
		const out = await run(props, async () => requireConfirm(undefined, "Deleting X", { n: 1 }, "careful"));
		expect(JSON.parse(out.content[0].text)).toMatchObject({ ok: false, code: "confirm_required",
			preview: { n: 1 }, hint: "careful" });
	});
});

describe("tool envelope", () => {
	it("wraps results and scrubs tokens from errors", async () => {
		const ok = await run(props, async () => ({ n: 1 }));
		expect(JSON.parse(ok.content[0].text)).toEqual({ ok: true, data: { n: 1 } });
		const bad = await run(props, async () => { throw new Error("boom with ACCESS-TOKEN-XYZ inside"); });
		expect(bad.isError).toBe(true);
		const body = JSON.parse(bad.content[0].text);
		expect(body).toMatchObject({ ok: false, code: "exception" });
		expect(body.error).not.toContain("ACCESS-TOKEN-XYZ");
	});
});

describe("lookups", () => {
	it("rejects titles and other non-ids before any request", () => {
		expect(() => requireId("Parcels layer")).toThrow(/not an item id/);
	});

	it("resolves item id -> service -> layer by index or name", async () => {
		const routes = {
			[`/content/items/${ID}`]: () => ({ id: ID, type: "Feature Service", url: SVC }),
			"/FeatureServer": () => ({ layers: [{ id: 0, name: "pts" }], tables: [{ id: 5, name: "visits" }] }),
		};
		expect(await resolveLayerUrl(fakeCtx(routes).ctx, ID, 1)).toBe(`${SVC}/5`);
		expect(await resolveLayerUrl(fakeCtx(routes).ctx, ID, "Visits")).toBe(`${SVC}/5`);
		await expect(resolveLayerUrl(fakeCtx(routes).ctx, ID, 7)).rejects.toThrow(/out of range/);
		expect(await resolveLayerUrl(fakeCtx(routes).ctx, `${SVC}/0`)).toBe(`${SVC}/0`);
	});

	it("never sends the token to a host outside the portal", async () => {
		const { ctx, calls } = fakeCtx({});
		await expect(resolveLayerUrl(ctx, "https://evil.example.com/arcgis/rest/services/x/FeatureServer/0"))
			.rejects.toMatchObject({ code: "host_not_allowed" });
		expect(calls).toHaveLength(0);
	});
});

describe("request budget", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("stops before the limit, keeping a reserve that only cleanup may use", async () => {
		const b = new Budget(5, 2);
		b.take(); b.take(); b.take();
		expect(b.left()).toBe(0);
		expect(() => b.take()).toThrow(expect.objectContaining({ code: "subrequest_limit" }));
		await b.cleanup(async () => { b.take(); b.take(); });
		expect(() => b.take()).toThrow(/reached 5 requests/);
	});

	it("each real context counts its own requests, and a refused one is a rejected promise", async () => {
		const fetchMock = vi.fn(async () => new Response("{}"));
		vi.stubGlobal("fetch", fetchMock);
		const ctx = makeCtx(props, [], 6);
		for (let i = 0; i < 3; i++) await ctx.request(`${SVC}/0`);
		await expect(ctx.request(`${SVC}/0`).catch((e) => e.code)).resolves.toBe("subrequest_limit");
		expect(fetchMock).toHaveBeenCalledTimes(3);
		await makeCtx(props, [], 6).request(`${SVC}/0`); // a new call starts with a full budget
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("a half-made item is still removed when the budget runs out", async () => {
		const { ctx, urls } = fakeCtx({ "/never": () => ({}), [`/items/${ID}/delete`]: () => ({ success: true }) });
		ctx.budget = new Budget(4, 1);
		const take = ctx.request;
		ctx.request = async (url, params) => (ctx.budget!.take(), take(url, params));
		await expect(orRemove(ctx, [ID], async () => {
			for (let i = 0; i < 10; i++) await ctx.request("/never");
		})).rejects.toMatchObject({ code: "subrequest_limit" });
		expect(urls().filter((u) => u === "/never")).toHaveLength(3);
		expect(urls().at(-1)).toMatch(new RegExp(`/items/${ID}/delete$`));
	});
});
