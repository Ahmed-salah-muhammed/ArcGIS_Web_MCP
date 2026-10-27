import { describe, expect, it } from "vitest";
import { share } from "../../src/tools/portal_share/handler";
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
});
