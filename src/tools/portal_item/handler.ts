/**
 * portal_item: read one item (get: card + every layer/table of a service; data: its JSON) and change it (update,
 * move, protect/unprotect, delete, dependencies). Deleting a layer that has views fails with "has a related
 * Service item": the views go first.
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { itemCard, truncate } from "../shared/format";
import { base, getItem, requireAllowed, requireId, resolveFolder, serviceLayers, userPath } from "../shared/lookup";
import { layerMetadata, webmapDescription } from "../shared/metadata";
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

// --- export -------------------------------------------------------------------------------------------

export const EXPORT_FORMATS: Record<string, string> = {
	csv: "CSV", geojson: "GeoJson", shapefile: "Shapefile", fgdb: "File Geodatabase", excel: "Excel",
	geopackage: "geoPackage", kml: "KML",
};

/**
 * Export a feature layer item to a file item in the signed-in user's content (content/users/<me>/export, a job
 * polled at items/<id>/status). The owner can always export; others need the layer's "Allow others to export".
 */
export async function exportItem(ctx: Ctx, args: { item_id: string; format?: string; title?: string; layers?: number[] }) {
	const id = requireId(args.item_id);
	const format = EXPORT_FORMATS[String(args.format ?? "").toLowerCase()];
	if (!format) throw new ArcGISError(`format must be ${Object.keys(EXPORT_FORMATS).join(" | ")}.`, "bad_argument");
	const it = await getItem(ctx, id);
	if (!["Feature Service", "Feature Collection"].includes(it.type)) {
		throw new ArcGISError(`Only feature layers can be exported (this is a ${it.type}).`, "unsupported");
	}
	const title = args.title?.trim() || `${it.title}_${String(args.format).toLowerCase()}`;
	const res = await ctx.request(`${userPath(ctx)}/export`, {
		itemId: id, exportFormat: format, title, tags: (it.tags ?? []).join(",") || "arcgis-web-mcp",
		exportParameters: args.layers?.length ? { layers: args.layers.map((l) => ({ id: l })) } : undefined,
	});
	if (!res.exportItemId) throw new ArcGISError(`The export did not start: ${JSON.stringify(res).slice(0, 200)}`, "export_failed");
	const wait = ctx.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	let status = "processing";
	for (let i = 0; i < 25 && res.jobId && status !== "completed"; i++) {
		await wait(2000);
		const st = await ctx.request(`${userPath(ctx)}/items/${res.exportItemId}/status`, { jobId: res.jobId, jobType: "export" });
		status = st.status;
		if (status === "failed") throw new ArcGISError(`The export failed: ${st.statusMessage ?? "no message"}`, "export_failed");
	}
	const out = await getItem(ctx, res.exportItemId);
	audit(ctx.props, { tool: "portal_item", action: "export", target: id, ok: status === "completed", details: { format, out: out.id } });
	return { source_item_id: id, export_item: itemCard(out, ctx.props.portal), format,
		status: status === "completed" ? "completed" : `still ${status} (check later with portal_item action=get)`,
		download_url: `${base(ctx)}/content/items/${out.id}/data`,
		download_note: "Open the item page while signed in to ArcGIS and click Download, or fetch download_url with a token." };
}

// --- metadata -------------------------------------------------------------------------------------------

async function layerFacts(ctx: Ctx, url: string) {
	requireAllowed(ctx, url);
	const p = await ctx.request(url);
	const count = await ctx.request(`${url}/query`, { where: "1=1", returnCountOnly: true }).then((r: any) => r.count ?? null,
		() => null);
	return { name: p.name as string, geometry: p.geometryType as string | undefined,
		fields: ((p.fields ?? []) as any[]).map((f) => String(f.name)), count };
}

/**
 * Summary, description and tags inferred from what the item holds (layer names, fields, geometry, counts; for a web
 * map, its layers). apply=true writes them to the item (tags are merged with the existing ones).
 */
export async function suggestMetadata(ctx: Ctx, args: { item_id: string; apply?: boolean }) {
	const id = requireId(args.item_id);
	const it = await getItem(ctx, id);
	let suggestion: { summary: string; description: string; tags: string[]; theme?: string };
	if (it.type === "Feature Service" && it.url) {
		const { candidates } = await serviceLayers(ctx, it.url);
		if (!candidates.length) throw new ArcGISError("The service has no layers.", "bad_argument");
		const facts = await Promise.all(candidates.slice(0, 5).map((c: any) => layerFacts(ctx, c.url)));
		const first = layerMetadata(facts[0].name || it.title, facts[0].geometry, facts.flatMap((f) => f.fields),
			facts.length === 1 ? facts[0].count : null);
		const others = facts.slice(1).map((f) => f.name);
		suggestion = { ...first,
			description: others.length ? `${first.description} The service also has: ${others.join(", ")}.` : first.description };
	} else if (it.type === "Web Map") {
		const data = await ctx.request(`${base(ctx)}/content/items/${id}/data`);
		const layers = ((data?.operationalLayers ?? []) as any[]).slice(0, 8);
		const described = await Promise.all(layers.map(async (l) => {
			if (!l.url) return { name: l.title };
			const facts = await layerFacts(ctx, l.url).catch(() => null);
			return { name: l.title, theme_label: facts ? layerMetadata(facts.name, facts.geometry, facts.fields).theme_label : undefined };
		}));
		const themes = [...new Set(described.map((d) => d.theme_label).filter(Boolean))] as string[];
		suggestion = { summary: `${it.title}: a web map of ${described.length} layer${described.length === 1 ? "" : "s"}`,
			description: webmapDescription(described), tags: ["ArcGIS Web MCP", "Web Map",
				...themes.flatMap((t) => t.split(" ").filter((w) => w.length > 3 && w !== "and"))].slice(0, 12) };
	} else {
		const meta = layerMetadata(it.title, null, []);
		suggestion = { summary: `${it.title}: ${it.type}`, description: `${it.type} "${it.title}". Described by ArcGIS Web MCP.`,
			tags: [...new Set([...meta.tags, it.type])] };
	}
	if (!args.apply) return { item_id: id, applied: false, current: { snippet: it.snippet ?? null, tags: it.tags ?? [] }, suggestion };
	const tags = [...new Set([...(it.tags ?? []), ...suggestion.tags])].slice(0, 30);
	const res = await ctx.request(`${userPath(ctx, it.owner)}/items/${id}/update`, {
		snippet: suggestion.summary.slice(0, 250), description: suggestion.description, tags: tags.join(","),
	});
	audit(ctx.props, { tool: "portal_item", action: "suggest_metadata", target: id, ok: Boolean(res.success) });
	return { item_id: id, applied: Boolean(res.success), suggestion: { ...suggestion, tags } };
}
