/**
 * ArcGIS StoryMaps stories, made like the ArcGIS API for Python 2.4.3 makes them (apps/storymap): a "StoryMap"
 * item whose draft is the resource draft_<ms>.json, and publishing = the same JSON as the item data and
 * published_data.json, "smstatuspublished" keywords, the url, then POST <story url>/publish. The nodes are shaped
 * like a published story read from ArcGIS Online: a "webmap" node pointing at a "webmap" resource (itemId,
 * itemType "Web Map", extent, layers), and "text" nodes typed h2/paragraph. The other blocks (images by URL, embeds,
 * video, buttons, quotes, lists, separators, big numbers, swipe, sidecar slides, timelines) and the cover image and
 * navigation are shaped as the Python API's story_content.py writes them.
 */
import { ArcGISError } from "../../arcgis";
import { esc } from "../../pages/credit";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { addItem, addResource, orRemove, portalSelf, requireItemOfType, updateItem } from "../shared/items";
import { base } from "../shared/lookup";
import type { AppArgs, Section, StoryBlock, StoryMedia } from "./types";

export const STORY_THEMES = ["summit", "obsidian", "ridgeline", "mesa", "tidal", "slate"];
const COVER_DATES = ["first-published", "last-published", "current-date", "none"];

/** What action=templates says about a story's blocks. */
export const BLOCK_HELP = {
	heading: "A heading: text, level 2 (default, listed in the navigation) | 3 | 4.",
	text: "Paragraphs (a blank line between them); **bold**, *italic*, [label](https://...) work in every text.",
	quote: "A pull quote.", bullets: "A bulleted list (items).", numbered: "A numbered list (items).",
	image: "An image by https url: caption, alt, size small | standard | wide | full | float, link.",
	map: "A web map (webmap_id): caption, size standard | wide | full | float.",
	embed: "A web page (url): display inline (default) or card.", video: "A video link (YouTube, Vimeo...).",
	button: "A button: text and url.", separator: "A divider.", number: "A big number (value) with text under it.",
	swipe: "Two web maps or two images compared with a slider: left / right = {webmap_id} or {image}.",
	sidecar: "Scrolling slides: style docked | floating | slideshow; slides = [{heading, text, webmap_id | image | url}].",
	timeline: "Events in order: style waterfall | timeline; events = [{heading, text, image}].",
	story: "cover = {type full | sidebyside | minimal, image, date first-published | last-published | current-date | none}; "
		+ "navigation = true shows the level-2 headings as a bar.",
};
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

/** Text with **bold**, *italic* and [links](https://...), escaped first: the only markup a story's text takes from here. */
export function richText(t: string): string {
	return esc(t)
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/\*(.+?)\*/g, "<em>$1</em>")
		.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>')
		.replace(/\n/g, "<br>");
}

const https = (url: unknown, what: string) => {
	const u = String(url ?? "").trim();
	if (!/^https:\/\/\S+$/i.test(u)) throw new ArcGISError(`${what} must be an https link.`, "bad_argument");
	return u;
};
const TEXT_STYLES: Record<string, string> = { text: "paragraph", quote: "quote", bullets: "bullet-list", numbered: "numbered-list" };
const IMAGE_SIZES = new Set(["small", "standard", "wide", "full", "float"]);

/** A story's nodes and resources, added the way the ArcGIS API for Python adds them. */
class Story {
	nodes: Record<string, any> = {};
	resources: Record<string, any> = {};
	constructor(private ctx: Ctx) {}
	node(n: any) { const id = nodeId("n"); this.nodes[id] = n; return id; }
	text(style: string, html: string) { return this.node({ type: "text", data: { type: style, text: html } }); }
	image(url: unknown, b: { caption?: string; alt?: string; size?: string; link?: string } = {}) {
		const rid = nodeId("r");
		this.resources[rid] = { type: "image", data: { src: https(url, "image url"), provider: "uri", height: 300, width: 400 } };
		const size = b.size ?? "standard";
		if (!IMAGE_SIZES.has(size)) throw new ArcGISError(`image size must be ${[...IMAGE_SIZES].join(" | ")}.`, "bad_argument");
		return this.node({ type: "image", data: { image: rid, caption: esc(b.caption ?? ""), alt: b.alt ?? "",
			...(b.link ? { link: https(b.link, "image link") } : {}) }, config: { size } });
	}
	async map(webmapId: string, b: { caption?: string; size?: string } = {}) {
		const m = await mapParts(this.ctx, webmapId);
		this.resources[m.rid] = m.resource;
		const size = b.size === "small" ? "standard" : b.size;
		if (size && !["standard", "wide", "full", "float"].includes(size)) {
			throw new ArcGISError("map size must be standard | wide | full | float.", "bad_argument");
		}
		return this.node({ ...m.node, data: { ...m.node.data, ...(b.caption ? { caption: esc(b.caption) } : {}) },
			...(size ? { config: { size } } : {}) });
	}
	embed(url: unknown, b: { caption?: string; alt?: string; display?: string } = {}) {
		const u = https(url, "embed url");
		const host = new URL(u).host;
		return this.node({ type: "embed", data: { url: u, embedType: "link", title: host, description: esc(b.caption ?? ""),
			providerUrl: host, alt: b.alt ?? "", display: b.display === "card" ? "card" : "inline", embedSrc: u } });
	}
	video(url: unknown, b: { caption?: string; alt?: string } = {}) {
		return this.node({ type: "embed", data: { url: https(url, "video url"), embedType: "video", caption: esc(b.caption ?? ""), alt: b.alt ?? "",
			display: "inline", aspectRatio: 1.778, addedAsEmbedCode: true } });
	}
	/** Media for a slide, a swipe side or a cover: a web map, an image, or a page. */
	async media(m: StoryMedia | undefined, what: string) {
		if (m?.webmap_id) return this.map(m.webmap_id, { caption: m.caption });
		if (m?.image) return this.image(m.image, { caption: m.caption, size: "standard" });
		if (m?.url) return this.embed(m.url, { caption: m.caption });
		throw new ArcGISError(`${what} needs webmap_id, image or url.`, "bad_argument");
	}
}

/** One story block, in order: headings, text, lists, images, maps, embeds, video, buttons, big numbers, swipe, sidecar, timeline. */
async function addBlock(st: Story, b: StoryBlock, i: number): Promise<string[]> {
	const what = `blocks[${i}] (${b.type})`;
	const need = (v: unknown, name: string) => {
		if (v === undefined || v === null || String(v).trim() === "") throw new ArcGISError(`${what} needs ${name}.`, "bad_argument");
		return String(v);
	};
	switch (b.type) {
		case "heading": return [st.text(`h${b.level === 3 || b.level === 4 ? b.level : 2}`, esc(need(b.text, "text")))];
		case "text": return need(b.text, "text").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => st.text("paragraph", richText(p)));
		case "quote": return [st.text("quote", richText(need(b.text, "text")))];
		case "bullets": case "numbered": {
			const items = (b.items ?? []).map(String).filter((x) => x.trim());
			if (!items.length) throw new ArcGISError(`${what} needs items.`, "bad_argument");
			return [st.text(TEXT_STYLES[b.type], items.map((x) => `<li>${richText(x)}</li>`).join(""))];
		}
		case "image": return [st.image(b.url, b)];
		case "map": return [await st.map(need(b.webmap_id, "webmap_id"), b)];
		case "embed": return [st.embed(b.url, b)];
		case "video": return [st.video(b.url, b)];
		case "button": return [st.node({ type: "button", data: { text: esc(need(b.text, "text")), link: https(b.url, `${what} url`) } })];
		case "separator": return [st.node({ type: "separator" })];
		case "number": return [st.node({ type: "large-number", data: { title: esc(need(b.value, "value")), description: esc(b.text ?? ""),
			alignment: "center" } })];
		case "swipe": {
			const [l, r] = [b.left, b.right];
			if (!l || !r || Boolean(l.webmap_id) !== Boolean(r.webmap_id) || Boolean(l.image) !== Boolean(r.image) || (!l.webmap_id && !l.image)) {
				throw new ArcGISError(`${what} needs left and right: two web maps (webmap_id) or two images (image).`, "bad_argument");
			}
			const left = await st.media(l, `${what} left`);
			const right = await st.media(r, `${what} right`);
			return [st.node({ type: "swipe", data: { contents: { 0: left, 1: right }, caption: esc(b.caption ?? ""), alt: b.alt ?? "" } })];
		}
		case "sidecar": {
			if (!b.slides?.length) throw new ArcGISError(`${what} needs slides [{heading, text, webmap_id | image | url}].`, "bad_argument");
			const slides: string[] = [];
			for (const [k, sl] of b.slides.entries()) {
				const content = [...(sl.heading ? [st.text("h3", esc(sl.heading))] : []),
					...String(sl.text ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => st.text("paragraph", richText(p)))];
				const panel = st.node({ type: "immersive-narrative-panel", children: content,
					data: { position: "start", size: "small", panelStyle: "themed" } });
				const media = await st.media(sl, `${what} slides[${k}]`);
				slides.push(st.node({ type: "immersive-slide", children: [panel, media], data: { transition: "fade" } }));
			}
			const subtype = { docked: "docked-panel", floating: "floating-panel", slideshow: "slideshow" }[b.style ?? "docked"];
			if (!subtype) throw new ArcGISError("sidecar style must be docked | floating | slideshow.", "bad_argument");
			return [st.node({ type: "immersive", data: { type: "sidecar", subtype, narrativePanelPosition: "start", narrativePanelSize: "medium" },
				children: slides })];
		}
		case "timeline": {
			if (!b.events?.length) throw new ArcGISError(`${what} needs events [{heading, text, image}].`, "bad_argument");
			const events = b.events.map((e) => st.node({ type: "timeline-event", children: [
				...(e.heading ? [st.text("h3", esc(e.heading))] : []), ...(e.text ? [st.text("paragraph", richText(e.text))] : []),
				...(e.image ? [st.image(e.image)] : [])] }));
			const style = b.style ?? "waterfall";
			if (!["waterfall", "timeline"].includes(style)) throw new ArcGISError("timeline style must be waterfall | timeline.", "bad_argument");
			return [st.node({ type: "timeline", data: { type: style }, children: events })];
		}
		default: throw new ArcGISError(`Unknown story block '${(b as any).type}'.`, "bad_argument");
	}
}

/** The story JSON: cover, navigation, the sections and blocks in order, credits. */
export async function storyJson(ctx: Ctx, args: AppArgs, byline: string) {
	const st = new Story(ctx);
	const blocks: StoryBlock[] = [];
	const sections: Section[] = args.sections?.length || args.blocks?.length ? args.sections ?? [] : [{ webmap_id: args.webmap_id }];
	for (const s of sections) {
		if (s.heading) blocks.push({ type: "heading", text: s.heading });
		if (String(s.text ?? "").trim()) blocks.push({ type: "text", text: s.text });
		if (s.webmap_id) blocks.push({ type: "map", webmap_id: s.webmap_id });
	}
	blocks.push(...(args.blocks ?? []));
	const children: string[] = [];
	for (const [i, b] of blocks.entries()) children.push(...await addBlock(st, b, i));
	if (!children.length) throw new ArcGISError("A story needs blocks, sections (heading/text/webmap_id) or a webmap_id.", "bad_argument");
	const c = args.cover ?? {};
	const coverType = c.type ?? (c.image ? "full" : "minimal");
	if (!["full", "sidebyside", "minimal"].includes(coverType)) throw new ArcGISError("cover type must be full | sidebyside | minimal.", "bad_argument");
	const cover = st.node({ type: "storycover", data: { type: coverType, title: args.title ?? "Untitled story", summary: args.summary ?? "",
		byline, titlePanelPosition: "start" }, ...(c.image ? { children: [st.image(c.image, { alt: c.alt })] } : {}) });
	// navigation: the h2 headings, shown when asked for
	const links = children.filter((id) => st.nodes[id].type === "text" && st.nodes[id].data.type === "h2");
	const nav = st.node({ type: "navigation", data: { links: args.navigation ? links : [] }, config: { isHidden: !args.navigation } });
	const credits = st.node({ type: "credits" });
	const theme = nodeId("r");
	st.resources[theme] = { type: "story-theme", data: { themeId: STORY_THEMES.includes(String(args.theme)) ? args.theme : "summit",
		themeBaseVariableOverrides: {} } };
	const date = c.date ?? "first-published";
	if (!COVER_DATES.includes(date)) throw new ArcGISError(`cover date must be ${COVER_DATES.join(" | ")}.`, "bad_argument");
	const root = st.node({ type: "story", data: { storyTheme: theme }, config: { coverDate: date, storyLocale: "en-US" },
		children: [cover, nav, ...children, credits] });
	return { root, nodes: st.nodes, resources: st.resources, blocks: children.length };
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
		const { blocks, ...json } = story;
		const text = JSON.stringify(json);
		await addResource(ctx, id, draft, text, "private");
		const open = online ? `https://storymaps.arcgis.com/stories/${id}` : `${portal}/apps/storymaps/stories/${id}`;
		let published: boolean | null = null;
		if (publish) {
			await addResource(ctx, id, "published_data.json", text);
			await updateItem(ctx, id, { text, url: open });
			published = await ctx.request(`${open}/publish`, {}).then(() => true, () => false);
		}
		const item = await ctx.request(`${base(ctx)}/content/items/${id}`);
		return { app: itemCard(item, ctx.props.portal), open: publish ? open : null, edit: `${open}/edit`, blocks,
			...(publish && !published ? { note: "Saved and marked published; StoryMaps' own publish step did not answer, so open it in the builder and Publish once." } : {}),
			...(!publish ? { note: "Saved as a draft: open it in the builder and Publish." } : {}) };
	});
}
