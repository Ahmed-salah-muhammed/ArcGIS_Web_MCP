/** portal_share: sharing level (private / org / everyone) and groups, with before/after per item. */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { base, getItem, requireId, resolveGroupId, userPath } from "../shared/lookup";
import { audit, requireConfirm } from "../shared/safety";

const LEVELS: Record<string, "private" | "org" | "everyone"> = {
	private: "private", org: "org", organization: "org", everyone: "everyone", public: "everyone",
};

async function sharingOf(ctx: Ctx, id: string) {
	const it = await getItem(ctx, id);
	let groups: { id: string; title: string }[] = [];
	try {
		const g = await ctx.request(`${base(ctx)}/content/items/${id}/groups`);
		groups = [...(g.admin ?? []), ...(g.member ?? []), ...(g.other ?? [])].map((x: any) => ({ id: x.id, title: x.title }));
	} catch {
		/* groups not readable - keep the level */
	}
	return { owner: it.owner as string, title: it.title as string, level: it.access as string, groups };
}

export async function share(ctx: Ctx, args: { item_ids: string[]; level?: string; add_groups?: string[];
	remove_groups?: string[]; confirm?: boolean }) {
	const ids = (args.item_ids ?? []).map(requireId);
	if (!ids.length) throw new ArcGISError("item_ids is required.", "bad_argument");
	const level = args.level ? LEVELS[args.level.toLowerCase()] : undefined;
	if (args.level && !level) throw new ArcGISError("level must be private | org | everyone.", "bad_argument");
	const add = await Promise.all((args.add_groups ?? []).map((g) => resolveGroupId(ctx, g)));
	const remove = await Promise.all((args.remove_groups ?? []).map((g) => resolveGroupId(ctx, g)));
	if (level === "everyone") {
		requireConfirm(args.confirm, `Sharing ${ids.length} item(s) with EVERYONE (public)`, { items: ids },
			"Anyone on the internet will be able to open them.");
	}
	const results = [];
	for (const id of ids) {
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
		results.push({ item_id: id, title: after.title, before: { level: before.level, groups: before.groups },
			after: { level: after.level, groups: after.groups }, ok: levelOk && !errors.length, errors: errors.length ? errors : null });
		audit(ctx.props, { tool: "portal_share", action: "share", target: id, ok: levelOk && !errors.length });
	}
	return { results, all_ok: results.every((r) => r.ok) };
}
