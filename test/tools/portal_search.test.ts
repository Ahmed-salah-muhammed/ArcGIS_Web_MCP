import { describe, expect, it } from "vitest";
import { buildSearchQuery, search } from "../../src/tools/portal_search/handler";
import { fakeCtx, ID, props } from "../helpers";

describe("portal_search", () => {
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
