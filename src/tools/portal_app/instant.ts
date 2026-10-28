/**
 * Instant Apps from a web map. The templates are the org's own "Web Application Templates" group (portals/self
 * templatesGroupQuery: 23 Instant Apps on ArcGIS Online, 2026-10). A created app, read from real ones: type "Web
 * Mapping Application", the template's typeKeywords without "createAppWithoutMap", data {source: <template item>,
 * folderId, values: {webmap, title, type: "webmap", datePublished, ...settings}} and
 * url <org>/apps/instant/<name>/index.html?appid=<id>. Settings left out take the template's defaults.
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { addItem, orgHome, orRemove, portalSelf, requireItemOfType, updateItem } from "../shared/items";
import { base } from "../shared/lookup";
import type { AppArgs } from "./types";

const FALLBACK_GROUP_QUERY = 'title:"Web Application Templates" AND owner:esri_en';

export type InstantTemplate = { id: string; name: string; title: string; summary: string | null; path: string; typeKeywords: string[] };

/** "/apps/instant/basic/index.html" or the sourceId keyword -> "basic". */
export function templateName(it: any): string {
	const path = /\/apps\/instant\/([^/]+)\//i.exec(String(it.url ?? ""));
	if (path) return path[1].toLowerCase();
	const kw = (it.typeKeywords ?? []).find((k: string) => k.startsWith("sourceId#instant_app_"));
	return kw ? kw.slice("sourceId#instant_app_".length).toLowerCase() : String(it.title).toLowerCase().replace(/\W+/g, "");
}

export async function instantTemplates(ctx: Ctx, self?: any): Promise<InstantTemplate[]> {
	const s = self ?? (await portalSelf(ctx));
	const groups = await ctx.request(`${base(ctx)}/community/groups`, { q: s.templatesGroupQuery || FALLBACK_GROUP_QUERY, num: 3 });
	const gid = groups.results?.[0]?.id;
	if (!gid) throw new ArcGISError("Your org has no app templates group.", "not_found");
	const res = await ctx.request(`${base(ctx)}/search`, {
		q: `group:${gid} AND type:"Web Mapping Application" AND typekeywords:"instantApp"`, num: 100, sortField: "title",
	});
	return (res.results ?? []).filter((it: any) => /\/apps\/instant\//i.test(String(it.url ?? ""))).map((it: any) => ({
		id: it.id, name: templateName(it), title: it.title, summary: it.snippet ?? null, path: it.url,
		typeKeywords: it.typeKeywords ?? [],
	}));
}

export async function createInstant(ctx: Ctx, args: AppArgs) {
	const map = await requireItemOfType(ctx, args.webmap_id, ["Web Map"], "webmap_id (the web map the app shows)");
	const self = await portalSelf(ctx);
	const templates = await instantTemplates(ctx, self);
	const wanted = String(args.template ?? "basic").toLowerCase().trim();
	const tpl = templates.find((t) => t.id === wanted || t.name === wanted || t.title.toLowerCase() === wanted);
	if (!tpl) {
		throw new ArcGISError(`No Instant Apps template '${args.template}'. Available: ${templates.map((t) => t.name).join(", ")}`,
			"not_found");
	}
	const title = args.title ?? `${map.title} (${tpl.title})`;
	const keywords = tpl.typeKeywords.filter((k) => k !== "createAppWithoutMap" && !k.startsWith("InstantAppGallery:"));
	const values = { ...(args.options ?? {}), webmap: map.id, title, type: "webmap", datePublished: Date.now() };
	const { id, folderId } = await addItem(ctx, args.folder, {
		type: "Web Mapping Application", title, tags: (args.tags ?? ["arcgis-web-mcp", "Instant Apps"]).join(","),
		snippet: args.summary ?? `${tpl.title} app of ${map.title}`, typeKeywords: keywords.join(","),
		extent: map.extent?.length === 2 ? map.extent.flat().join(",") : undefined,
	});
	return orRemove(ctx, [id], async () => {
		const url = `${orgHome(self, ctx.props.portal)}${tpl.path.startsWith("/") ? tpl.path : `/${tpl.path}`}?appid=${id}`;
		await updateItem(ctx, id, { url, text: JSON.stringify({ source: tpl.id, folderId, values }) });
		const item = await ctx.request(`${base(ctx)}/content/items/${id}`);
		return { app: itemCard(item, ctx.props.portal), open: url, template: { name: tpl.name, title: tpl.title, id: tpl.id },
			next: "Change its settings from the item page (Configure)." };
	});
}
