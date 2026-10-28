/**
 * portal_groups: search, get (members + items), create, update, delete (confirm), and members: add_users (addUsers:
 * members of your org, as an admin or the group's manager), invite_users (invite: they accept it themselves) and
 * remove_users (removeUsers, confirm). Search..delete were verified on ArcGIS Online with a throwaway private group;
 * the member actions follow the REST reference and report what ArcGIS refused (not_added, not_removed).
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { iso } from "../shared/format";
import { base, resolveGroupId } from "../shared/lookup";
import { audit, requireConfirm } from "../shared/safety";

const ACCESS = new Set(["private", "org", "public"]);
export const MAX_USERS = 25; // usernames per add/invite/remove call

export function groupCard(g: any) {
	return { id: g.id, title: g.title, owner: g.owner, access: g.access, isInvitationOnly: g.isInvitationOnly ?? null,
		isViewOnly: g.isViewOnly ?? null, shared_update: (g.capabilities ?? []).includes("updateitemcontrol"),
		tags: g.tags ?? [], created: iso(g.created) };
}

export type GroupArgs = {
	action?: "search" | "get" | "create" | "update" | "delete" | "add_users" | "invite_users" | "remove_users";
	users?: string[];
	as_managers?: boolean;
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
	if (action === "add_users" || action === "invite_users" || action === "remove_users") {
		return members(ctx, action, id, title, args);
	}
	if (action === "delete") {
		requireConfirm(args.confirm, `Deleting group '${title}'`, { id, title }, "Items stay; only the group and its sharing go.");
		const res = await ctx.request(`${base(ctx)}/community/groups/${id}/delete`);
		audit(ctx.props, { tool: "portal_groups", action, target: id, ok: Boolean(res.success) });
		return { group: title, id, deleted: Boolean(res.success) };
	}
	throw new ArcGISError("action must be search | get | create | update | delete | add_users | invite_users | remove_users.",
		"bad_action");
}

async function memberList(ctx: Ctx, id: string) {
	const m = await ctx.request(`${base(ctx)}/community/groups/${id}/users`);
	return { owner: m.owner, admins: m.admins ?? [], users: m.users ?? [] };
}

async function members(ctx: Ctx, action: "add_users" | "invite_users" | "remove_users", id: string, title: string, args: GroupArgs) {
	const users = [...new Set((args.users ?? []).map((u) => String(u).trim()).filter(Boolean))];
	if (!users.length) throw new ArcGISError("users (usernames) is required.", "bad_argument");
	if (users.length > MAX_USERS) throw new ArcGISError(`At most ${MAX_USERS} users per call.`, "too_many");
	const path = `${base(ctx)}/community/groups/${id}`;
	const list = users.join(",");
	if (action === "remove_users") {
		requireConfirm(args.confirm, `Removing ${users.length} user(s) from group '${title}'`, { group: title, users },
			"They lose access to what is shared only with this group.");
		const res = await ctx.request(`${path}/removeUsers`, { users: list });
		const notRemoved: string[] = res.notRemoved ?? [];
		audit(ctx.props, { tool: "portal_groups", action, target: id, ok: !notRemoved.length, details: { users } });
		return { group: title, id, removed: users.filter((u) => !notRemoved.includes(u)), not_removed: notRemoved.length ? notRemoved : null,
			members: await memberList(ctx, id) };
	}
	if (action === "invite_users") {
		const res = await ctx.request(`${path}/invite`, { users: list, role: args.as_managers ? "group_admin" : "group_member",
			expiration: 20160 });
		const notInvited: string[] = res.notInvited ?? [];
		audit(ctx.props, { tool: "portal_groups", action, target: id, ok: Boolean(res.success) && !notInvited.length, details: { users } });
		return { group: title, id, invited: Boolean(res.success) ? users.filter((u) => !notInvited.includes(u)) : [],
			not_invited: notInvited.length ? notInvited : null, expires_in: "2 weeks",
			next: "They see the invitation in ArcGIS (Groups > My invitations) and accept it." };
	}
	const res = await ctx.request(`${path}/addUsers`, args.as_managers ? { admins: list } : { users: list });
	const notAdded: string[] = res.notAdded ?? [];
	audit(ctx.props, { tool: "portal_groups", action, target: id, ok: !notAdded.length, details: { users } });
	return { group: title, id, added: users.filter((u) => !notAdded.includes(u)), not_added: notAdded.length ? notAdded : null,
		...(notAdded.length ? { hint: "Adding directly works for members of your organization when you may manage the group; "
			+ "invite_users sends them an invitation instead." } : {}),
		members: await memberList(ctx, id) };
}
