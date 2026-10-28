/**
 * Experience Builder apps from Esri's own templates, the way the ArcGIS API for Python 2.4.3 makes them
 * (apps/expbuilder): the template's config.json from Esri's CDN, a "Web Experience" item, the draft in the
 * resource config/config.json, and publishing = the same config as the item data + "status: Published" + the url.
 * A web map is bound like in published experiences: a WEB_MAP data source plus useDataSources on every map widget
 * (legends and layer lists already point at the map widget). The template keeps its own exbVersion so Experience
 * Builder upgrades it when it loads. theme_color sets the theme's primary colour (customTheme.colors.primary, as a
 * published experience on ArcGIS Online keeps it).
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { addItem, addResource, orgHome, orRemove, portalSelf, requireItemOfType, updateItem } from "../shared/items";
import { base } from "../shared/lookup";
import type { AppArgs } from "./types";

const CDN = "https://experiencedev.arcgis.com/cdn/2400/templates/app";

/** Every template on the CDN (checked 2026-10-28), with its map widgets and the widgets that need a layer bound. */
export const EXB_TEMPLATES: Record<string, { maps: number; needs_layer?: string[] }> = {
	blank_fullscreen: { maps: 0 }, blank_scrollable: { maps: 0 }, billboard: { maps: 1 }, pocket: { maps: 1 }, dart: { maps: 1 },
	mapflyer: { maps: 1 }, checkerboard: { maps: 1 }, summary: { maps: 1 }, frame: { maps: 1 }, voyage: { maps: 1 },
	dashboard: { maps: 1 }, elevate: { maps: 2 }, foldable: { maps: 1, needs_layer: ["table"] },
	launchpad: { maps: 1, needs_layer: ["table"] }, jewelrybox: { maps: 1, needs_layer: ["list"] },
	journey: { maps: 1, needs_layer: ["bookmark"] }, ribbon: { maps: 1, needs_layer: ["bookmark"] },
	quick_navigation: { maps: 1, needs_layer: ["bookmark"] }, parallax: { maps: 1, needs_layer: ["bookmark"] },
	scenic: { maps: 1, needs_layer: ["bookmark"] }, vacation: { maps: 4, needs_layer: ["bookmark"] },
	epic: { maps: 1, needs_layer: ["list"] }, kit: { maps: 1, needs_layer: ["bookmark", "table"] },
	monitor: { maps: 1, needs_layer: ["chart", "query", "table"] }, chronology: { maps: 1, needs_layer: ["chart", "filter", "list"] },
	data_collector: { maps: 1, needs_layer: ["chart", "edit", "list"] }, route: { maps: 1, needs_layer: ["bookmark", "chart", "filter", "list"] },
	booking: { maps: 1, needs_layer: ["chart", "filter", "list", "table"] }, multiverse: { maps: 1, needs_layer: ["bookmark", "feature-info", "table"] },
	panorama: { maps: 1, needs_layer: ["chart", "feature-info", "filter", "list"] }, comparatist: { maps: 1, needs_layer: ["chart", "feature-info"] },
	illustrator: { maps: 1, needs_layer: ["chart", "filter", "list"] }, pamphlet: { maps: 1, needs_layer: ["bookmark", "chart", "list"] },
	exhibition: { maps: 4, needs_layer: ["bookmark", "list"] }, reveal: { maps: 3, needs_layer: ["bookmark", "chart", "list", "table"] },
	sketchbook: { maps: 5, needs_layer: ["chart"] }, lens: { maps: 2, needs_layer: ["bookmark", "chart", "feature-info", "filter", "list"] },
	indicator: { maps: 5, needs_layer: ["bookmark", "chart", "filter", "list", "query", "table"] },
	general: { maps: 0 }, introduction: { maps: 0 }, gallery: { maps: 0 }, snapshot: { maps: 0 }, timeline: { maps: 0 },
	gear: { maps: 0 }, showroom: { maps: 0 }, collage: { maps: 0 }, avatarboard: { maps: 0 }, leaflet: { maps: 0 },
	events: { maps: 0 }, seeker: { maps: 0, needs_layer: ["list"] },
};

export function experienceTemplates() {
	return Object.entries(EXB_TEMPLATES).map(([name, t]) => ({ name, map_widgets: t.maps,
		ready_with_a_map: t.maps > 0 && !t.needs_layer, also_needs_a_layer_for: t.needs_layer ?? [] }));
}

/** Binds the web map to every map widget of a template config (in place); returns the data source id. */
export function bindWebMap(config: any, map: { id: string; title: string }, portalUrl: string): string {
	config.dataSources ??= {};
	let n = 1;
	while (config.dataSources[`dataSource_${n}`]) n++;
	const dsId = `dataSource_${n}`;
	config.dataSources[dsId] = { id: dsId, type: "WEB_MAP", sourceLabel: map.title, itemId: map.id, portalUrl };
	for (const w of Object.values<any>(config.widgets ?? {})) {
		if (!String(w.uri ?? "").endsWith("arcgis-map/")) continue;
		w.useDataSources = [{ dataSourceId: dsId, mainDataSourceId: dsId }];
		w.config = { ...(w.config ?? {}), initialMapDataSourceID: dsId };
	}
	return dsId;
}

export async function createExperience(ctx: Ctx, args: AppArgs) {
	const name = String(args.template ?? "billboard").toLowerCase().trim().replace(/[\s-]+/g, "_");
	const tpl = EXB_TEMPLATES[name];
	if (!tpl) throw new ArcGISError(`No Experience Builder template '${args.template}'. Available: ${Object.keys(EXB_TEMPLATES).join(", ")}`, "not_found");
	const map = args.webmap_id ? await requireItemOfType(ctx, args.webmap_id, ["Web Map"], "webmap_id") : null;
	if (!ctx.publicGet) throw new ArcGISError("No way to read Esri's templates here.", "unsupported");
	const config = await ctx.publicGet(`${CDN}/${name.replace(/_/g, "")}/config.json`);
	if (!config?.widgets && !config?.pages) throw new ArcGISError(`Template '${name}' could not be read from Esri's CDN.`, "arcgis_error");
	const self = await portalSelf(ctx);
	const home = orgHome(self, ctx.props.portal);
	config.attributes = { ...(config.attributes ?? {}), portalUrl: home };
	if (map) bindWebMap(config, map, home);
	if (args.theme_color !== undefined) {
		if (!/^#[0-9a-f]{6}$/i.test(args.theme_color)) throw new ArcGISError("theme_color must be #rrggbb.", "bad_argument");
		config.customTheme = { ...(config.customTheme ?? {}), colors: { ...(config.customTheme?.colors ?? {}), primary: args.theme_color.toLowerCase() } };
	}
	const title = args.title ?? (map ? `${map.title} experience` : "New experience");
	const publish = args.publish ?? true;
	const keywords = ["EXB Experience", "JavaScript", "Ready To Use", publish ? "status: Published" : "status: Draft", "Web Application",
		"Web Experience", "Web Page", "Web Site", `template:${name}`];
	const { id } = await addItem(ctx, args.folder, { type: "Web Experience", title, typeKeywords: keywords.join(","),
		tags: (args.tags ?? ["arcgis-web-mcp", "Experience Builder"]).join(","), snippet: args.summary ?? `Experience Builder app (${name})` });
	return orRemove(ctx, [id], async () => {
		const text = JSON.stringify(config);
		await addResource(ctx, id, "config/config.json", text);
		const online = !self.isPortal;
		const open = online ? `https://experience.arcgis.com/experience/${id}` : `${ctx.props.portal.replace(/\/+$/, "")}/apps/experiencebuilder/experience/?id=${id}`;
		const edit = online ? `https://experience.arcgis.com/builder/?id=${id}` : `${ctx.props.portal.replace(/\/+$/, "")}/apps/experiencebuilder/?id=${id}`;
		if (publish) await updateItem(ctx, id, { url: open, text });
		const item = await ctx.request(`${base(ctx)}/content/items/${id}`);
		return { app: itemCard(item, ctx.props.portal), open: publish ? open : null, edit, template: name, map_bound: Boolean(map),
			...(args.theme_color ? { theme_color: args.theme_color.toLowerCase() } : {}),
			...(tpl.needs_layer ? { note: `These widgets need a layer chosen in the builder: ${tpl.needs_layer.join(", ")}.` } : {}),
			...(!publish ? { note_draft: "Saved as a draft: open it in the builder and Publish." } : {}) };
	});
}
