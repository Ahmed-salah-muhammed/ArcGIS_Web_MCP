/**
 * Lookups several tools share: item ids, the URLs content lives at, layers of a service, folders and groups.
 * Ids are preferred over titles everywhere, because titles are not unique.
 */
import { ArcGISError, hostAllowed, sharingUrl } from "../../arcgis";
import type { Ctx } from "./context";

export const ID_RE = /^[0-9a-f]{32}$/i;
const LAYER_URL_RE = /\/(FeatureServer|MapServer)\/\d+\/?$/i;
const SERVICE_URL_RE = /\/(FeatureServer|MapServer)\/?$/i;
const ROOT_NAMES = new Set(["", "/", "root", "root folder", "home"]);

/** <portal>/sharing/rest */
export const base = (ctx: Ctx) => sharingUrl(ctx.props.portal);
/** <portal>/sharing/rest/content/users/<owner, default the signed-in user> */
export const userPath = (ctx: Ctx, owner?: string) => `${base(ctx)}/content/users/${encodeURIComponent(owner ?? ctx.props.username)}`;

export function requireAllowed(ctx: Ctx, url: string): void {
	if (!hostAllowed(url, ctx.props.portal, ctx.extraHosts)) {
		throw new ArcGISError(
			`Refusing to send your token to ${new URL(url).hostname}: it is not your portal or one of its services.`,
			"host_not_allowed",
		);
	}
}

export function requireId(id: string): string {
	const clean = String(id ?? "").trim();
	if (!ID_RE.test(clean)) {
		throw new ArcGISError(`'${id}' is not an item id (32 hex characters). Titles are not unique: find the id with portal_search.`,
			"bad_argument");
	}
	return clean;
}

export async function getItem(ctx: Ctx, id: string) {
	return ctx.request(`${base(ctx)}/content/items/${requireId(id)}`);
}

// --- services and layers -----------------------------------------------------------------------------

export async function serviceLayers(ctx: Ctx, serviceUrl: string) {
	requireAllowed(ctx, serviceUrl);
	const svc = await ctx.request(serviceUrl.replace(/\/+$/, ""));
	const root = serviceUrl.replace(/\/+$/, "");
	const layers = (svc.layers ?? []).map((l: any) => ({ kind: "layer", id: l.id, name: l.name,
		geometryType: l.geometryType ?? null, url: `${root}/${l.id}` }));
	const tables = (svc.tables ?? []).map((t: any) => ({ kind: "table", id: t.id, name: t.name, geometryType: null,
		url: `${root}/${t.id}` }));
	return { service: svc, candidates: [...layers, ...tables] };
}

/** item id / .../FeatureServer / .../FeatureServer/N -> the layer URL (index = position in layers + tables, or name). */
export async function resolveLayerUrl(ctx: Ctx, target: string, layer: number | string = 0): Promise<string> {
	const t = String(target ?? "").trim();
	if (LAYER_URL_RE.test(t)) {
		requireAllowed(ctx, t);
		return t.replace(/\/+$/, "");
	}
	let serviceUrl: string;
	if (SERVICE_URL_RE.test(t)) {
		serviceUrl = t;
	} else if (ID_RE.test(t)) {
		const it = await ctx.request(`${base(ctx)}/content/items/${t}`);
		if (!it.url) throw new ArcGISError(`Item ${t} (${it.type}) has no service URL.`, "bad_argument");
		serviceUrl = it.url;
	} else {
		throw new ArcGISError("target must be an item id or a .../FeatureServer[/N] URL.", "bad_argument");
	}
	const { candidates } = await serviceLayers(ctx, serviceUrl);
	if (!candidates.length) throw new ArcGISError("The service has no layers or tables.", "bad_argument");
	if (typeof layer === "number" || /^\d+$/.test(String(layer))) {
		const idx = Number(layer);
		const hit = candidates[idx];
		if (!hit) {
			throw new ArcGISError(`layer ${idx} out of range; the service has ${candidates.length} layer(s)/table(s): `
				+ candidates.map((c) => c.name).join(", "), "bad_argument");
		}
		return hit.url;
	}
	const named = candidates.find((c) => String(c.name).toLowerCase() === String(layer).toLowerCase());
	if (!named) throw new ArcGISError(`No layer named '${layer}'.`, "bad_argument");
	return named.url;
}

/** .../FeatureServer/3 -> .../FeatureServer */
export function serviceOf(layerUrl: string): string {
	return layerUrl.replace(/\/\d+\/?$/, "");
}

export function isHosted(url: string): boolean {
	return /services\d*\.arcgis\.com/i.test(url) || /\/Hosted\//i.test(url);
}

// --- folders -------------------------------------------------------------------------------------------

export async function listFolders(ctx: Ctx): Promise<{ id: string; title: string }[]> {
	const res = await ctx.request(userPath(ctx), { num: 1 });
	return (res.folders ?? []).map((f: any) => ({ id: f.id, title: f.title }));
}

/** Folder by id or exact title (case-insensitive); null/"root" = the root folder. */
export async function resolveFolder(ctx: Ctx, ref: string | null | undefined, create = false): Promise<string | null> {
	const name = String(ref ?? "").trim();
	if (ROOT_NAMES.has(name.toLowerCase())) return null;
	const folders = await listFolders(ctx);
	const hit = folders.find((f) => f.id === name) ?? folders.find((f) => f.title.toLowerCase() === name.toLowerCase());
	if (hit) return hit.id;
	if (!create) throw new ArcGISError(`Folder '${name}' not found (portal_folders action=list shows them).`, "not_found");
	const res = await ctx.request(`${userPath(ctx)}/createFolder`, { title: name });
	return res.folder?.id ?? null;
}

// --- groups --------------------------------------------------------------------------------------------

export async function resolveGroupId(ctx: Ctx, ref: string): Promise<{ id: string; title: string }> {
	const clean = String(ref).trim();
	if (ID_RE.test(clean)) {
		const g = await ctx.request(`${base(ctx)}/community/groups/${clean}`);
		return { id: g.id, title: g.title };
	}
	const res = await ctx.request(`${base(ctx)}/community/groups`, { q: `title:"${clean}"`, num: 100 });
	const exact = (res.results ?? []).filter((g: any) => String(g.title).toLowerCase() === clean.toLowerCase());
	if (exact.length > 1) {
		throw new ArcGISError(`Group '${ref}' is ambiguous (${exact.length} groups share that title) - use its id: `
			+ exact.slice(0, 5).map((g: any) => `${g.id} (owner ${g.owner})`).join(", "), "ambiguous");
	}
	if (!exact.length) throw new ArcGISError(`Group '${ref}' not found.`, "not_found");
	return { id: exact[0].id, title: exact[0].title };
}
