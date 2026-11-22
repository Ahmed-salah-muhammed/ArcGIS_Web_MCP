/**
 * portal_audit: a read-only review of content: how much is at each sharing level, which public layers anyone can
 * edit, what nobody has touched for a long time, and where credits and storage stand. It changes nothing; what it
 * finds is acted on with portal_share, portal_layer_schema or portal_item.
 */
import { ArcGISError, hostAllowed } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { iso, itemCard } from "../shared/format";
import { portalSelf } from "../shared/items";
import { mapLimit } from "../shared/jobs";
import { base } from "../shared/lookup";

export type AuditArgs = { action?: "summary" | "public" | "stale" | "credits"; scope?: "me" | "org"; days?: number; max_items?: number };

const LEVELS = ["private", "shared", "org", "public"] as const;
const SEARCH_CAP = 10000; // ArcGIS search stops counting here
const SERVICES_AT_ONCE = 5;
const WRITE_CAPABILITIES = /\b(Create|Update|Delete|Editing)\b/i;

/** The items the review covers: the signed-in user's own (default), or everything they can see in their organization. */
export function scopeQuery(ctx: Ctx, scope: AuditArgs["scope"]): string {
	if ((scope ?? "me") === "me") return `owner:${ctx.props.username}`;
	if (scope !== "org") throw new ArcGISError("scope must be me | org.", "bad_argument");
	// on Enterprise the portal is the organization: every item it holds is in scope
	return !ctx.props.isPortal && ctx.props.orgId ? `orgid:${ctx.props.orgId}` : "*";
}

const and = (...parts: string[]) => parts.filter((p) => p && p !== "*").join(" AND ") || "*";

/** ArcGIS search takes dates as 19-digit, zero-padded epoch milliseconds: modified:[000... TO 000...]. */
export function dateRange(field: string, fromMs: number, toMs: number): string {
	const pad = (ms: number) => String(Math.max(0, Math.trunc(ms))).padStart(19, "0");
	return `${field}:[${pad(fromMs)} TO ${pad(toMs)}]`;
}

const countOf = (total: unknown) => (Number(total) >= SEARCH_CAP ? `${SEARCH_CAP}+` : Number(total) || 0);

export async function contentAudit(ctx: Ctx, args: AuditArgs) {
	const action = args.action ?? "summary";
	const scope = args.scope ?? "me";
	const max = Math.max(1, Math.min(Math.trunc(args.max_items ?? 25), 50));

	if (action === "credits") {
		const [self, me] = await Promise.all([portalSelf(ctx), ctx.request(`${base(ctx)}/community/self`)]);
		const sub = self.subscriptionInfo ?? {};
		return {
			platform: ctx.props.isPortal ? "ArcGIS Enterprise" : "ArcGIS Online",
			organization: {
				available_credits: self.availableCredits ?? null,
				subscription: sub.type ?? null, state: sub.state ?? null, expires: iso(sub.expDate),
				note: ctx.props.isPortal ? "ArcGIS Enterprise does not use credits."
					: self.availableCredits === undefined ? "Only administrators see the organization's credit balance." : null,
			},
			me: {
				// -1 = no budget set for this member
				assigned_credits: me.assignedCredits ?? null, available_credits: me.availableCredits ?? null,
				storage_used_bytes: me.storageUsage ?? null, storage_quota_bytes: me.storageQuota ?? null,
			},
		};
	}

	const within = scopeQuery(ctx, args.scope);
	const search = (q: string, more: Record<string, unknown> = {}) => ctx.request(`${base(ctx)}/search`, { q, num: 1, ...more });

	if (action === "summary") {
		const [all, ...levels] = await Promise.all([search(within), ...LEVELS.map((l) => search(and(within, `access:${l}`)))]);
		return { scope, total: countOf(all.total),
			by_sharing: Object.fromEntries(LEVELS.map((l, i) => [l === "public" ? "everyone" : l, countOf(levels[i].total)])),
			next: "action=public lists what everyone can see and which layers anyone can edit; action=stale what is unused." };
	}

	if (action === "public") {
		const res = await search(and(within, "access:public"), { num: max, sortField: "numViews", sortOrder: "desc" });
		const results: any[] = res.results ?? [];
		// a public feature layer with editing on can be changed by anyone: the service itself says what it allows
		const items = await mapLimit(results, SERVICES_AT_ONCE, async (it) => {
			const card: Record<string, unknown> = { ...itemCard(it, ctx.props.portal), views: it.numViews ?? null };
			if (it.type !== "Feature Service" || !it.url) return card;
			if (!hostAllowed(it.url, ctx.props.portal, ctx.extraHosts)) return { ...card, editable_by_anyone: null, capabilities: "not checked: outside your portal" };
			if ((ctx.budget?.left() ?? Infinity) < 1) return { ...card, editable_by_anyone: null, capabilities: "not checked: request limit" };
			try {
				const capabilities = String((await ctx.request(it.url)).capabilities ?? "");
				return { ...card, capabilities, editable_by_anyone: WRITE_CAPABILITIES.test(capabilities) };
			} catch (e) {
				return { ...card, editable_by_anyone: null, capabilities: `not checked: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160) };
			}
		});
		const risky = items.filter((i) => i.editable_by_anyone === true);
		return { scope, public_items: countOf(res.total), listed: items.length, editable_by_anyone: risky.length,
			items: [...risky, ...items.filter((i) => i.editable_by_anyone !== true)],
			next: risky.length ? "Stop public editing with portal_layer_schema action=capabilities, or unshare with portal_share." : null };
	}

	if (action === "stale") {
		const days = Math.max(1, Math.trunc(args.days ?? 365));
		const cutoff = Date.now() - days * 86_400_000;
		const res = await search(and(within, dateRange("modified", 0, cutoff)), { num: max, sortField: "modified", sortOrder: "asc" });
		const results: any[] = res.results ?? [];
		return { scope, days, not_modified_since: iso(cutoff), stale_items: countOf(res.total), listed: results.length,
			next_start: res.nextStart > 0 ? res.nextStart : null,
			items: results.map((it) => ({ ...itemCard(it, ctx.props.portal), views: it.numViews ?? null, size_bytes: it.size ?? null })),
			next: "Before deleting anything, portal_item action=dependencies shows what uses it." };
	}
	throw new ArcGISError("action must be summary | public | stale | credits.", "bad_action");
}
