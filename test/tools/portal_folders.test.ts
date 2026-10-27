import { describe, expect, it } from "vitest";
import { folders } from "../../src/tools/portal_folders/handler";
import { fakeCtx, silence, USER } from "../helpers";

describe("portal_folders", () => {
	it("delete previews the items inside and needs confirm", async () => {
		silence();
		const { ctx, urls } = fakeCtx({
			[USER]: () => ({ folders: [{ id: "f1", title: "mcp_test_f" }] }),
			[`${USER}/f1`]: () => ({ total: 2, items: [{ title: "one" }, { title: "two" }] }),
			[`${USER}/f1/delete`]: () => ({ success: true }),
		});
		await expect(folders(ctx, { action: "delete", name: "MCP_TEST_F" })).rejects.toMatchObject({
			code: "confirm_required", preview: { items_inside: 2, sample: ["one", "two"] } });
		expect(urls().some((u) => u.endsWith("/delete"))).toBe(false);
		expect(await folders(ctx, { action: "delete", name: "mcp_test_f", confirm: true })).toEqual({ deleted: true, folder: "mcp_test_f" });
	});

	it("create is a no-op when the folder exists", async () => {
		const { ctx, urls } = fakeCtx({ [USER]: () => ({ folders: [{ id: "f1", title: "Data" }] }) });
		expect(await folders(ctx, { action: "create", name: "data" })).toMatchObject({ id: "f1", created: false });
		expect(urls().some((u) => u.endsWith("/createFolder"))).toBe(false);
	});
});
