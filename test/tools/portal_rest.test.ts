import { describe, expect, it } from "vitest";
import { ArcGISError } from "../../src/arcgis";
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

	it("sends a file as multipart with a POST, and reads a file that is not JSON as text", async () => {
		silence();
		const resource = `${USER}/items/${ID}/updateResources`;
		const { ctx, calls } = fakeCtx({
			[resource]: () => ({ success: true }),
			[`/items/${ID}/resources/config/config.json`]: () => { throw new ArcGISError("Not a JSON response (HTTP 200).", "not_json", 200, "<p>x"); },
		});
		const config = { widgets: { widget_1: { config: { text: '<p style="color: red;"><exp data-x="1">n</exp></p>' } } } };
		const args = { path: resource, method: "POST" as const, params: { resourcesPrefix: "config", fileName: "config.json" },
			file: { name: "config.json", content: config } };
		await expect(rest(ctx, args)).rejects.toMatchObject({ code: "confirm_required" });
		expect(await rest(ctx, { ...args, confirm: true })).toMatchObject({ response: { success: true } });
		const sent: any = calls.at(-1);
		expect(sent.via).toBe("upload");
		expect(sent.params).toEqual({ resourcesPrefix: "config", fileName: "config.json" });
		expect(sent.file).toEqual({ name: "config.json", type: "application/json", content: JSON.stringify(config) });
		await expect(rest(ctx, { path: resource, file: { name: "a.json", content: "{}" } })).rejects.toMatchObject({ code: "bad_argument" });
		expect(await rest(ctx, { path: `content/items/${ID}/resources/config/config.json` }))
			.toMatchObject({ raw: true, chars: 4, response: "<p>x" });
	});
});
