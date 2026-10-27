import { describe, expect, it } from "vitest";
import { groups } from "../../src/tools/portal_groups/handler";
import { fakeCtx, ID, silence } from "../helpers";

describe("portal_groups", () => {
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
