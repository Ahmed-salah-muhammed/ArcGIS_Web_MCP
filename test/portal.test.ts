import { describe, expect, it } from "vitest";
import type { ArcGISProps } from "../src/arcgis";
import {
	buildSearchQuery,
	type Ctx,
	item,
	iso,
	layerQuery,
	parseStats,
	requireId,
	resolveLayerUrl,
	rowsFrom,
	search,
} from "../src/portal";
import { run } from "../src/tools";

const ID = "a".repeat(32);
const SVC = "https://services1.arcgis.com/ORG/arcgis/rest/services/pts/FeatureServer";

const props: ArcGISProps = {
	username: "jdoe_gis", fullName: "Jane Doe", role: "org_publisher", orgId: "ORG", orgName: "Example Org",
	isPortal: false, portal: "https://www.arcgis.com", accessToken: "ACCESS-TOKEN-XYZ", refreshToken: "REFRESH-TOKEN-XYZ",
	expiresAt: Date.now() + 1_800_000,
};

/** A fake request: route by URL suffix; records every call so tests can prove what was (not) requested. */
function fakeCtx(routes: Record<string, (params: Record<string, unknown>) => unknown>, p = props) {
	const calls: { url: string; params: Record<string, unknown> }[] = [];
	const ctx: Ctx = {
		props: p,
		request: async (url, params = {}) => {
			calls.push({ url, params });
			const key = Object.keys(routes).find((k) => url.endsWith(k));
			if (!key) throw new Error(`unexpected request ${url}`);
			return routes[key](params);
		},
	};
	return { ctx, calls };
}

describe("search", () => {
	it("builds the query like the Python portal_search", () => {
		expect(buildSearchQuery({ query: "roads", owner: "me", item_type: "Web Map", tags: ["egypt"] }, props)).toEqual({
			q: 'roads AND owner:jdoe_gis AND tags:"egypt" AND orgid:ORG', filter: 'type:"Web Map"',
		});
		expect(buildSearchQuery({ query: "a OR b", outside_org: true }, props).q).toBe("(a OR b)");
		expect(buildSearchQuery({}, { ...props, isPortal: true }).q).toBe("*"); // Enterprise: no orgid filter
		expect(buildSearchQuery({ query: "orgid:OTHER" }, props).q).toBe("orgid:OTHER");
	});

	it("returns compact items, newest first, with next_start", async () => {
		const { ctx, calls } = fakeCtx({
			"/sharing/rest/search": () => ({ total: 3, nextStart: 3, results: [
				{ id: ID, title: "Parcels", type: "Feature Service", owner: "jdoe_gis", access: "private", modified: 1700000000000 }] }),
		});
		const out = await search(ctx, { query: "parcels", max_items: 500 });
		expect(calls[0].params).toMatchObject({ num: 100, start: 1, sortField: "modified", sortOrder: "desc" });
		expect(out.next_start).toBe(3);
		expect(out.items[0]).toMatchObject({ id: ID, modified: "2023-11-14T22:13:20Z",
			item_url: `https://www.arcgis.com/home/item.html?id=${ID}` });
	});
});

describe("item", () => {
	it("rejects titles and other non-ids before any request", () => {
		expect(() => requireId("Parcels layer")).toThrow(/not an item id/);
	});

	it("get lists a feature service's layers and tables with their index", async () => {
		const { ctx } = fakeCtx({
			[`/content/items/${ID}`]: () => ({ id: ID, title: "Pts", type: "Feature Service", url: SVC,
				typeKeywords: ["Hosted Service"], tags: [] }),
			"/FeatureServer": () => ({ layers: [{ id: 0, name: "pts", geometryType: "esriGeometryPoint" }],
				tables: [{ id: 3, name: "visits" }] }),
		});
		const out: any = await item(ctx, { item_id: ID });
		expect(out.is_hosted).toBe(true);
		expect(out.layers).toEqual([
			{ index: 0, kind: "layer", id: 0, name: "pts", geometryType: "esriGeometryPoint", url: `${SVC}/0` },
			{ index: 1, kind: "table", id: 3, name: "visits", geometryType: null, url: `${SVC}/3` },
		]);
	});

	it("data is truncated to max_chars", async () => {
		const { ctx } = fakeCtx({ [`/content/items/${ID}/data`]: () => ({ big: "x".repeat(5000) }) });
		const out: any = await item(ctx, { item_id: ID, action: "data", max_chars: 1000 });
		expect(out.chars).toBeGreaterThan(5000);
		expect(typeof out.data).toBe("string");
		expect(out.data).toContain("more chars");
	});
});

describe("layers", () => {
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

	it("parses stats shorthand", () => {
		expect(parseStats(["sum:POP", "Avg:INCOME"])).toEqual([
			{ statisticType: "sum", onStatisticField: "POP", outStatisticFieldName: "sum_POP" },
			{ statisticType: "avg", onStatisticField: "INCOME", outStatisticFieldName: "avg_INCOME" },
		]);
		expect(() => parseStats(["median:POP"])).toThrow(/Bad stat/);
	});

	it("rows: dates to ISO, big geometries replaced", () => {
		const rows = rowsFrom([
			{ attributes: { OBJECTID: 1, SEEN: 1700000000000 }, geometry: { x: 1, y: 2 } },
			{ attributes: { OBJECTID: 2, SEEN: null }, geometry: { rings: [Array(3000).fill([1.123456, 2.123456])] } },
		], [{ name: "SEEN", type: "esriFieldTypeDate" }], true);
		expect(rows[0]).toEqual({ OBJECTID: 1, SEEN: "2023-11-14T22:13:20Z", _geometry: { x: 1, y: 2 } });
		expect((rows[1]._geometry as any).note).toMatch(/omitted/);
		expect(iso(-1)).toBeNull();
	});

	it("query pages and caps the limit; describe includes the count", async () => {
		const { ctx, calls } = fakeCtx({
			"/FeatureServer/0/query": (p) => p.returnCountOnly ? { count: 42 } : {
				fields: [{ name: "WHEN", type: "esriFieldTypeDate" }],
				features: Array.from({ length: 2 }, (_, i) => ({ attributes: { OBJECTID: i, WHEN: 0 } })),
			},
			"/FeatureServer/0": () => ({ name: "pts", type: "Feature Layer", objectIdField: "OBJECTID",
				fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }], capabilities: "Query" }),
		});
		const q: any = await layerQuery(ctx, { target: `${SVC}/0`, limit: 2, offset: 10, fields: ["OBJECTID", "WHEN"] });
		expect(q).toMatchObject({ count: 2, offset: 10, next_offset: 12, dates: "ISO 8601 UTC (stored as epoch ms)" });
		expect(calls.at(-1)!.params).toMatchObject({ outFields: "OBJECTID,WHEN", resultOffset: 10, resultRecordCount: 2,
			returnGeometry: false });
		await layerQuery(ctx, { target: `${SVC}/0`, limit: 999999 });
		expect(calls.at(-1)!.params.resultRecordCount).toBe(1000);
		const d: any = await layerQuery(ctx, { target: `${SVC}/0`, action: "describe" });
		expect(d).toMatchObject({ name: "pts", count: 42, fields: [{ name: "OBJECTID", type: "OID" }] });
		await expect(layerQuery(ctx, { target: `${SVC}/0`, action: "stats" })).rejects.toThrow(/stats is required/);
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
