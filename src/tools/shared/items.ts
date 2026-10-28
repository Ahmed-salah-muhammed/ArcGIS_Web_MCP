/**
 * Item writes the app builders share: addItem into a folder, update, resources, relationships, and the org's own
 * web address (apps live under it). Parameter names are the ones the ArcGIS API for Python 2.4.3 sends.
 */
import { ArcGISError } from "../../arcgis";
import { cleanup, type Ctx } from "./context";
import { base, requireId, resolveFolder, userPath } from "./lookup";

export async function portalSelf(ctx: Ctx): Promise<any> {
	return ctx.request(`${base(ctx)}/portals/self`);
}

/**
 * Where the org's apps are opened: https://<urlKey>.maps.arcgis.com on ArcGIS Online, the portal itself on
 * Enterprise (gis.example.com/portal).
 */
export function orgHome(self: any, portal: string): string {
	if (self?.urlKey && self?.customBaseUrl && !self?.isPortal) return `https://${self.urlKey}.${self.customBaseUrl}`;
	return portal.replace(/\/+$/, "");
}

export async function addItem(ctx: Ctx, folder: string | null | undefined, params: Record<string, unknown>) {
	const folderId = await resolveFolder(ctx, folder, true);
	const res = await ctx.request(`${userPath(ctx)}${folderId ? `/${folderId}` : ""}/addItem`, params);
	if (!res.id) throw new ArcGISError("ArcGIS did not return the new item's id.", "arcgis_error");
	return { id: String(res.id), folderId };
}

export function updateItem(ctx: Ctx, id: string, params: Record<string, unknown>, owner?: string) {
	return ctx.request(`${userPath(ctx, owner)}/items/${requireId(id)}/update`, params);
}

export function deleteItem(ctx: Ctx, id: string, owner?: string) {
	return ctx.request(`${userPath(ctx, owner)}/items/${requireId(id)}/delete`);
}

/** "config/config.json" -> resourcesPrefix "config" + fileName "config.json". */
export function addResource(ctx: Ctx, id: string, path: string, text: string, access?: "private" | "inherit") {
	const slash = path.lastIndexOf("/");
	return ctx.request(`${userPath(ctx)}/items/${requireId(id)}/addResources`, {
		resourcesPrefix: slash > 0 ? path.slice(0, slash) : undefined, fileName: path.slice(slash + 1), text, access,
	});
}

export function addRelationship(ctx: Ctx, originItemId: string, destinationItemId: string, relationshipType: string) {
	return ctx.request(`${userPath(ctx)}/addRelationship`, { originItemId, destinationItemId, relationshipType });
}

/**
 * Runs the steps after addItem; if one fails, the half-made item is deleted so nothing is left behind, and the
 * original error is what the caller sees.
 */
export async function orRemove<T>(ctx: Ctx, ids: string[], steps: () => Promise<T>): Promise<T> {
	try {
		return await steps();
	} catch (e) {
		await cleanup(ctx, async () => {
			for (const id of [...ids].reverse()) await deleteItem(ctx, id).catch(() => undefined);
		});
		throw e;
	}
}

export async function requireItemOfType(ctx: Ctx, id: string | undefined, types: string[], what: string) {
	if (!id) throw new ArcGISError(`${what} is required.`, "bad_argument");
	const it = await ctx.request(`${base(ctx)}/content/items/${requireId(id)}`);
	if (!types.includes(it.type)) throw new ArcGISError(`${what} must be a ${types.join(" or ")}; ${it.id} is a ${it.type}.`, "bad_argument");
	return it;
}
