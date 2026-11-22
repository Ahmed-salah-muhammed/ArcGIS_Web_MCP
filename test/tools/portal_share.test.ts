import { describe, expect, it } from "vitest";
import { share } from "../../src/tools/portal_share/handler";
import { Budget } from "../../src/tools/shared/context";
import { resolveGroupId } from "../../src/tools/shared/lookup";
import { fakeCtx, ID, ID2, silence, USER } from "../helpers";

describe("portal_share", () => {
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

	it("a call that cannot finish inside the request limit is refused whole, before any item changes", async () => {
		const ids = Array.from({ length: 12 }, (_, i) => i.toString(16).padStart(32, "0"));
		const { ctx, calls } = fakeCtx({});
		ctx.budget = new Budget(50); // 47 for normal work; 12 items x 5 requests = 60
		const e: any = await share(ctx, { item_ids: ids, level: "org" }).catch((x) => x);
		expect(e).toMatchObject({ code: "too_many" });
		expect(e.message).toContain("at most 9 items per call. Nothing was changed.");
		expect(calls).toHaveLength(0);
	});

	it("several items are shared side by side and reported in the order they were given", async () => {
		silence();
		const ids = [ID, ID2, "c".repeat(32), "d".repeat(32)];
		const access: Record<string, string> = Object.fromEntries(ids.map((id) => [id, "private"]));
		let open = 0;
		let most = 0;
		const routes: Record<string, () => unknown> = {};
		for (const id of ids) {
			routes[`/content/items/${id}`] = () => ({ id, owner: "jdoe_gis", title: `T${id[0]}`, access: access[id] });
			routes[`/content/items/${id}/groups`] = () => ({});
			routes[`${USER}/items/${id}/share`] = () => {
				access[id] = "org";
				return {};
			};
		}
		const { ctx } = fakeCtx(routes);
		const request = ctx.request;
		ctx.request = async (url, params) => {
			most = Math.max(most, ++open);
			await new Promise((r) => setTimeout(r, 2));
			open--;
			return request(url, params);
		};
		const out: any = await share(ctx, { item_ids: ids, level: "org" });
		expect(out.results.map((r: any) => r.item_id)).toEqual(ids);
		expect(out.all_ok).toBe(true);
		expect(most).toBeGreaterThan(1);
		expect(most).toBeLessThanOrEqual(6); // Cloudflare's open connections per call
	});
});
