import { describe, expect, it } from "vitest";
import { publish, serviceName } from "../../src/tools/portal_publish/handler";
import { fakeCtx, ID, ID2, silence, SVC, USER } from "../helpers";

const routes = (statuses: string[]) => ({
	[`${USER}/addItem`]: () => ({ id: ID, success: true }),
	"/content/features/analyze": () => ({ publishParameters: { name: "x", locationType: "none" } }),
	"/portals/ORG/isServiceNameAvailable": () => ({ available: true }),
	[`${USER}/publish`]: () => ({ services: [{ serviceItemId: ID2, jobId: "j1", serviceurl: SVC }] }),
	[`${USER}/items/${ID2}/status`]: () => ({ status: statuses.shift() ?? "completed" }),
	[`/content/items/${ID2}`]: () => ({ id: ID2, title: "Cities", type: "Feature Service", owner: "jdoe_gis", url: SVC }),
	"/FeatureServer": () => ({ layers: [{ id: 0, name: "cities" }] }),
	[`${USER}/items/${ID}/delete`]: () => ({ success: true }),
});

describe("portal_publish", () => {
	it("uploads the CSV as a file, publishes by coordinates and waits for the job", async () => {
		silence();
		const { ctx, calls } = fakeCtx(routes(["processing", "completed"]));
		const out: any = await publish(ctx, { title: "mcp test cities!", csv_text: "NAME,LAT,LON\nA,30,31\nB,29,30",
			latitude_field: "LAT", longitude_field: "LON" });
		const upload = calls.find((c) => c.via === "upload")!;
		expect(upload.params).toMatchObject({ type: "CSV", title: "mcp test cities!" });
		expect(upload.file).toMatchObject({ name: "mcp_test_cities.csv", type: "text/csv" });
		expect(calls.find((c) => c.url.endsWith("/publish"))!.params).toMatchObject({ itemid: ID, filetype: "csv",
			publishParameters: { name: "mcp_test_cities", locationType: "coordinates", latitudeFieldName: "LAT",
				longitudeFieldName: "LON" } });
		expect(calls.filter((c) => c.url.endsWith("/status"))).toHaveLength(2);
		expect(out).toMatchObject({ source_item_id: ID, status: "completed", layers: [{ url: `${SVC}/0` }] });
	});

	it("asks before geocoding addresses - and before uploading anything", async () => {
		const { ctx, calls } = fakeCtx(routes([]));
		await expect(publish(ctx, { title: "t", csv_text: "ADDR\n1 Main St\n2 Main St", address_fields: { Address: "ADDR" } }))
			.rejects.toMatchObject({ code: "confirm_required", preview: { estimated_credits: 0.08 } });
		expect(calls).toHaveLength(0);
	});

	it("removes its upload when analyze finds addresses and there is no confirm", async () => {
		const withAddresses = { ...routes([]), "/content/features/analyze": () => ({ publishParameters: { locationType: "address" } }) };
		const { ctx, urls } = fakeCtx(withAddresses);
		await expect(publish(ctx, { title: "t", csv_text: "ADDR\n1 Main St" })).rejects.toMatchObject({ code: "confirm_required" });
		expect(urls().at(-1)).toMatch(new RegExp(`/items/${ID}/delete$`));
		expect(urls().some((u) => u.endsWith("/publish"))).toBe(false);
	});

	it("validates the source before any request", async () => {
		const { ctx, calls } = fakeCtx({});
		await expect(publish(ctx, { title: "t" })).rejects.toMatchObject({ code: "bad_argument" });
		await expect(publish(ctx, { title: "t", csv_text: "a", geojson_text: "{}" })).rejects.toMatchObject({ code: "bad_argument" });
		await expect(publish(ctx, { title: "t", url: "http://example.com/a.csv" })).rejects.toThrow(/https/);
		expect(calls).toHaveLength(0);
		expect(serviceName("  Cairo / Schools (2026) ")).toBe("Cairo_Schools_2026");
	});
});
