/**
 * portal_item: read one item (get: card + every layer/table of a service; data: its JSON) and change it (update,
 * move, protect/unprotect, delete, dependencies). Deleting a layer that has views fails with "has a related
 * Service item": the views go first.
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { itemCard, truncate } from "../shared/format";
import { base, getItem, requireId, resolveFolder, serviceLayers, userPath } from "../shared/lookup";
import { audit, requireConfirm } from "../shared/safety";

const UPDATABLE = new Set(["title", "snippet", "description", "tags", "accessInformation", "licenseInfo",
	"typeKeywords", "spatialReference", "culture", "url"]);

export async function item(ctx: Ctx, args: { action?: "get" | "data"; item_id: string; max_chars?: number }) {
	const id = requireId(args.item_id);
	if ((args.action ?? "get") === "data") {
		const data = await ctx.request(`${base(ctx)}/content/items/${id}/data`);
		const text = JSON.stringify(data ?? null);
		const limit = Math.max(500, Math.min(Math.trunc(args.max_chars ?? 20000), 100000));
		return { item_id: id, chars: text.length, data: text.length <= limit ? data : truncate(text, limit) };
	}
	const it = await ctx.request(`${base(ctx)}/content/items/${id}`);
	const out = itemCard(it, ctx.props.portal, true);
	if (["Feature Service", "Map Service"].includes(it.type) && it.url) {
		try {
			out.layers = (await serviceLayers(ctx, it.url)).candidates.map((c: any, index: number) => ({ index, ...c }));
		} catch (e) {
			out.layers_error = e instanceof Error ? e.message : String(e);
		}
	}
	return out;
}

export type ItemWriteArgs = {
	action: "update" | "move" | "protect" | "unprotect" | "delete" | "dependencies";
	item_id: string;
	properties?: Record<string, unknown>;
	data?: unknown;
	folder?: string;
	permanent?: boolean;
	confirm?: boolean;
};

export async function itemWrite(ctx: Ctx, args: ItemWriteArgs) {
	const id = requireId(args.item_id);
	const it = await getItem(ctx, id);
	const path = `${userPath(ctx, it.owner)}/items/${id}`;

	if (args.action === "dependencies") {
		const [upon, to] = await Promise.all([
			ctx.request(`${base(ctx)}/content/items/${id}/dependencies`),
			ctx.request(`${base(ctx)}/content/items/${id}/dependencies/listDependentsTo`),
		]);
		return { item_id: id, uses: upon.list ?? [], used_by: to.list ?? [] };
	}
	if (args.action === "update") {
		const props: Record<string, unknown> = {};
		const rejected: string[] = [];
		for (const [k, v] of Object.entries(args.properties ?? {})) {
			if (!UPDATABLE.has(k)) rejected.push(k);
			else props[k] = Array.isArray(v) ? v.join(",") : v;
		}
		if (!Object.keys(props).length && args.data === undefined) {
			throw new ArcGISError("Nothing to update: give properties (title, snippet, description, tags, ...) or data.",
				"nothing_to_do");
		}
		const before = Object.fromEntries(Object.keys(props).map((k) => [k, it[k] ?? null]));
		const params: Record<string, unknown> = { ...props };
		if (args.data !== undefined) params.text = typeof args.data === "string" ? args.data : JSON.stringify(args.data);
		const res = await ctx.request(`${path}/update`, params);
		const fresh = await getItem(ctx, id);
		const after = Object.fromEntries(Object.keys(props).map((k) => [k, fresh[k] ?? null]));
		audit(ctx.props, { tool: "portal_item", action: "update", target: id, ok: Boolean(res.success) });
		return { item_id: id, updated: Boolean(res.success), before, after, rejected_keys: rejected.length ? rejected : null,
			data_updated: args.data !== undefined };
	}
	if (args.action === "move") {
		const folderId = await resolveFolder(ctx, args.folder);
		const res = await ctx.request(`${path}/move`, { folder: folderId ?? "/" });
		audit(ctx.props, { tool: "portal_item", action: "move", target: id, ok: Boolean(res.success) });
		return { item_id: id, moved: Boolean(res.success), folder: args.folder ?? "(root)", folder_id: folderId };
	}
	if (args.action === "protect" || args.action === "unprotect") {
		const res = await ctx.request(`${path}/${args.action}`);
		const fresh = await getItem(ctx, id);
		audit(ctx.props, { tool: "portal_item", action: args.action, target: id, ok: Boolean(res.success) });
		return { item_id: id, protected: Boolean(fresh.protected) };
	}
	if (args.action === "delete") {
		const dependents = await ctx.request(`${base(ctx)}/content/items/${id}/dependencies/listDependentsTo`)
			.catch(() => ({ list: [] }));
		const preview = { item: itemCard(it, ctx.props.portal), protected: Boolean(it.protected),
			items_that_use_it: (dependents.list ?? []).length, permanent: Boolean(args.permanent) };
		if (it.protected) {
			throw new ArcGISError("Item is delete-protected; unprotect it first (portal_item action=unprotect) if the user "
				+ "really wants it gone.", "protected");
		}
		requireConfirm(args.confirm, `Deleting ${it.type} '${it.title}'`, preview,
			preview.items_that_use_it ? "Items that use it will break." : undefined);
		const res = await ctx.request(`${path}/delete`, args.permanent ? { permanentDelete: true } : {});
		audit(ctx.props, { tool: "portal_item", action: "delete", target: id, ok: Boolean(res.success) });
		return { item_id: id, deleted: Boolean(res.success) };
	}
	throw new ArcGISError("action must be get | data | update | move | protect | unprotect | delete | dependencies.",
		"bad_action");
}
