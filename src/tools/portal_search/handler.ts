/** portal_search: items by ArcGIS query syntax, exact type, owner and tags; newest first, paged. */
import type { ArcGISProps } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { base } from "../shared/lookup";

export type SearchArgs = {
	query?: string;
	item_type?: string;
	owner?: string;
	tags?: string[];
	max_items?: number;
	start?: number;
	sort_field?: string;
	sort_order?: "asc" | "desc";
	outside_org?: boolean;
};

/** Same query rules as the Python portal_search: owner "me", exact type via `filter`, org-only on ArcGIS Online. */
export function buildSearchQuery(args: SearchArgs, props: ArcGISProps): { q: string; filter?: string } {
	const parts: string[] = [];
	const query = (args.query ?? "").trim();
	if (query) parts.push(query);
	if (args.owner) parts.push(`owner:${args.owner.toLowerCase() === "me" ? props.username : args.owner}`);
	for (const t of args.tags ?? []) parts.push(`tags:"${t}"`);
	if (!args.outside_org && !props.isPortal && props.orgId && !/orgid:/i.test(query)) parts.push(`orgid:${props.orgId}`);
	const q = parts.map((p) => (/\sOR\s/.test(p) ? `(${p})` : p)).join(" AND ") || "*";
	return { q, filter: args.item_type ? `type:"${args.item_type}"` : undefined };
}

export async function search(ctx: Ctx, args: SearchArgs) {
	const { q, filter } = buildSearchQuery(args, ctx.props);
	const num = Math.max(1, Math.min(Math.trunc(args.max_items ?? 20), 100));
	const res = await ctx.request(`${base(ctx)}/search`, {
		q, filter, num, start: Math.max(1, Math.trunc(args.start ?? 1)),
		sortField: args.sort_field ?? "modified", sortOrder: args.sort_order ?? (args.sort_field ? "asc" : "desc"),
	});
	const results: any[] = res.results ?? [];
	return {
		query: q, total: res.total ?? results.length, count: results.length,
		next_start: res.nextStart && res.nextStart > 0 ? res.nextStart : null,
		items: results.map((r) => itemCard(r, ctx.props.portal)),
	};
}
