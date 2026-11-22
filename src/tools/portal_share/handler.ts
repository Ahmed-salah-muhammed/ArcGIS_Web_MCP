/** portal_share: sharing level (private / org / everyone) and groups, with before/after per item. */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { mapLimit } from "../shared/jobs";
import { base, getItem, requireId, resolveGroupId, userPath } from "../shared/lookup";
import { audit, requireConfirm } from "../shared/safety";

const LEVELS: Record<string, "private" | "org" | "everyone"> = {
	private: "private", org: "org", organization: "org", everyone: "everyone", public: "everyone",
};

async function sharingOf(ctx: Ctx, id: string) {
	// the item and its groups are read together; groups that cannot be read leave the level on its own
	const [it, g] = await Promise.all([getItem(ctx, id),
		ctx.request(`${base(ctx)}/content/items/${id}/groups`).catch(() => ({}))]);
	const groups: { id: string; title: string }[] = [...(g.admin ?? []), ...(g.member ?? []), ...(g.other ?? [])]
		.map((x: any) => ({ id: x.id, title: x.title }));
	return { owner: it.owner as string, title: it.title as string, level: it.access as string, groups };
}

/** Items shared at the same time: each one reads two things at once, and Cloudflare keeps 6 connections per call. */
const ITEMS_AT_ONCE = 3;

export async function share(ctx: Ctx, args: { item_ids: string[]; level?: string; add_groups?: string[];
	remove_groups?: string[]; confirm?: boolean }) {
	const ids = (args.item_ids ?? []).map(requireId);
	if (!ids.length) throw new ArcGISError("item_ids is required.", "bad_argument");
	const level = args.level ? LEVELS[args.level.toLowerCase()] : undefined;
	if (args.level && !level) throw new ArcGISError("level must be private | org | everyone.", "bad_argument");
	const add = await Promise.all((args.add_groups ?? []).map((g) => resolveGroupId(ctx, g)));
	const remove = await Promise.all((args.remove_groups ?? []).map((g) => resolveGroupId(ctx, g)));
	// Each item costs 2 reads before, 2 after, and one request per change. A call that cannot finish is refused whole,
	// here, rather than stopping at the request limit with some items shared and the rest not.
	const perItem = 4 + (level || add.length ? 1 : 0) + (remove.length ? 1 : 0);
	const room = ctx.budget?.left();
	if (room !== undefined && ids.length * perItem > room) {
		throw new ArcGISError(`Sharing ${ids.length} items takes ${ids.length * perItem} requests and this call has ${room} left: `
			+ `share at most ${Math.floor(room / perItem)} items per call. Nothing was changed.`, "too_many");
	}
	if (level === "everyone") {
		requireConfirm(args.confirm, `Sharing ${ids.length} item(s) with EVERYONE (public)`, { items: ids },
			"Anyone on the internet will be able to open them.");
	}
	const results = await mapLimit(ids, ITEMS_AT_ONCE, async (id) => {
		const before = await sharingOf(ctx, id);
		const path = `${userPath(ctx, before.owner)}/items/${id}`;
		const errors: string[] = [];
		if (level || add.length) {
			const params: Record<string, unknown> = { groups: add.map((g) => g.id).join(",") };
			const effective = level ?? (before.level === "public" ? "everyone" : before.level === "org" ? "org" : "private");
			params.everyone = effective === "everyone";
			params.org = effective === "everyone" || effective === "org";
			const res = await ctx.request(`${path}/share`, params);
			if ((res.notSharedWith ?? []).length) errors.push(`not shared with: ${res.notSharedWith.join(", ")}`);
		}
		if (remove.length) {
			const res = await ctx.request(`${path}/unshare`, { groups: remove.map((g) => g.id).join(",") });
			if ((res.notUnsharedFrom ?? []).length) errors.push(`not unshared from: ${res.notUnsharedFrom.join(", ")}`);
		}
		const after = await sharingOf(ctx, id);
		const wanted = level === "everyone" ? "public" : level === "org" ? "org" : level === "private" ? "private" : null;
		const levelOk = !wanted || after.level === wanted || (wanted === "private" && after.level === "shared");
		audit(ctx.props, { tool: "portal_share", action: "share", target: id, ok: levelOk && !errors.length });
		return { item_id: id, title: after.title, before: { level: before.level, groups: before.groups },
			after: { level: after.level, groups: after.groups }, ok: levelOk && !errors.length, errors: errors.length ? errors : null };
	});
	return { results, all_ok: results.every((r) => r.ok) };
}
