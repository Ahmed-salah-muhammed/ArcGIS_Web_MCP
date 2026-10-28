/**
 * ArcGIS StoryMaps stories, made like the ArcGIS API for Python 2.4.3 makes them (apps/storymap): a "StoryMap"
 * item whose draft is the resource draft_<ms>.json, and publishing = the same JSON as the item data and
 * published_data.json, "smstatuspublished" keywords, the url, then POST <story url>/publish. The nodes are shaped
 * like a published story read from ArcGIS Online: a "webmap" node pointing at a "webmap" resource (itemId,
 * itemType "Web Map", extent, layers), and "text" nodes typed h2/paragraph.
 */
import { ArcGISError } from "../../arcgis";
import { esc } from "../../pages/credit";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { addItem, addResource, orRemove, portalSelf, requireItemOfType, updateItem } from "../shared/items";
import { base } from "../shared/lookup";
import type { AppArgs, Section } from "./types";

export const STORY_THEMES = ["summit", "obsidian", "ridgeline", "mesa", "tidal", "slate"];
const nodeId = (prefix: "n" | "r") => `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;

/** WGS84 lon/lat -> Web Mercator x/y. */
export function mercator(lon: number, lat: number): [number, number] {
	const r = 6378137;
	const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
	return [r * (lon * Math.PI) / 180, r * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))];
}

/** The map placement StoryMaps stores, from an item extent [[xmin, ymin], [xmax, ymax]] in WGS84. */
export function placement(extent: number[][] | null | undefined) {
	if (!Array.isArray(extent) || extent.length !== 2) {
		return { zoom: 2, viewpoint: { rotation: 0, scale: -1, targetGeometry: {} } };
	}
	const sr = { latestWkid: 3857, wkid: 102100 };
	const [xmin, ymin] = mercator(extent[0][0], extent[0][1]);
	const [xmax, ymax] = mercator(extent[1][0], extent[1][1]);
	const span = Math.max(extent[1][0] - extent[0][0], (extent[1][1] - extent[0][1]) * 2, 1e-6);
	const zoom = Math.max(1, Math.min(20, Math.log2(360 / span)));
	const center = { spatialReference: sr, x: (xmin + xmax) / 2, y: (ymin + ymax) / 2 };
	return { extent: { spatialReference: sr, xmin, ymin, xmax, ymax }, center, zoom,
		viewpoint: { rotation: 0, scale: 591657527.591555 / 2 ** zoom, targetGeometry: center } };
}

async function mapParts(ctx: Ctx, mapId: string) {
	const map = await requireItemOfType(ctx, mapId, ["Web Map"], "webmap_id");
	const data = await ctx.request(`${base(ctx)}/content/items/${map.id}/data`);
	const mapLayers = (data.operationalLayers ?? []).map((l: any) => ({ id: l.id, title: l.title, visible: l.visibility ?? true }));
	const place = placement(map.extent);
	const rid = `r-${map.id}`;
	return { map, rid, resource: { type: "webmap", data: { ...place, mapLayers, itemId: map.id, itemType: "Web Map", type: "default" } },
		node: { type: "webmap", data: { caption: map.title, map: rid, popupDocked: true, search: false, locate: false, timeSlider: false,
			viewPlacement: "extent", mapLayers, ...place } } };
}

/** The story JSON: cover, hidden navigation, the sections in order, credits. */
export async function storyJson(ctx: Ctx, args: AppArgs, byline: string) {
	const sections: Section[] = args.sections?.length ? args.sections : [{ webmap_id: args.webmap_id }];
	const nodes: Record<string, any> = {};
	const resources: Record<string, any> = {};
	const children: string[] = [];
	const add = (node: any) => { const id = nodeId("n"); nodes[id] = node; children.push(id); return id; };
	const cover = nodeId("n");
	nodes[cover] = { type: "storycover", data: { type: "minimal", title: args.title ?? "Untitled story", summary: args.summary ?? "",
		byline, titlePanelPosition: "start" } };
	const nav = nodeId("n");
	nodes[nav] = { type: "navigation", data: { links: [] }, config: { isHidden: true } };
	for (const s of sections) {
		if (s.heading) add({ type: "text", data: { type: "h2", text: esc(s.heading) } });
		for (const para of String(s.text ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
			add({ type: "text", data: { type: "paragraph", text: esc(para).replace(/\n/g, "<br>") } });
		}
		if (s.webmap_id) {
			const m = await mapParts(ctx, s.webmap_id);
			resources[m.rid] = m.resource;
			add(m.node);
		}
	}
	if (!children.length) throw new ArcGISError("A story needs sections (heading/text/webmap_id) or a webmap_id.", "bad_argument");
	const credits = nodeId("n");
	nodes[credits] = { type: "credits" };
	const theme = nodeId("r");
	resources[theme] = { type: "story-theme", data: { themeId: STORY_THEMES.includes(String(args.theme)) ? args.theme : "summit",
		themeBaseVariableOverrides: {} } };
	const root = nodeId("n");
	nodes[root] = { type: "story", data: { storyTheme: theme }, config: { coverDate: "first-published", storyLocale: "en-US" },
		children: [cover, nav, ...children, credits] };
	return { root, nodes, resources };
}

export async function createStorymap(ctx: Ctx, args: AppArgs) {
	const self = await portalSelf(ctx);
	const online = !self.isPortal;
	const portal = ctx.props.portal.replace(/\/+$/, "");
	const story = await storyJson(ctx, args, ctx.props.fullName ?? ctx.props.username);
	const versionUrl = online ? "https://storymaps.arcgis.com/version" : `${portal}/apps/storymaps/version`;
	const version = String((await ctx.publicGet?.(versionUrl).catch(() => null))?.version ?? "");
	const draft = `draft_${Date.now()}.json`;
	const publish = args.publish ?? true;
	const v = (k: string) => (version ? [`${k}:${version}`] : []);
	const keywords = publish
		? ["arcgis-storymaps", "StoryMap", "Web Application", "smstatuspublished", ...v("smversiondraft"), ...v("smversionpublished"),
			"smpublisherapp:arcgis-web-mcp", `smdraftresourceid:${draft}`, `smpublisheddate:${Date.now()}`]
		: ["arcgis-storymaps", "StoryMap", "Web Application", "smstatusdraft", ...v("smversiondraft"), "smeditorapp:arcgis-web-mcp",
			`smdraftresourceid:${draft}`];
	const title = args.title ?? "Untitled story";
	const { id } = await addItem(ctx, args.folder, { type: "StoryMap", title, typeKeywords: keywords.join(","), text: " ",
		tags: (args.tags ?? ["arcgis-web-mcp", "StoryMap"]).join(","), snippet: args.summary ?? "" });
	return orRemove(ctx, [id], async () => {
		const text = JSON.stringify(story);
		await addResource(ctx, id, draft, text, "private");
		const open = online ? `https://storymaps.arcgis.com/stories/${id}` : `${portal}/apps/storymaps/stories/${id}`;
		let published: boolean | null = null;
		if (publish) {
			await addResource(ctx, id, "published_data.json", text);
			await updateItem(ctx, id, { text, url: open });
			published = await ctx.request(`${open}/publish`, {}).then(() => true, () => false);
		}
		const item = await ctx.request(`${base(ctx)}/content/items/${id}`);
		return { app: itemCard(item, ctx.props.portal), open: publish ? open : null, edit: `${open}/edit`, sections: story.nodes[story.root].children.length - 3,
			...(publish && !published ? { note: "Saved and marked published; StoryMaps' own publish step did not answer, so open it in the builder and Publish once." } : {}),
			...(!publish ? { note: "Saved as a draft: open it in the builder and Publish." } : {}) };
	});
}
