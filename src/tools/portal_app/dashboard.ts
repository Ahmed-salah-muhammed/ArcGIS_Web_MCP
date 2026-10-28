/**
 * ArcGIS Dashboards from a hosted layer and/or a web map, written in the current schema (5.1.0 on ArcGIS Online,
 * 2026-10). Every widget below is shaped like the same widget in real 5.1.0 dashboards read from ArcGIS Online:
 * desktopView.widgets + a dockingLayout of nested stackLayoutElements whose leaves carry the widget ids. Data comes
 * from {type: "layerDataSource", itemId, layerId}: a Feature Service item + its numeric layer id, or a web map +
 * the operational layer's id (then selections follow the map). Pie colours need the real category values, so they
 * are read from the layer when the dashboard is made.
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { addItem, orgHome, orRemove, portalSelf } from "../shared/items";
import { base, requireId, resolveLayerUrl } from "../shared/lookup";
import type { AppArgs, WidgetSpec } from "./types";

const PALETTE = [[0, 122, 194], [53, 172, 70], [237, 81, 81], [252, 146, 31], [148, 103, 189], [23, 190, 207],
	[214, 39, 140], [140, 86, 75], [188, 189, 34], [127, 127, 127], [31, 119, 180], [255, 187, 120]];
const SYSTEM = /^(objectid|fid|globalid|shape__?(area|length)|shape|created_(user|date)|last_edited_(user|date)|creationdate|creator|editdate|editor)$/i;
const font = (weight = "normal", size?: number) => ({ family: "inherit", ...(size ? { size } : {}), style: "normal", weight });
const text = (angle = 0, weight = "normal", size?: number) => ({ type: "esriTS", angle, font: font(weight, size) });
const fill = (c: number[], outline = c, width = 1) => ({ type: "esriSFS", style: "esriSFSSolid", color: [...c, 255],
	outline: { type: "esriSLS", style: "esriSLSSolid", color: [...outline, 255], width } });
const NUMBER = { name: "value", prefix: true, style: "decimal", useGrouping: true, maximumFractionDigits: 1 };

export const WIDGET_HELP = {
	map: "The web map (needs webmap_id).",
	indicator: "One number: statistic (count | sum | avg | min | max) of field.",
	pie: "Share of each value of field (count, or statistic of value_field).",
	bar: "Bars per value of field (count, or statistic of value_field).",
	line: "Line per value of field (count, or statistic of value_field).",
	list: "Features listed by field, plus fields under it.",
	table: "A table of fields (default: the first five).",
	details: "The selected feature's details.",
	legend: "The map's legend.",
	text: "Rich text (text).",
};

type Source = { type: "layerDataSource"; itemId: string; layerId: string | number };
type Layer = { url: string; source: Source; info: any; mapId: string | null };

const uuid = () => crypto.randomUUID();
const widget = (type: string, name: string) => ({ id: uuid(), dashboardItemType: "widget", name, noDataState: {},
	noFilterState: {}, focusModeEnabled: false, type });
const dataset = (source: Source, extra: Record<string, unknown>) => ({ type: "serviceDataset", name: "main", dataSource: source,
	groupByFields: [], orderByFields: [], statisticDefinitions: [], maxFeatures: 1000, outFields: ["*"],
	returnDistinctValues: false, allowSourceDownload: false, allowSummaryDownload: false, ...extra });
const caption = (t: string) => `<p style="text-align:center;"><span style="font-size:16px;">${t.replace(/[<>&]/g, "")}</span></p>`;
const outName = (stat: string, field: string) => `${stat}_${field}`.toUpperCase();

export function fieldOf(info: any, name: string | undefined, what: string): string {
	const f = (info.fields ?? []).find((x: any) => x.name.toLowerCase() === String(name ?? "").toLowerCase());
	if (!f) {
		throw new ArcGISError(`${what}: no field '${name}'. Fields: ${(info.fields ?? []).map((x: any) => x.name).join(", ")}`,
			"bad_argument");
	}
	return f.name;
}

function oidField(info: any): string {
	return info.objectIdField ?? (info.fields ?? []).find((f: any) => f.type === "esriFieldTypeOID")?.name ?? "OBJECTID";
}

/** Map widget, as in real dashboards. */
export function mapWidget(webmapId: string, title: string) {
	return { ...widget("mapWidget", title), itemId: webmapId, linkedMapWidgetIds: [], flashRepeats: 3,
		mapTools: [{ type: "legendTool" }, { type: "searchTool" }, { type: "basemapGalleryTool" }], showMeasureTool: false,
		showNavigation: true, showPanRotate: false, showLocate: false, showCompass: false, showPopup: true, scalebarStyle: "line",
		editingEnabled: false, trackedFeatureRadius: 60, selectTool: { type: "selectTool", clickToSelect: false, advanceSketchTools: [] } };
}

export function indicatorWidget(l: Layer, spec: WidgetSpec) {
	const stat = spec.statistic ?? "count";
	const field = stat === "count" && !spec.field ? oidField(l.info) : fieldOf(l.info, spec.field, "indicator");
	const label = spec.title ?? (stat === "count" ? "Features" : `${stat} of ${field}`);
	return { ...widget("indicatorWidget", label),
		datasets: [dataset(l.source, { maxFeatures: undefined, outFields: [field],
			statisticDefinitions: [{ onStatisticField: field, statisticType: stat, outStatisticFieldName: outName(stat, field) }] })],
		defaultSettings: { topSection: { maxHeight: 0, textInfo: { weight: "normal" } },
			middleSection: { maxHeight: 30, textInfo: { text: "{calculated/value}", weight: "normal" } },
			bottomSection: { maxHeight: 30, textInfo: { text: label, weight: "normal" } } },
		verticalAlignment: "middle", comparison: "none", valueType: "statistic", noValueState: {}, showFeatureMenu: false,
		valueFormat: { ...NUMBER, prefix: false }, percentageFormat: { name: "percentage", prefix: false, style: "percent", useGrouping: true },
		ratioFormat: { name: "ratio", prefix: false, style: "decimal", useGrouping: true, maximumFractionDigits: 2 } };
}

function grouped(l: Layer, spec: WidgetSpec, kind: string) {
	const category = fieldOf(l.info, spec.field, `${kind} chart (field = the category)`);
	const stat = spec.statistic ?? (spec.value_field ? "sum" : "count");
	const value = stat === "count" ? (spec.value_field ? fieldOf(l.info, spec.value_field, kind) : category)
		: fieldOf(l.info, spec.value_field, `${kind} chart (value_field for ${stat})`);
	const y = outName(stat, value);
	return { category, stat, value, y, ds: dataset(l.source, { groupByFields: [category], orderByFields: [`${category} ASC`],
		outFields: [category], statisticDefinitions: [{ onStatisticField: value, statisticType: stat, outStatisticFieldName: y }] }) };
}

/** Up to 12 category values with labels (coded-value domain names when there is a domain), most frequent first. */
export async function categories(ctx: Ctx, l: Layer, field: string): Promise<{ value: unknown; label: string }[]> {
	const res = await ctx.request(`${l.url}/query`, { where: "1=1", returnGeometry: false, groupByFieldsForStatistics: field,
		outStatistics: [{ statisticType: "count", onStatisticField: oidField(l.info), outStatisticFieldName: "n" }],
		orderByFields: "n DESC" });
	const coded = (l.info.fields ?? []).find((f: any) => f.name === field)?.domain?.codedValues ?? [];
	return (res.features ?? []).slice(0, 12).map((f: any) => {
		const value = f.attributes?.[field] ?? f.attributes?.[field.toLowerCase()] ?? null;
		return { value, label: String(coded.find((c: any) => c.code === value)?.name ?? value ?? "null") };
	});
}

export function pieWidget(l: Layer, spec: WidgetSpec, values: { value: unknown; label: string }[]) {
	const g = grouped(l, spec, "pie");
	return { ...widget("pieChartWidget", spec.title ?? `${g.value === g.category ? "Count" : `${g.stat} of ${g.value}`} by ${g.category}`),
		topCaption: caption(spec.title ?? `By ${g.category}`), datasets: [g.ds], actionMode: "monoSelection",
		categoryType: "groupByValues", dataLabelsFormat: "percentage", valueFormat: { ...NUMBER, prefix: false, useGrouping: false },
		percentageFormat: { name: "percentage", prefix: false, style: "percent", useGrouping: false, minimumFractionDigits: 1,
			maximumFractionDigits: 1 },
		chartConfig: { version: "25.1.0", type: "chart", orderOptions: {}, colorMatch: true,
			chartRenderer: { type: "uniqueValue", field1: g.category, uniqueValueInfos: values.map((v, i) => ({ label: v.label,
				symbol: fill(PALETTE[i % PALETTE.length], [255, 255, 255], 0), value: v.value })) },
			series: [{ type: "pieSeries", id: "main", name: "main", x: g.category, y: g.y,
				dataLabels: { type: "chartText", visible: false, content: text(0, "normal", 13) }, dataTooltipVisible: true,
				dataTooltipReverseColor: true, optimizeDataLabelsOverlapping: true, alignDataLabels: true, innerRadius: 50, startAngle: 0,
				ticks: { type: "pieTick", lineSymbol: { type: "esriSLS", style: "esriSLSSolid", color: [214, 214, 214, 127.5] } },
				fillSymbol: fill([214, 214, 214], [255, 255, 255], 0), dataLabelsOffset: 10,
				sliceGrouping: { sliceId: "__other-slice__", percentageThreshold: 0, fillSymbol: fill([255, 255, 255], [255, 255, 255], 0),
					label: null } }],
			legend: { type: "chartLegend", visible: true, body: text(0, "normal", 13), position: "right", displayPercentage: true,
				displayNumericValue: false, labelMaxWidth: 100, valueLabelMaxWidth: 50 } } };
}

const axis = (category: boolean) => ({ type: "chartAxis", visible: true,
	title: { type: "chartText", visible: true, content: text(category ? 0 : 270, "bold") },
	valueFormat: category ? { type: "category", characterLimit: 11 }
		: { type: "number", intlOptions: { style: "decimal", notation: "standard", minimumFractionDigits: 0, maximumFractionDigits: 1 } },
	lineSymbol: { type: "esriSLS", style: "esriSLSSolid", width: 1 }, labels: { type: "chartText", visible: true, content: text() },
	grid: { type: "esriSLS", style: "esriSLSSolid", width: 1 }, guides: [],
	...(category ? { scrollbar: { visible: true, width: 15, gripSize: 22 } } : { buffer: true }) });

export function serialWidget(l: Layer, spec: WidgetSpec, line: boolean) {
	const g = grouped(l, spec, line ? "line" : "bar");
	const color = PALETTE[0];
	const series: Record<string, unknown> = { type: line ? "lineSeries" : "barSeries", id: g.y, name: "groupByValues", x: g.category, y: g.y,
		dataLabels: { type: "chartText", visible: false, content: text() }, dataTooltipVisible: true, dataTooltipReverseColor: true };
	if (line) {
		Object.assign(series, { lineSmoothed: false, lineSymbol: { type: "esriSLS", style: "esriSLSSolid", color: [...color, 255], width: 2 },
			markerVisible: true, markerSymbol: { type: "esriSMS", style: "esriSMSCircle", color: [...color, 255], size: 8,
				outline: { type: "esriSLS", style: "esriSLSSolid", color: [...color, 255] } }, showArea: false, connectLines: true });
	} else {
		series.fillSymbol = fill(color);
	}
	return { ...widget("serialChartWidget", spec.title ?? `${g.value === g.category ? "Count" : `${g.stat} of ${g.value}`} by ${g.category}`),
		topCaption: caption(spec.title ?? `By ${g.category}`), datasets: [g.ds], actionMode: "monoSelection", categoryType: "groupByValues",
		valueFormat: NUMBER, labelFormat: { ...NUMBER, name: "label" }, category: { labelOverrides: [], nullLabel: "null", blankLabel: "blank" },
		parseDates: false, minPeriod: "MM", categoryAxisLabelsBehavior: "wrap",
		chartConfig: { version: "25.1.0", type: "chart", orderOptions: {}, colorMatch: false, axes: [axis(true), axis(false)], series: [series],
			legend: { type: "chartLegend", visible: false, body: text(), position: "bottom" }, horizontalAxisLabelsBehavior: "wrap",
			verticalAxisLabelsBehavior: "hide", cursorCrosshair: { type: "cursorCrosshair", verticalLineVisible: false,
				horizontalLineVisible: false }, stackedType: "sideBySide" } };
}

function usefulFields(info: any, wanted?: string[]): string[] {
	if (wanted?.length) return wanted.map((f) => fieldOf(info, f, "fields"));
	return (info.fields ?? []).filter((f: any) => !SYSTEM.test(f.name) && f.type !== "esriFieldTypeGeometry").slice(0, 5).map((f: any) => f.name);
}

export function listWidget(l: Layer, spec: WidgetSpec) {
	const first = spec.field ? fieldOf(l.info, spec.field, "list") : (l.info.displayField || usefulFields(l.info)[0] || oidField(l.info));
	const more = (spec.fields ?? []).map((f) => fieldOf(l.info, f, "list"));
	return { ...widget("listWidget", spec.title ?? "List"), ...(spec.title ? { topCaption: caption(spec.title) } : {}),
		datasets: [dataset(l.source, { maxFeatures: 50, orderByFields: [`${first} ASC`], outFields: [first, ...more] })],
		selectionMode: "single", iconType: "symbol", showFilter: true,
		text: [`<p><strong>{field/${first}}</strong></p>`, ...more.map((f) => `<p>${f}: {field/${f}}</p>`)].join("") };
}

export function tableWidget(l: Layer, spec: WidgetSpec) {
	const fields = usefulFields(l.info, spec.fields);
	const alias = (n: string) => (l.info.fields ?? []).find((f: any) => f.name === n)?.alias ?? n;
	return { ...widget("tableWidget", spec.title ?? "Table"), datasets: [dataset(l.source, { outFields: fields })],
		dataSettings: { type: "features", valueFields: fields },
		tableSettings: { layout: "fit-columns", scale: "medium", hoverText: false, rowStriping: true, selectionMode: "single",
			verticalGrid: { thickness: 1 }, horizontalGrid: { thickness: 1 },
			headerSettings: { textColor: "#ffffff", backgroundColor: "#004da8", rule: { thickness: 3 } } },
		columnSettings: fields.map((f) => ({ title: alias(f), fieldName: f, textAlign: "left", isBold: false, isItalic: false,
			isUnderlined: false })) };
}

export function detailsWidget(l: Layer, mapWidgetId: string | null, spec: WidgetSpec) {
	return { ...widget("detailsWidget", spec.title ?? "Details"), title: spec.title ?? "Details",
		noFilterState: { text: "Select a feature to see its details" }, datasets: [dataset(l.source, { maxFeatures: 50, outFields: [] })],
		showTitle: true, showContents: true, showMedia: true, showAttachments: true, showFeatureMenu: true,
		...(mapWidgetId ? { mapWidgetId } : {}) };
}

export const legendWidget = (mapWidgetId: string) => ({ ...widget("legendWidget", "Legend"), mapWidgetId });
export const textWidget = (html: string) => ({ ...widget("richTextWidget", "Text"), datasets: [], text: html });

/** Columns of widget ids -> nested stack layout (columns side by side, widgets stacked in each). */
export function layoutFor(columns: { ids: string[]; width: number }[]) {
	const cols = columns.filter((c) => c.ids.length);
	const total = cols.reduce((s, c) => s + c.width, 0) || 1;
	return { type: "dockingLayout", rootElement: { width: 1, height: 1, id: uuid(), type: "stackLayoutElement", orientation: "col",
		elements: cols.map((c) => ({ width: c.width / total, height: 1, id: uuid(), type: "stackLayoutElement", orientation: "row",
			elements: c.ids.map((id) => ({ width: 1, height: 1 / c.ids.length, type: "itemLayoutElement", id })) })) } };
}

async function dataLayer(ctx: Ctx, args: AppArgs, map: any | null): Promise<Layer> {
	if (args.target) {
		const id = requireId(args.target);
		const url = await resolveLayerUrl(ctx, id, args.layer ?? 0);
		return { url, source: { type: "layerDataSource", itemId: id, layerId: Number(url.split("/").pop()) }, info: await ctx.request(url),
			mapId: null };
	}
	if (!map) throw new ArcGISError("A dashboard needs data: target (a feature layer item id) and/or webmap_id.", "bad_argument");
	const data = await ctx.request(`${base(ctx)}/content/items/${map.id}/data`);
	const ops = (data.operationalLayers ?? []).filter((o: any) => o.url && /\/(FeatureServer|MapServer)\/\d+$/i.test(o.url));
	const ref = String(args.layer ?? "").toLowerCase();
	const op = args.layer === undefined ? ops[0]
		: typeof args.layer === "number" || /^\d+$/.test(ref) ? ops[Number(args.layer)]
			: ops.find((o: any) => [o.title, o.id].map((v) => String(v).toLowerCase()).includes(ref));
	if (!op) throw new ArcGISError(`No feature layer '${args.layer ?? 0}' in the map: ${ops.map((o: any) => o.title).join(", ") || "none"}`, "not_found");
	return { url: op.url, source: { type: "layerDataSource", itemId: map.id, layerId: op.id }, info: await ctx.request(op.url), mapId: map.id };
}

/** Widgets chosen from the layer when none are asked for: a count, a chart by a category field, a table. */
export function autoWidgets(info: any, hasMap: boolean): WidgetSpec[] {
	const fields = (info.fields ?? []).filter((f: any) => !SYSTEM.test(f.name));
	const cat = fields.find((f: any) => f.type === "esriFieldTypeString" && f.domain?.codedValues)
		?? fields.find((f: any) => f.type === "esriFieldTypeString" && /type|status|categ|class|kind|zone|region/i.test(f.name))
		?? fields.find((f: any) => f.type === "esriFieldTypeString" && f.name !== info.displayField);
	const num = fields.find((f: any) => ["esriFieldTypeDouble", "esriFieldTypeInteger", "esriFieldTypeSingle"].includes(f.type));
	const out: WidgetSpec[] = [{ type: "indicator", statistic: "count", title: "Features" }];
	if (num) out.push({ type: "indicator", statistic: "sum", field: num.name });
	if (hasMap) out.push({ type: "map" }, { type: "legend" });
	if (cat) out.push({ type: "pie", field: cat.name });
	if (cat && num) out.push({ type: "bar", field: cat.name, value_field: num.name, statistic: "sum" });
	out.push({ type: "table" });
	return out;
}

export async function createDashboard(ctx: Ctx, args: AppArgs) {
	const map = args.webmap_id ? await ctx.request(`${base(ctx)}/content/items/${requireId(args.webmap_id)}`) : null;
	if (map && map.type !== "Web Map") throw new ArcGISError(`webmap_id must be a Web Map; ${map.id} is a ${map.type}.`, "bad_argument");
	const l = await dataLayer(ctx, args, map);
	const specs = args.widgets?.length ? args.widgets : autoWidgets(l.info, Boolean(map));
	const title = args.title ?? `${l.info.name ?? "Layer"} dashboard`;
	const left: string[] = []; const center: string[] = []; const right: string[] = [];
	const widgets: any[] = [];
	const mapSpec = specs.find((s) => s.type === "map");
	if (mapSpec && !map) throw new ArcGISError("A map widget needs webmap_id.", "bad_argument");
	const mapW = mapSpec && map ? mapWidget(map.id, mapSpec.title ?? map.title) : null;
	if (mapW) { widgets.push(mapW); center.push(mapW.id); }
	for (const s of specs) {
		let w: any;
		let column = right;
		if (s.type === "map") continue;
		else if (s.type === "indicator") { w = indicatorWidget(l, s); column = left; }
		else if (s.type === "pie") w = pieWidget(l, s, await categories(ctx, l, fieldOf(l.info, s.field, "pie chart (field = the category)")));
		else if (s.type === "bar" || s.type === "line") w = serialWidget(l, s, s.type === "line");
		else if (s.type === "list") { w = listWidget(l, s); column = left; }
		else if (s.type === "table") { w = tableWidget(l, s); column = center; }
		else if (s.type === "details") w = detailsWidget(l, mapW?.id ?? null, s);
		else if (s.type === "legend") { if (!mapW) throw new ArcGISError("A legend needs a map widget (webmap_id).", "bad_argument"); w = legendWidget(mapW.id); column = left; }
		else if (s.type === "text") { w = textWidget(String(s.text ?? s.title ?? "").replace(/<\s*script/gi, "")); column = left; }
		else throw new ArcGISError(`Unknown widget type '${(s as any).type}'.`, "bad_argument");
		widgets.push(w);
		column.push(w.id);
	}
	const data = { version: "5.1.0", authoringApp: "ArcGIS Dashboards", authoringAppVersion: "5.1.0", maxPaginationRecords: 50000,
		maxChartRecords: 10000, timeZone: "system", theme: { id: args.theme === "dark" ? "dark" : "light", type: "defined" },
		numberPrefixOverrides: [["yotta", "Y"], ["zeta", "Z"], ["exa", "E"], ["peta", "P"], ["tera", "T"], ["giga", "G"], ["mega", "M"],
			["kilo", "k"], ["base", ""], ["deci", "d", false], ["centi", "c", false], ["milli", "m", false], ["micro", "µ", false],
			["nano", "n", false]].map(([key, symbol, enabled = true]) => ({ key, symbol, enabled })),
		desktopView: { type: "desktop", widgets, settings: { allowElementResizing: false, allowReset: false },
			layout: layoutFor([{ ids: left, width: 0.22 }, { ids: center, width: 0.48 }, { ids: right, width: 0.3 }]),
			header: { dashboardItemType: "panel", type: "header", title, logoSize: "small", backgroundImageSizing: "fit-height",
				normalBackgroundImagePlacement: "left", horizontalBackgroundImagePlacement: "top", showSignOutMenu: false, selectors: [] } },
		elementMappings: {} };
	const self = await portalSelf(ctx);
	const { id } = await addItem(ctx, args.folder, { type: "Dashboard", title, text: JSON.stringify(data),
		typeKeywords: "ArcGIS Dashboards,Dashboard,Operations Dashboard", tags: (args.tags ?? ["arcgis-web-mcp", "Dashboard"]).join(","),
		snippet: args.summary ?? `Dashboard of ${l.info.name ?? "a layer"}` });
	return orRemove(ctx, [id], async () => {
		const item = await ctx.request(`${base(ctx)}/content/items/${id}`);
		return { app: itemCard(item, ctx.props.portal), open: `${orgHome(self, ctx.props.portal)}/apps/dashboards/${id}`,
			widgets: widgets.map((w) => ({ type: w.type, name: w.name })), data_from: l.mapId ? "the web map's layer" : "the feature layer" };
	});
}
