import { describe, expect, it } from "vitest";
import { operationOf, rest, restUrl } from "../../src/tools/portal_rest/handler";
import { fakeCtx, ID, silence, SVC, USER } from "../helpers";

describe("portal_rest", () => {
	it("resolves paths, reads the operation, and gates writes", async () => {
		silence();
		expect(restUrl("https://www.arcgis.com", "/portals/self")).toBe("https://www.arcgis.com/sharing/rest/portals/self");
		expect(operationOf(`${SVC}/0/query/`)).toBe("query");
		const { ctx, calls } = fakeCtx({
			"/portals/self": () => ({ id: "ORG" }),
			[`${SVC}/0/query`]: () => ({ features: [], exceededTransferLimit: false }),
			[`${USER}/items/${ID}/delete`]: () => ({ success: true }),
		});
		expect(await rest(ctx, { path: "portals/self" })).toMatchObject({ method: "GET", response: { id: "ORG" } });
		expect(calls.at(-1)!.via).toBe("get");
		await rest(ctx, { path: `${SVC}/0/query`, method: "POST", params: { where: "1=1" } });
		await expect(rest(ctx, { path: `content/users/jdoe_gis/items/${ID}/delete`, method: "POST" }))
			.rejects.toMatchObject({ code: "confirm_required" });
		expect(calls.some((c) => c.url.endsWith("/delete"))).toBe(false);
		await expect(rest(ctx, { path: "https://evil.example.com/arcgis/rest/info" })).rejects.toMatchObject({ code: "host_not_allowed" });
	});
});
