/**
 * Content writes over plain ArcGIS REST: item update/move/protect/delete/dependencies, folders, sharing, publishing.
 * Every call here was first verified on ArcGIS Online with throwaway items (see README "What was verified").
 * Facts that shaped it: a CSV added as `text` cannot be analyzed/published (multipart upload is required);
 * deleting a layer that has views fails with "has a related Service item"; folder rename is not exposed reliably
 * (updateFolder rejected every parameter tried), so it is not offered.
 */
import { ArcGISError, hostAllowed, sharingUrl } from "./arcgis";
import { type Ctx, itemCard, requireId } from "./portal";
import { audit, GEOCODE_CREDITS_EACH, MAX_UPLOAD_CHARS, requireConfirm } from "./safety";

const ROOT_NAMES = new Set(["", "/", "root", "root folder", "home"]);
const UPDATABLE = new Set(["title", "snippet", "description", "tags", "accessInformation", "licenseInfo",
	"typeKeywords", "spatialReference", "culture", "url"]);
const LEVELS: Record<string, "private" | "org" | "everyone"> = {
	private: "private", org: "org", organization: "org", everyone: "everyone", public: "everyone",
};

const base = (ctx: Ctx) => sharingUrl(ctx.props.portal);
const userPath = (ctx: Ctx, owner?: string) => `${base(ctx)}/content/users/${encodeURIComponent(owner ?? ctx.props.username)}`;

async function getItem(ctx: Ctx, id: string) {
	return ctx.request(`${base(ctx)}/content/items/${requireId(id)}`);
}

// --- folders ------------------------------------------------------------------------------------

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

// --- items ----------------------------------------------------------------------------------------

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

// --- groups lookup (ids over titles) ----------------------------------------------------------------

export async function resolveGroupId(ctx: Ctx, ref: string): Promise<{ id: string; title: string }> {
	const clean = String(ref).trim();
	if (/^[0-9a-f]{32}$/i.test(clean)) {
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

// --- sharing ------------------------------------------------------------------------------------------

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

// --- publishing -----------------------------------------------------------------------------------------

export type PublishArgs = {
	title: string;
	csv_text?: string;
	geojson_text?: string;
	url?: string;
	item_id?: string;
	folder?: string;
	tags?: string[];
	snippet?: string;
	latitude_field?: string;
	longitude_field?: string;
	address_fields?: Record<string, string>;
	confirm?: boolean;
};

export function serviceName(title: string): string {
	return title.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 80) || "layer";
}

const FILE_TYPES: Record<string, { itemType: string; fileType: string; ext: string; mime: string }> = {
	csv: { itemType: "CSV", fileType: "csv", ext: "csv", mime: "text/csv" },
	geojson: { itemType: "GeoJson", fileType: "geojson", ext: "geojson", mime: "application/geo+json" },
};
const ITEM_FILE_TYPES: Record<string, string> = {
	CSV: "csv", GeoJson: "geojson", Shapefile: "shapefile", "File Geodatabase": "fileGeodatabase",
	"Microsoft Excel": "excel", GeoPackage: "geopackage",
};

async function availableName(ctx: Ctx, wanted: string): Promise<string> {
	const orgId = ctx.props.orgId;
	if (!orgId) return `${wanted}_${Date.now()}`;
	for (let i = 1; i <= 5; i++) {
		const name = i === 1 ? wanted : `${wanted}_${i}`;
		try {
			const res = await ctx.request(`${base(ctx)}/portals/${orgId}/isServiceNameAvailable`,
				{ name, type: "Feature Service" });
			if (res.available) return name;
		} catch {
			return `${wanted}_${Date.now()}`;
		}
	}
	return `${wanted}_${Date.now()}`;
}

export async function publish(ctx: Ctx, args: PublishArgs) {
	const title = args.title?.trim();
	if (!title) throw new ArcGISError("title is required.", "bad_argument");
	const sources = ["csv_text", "geojson_text", "url", "item_id"].filter((k) => (args as any)[k]);
	if (sources.length !== 1) {
		throw new ArcGISError("Give exactly one source: csv_text, geojson_text, url (a public CSV/GeoJSON) or item_id "
			+ "(an uploaded CSV / GeoJSON / Shapefile / File Geodatabase item).", "bad_argument");
	}
	let kind: string | null = args.csv_text ? "csv" : args.geojson_text ? "geojson" : null;
	let content = args.csv_text ?? args.geojson_text ?? null;
	if (args.url) {
		const u = new URL(args.url);
		if (u.protocol !== "https:") throw new ArcGISError("url must be https.", "bad_argument");
		const res = await fetch(u.href); // public fetch (global_fetch_strictly_public); no token is sent
		if (!res.ok) throw new ArcGISError(`Could not download ${u.hostname}: HTTP ${res.status}`, "download_failed");
		content = await res.text();
		kind = /\.(geo)?json(\?|$)/i.test(u.pathname) || content.trimStart().startsWith("{") ? "geojson" : "csv";
	}
	if (content !== null && content.length > MAX_UPLOAD_CHARS) {
		throw new ArcGISError(`The data is ${content.length} characters; the limit here is ${MAX_UPLOAD_CHARS}. Upload `
			+ "large files in ArcGIS Online, then publish them with item_id.", "too_large");
	}

	// Geocoding spends credits: ask BEFORE uploading anything, so a refusal leaves no orphan item behind.
	const rows = kind === "csv" && content !== null ? Math.max(0, content.trim().split(/\r?\n/).length - 1) : 0;
	const geocodeNote = "This spends ArcGIS Online credits.";
	const byAddress = Boolean(args.address_fields) && !(args.latitude_field && args.longitude_field);
	if (byAddress && !ctx.props.isPortal) {
		requireConfirm(args.confirm, `Publishing ${rows || "the"} rows by address (geocoding)`,
			{ estimated_credits: rows ? Math.round(rows * GEOCODE_CREDITS_EACH * 100) / 100 : null }, geocodeNote);
	}

	const folderId = await resolveFolder(ctx, args.folder, true);
	const folderPath = `${userPath(ctx)}${folderId ? `/${folderId}` : ""}`;
	let sourceId: string;
	let fileType: string;
	let uploaded = false;
	if (args.item_id) {
		const src = await getItem(ctx, args.item_id);
		fileType = ITEM_FILE_TYPES[src.type];
		if (!fileType) throw new ArcGISError(`${src.type} items cannot be published here.`, "unsupported");
		sourceId = src.id;
	} else {
		const ft = FILE_TYPES[kind!];
		if (!ctx.upload) throw new ArcGISError("Uploads are not available in this context.", "unsupported");
		const added = await ctx.upload(`${folderPath}/addItem`, {
			type: ft.itemType, title, tags: (args.tags ?? ["arcgis-web-mcp"]).join(","),
			snippet: args.snippet ?? "Uploaded by ArcGIS Web MCP",
		}, { name: `${serviceName(title)}.${ft.ext}`, content: content!, type: ft.mime });
		if (!added.id) throw new ArcGISError(`The upload did not create an item: ${JSON.stringify(added).slice(0, 200)}`, "upload_failed");
		sourceId = added.id;
		fileType = ft.fileType;
		uploaded = true;
	}
	const dropUpload = async () => {
		if (uploaded) await ctx.request(`${userPath(ctx)}/items/${sourceId}/delete`, { permanentDelete: true }).catch(() => null);
	};

	let pp: Record<string, unknown> = {};
	if (fileType === "csv" || fileType === "excel") {
		const analyzed = await ctx.request(`${base(ctx)}/content/features/analyze`,
			{ itemid: sourceId, filetype: fileType, sourceLocale: "en" });
		pp = { ...(analyzed.publishParameters ?? {}) };
		if (args.latitude_field && args.longitude_field) {
			Object.assign(pp, { locationType: "coordinates", latitudeFieldName: args.latitude_field,
				longitudeFieldName: args.longitude_field });
		} else if (args.address_fields) {
			Object.assign(pp, { locationType: "address", addressFields: args.address_fields });
		}
		if (pp.locationType === "address" && !ctx.props.isPortal && !args.confirm) {
			// analyze detected address columns on its own: remove the upload, then ask
			await dropUpload();
			requireConfirm(false, `Publishing ${rows || "the"} rows by address (geocoding; the file has address columns)`,
				{ estimated_credits: rows ? Math.round(rows * GEOCODE_CREDITS_EACH * 100) / 100 : null,
					avoid_credits: "pass latitude_field + longitude_field if the data has coordinates" }, geocodeNote);
		}
	}
	pp.name = await availableName(ctx, serviceName(title));
	const pub = await ctx.request(`${userPath(ctx)}/publish`, { itemid: sourceId, filetype: fileType,
		publishParameters: pp }).catch(async (e) => {
		await dropUpload();
		throw e;
	});
	const svc = (pub.services ?? [])[0] ?? {};
	if (!svc.serviceItemId || svc.success === false) {
		await dropUpload();
		throw new ArcGISError(`Publishing failed: ${JSON.stringify(svc.error ?? svc).slice(0, 300)}`, "publish_failed");
	}
	const wait = ctx.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	let status = "processing";
	for (let i = 0; i < 30 && svc.jobId && status !== "completed"; i++) {
		await wait(2000);
		const st = await ctx.request(`${userPath(ctx)}/items/${svc.serviceItemId}/status`,
			{ jobId: svc.jobId, jobType: "publish" });
		status = st.status;
		if (status === "failed") throw new ArcGISError(`Publishing failed: ${st.statusMessage}`, "publish_failed");
	}
	const published = await getItem(ctx, svc.serviceItemId);
	let layers: unknown[] = [];
	if (published.url && hostAllowed(published.url, ctx.props.portal, ctx.extraHosts)) {
		const s = await ctx.request(published.url);
		layers = [...(s.layers ?? []), ...(s.tables ?? [])].map((l: any, index: number) => ({ index, id: l.id, name: l.name,
			url: `${published.url}/${l.id}` }));
	}
	audit(ctx.props, { tool: "portal_publish", action: "publish", target: title, ok: true,
		details: { source: sourceId, published: svc.serviceItemId } });
	return { source_item_id: sourceId, published_item: itemCard(published, ctx.props.portal), layers,
		status: status === "completed" ? "completed" : `still ${status} (check later with portal_item)` };
}
