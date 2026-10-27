/**
 * portal_folders: list, create (no-op if it exists) and delete (confirm; items inside go too). Renaming is not
 * offered: updateFolder rejected every parameter tried on ArcGIS Online.
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { listFolders, resolveFolder, userPath } from "../shared/lookup";
import { audit, requireConfirm } from "../shared/safety";

export async function folders(ctx: Ctx, args: { action?: "list" | "create" | "delete"; name?: string; confirm?: boolean }) {
	const action = args.action ?? "list";
	if (action === "list") return { folders: [{ id: null, title: "(root)" }, ...(await listFolders(ctx))] };
	const name = args.name?.trim();
	if (!name) throw new ArcGISError("name is required.", "bad_argument");
	if (action === "create") {
		const existing = (await listFolders(ctx)).find((f) => f.title.toLowerCase() === name.toLowerCase());
		if (existing) return { ...existing, created: false };
		const res = await ctx.request(`${userPath(ctx)}/createFolder`, { title: name });
		audit(ctx.props, { tool: "portal_folders", action, target: name, ok: Boolean(res.success) });
		return { id: res.folder?.id, title: res.folder?.title, created: true };
	}
	if (action === "delete") {
		const id = await resolveFolder(ctx, name);
		if (!id) throw new ArcGISError("The root folder cannot be deleted.", "bad_argument");
		const inside = await ctx.request(`${userPath(ctx)}/${id}`, { num: 10 });
		const preview = { folder: name, items_inside: inside.total ?? 0,
			sample: (inside.items ?? []).map((i: any) => i.title) };
		requireConfirm(args.confirm, `Deleting folder '${name}'`, preview,
			preview.items_inside ? "Items inside are deleted too." : undefined);
		const res = await ctx.request(`${userPath(ctx)}/${id}/delete`);
		audit(ctx.props, { tool: "portal_folders", action, target: name, ok: Boolean(res.success) });
		return { deleted: Boolean(res.success), folder: name };
	}
	throw new ArcGISError("action must be list | create | delete.", "bad_action");
}
