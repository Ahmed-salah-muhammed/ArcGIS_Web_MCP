import { describe, expect, it } from "vitest";
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
