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

	it("members: add reports who was refused, remove needs confirm, invite sends a role", async () => {
		silence();
		const { ctx, calls } = fakeCtx({
			[`/community/groups/${ID}`]: () => ({ id: ID, title: "team" }),
			[`/community/groups/${ID}/addUsers`]: () => ({ notAdded: ["outsider"] }),
			[`/community/groups/${ID}/removeUsers`]: () => ({ notRemoved: [] }),
			[`/community/groups/${ID}/invite`]: () => ({ success: true }),
			[`/community/groups/${ID}/users`]: () => ({ owner: "jdoe_gis", admins: ["jdoe_gis"], users: ["sara"] }),
		});
		const added: any = await groups(ctx, { action: "add_users", group: ID, users: ["sara", " outsider ", "sara"] });
		expect(calls.find((c) => c.url.endsWith("/addUsers"))!.params).toEqual({ users: "sara,outsider" });
		expect(added).toMatchObject({ added: ["sara"], not_added: ["outsider"], hint: expect.stringMatching(/invite_users/),
			members: { users: ["sara"] } });
		await groups(ctx, { action: "invite_users", group: ID, users: ["omar"], as_managers: true });
		expect(calls.find((c) => c.url.endsWith("/invite"))!.params).toMatchObject({ users: "omar", role: "group_admin" });
		await expect(groups(ctx, { action: "remove_users", group: ID, users: ["sara"] })).rejects.toMatchObject({ code: "confirm_required" });
		expect(calls.some((c) => c.url.endsWith("/removeUsers"))).toBe(false);
		expect(await groups(ctx, { action: "remove_users", group: ID, users: ["sara"], confirm: true })).toMatchObject({ removed: ["sara"] });
		await expect(groups(ctx, { action: "add_users", group: ID, users: [] })).rejects.toMatchObject({ code: "bad_argument" });
	});
});
