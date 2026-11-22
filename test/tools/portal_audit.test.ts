import { describe, expect, it } from "vitest";
import { contentAudit, dateRange, scopeQuery } from "../../src/tools/portal_audit/handler";
import { Budget } from "../../src/tools/shared/context";
import { fakeCtx, ID, ID2, props, SVC } from "../helpers";

describe("portal_audit", () => {
	it("scope: the user's own items, or the organization; dates as ArcGIS search writes them", () => {
		const { ctx } = fakeCtx({});
		expect(scopeQuery(ctx, undefined)).toBe("owner:jdoe_gis");
		expect(scopeQuery(ctx, "org")).toBe("orgid:ORG");
		expect(scopeQuery(fakeCtx({}, { ...props, isPortal: true }).ctx, "org")).toBe("*");
		expect(() => scopeQuery(ctx, "all" as any)).toThrow(/scope must be/);
		// the range Esri's search reference gives as its example
		expect(dateRange("modified", 1249084800000, 1249548000000)).toBe("modified:[0000001249084800000 TO 0000001249548000000]");
	});

	it("summary counts each sharing level with one small search each", async () => {
		const totals: Record<string, number> = { private: 12, shared: 3, org: 5, public: 10000 };
		const { ctx, calls } = fakeCtx({ "/search": (p) => {
			const level = /access:(\w+)/.exec(String(p.q))?.[1];
			return { total: level ? totals[level] : 30, results: [] };
		} });
		const out: any = await contentAudit(ctx, {});
		expect(out).toMatchObject({ scope: "me", total: 30, by_sharing: { private: 12, shared: 3, org: 5, everyone: "10000+" } });
		expect(calls).toHaveLength(5);
		expect(calls.every((c) => c.params.num === 1)).toBe(true);
		expect(calls[1].params.q).toBe("owner:jdoe_gis AND access:private");
	});

	it("public: asks each public feature service what it allows, and lists the editable ones first", async () => {
		const { ctx, calls } = fakeCtx({
			"/search": () => ({ total: 3, results: [
				{ id: ID, title: "Read only", type: "Feature Service", url: SVC, access: "public", numViews: 900 },
				{ id: ID2, title: "Open edits", type: "Feature Service", url: `${SVC}2`, access: "public", numViews: 40 },
				{ id: "c".repeat(32), title: "A map", type: "Web Map", access: "public", numViews: 7 },
				{ id: "d".repeat(32), title: "Elsewhere", type: "Feature Service", url: "https://other.example.org/x/FeatureServer", access: "public" },
			] }),
			[SVC]: () => ({ capabilities: "Query,Extract" }),
			[`${SVC}2`]: () => ({ capabilities: "Create,Delete,Query,Update,Editing" }),
		});
		const out: any = await contentAudit(ctx, { action: "public", scope: "org" });
		expect(calls[0].params).toMatchObject({ q: "orgid:ORG AND access:public", sortField: "numViews", sortOrder: "desc", num: 25 });
		expect(out).toMatchObject({ public_items: 3, listed: 4, editable_by_anyone: 1 });
		expect(out.items.map((i: any) => [i.title, i.editable_by_anyone])).toEqual([["Open edits", true], ["Read only", false],
			["A map", undefined], ["Elsewhere", null]]);
		expect(out.next).toContain("portal_layer_schema");
		expect(calls.some((c) => c.url.includes("other.example.org"))).toBe(false); // the token never leaves the portal
	});

	it("public: stops asking services when the request budget is spent, and says which were not checked", async () => {
		const { ctx } = fakeCtx({
			"/search": () => ({ total: 2, results: [{ id: ID, title: "A", type: "Feature Service", url: SVC },
				{ id: ID2, title: "B", type: "Feature Service", url: `${SVC}2` }] }),
			[SVC]: () => ({ capabilities: "Query" }), [`${SVC}2`]: () => ({ capabilities: "Query" }),
		});
		ctx.budget = new Budget(3, 3); // nothing left for normal work
		const out: any = await contentAudit(ctx, { action: "public" });
		expect(out.items.every((i: any) => i.editable_by_anyone === null && /request limit/.test(i.capabilities))).toBe(true);
	});

	it("stale: items not modified for N days, oldest first", async () => {
		const { ctx, calls } = fakeCtx({ "/search": () => ({ total: 1, nextStart: -1,
			results: [{ id: ID, title: "Old", type: "CSV", modified: 1332954667000, numViews: 2, size: 2048 }] }) });
		const before = Date.now();
		const out: any = await contentAudit(ctx, { action: "stale", days: 730, max_items: 5 });
		const [, from, to] = /modified:\[(\d{19}) TO (\d{19})\]/.exec(String(calls[0].params.q))!;
		expect(Number(from)).toBe(0);
		expect(before - Number(to)).toBeGreaterThanOrEqual(730 * 86_400_000 - 5);
		expect(calls[0].params).toMatchObject({ num: 5, sortField: "modified", sortOrder: "asc" });
		expect(out).toMatchObject({ days: 730, stale_items: 1, next_start: null,
			items: [{ id: ID, modified: "2012-03-28T17:11:07Z", views: 2, size_bytes: 2048 }] });
	});

	it("credits: the organization's balance when it is shown, the member's budget and storage", async () => {
		const { ctx } = fakeCtx({
			"/portals/self": () => ({ availableCredits: 812.5, subscriptionInfo: { type: "In House", state: "active", expDate: 1800000000000 } }),
			"/community/self": () => ({ assignedCredits: -1, availableCredits: 812.5, storageUsage: 1048576, storageQuota: 2199023255552 }),
		});
		expect(await contentAudit(ctx, { action: "credits" })).toEqual({ platform: "ArcGIS Online",
			organization: { available_credits: 812.5, subscription: "In House", state: "active", expires: "2027-01-15T08:00:00Z", note: null },
			me: { assigned_credits: -1, available_credits: 812.5, storage_used_bytes: 1048576, storage_quota_bytes: 2199023255552 } });
		const member = fakeCtx({ "/portals/self": () => ({}), "/community/self": () => ({}) });
		const out: any = await contentAudit(member.ctx, { action: "credits" });
		expect(out.organization).toMatchObject({ available_credits: null, note: expect.stringMatching(/administrators/) });
		await expect(contentAudit(ctx, { action: "nope" as any })).rejects.toMatchObject({ code: "bad_action" });
	});
});
