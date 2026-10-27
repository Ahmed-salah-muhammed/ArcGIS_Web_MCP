/**
 * Groups: search, get (members + items), create, update, delete (confirm). Verified on ArcGIS Online with a
 * throwaway private group. Adding/removing other members is left out of this version: it could not be verified
 * without a second account (portal_rest reaches community/groups/<id>/addUsers if needed).
 */
import { ArcGISError, sharingUrl } from "./arcgis";
import { resolveGroupId } from "./content";
import { type Ctx, iso } from "./portal";
import { audit, requireConfirm } from "./safety";

const base = (ctx: Ctx) => sharingUrl(ctx.props.portal);
const ACCESS = new Set(["private", "org", "public"]);

export function groupCard(g: any) {
	return { id: g.id, title: g.title, owner: g.owner, access: g.access, isInvitationOnly: g.isInvitationOnly ?? null,
		isViewOnly: g.isViewOnly ?? null, shared_update: (g.capabilities ?? []).includes("updateitemcontrol"),
		tags: g.tags ?? [], created: iso(g.created) };
}

export type GroupArgs = {
	action?: "search" | "get" | "create" | "update" | "delete";
	group?: string;
	query?: string;
	title?: string;
	tags?: string[];
	description?: string;
	access?: "private" | "org" | "public";
	is_invitation_only?: boolean;
	max_groups?: number;
	confirm?: boolean;
};

export async function groups(ctx: Ctx, args: GroupArgs) {
	const action = args.action ?? "search";
	if (action === "search") {
		const res = await ctx.request(`${base(ctx)}/community/groups`, { q: args.query?.trim() || "*",
			num: Math.max(1, Math.min(Math.trunc(args.max_groups ?? 50), 100)) });
		return { total: res.total ?? null, groups: (res.results ?? []).map(groupCard) };
	}
	if (action === "create") {
		if (!args.title) throw new ArcGISError("title is required.", "bad_argument");
		const access = args.access ?? "private";
		if (!ACCESS.has(access)) throw new ArcGISError("access must be private | org | public.", "bad_argument");
		if (access === "public") requireConfirm(args.confirm, `Creating PUBLIC group '${args.title}'`, { title: args.title });
		const res = await ctx.request(`${base(ctx)}/community/createGroup`, { title: args.title,
			tags: (args.tags ?? ["arcgis-web-mcp"]).join(","), description: args.description, access,
			isInvitationOnly: args.is_invitation_only ?? true });
		if (!res.group?.id) throw new ArcGISError(`The portal did not create the group: ${JSON.stringify(res).slice(0, 200)}`, "not_created");
		audit(ctx.props, { tool: "portal_groups", action, target: res.group.id, ok: true });
		return { group: groupCard(res.group) };
	}
	if (!args.group) throw new ArcGISError("group (id or exact title) is required.", "bad_argument");
	const { id, title } = await resolveGroupId(ctx, args.group);
	if (action === "get") {
		const [g, members, items] = await Promise.all([
			ctx.request(`${base(ctx)}/community/groups/${id}`),
			ctx.request(`${base(ctx)}/community/groups/${id}/users`),
			ctx.request(`${base(ctx)}/search`, { q: `group:${id}`, num: 100 }),
		]);
		return { ...groupCard(g), members: { owner: members.owner, admins: members.admins ?? [], users: members.users ?? [] },
			items: (items.results ?? []).map((i: any) => ({ id: i.id, title: i.title, type: i.type, owner: i.owner })) };
	}
	if (action === "update") {
		const changes: Record<string, unknown> = {};
		if (args.title) changes.title = args.title;
		if (args.tags?.length) changes.tags = args.tags.join(",");
		if (args.description) changes.description = args.description;
		if (args.access) {
			if (!ACCESS.has(args.access)) throw new ArcGISError("access must be private | org | public.", "bad_argument");
			changes.access = args.access;
		}
		if (!Object.keys(changes).length) throw new ArcGISError("Nothing to update (title, tags, description, access).", "nothing_to_do");
		if (changes.access === "public") requireConfirm(args.confirm, `Making group '${title}' PUBLIC`, changes);
		const res = await ctx.request(`${base(ctx)}/community/groups/${id}/update`, changes);
		audit(ctx.props, { tool: "portal_groups", action, target: id, ok: Boolean(res.success) });
		return { group: groupCard(await ctx.request(`${base(ctx)}/community/groups/${id}`)), updated: Boolean(res.success) };
	}
	if (action === "delete") {
		requireConfirm(args.confirm, `Deleting group '${title}'`, { id, title }, "Items stay; only the group and its sharing go.");
		const res = await ctx.request(`${base(ctx)}/community/groups/${id}/delete`);
		audit(ctx.props, { tool: "portal_groups", action, target: id, ok: Boolean(res.success) });
		return { group: title, id, deleted: Boolean(res.success) };
	}
	throw new ArcGISError("action must be search | get | create | update | delete.", "bad_action");
}
