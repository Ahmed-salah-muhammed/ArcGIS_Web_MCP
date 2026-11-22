import { afterEach, describe, expect, it, vi } from "vitest";
import { Budget, makeCtx } from "../../src/tools/shared/context";
import { orRemove } from "../../src/tools/shared/items";
import { mapLimit, pollJob } from "../../src/tools/shared/jobs";
import { resolveLayerUrl, requireId } from "../../src/tools/shared/lookup";
import { run, toResult } from "../../src/tools/shared/mcp";
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

describe("structured results", () => {
	it("are the same envelope as the text, and only when asked for", () => {
		const env = { ok: true as const, data: { n: 1 } };
		expect(toResult(env)).toEqual({ content: [{ type: "text", text: '{"ok":true,"data":{"n":1}}' }] });
		expect(toResult(env, true).structuredContent).toEqual(env);
		expect(toResult({ ok: false, error: "x", code: "bad_argument" }, true)).toMatchObject({ isError: true,
			structuredContent: { ok: false, code: "bad_argument" } });
	});
});

describe("jobs", () => {
	it("polls quickly at first, then every two seconds, and reports progress", async () => {
		const waits: number[] = [];
		const seen: string[] = [];
		const statuses = ["processing", "processing", "processing", "processing", "completed"];
		const { ctx } = fakeCtx({});
		ctx.wait = async (ms) => void waits.push(ms);
		ctx.progress = (message) => void seen.push(message);
		const status = await pollJob(ctx, { what: "Publishing", reserve: 2, failed: "publish_failed",
			check: async () => ({ status: statuses.shift() }) });
		expect(status).toBe("completed");
		expect(waits).toEqual([500, 1000, 1500, 2000, 2000]);
		expect(seen.at(-1)).toBe("Publishing: completed");
	});

	it("gives up after a minute, stops at the request reserve, and throws a failed job", async () => {
		const { ctx } = fakeCtx({});
		let checks = 0;
		expect(await pollJob(ctx, { what: "x", reserve: 2, failed: "f", check: async () => (checks++, { status: "processing" }) }))
			.toBe("processing");
		expect(checks).toBe(32); // 0.5 + 1 + 1.5 + 29 x 2 s: the first check past a minute is the last
		ctx.budget = new Budget(10, 3);
		for (let i = 0; i < 5; i++) ctx.budget.take();
		checks = 0;
		await pollJob(ctx, { what: "x", reserve: 2, failed: "f", check: async () => (checks++, { status: "processing" }) });
		expect(checks).toBe(0); // 2 requests left: exactly the reserve the answer needs
		await expect(pollJob(fakeCtx({}).ctx, { what: "The export", reserve: 0, failed: "export_failed",
			check: async () => ({ status: "failed", statusMessage: "no space" }) })).rejects.toMatchObject({ code: "export_failed",
			message: "The export failed: no space" });
	});

	it("mapLimit keeps the order and never runs more than the limit at once", async () => {
		let open = 0;
		let most = 0;
		const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
			most = Math.max(most, ++open);
			await new Promise((r) => setTimeout(r, n));
			open--;
			return n * 10;
		});
		expect(out).toEqual([50, 10, 40, 20, 30]);
		expect(most).toBe(2);
		expect(await mapLimit([], 3, async (n: number) => n)).toEqual([]);
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
		for (let i = 0; i < 3; i++) await ctx.request(`${SVC}/0/query`);
		await expect(ctx.request(`${SVC}/0/query`).catch((e) => e.code)).resolves.toBe("subrequest_limit");
		expect(fetchMock).toHaveBeenCalledTimes(3);
		await makeCtx(props, [], 6).request(`${SVC}/0/query`); // a new call starts with a full budget
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("an item, service or layer read twice in one call is fetched once, until something may have changed it", async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: "pts", fields: [{ name: "A" }] })));
		vi.stubGlobal("fetch", fetchMock);
		const ctx = makeCtx(props, [], 20);
		const [a, b] = await Promise.all([ctx.request(`${SVC}/0`), ctx.request(`${SVC}/0/`)]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(ctx.budget!.used).toBe(1);
		a.fields.push({ name: "mine" }); // a caller's changes stay its own
		expect(b.fields).toHaveLength(1);
		expect((await ctx.request(`${SVC}/0`)).fields).toHaveLength(1);
		await ctx.request(`${SVC}/0/query`, { where: "1=1" }); // a read keeps the memo
		await ctx.request(`${SVC}/0`);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		await ctx.request(`${SVC}/0`, { returnUpdates: true }); // parameters: never remembered
		expect(fetchMock).toHaveBeenCalledTimes(3);
		await ctx.request(`${SVC}/0/applyEdits`, { adds: [] }); // a write empties it
		await ctx.request(`${SVC}/0`);
		expect(fetchMock).toHaveBeenCalledTimes(5);
		await makeCtx(props, [], 20).request(`${SVC}/0`); // and it never outlives the call
		expect(fetchMock).toHaveBeenCalledTimes(6);
	});

	it("a failed read is not remembered", async () => {
		const answers = [new Response(JSON.stringify({ error: { code: 500, message: "down" } })), new Response('{"name":"pts"}')];
		vi.stubGlobal("fetch", vi.fn(async () => answers.shift()!));
		const ctx = makeCtx(props, [], 20);
		await expect(ctx.request(`${SVC}/0`)).rejects.toMatchObject({ code: "arcgis_error" });
		expect(await ctx.request(`${SVC}/0`)).toEqual({ name: "pts" });
	});

	it("retries once after 429, and after 503 only for a GET; the retry is counted", async () => {
		const waits: number[] = [];
		const wait = async (ms: number) => void waits.push(ms);
		const limited = () => new Response(JSON.stringify({ error: { code: 429, message: "Too many requests" } }));
		let answers = [limited(), new Response('{"ok":1}')];
		const fetchMock = vi.fn(async () => answers.shift()!);
		vi.stubGlobal("fetch", fetchMock);
		const ctx = makeCtx(props, [], 20, { wait });
		expect(await ctx.request(`${SVC}/0/applyEdits`, { adds: [] })).toEqual({ ok: 1 });
		expect(waits).toEqual([1500]);
		expect(ctx.budget!.used).toBe(2);
		answers = [limited(), limited()];
		await expect(ctx.request(`${SVC}/0/query`)).rejects.toMatchObject({ code: "rate_limited" }); // one retry, not a loop
		expect(fetchMock).toHaveBeenCalledTimes(4);
		answers = [new Response("busy", { status: 503 })];
		await expect(ctx.request(`${SVC}/0/applyEdits`, { adds: [] })).rejects.toMatchObject({ status: 503 }); // a write is not repeated
		expect(fetchMock).toHaveBeenCalledTimes(5);
		answers = [new Response("busy", { status: 503 }), new Response('{"ok":2}')];
		expect(await ctx.get!(`${SVC}/0`)).toEqual({ ok: 2 });
	});

	it("a request that never answers ends as a timeout error", async () => {
		vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
			init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
		})));
		const { withTimeout } = await import("../../src/arcgis");
		const e: any = await withTimeout("https://services1.arcgis.com/x", 20, (signal) => fetch("https://services1.arcgis.com/x", { signal }))
			.catch((x) => x);
		expect(e).toMatchObject({ code: "timeout" });
		expect(e.message).toContain("services1.arcgis.com did not answer");
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
