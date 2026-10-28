/**
 * portal_map: web maps as plain web-map JSON (addItem type "Web Map" + text, verified on ArcGIS Online), ported
 * from the ArcGIS Pro Salah MCP (portal/maps.py). Basemaps come from the user's own org: its default basemap, or a
 * title from its basemap gallery group.
 */
import { ArcGISError, hostAllowed } from "../../arcgis";
import { VERSION } from "../../pages/identity";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { addItem } from "../shared/items";
import { base, requireId } from "../shared/lookup";
import { buildRenderer } from "../shared/renderer";
import { audit } from "../shared/safety";

export const BASEMAP_ALIASES: Record<string, string> = {
	"topo-vector": "topographic", topo: "topographic", "streets-vector": "streets", streets: "streets",
	satellite: "imagery", imagery: "imagery", hybrid: "imagery hybrid", "gray-vector": "light gray canvas",
	gray: "light gray canvas", "dark-gray-vector": "dark gray canvas", "dark-gray": "dark gray canvas", oceans: "oceans",
	osm: "openstreetmap", terrain: "terrain with labels", navigation: "navigation",
};
const SYSTEM_FIELDS = new Set(["objectid", "fid", "globalid", "shape", "shape__area", "shape__length", "shape_area",
	"shape_length", "created_user", "created_date", "last_edited_user", "last_edited_date", "creationdate", "creator",
	"editdate", "editor"]);
const ID_RE = /^[0-9a-f]{32}$/i;

export function popupFor(props: any, titleField?: string, fields?: string[]) {
	const fieldInfos = (props.fields ?? []).map((f: any) => ({
		fieldName: f.name, label: f.alias || f.name,
		visible: fields?.length ? fields.includes(f.name) : !SYSTEM_FIELDS.has(String(f.name).toLowerCase()),
	}));
	const title = titleField || props.displayField || fields?.[0];
	return { title: title ? `{${title}}` : props.name ?? "", fieldInfos, popupElements: [{ type: "fields" }] };
}

export function findLayer(layers: any[], ref: unknown): number {
	if (typeof ref === "number" || /^\d+$/.test(String(ref))) {
		const i = Number(ref);
		if (i >= 0 && i < layers.length) return i;
		throw new ArcGISError(`layer index ${i} out of range (${layers.length} layers).`, "bad_argument");
	}
	const key = String(ref).toLowerCase();
	const i = layers.findIndex((l) => [l.title, l.id, l.url].map((v) => String(v ?? "").toLowerCase()).includes(key));
	if (i < 0) throw new ArcGISError(`No layer '${ref}' in the map: ${layers.map((l) => l.title).join(", ")}`, "not_found");
	return i;
}

export function summary(data: any) {
	return {
		basemap: data.baseMap?.title ?? null,
		layers: (data.operationalLayers ?? []).map((l: any) => {
			const drawing = l.layerDefinition?.drawingInfo ?? {};
			return { id: l.id, title: l.title, type: l.layerType, url: l.url ?? null, itemId: l.itemId ?? null,
				visible: l.visibility ?? null, popup: Boolean(l.popupInfo) && !l.disablePopup,
				renderer: drawing.renderer?.type ?? null, definitionExpression: l.layerDefinition?.definitionExpression ?? null };
		}),
		tables: (data.tables ?? []).map((t: any) => ({ title: t.title, url: t.url })),
	};
}

export function unionExtent(extents: (number[][] | null | undefined)[]): number[][] | null {
	const ok = extents.filter((e): e is number[][] => Array.isArray(e) && e.length === 2);
	if (!ok.length) return null;
	return [[Math.min(...ok.map((e) => e[0][0])), Math.min(...ok.map((e) => e[0][1]))],
		[Math.max(...ok.map((e) => e[1][0])), Math.max(...ok.map((e) => e[1][1]))]];
}

async function basemapFor(ctx: Ctx, name?: string) {
	const self = await ctx.request(`${base(ctx)}/portals/self`);
	if (!name || name.toLowerCase() === "default") {
		const bm = self.defaultBasemap ?? {};
		if (!bm.baseMapLayers) throw new ArcGISError("The org has no default basemap; pass basemap= a gallery title.", "not_found");
		return { title: bm.title ?? "Basemap", baseMapLayers: bm.baseMapLayers };
	}
	const wanted = BASEMAP_ALIASES[name.toLowerCase()] ?? name.toLowerCase();
	const q = (self.useVectorBasemaps && self.vectorBasemapGalleryGroupQuery) || self.basemapGalleryGroupQuery;
	const titles: string[] = [];
	if (q) {
		const groups = await ctx.request(`${base(ctx)}/community/groups`, { q, num: 3 });
		for (const g of groups.results ?? []) {
			const maps = await ctx.request(`${base(ctx)}/search`, { q: `group:${g.id} AND type:"Web Map"`, num: 100 });
			for (const m of maps.results ?? []) {
				titles.push(m.title);
				if (String(m.title).toLowerCase() === wanted) {
					const data = await ctx.request(`${base(ctx)}/content/items/${m.id}/data`);
					return { title: data.baseMap?.title ?? m.title, baseMapLayers: data.baseMap?.baseMapLayers ?? [] };
				}
			}
		}
	}
	throw new ArcGISError(`Basemap '${name}' is not in your org's gallery. Available: ${[...new Set(titles)].join(", ") || "none"}`
		+ " (or omit basemap for the org default).", "not_found");
}

async function layersFrom(ctx: Ctx, ref: string, popups: boolean): Promise<{ layers: any[]; extent: number[][] | null }> {
	const r = String(ref).trim();
	if (!ID_RE.test(r)) {
		if (!hostAllowed(r, ctx.props.portal, ctx.extraHosts)) {
			throw new ArcGISError(`Refusing ${new URL(r).hostname}: not your portal or one of its services.`, "host_not_allowed");
		}
		const p = await ctx.request(r);
		const layer: any = { id: `lyr_${Math.abs([...r].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}`,
			title: p.name, url: r, layerType: "ArcGISFeatureLayer", visibility: true, opacity: 1 };
		if (popups) layer.popupInfo = popupFor(p);
		return { layers: [layer], extent: null };
	}
	const it = await ctx.request(`${base(ctx)}/content/items/${requireId(r)}`);
	if (it.type === "Feature Service") {
		if (!it.url || !hostAllowed(it.url, ctx.props.portal, ctx.extraHosts)) {
			throw new ArcGISError(`Item ${it.id} points at a service outside your portal; add it by URL only if you trust it.`,
				"host_not_allowed");
		}
		const svc = await ctx.request(it.url);
		const subs = [...(svc.layers ?? []), ...(svc.tables ?? [])];
		const layers = [];
		for (const [i, s] of subs.entries()) {
			const url = `${it.url}/${s.id}`;
			const layer: any = { id: `${it.id.slice(0, 8)}_${i}`, title: subs.length > 1 ? s.name : it.title, url,
				itemId: it.id, layerType: "ArcGISFeatureLayer", visibility: true, opacity: 1 };
			if (popups) layer.popupInfo = popupFor(await ctx.request(url));
			layers.push(layer);
		}
		return { layers, extent: it.extent ?? null };
	}
	const kinds: Record<string, string> = { "Map Service": "ArcGISMapServiceLayer", "Image Service": "ArcGISImageServiceLayer",
		"Vector Tile Service": "VectorTileLayer" };
	if (!kinds[it.type]) throw new ArcGISError(`${it.type} items cannot be added to a web map here.`, "unsupported");
	const layer: any = { id: it.id.slice(0, 12), title: it.title, itemId: it.id, layerType: kinds[it.type], visibility: true,
		opacity: 1 };
	if (it.type === "Vector Tile Service") layer.styleUrl = `${it.url}/resources/styles/root.json`;
	else layer.url = it.url;
	return { layers: [layer], extent: it.extent ?? null };
}

export type MapArgs = {
	action?: "create" | "describe" | "add_layers" | "remove_layers" | "popup" | "renderer" | "filter" | "basemap";
	item_id?: string;
	title?: string;
	layers?: (string | number)[];
	basemap?: string;
	tags?: string[];
	folder?: string;
	snippet?: string;
	popups?: boolean;
	renderer?: Record<string, any>;
	layer?: string | number;
	popup_fields?: string[];
	popup_title?: string;
	definition_expression?: string;
};

export async function webmap(ctx: Ctx, args: MapArgs) {
	const action = args.action ?? "describe";
	const popups = args.popups ?? true;
	if (action === "create") {
		if (!args.title || !args.layers?.length) throw new ArcGISError("title and layers (item ids / layer URLs) are required.", "bad_argument");
		const ops: any[] = [];
		const extents: (number[][] | null)[] = [];
		for (const ref of args.layers) {
			const { layers, extent } = await layersFrom(ctx, String(ref), popups);
			ops.push(...layers);
			extents.push(extent);
		}
		const target = ops[findLayer(ops, args.layer ?? 0)];
		if (args.renderer) {
			target.layerDefinition = { ...(target.layerDefinition ?? {}), drawingInfo: { renderer:
				await buildRenderer(ctx, target.url, (await ctx.request(target.url)).geometryType, args.renderer) } };
		}
		if (args.definition_expression) {
			target.layerDefinition = { ...(target.layerDefinition ?? {}), definitionExpression: args.definition_expression };
		}
		const data = { operationalLayers: ops, baseMap: await basemapFor(ctx, args.basemap),
			spatialReference: { wkid: 102100, latestWkid: 3857 }, version: "2.31", authoringApp: "ArcGIS Web MCP",
			authoringAppVersion: VERSION };
		const extent = unionExtent(extents);
		const { id } = await addItem(ctx, args.folder, {
			type: "Web Map", title: args.title, tags: (args.tags ?? ["arcgis-web-mcp"]).join(","),
			snippet: args.snippet ?? "Created by ArcGIS Web MCP", text: data,
			typeKeywords: "ArcGIS Online,Explorer Web Map,Map,Online Map,Web Map",
			extent: extent ? extent.flat().join(",") : undefined,
		});
		const saved = await ctx.request(`${base(ctx)}/content/items/${id}/data`);
		const item = await ctx.request(`${base(ctx)}/content/items/${id}`);
		audit(ctx.props, { tool: "portal_map", action, target: id, ok: true });
		return { webmap: itemCard(item, ctx.props.portal), ...summary(saved) };
	}
	if (!args.item_id) throw new ArcGISError("item_id (the web map) is required.", "bad_argument");
	const id = requireId(args.item_id);
	const it = await ctx.request(`${base(ctx)}/content/items/${id}`);
	if (it.type !== "Web Map") throw new ArcGISError(`Item is a ${it.type}, not a Web Map.`, "bad_argument");
	const data = (await ctx.request(`${base(ctx)}/content/items/${id}/data`)) ?? {};
	if (action === "describe") return { webmap: itemCard(it, ctx.props.portal), ...summary(data) };

	const ops: any[] = (data.operationalLayers ??= []);
	if (action === "add_layers") {
		if (!args.layers?.length) throw new ArcGISError("layers (item ids / layer URLs) is required.", "bad_argument");
		for (const ref of args.layers) ops.push(...(await layersFrom(ctx, String(ref), popups)).layers);
	} else if (action === "remove_layers") {
		if (!args.layers?.length) throw new ArcGISError("layers (titles, ids, urls or indexes) is required.", "bad_argument");
		const idx = [...new Set(args.layers.map((r) => findLayer(ops, r)))].sort((a, b) => b - a);
		for (const i of idx) ops.splice(i, 1);
	} else if (action === "popup") {
		if (args.layer === undefined) throw new ArcGISError("layer is required.", "bad_argument");
		const target = ops[findLayer(ops, args.layer)];
		target.popupInfo = popupFor(await ctx.request(target.url), args.popup_title, args.popup_fields);
		delete target.disablePopup;
	} else if (action === "renderer") {
		if (args.layer === undefined || !args.renderer) throw new ArcGISError("layer and renderer are required.", "bad_argument");
		const target = ops[findLayer(ops, args.layer)];
		target.layerDefinition = { ...(target.layerDefinition ?? {}), drawingInfo: { ...(target.layerDefinition?.drawingInfo ?? {}),
			renderer: await buildRenderer(ctx, target.url, (await ctx.request(target.url)).geometryType, args.renderer) } };
	} else if (action === "filter") {
		if (args.layer === undefined) throw new ArcGISError("layer is required (an empty definition_expression clears the filter).", "bad_argument");
		const target = ops[findLayer(ops, args.layer)];
		target.layerDefinition = { ...(target.layerDefinition ?? {}) };
		if (args.definition_expression) target.layerDefinition.definitionExpression = args.definition_expression;
		else delete target.layerDefinition.definitionExpression;
	} else if (action === "basemap") {
		data.baseMap = await basemapFor(ctx, args.basemap);
	} else {
		throw new ArcGISError("action must be create | describe | add_layers | remove_layers | popup | renderer | filter | basemap.",
			"bad_action");
	}
	const res = await ctx.request(`${base(ctx)}/content/users/${encodeURIComponent(it.owner)}/items/${id}/update`, { text: data });
	const saved = await ctx.request(`${base(ctx)}/content/items/${id}/data`);
	audit(ctx.props, { tool: "portal_map", action, target: id, ok: Boolean(res.success) });
	return { webmap: itemCard(it, ctx.props.portal), updated: Boolean(res.success), ...summary(saved) };
}
