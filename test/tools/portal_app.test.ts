import { describe, expect, it } from "vitest";
import { autoWidgets, chartGuides, iconSvg, layoutFor, NAVY_THEME, widgetFilter } from "../../src/tools/portal_app/dashboard";
import { arcadeTest, filterSql } from "../../src/tools/portal_app/filters";
import { formFor, inputFor } from "../../src/tools/portal_app/fieldmaps";
import { app } from "../../src/tools/portal_app/handler";
import { templateName } from "../../src/tools/portal_app/instant";
import { mercator, placement } from "../../src/tools/portal_app/storymap";
import { fakeCtx, ID, ID2, silence, SVC, USER } from "../helpers";

const MAP = "c".repeat(32);
const NEW = "d".repeat(32);
const TPL = "e".repeat(32);
const SELF = { urlKey: "acme", customBaseUrl: "maps.arcgis.com", isPortal: false, templatesGroupQuery: 'title:"T" AND owner:esri_en' };
const mapItem = { id: MAP, title: "Parks", type: "Web Map", owner: "jdoe_gis", extent: [[30, 29], [32, 31]], typeKeywords: ["Web Map"] };
const json = (v: unknown) => JSON.parse(String(v));

/** The routes every create shares: the org, the web map, addItem, update, and reading the new item back. */
function common(extra: Record<string, (p: Record<string, unknown>) => unknown> = {}) {
	return {
		"/portals/self": () => SELF,
		[`/content/items/${MAP}`]: () => mapItem,
		[`${USER}/addItem`]: () => ({ id: NEW, success: true }),
		[`${USER}/items/${NEW}/update`]: () => ({ success: true }),
		[`${USER}/items/${NEW}/addResources`]: () => ({ success: true }),
		[`${USER}/items/${NEW}/delete`]: () => ({ success: true }),
		[`/content/items/${NEW}`]: () => ({ id: NEW, title: "New", type: "X", owner: "jdoe_gis" }),
		...extra,
	};
}
const sent = (calls: { url: string; params: Record<string, unknown> }[], suffix: string) => calls.filter((c) => c.url.endsWith(suffix));

describe("portal_app: Instant Apps", () => {
	const templates = () => ({ results: [
		{ id: TPL, title: "Sidebar", url: "/apps/instant/sidebar/index.html",
			typeKeywords: ["configurableApp", "createAppWithoutMap", "instantApp", "sourceId#instant_app_sidebar", "InstantAppGallery:Badge:Updated"] },
		{ id: ID2, title: "Classic viewer", url: "/apps/Viewer/index.html", typeKeywords: ["configurableApp"] },
	] });

	it("templates come from the org's gallery group; only Instant Apps are listed", async () => {
		const { ctx, calls } = fakeCtx(common({ "/community/groups": () => ({ results: [{ id: "g1" }] }), "/search": templates }));
		const out: any = await app(ctx, { action: "templates", kind: "instant" });
		expect(out.templates).toEqual([{ id: TPL, name: "sidebar", title: "Sidebar", summary: null, path: "/apps/instant/sidebar/index.html" }]);
		expect(sent(calls, "/community/groups")[0].params.q).toBe(SELF.templatesGroupQuery);
		expect(templateName({ title: "X", typeKeywords: ["sourceId#instant_app_basic"] })).toBe("basic");
	});

	it("create writes the app like a real one: template keywords, source + values, url under the org", async () => {
		silence();
		const { ctx, calls } = fakeCtx(common({ "/community/groups": () => ({ results: [{ id: "g1" }] }), "/search": templates }));
		const out: any = await app(ctx, { kind: "instant", webmap_id: MAP, template: "Sidebar", options: { legend: true } });
		const add = sent(calls, "/addItem")[0].params;
		expect(add).toMatchObject({ type: "Web Mapping Application", title: "Parks (Sidebar)", extent: "30,29,32,31" });
		expect(String(add.typeKeywords).split(",")).toEqual(["configurableApp", "instantApp", "sourceId#instant_app_sidebar"]);
		const upd = sent(calls, `/items/${NEW}/update`)[0].params;
		expect(upd.url).toBe(`https://acme.maps.arcgis.com/apps/instant/sidebar/index.html?appid=${NEW}`);
		expect(json(upd.text)).toMatchObject({ source: TPL, folderId: null,
			values: { webmap: MAP, title: "Parks (Sidebar)", type: "webmap", legend: true } });
		expect(out).toMatchObject({ kind: "instant", open: upd.url, template: { name: "sidebar" } });
	});

	it("an unknown template or a non-map item fails before anything is created", async () => {
		const { ctx, calls } = fakeCtx(common({ "/community/groups": () => ({ results: [{ id: "g1" }] }), "/search": templates,
			[`/content/items/${ID}`]: () => ({ id: ID, type: "Feature Service" }) }));
		await expect(app(ctx, { kind: "instant", webmap_id: MAP, template: "nope" })).rejects.toThrow(/Available: sidebar/);
		await expect(app(ctx, { kind: "instant", webmap_id: ID })).rejects.toThrow(/must be a Web Map/);
		expect(sent(calls, "/addItem")).toHaveLength(0);
	});
});

describe("portal_app: Dashboards", () => {
	const layer = { name: "inspections", objectIdField: "OBJECTID", displayField: "NAME", fields: [
		{ name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "NAME", type: "esriFieldTypeString" },
		{ name: "STATUS", type: "esriFieldTypeString", domain: { codedValues: [{ code: "O", name: "Open" }, { code: "C", name: "Closed" }] } },
		{ name: "COST", type: "esriFieldTypeDouble" }] };
	const routes = () => common({
		[`/content/items/${ID}`]: () => ({ id: ID, type: "Feature Service", url: SVC }),
		[SVC]: () => ({ layers: [{ id: 0, name: "inspections" }] }),
		[`${SVC}/0`]: () => layer,
		[`${SVC}/0/query`]: () => ({ features: [{ attributes: { STATUS: "O", n: 5 } }, { attributes: { STATUS: "C", n: 2 } }] }),
	});

	it("chooses widgets from the layer: counts, a pie and a bar by the coded field, a table", () => {
		expect(autoWidgets(layer, false).map((w) => `${w.type}:${w.field ?? ""}`)).toEqual(
			["indicator:", "indicator:COST", "pie:STATUS", "bar:STATUS", "table:"]);
		expect(autoWidgets(layer, true).map((w) => w.type)).toContain("map");
	});

	it("builds a 5.1.0 dashboard on the feature layer; pie colours from the layer's real values", async () => {
		silence();
		const { ctx, calls } = fakeCtx(routes());
		const out: any = await app(ctx, { kind: "dashboard", target: ID });
		const add = sent(calls, "/addItem")[0].params;
		expect(add).toMatchObject({ type: "Dashboard", typeKeywords: "ArcGIS Dashboards,Dashboard,Operations Dashboard" });
		const data = json(add.text);
		expect(data.version).toBe("5.1.0");
		const widgets = data.desktopView.widgets;
		expect(widgets.map((w: any) => w.type)).toEqual(["indicatorWidget", "indicatorWidget", "pieChartWidget", "serialChartWidget", "tableWidget"]);
		expect(widgets[0].datasets[0].dataSource).toEqual({ type: "layerDataSource", itemId: ID, layerId: 0 });
		expect(widgets[1].datasets[0].statisticDefinitions).toEqual([{ onStatisticField: "COST", statisticType: "sum", outStatisticFieldName: "SUM_COST" }]);
		const pie = widgets[2];
		expect(pie.chartConfig.chartRenderer.uniqueValueInfos.map((u: any) => [u.value, u.label])).toEqual([["O", "Open"], ["C", "Closed"]]);
		expect(pie.chartConfig.series[0]).toMatchObject({ type: "pieSeries", x: "STATUS", y: "COUNT_STATUS" });
		expect(widgets[3].chartConfig.series[0]).toMatchObject({ type: "barSeries", x: "STATUS", y: "SUM_COST" });
		const leaves = JSON.stringify(data.desktopView.layout).match(/"itemLayoutElement","id":"[^"]+"/g)!.map((s) => s.split('"').at(-2));
		expect(new Set(leaves)).toEqual(new Set(widgets.map((w: any) => w.id)));
		expect(out.open).toBe(`https://acme.maps.arcgis.com/apps/dashboards/${NEW}`);
	});

	it("with a web map, data comes through the map's layer and a map + legend are added", async () => {
		silence();
		const { ctx, calls } = fakeCtx({ ...routes(), [`/content/items/${MAP}/data`]: () => ({ operationalLayers: [
			{ id: "op-1", title: "Inspections", url: `${SVC}/0` }] }) });
		await app(ctx, { kind: "dashboard", webmap_id: MAP, widgets: [{ type: "map" }, { type: "legend" }, { type: "list", field: "name" }] });
		const widgets = json(sent(calls, "/addItem")[0].params.text).desktopView.widgets;
		expect(widgets.map((w: any) => w.type)).toEqual(["mapWidget", "legendWidget", "listWidget"]);
		expect(widgets[0].itemId).toBe(MAP);
		expect(widgets[1].mapWidgetId).toBe(widgets[0].id);
		expect(widgets[2].datasets[0].dataSource).toEqual({ type: "layerDataSource", itemId: MAP, layerId: "op-1" });
		expect(widgets[2].text).toContain("{field/NAME}");
	});

	it("unknown fields and a map without webmap_id fail before anything is created", async () => {
		const { ctx, calls } = fakeCtx(routes());
		await expect(app(ctx, { kind: "dashboard", target: ID, widgets: [{ type: "pie", field: "NOPE" }] })).rejects.toThrow(/no field 'NOPE'/);
		await expect(app(ctx, { kind: "dashboard", target: ID, widgets: [{ type: "map" }] })).rejects.toThrow(/needs webmap_id/);
		expect(sent(calls, "/addItem")).toHaveLength(0);
		const layout = layoutFor([{ ids: ["a", "b"], width: 1 }, { ids: [], width: 1 }]);
		expect(layout.rootElement.elements).toHaveLength(1);
	});
});

describe("portal_app: interactive dashboards", () => {
	const layer = { name: "users", objectIdField: "OBJECTID", displayField: "NAME", fields: [
		{ name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "NAME", type: "esriFieldTypeString" },
		{ name: "Role", type: "esriFieldTypeString" },
		{ name: "STATUS", type: "esriFieldTypeString", domain: { codedValues: [{ code: "O", name: "Open" }, { code: "C", name: "Closed" }] } },
		{ name: "COST", type: "esriFieldTypeDouble" }, { name: "JoinDate", type: "esriFieldTypeDate" }] };
	const routes = () => ({ ...common({
		[`/content/items/${ID}`]: () => ({ id: ID, type: "Feature Service", url: SVC }),
		[SVC]: () => ({ layers: [{ id: 0, name: "users" }] }),
		[`${SVC}/0`]: () => layer,
		[`${SVC}/0/query`]: () => ({ features: [{ attributes: { Role: "owner", n: 5 } }, { attributes: { Role: "user", n: 9 } }] }),
	}), [`/content/items/${MAP}/data`]: () => ({ operationalLayers: [{ id: "op-users", title: "Users", url: `${SVC}/0/` }] }) });
	const build = async (args: Record<string, unknown>) => {
		silence();
		const { ctx, calls } = fakeCtx(routes());
		const out: any = await app(ctx, { kind: "dashboard", ...args } as any);
		const data = json(sent(calls, "/addItem")[0].params.text);
		const byName = (name: string) => data.desktopView.widgets.find((w: any) => w.name === name);
		return { out, data, byName, widgets: data.desktopView.widgets as any[] };
	};

	it("selections filter the other widgets and the map, zoom to it; the map filters back", async () => {
		const { out, widgets, byName } = await build({ target: ID, webmap_id: MAP, widgets: [{ type: "map" },
			{ type: "indicator", title: "All" }, { type: "pie", field: "Role", title: "By role" }, { type: "table" }] });
		const [map, indicator, pie, table] = widgets;
		expect(byName("By role")).toBe(pie);
		const [filter, zoom] = pie.events[0].actions;
		expect(pie.events[0].type).toBe("selectionChanged");
		expect(filter.targets).toEqual([
			{ targetId: `${indicator.id}#main`, by: "whereClause", requiresSelection: false },
			{ targetId: `${table.id}#main`, by: "whereClause", requiresSelection: false },
			{ targetId: `${map.id}#op-users`, by: "whereClause", requiresSelection: false }]);
		expect(zoom).toEqual({ type: "zoom", targets: [{ targetId: map.id, by: "geometry", requiresSelection: false }] });
		expect(table.events[0].actions[0].targets.map((t: any) => t.targetId)).toContain(`${pie.id}#main`);
		expect(indicator.events).toBeUndefined();
		expect(map.events[0]).toMatchObject({ type: "extentChanged", actions: [{ type: "filter",
			targets: [indicator, pie, table].map((w) => ({ targetId: `${w.id}#main`, by: "geometry", requiresSelection: false })) }] });
		expect(map.layers[0]).toMatchObject({ dataSource: { type: "layerDataSource", itemId: MAP, layerId: "op-users" },
			events: [{ type: "selectionChanged" }] });
		expect(map.selectTool.clickToSelect).toBe(true);
		expect(out.interactive).toMatchObject({ selecting_filters_others: ["By role", "Table"], map_extent_filters: true,
			map_selection_filters: true });
	});

	it("interactive=false and extent_filter=false turn the wiring off", async () => {
		const off = await build({ target: ID, webmap_id: MAP, interactive: false, widgets: [{ type: "map" }, { type: "pie", field: "Role" }] });
		expect(JSON.stringify(off.widgets)).not.toContain('"events"');
		expect(off.out.interactive).toBe(false);
		const still = await build({ target: ID, webmap_id: MAP, extent_filter: false, widgets: [{ type: "map" }, { type: "pie", field: "Role" }] });
		expect(still.widgets[0].events).toBeUndefined();
		expect(still.widgets[1].events).toBeDefined();
	});

	it("widget filters: equal / is_in, coded values by their description; numbers and dates by operator", () => {
		expect(widgetFilter(layer, { Role: "owner" })).toEqual({ type: "filterGroup", condition: "OR", rules: [{ type: "filterGroup",
			condition: "AND", rules: [{ type: "filterRule", field: { name: "Role", type: "string" }, operator: "equal",
				constraint: { type: "value", value: "owner" } }] }] });
		expect(widgetFilter(layer, { status: ["Open", "C"] })!.rules[0].rules[0]).toMatchObject({ field: { name: "STATUS" },
			operator: "is_in", constraint: { type: "values", values: ["O", "C"] } });
		expect(widgetFilter(layer, undefined)).toBeUndefined();
		const rules = (f: any) => widgetFilter(layer, f)!.rules[0].rules;
		expect(rules({ COST: { op: ">=", value: "5" }, Role: { op: "!=", value: "guest" } })).toEqual([
			{ type: "filterRule", field: { name: "COST", type: "double" }, operator: "greater_or_equal", constraint: { type: "value", value: 5 } },
			{ type: "filterRule", field: { name: "Role", type: "string" }, operator: "is_not_in", constraint: { type: "values", values: ["guest"] } }]);
		expect(rules({ JoinDate: { op: "last", value: 7, unit: "day" } })[0]).toEqual({ type: "filterRule", field: { name: "JoinDate", type: "date" },
			operator: "is_within_last", constraint: { type: "relativeDate", unit: "day", value: 7 } });
		expect(rules({ JoinDate: { op: "this_year" }, NAME: { op: "not_null" } })).toMatchObject([
			{ operator: "is_on", constraint: { type: "period", value: "thisYear" } }, { operator: "is_not_null", constraint: { type: "nil" } }]);
		expect(() => widgetFilter(layer, { Role: { op: ">", value: 1 } })).toThrow(/needs a number field/);
		expect(() => widgetFilter(layer, { COST: { op: "last", value: 1, unit: "day" } })).toThrow(/needs a date field/);
		expect(() => widgetFilter(layer, { JoinDate: "2024-01-01" })).toThrow(/Date fields filter with/);
		expect(() => widgetFilter(layer, { COST: "cheap" })).toThrow(/not a number/);
		expect(() => widgetFilter(layer, { JoinDate: { op: "last", value: 3, unit: "week" as any } })).toThrow(/unit/);
		expect(filterSql(layer, { STATUS: "Open", COST: { op: "<=", value: 9 }, Role: ["a'b", "c"] }))
			.toBe("STATUS = 'O' AND COST <= 9 AND Role IN ('a''b', 'c')");
		expect(() => filterSql(layer, { JoinDate: { op: "this_year" } })).toThrow(/grouped list cannot filter/);
		expect(arcadeTest(layer, "COST", { op: ">", value: 10 })).toBe('$datapoint["COST"] > 10');
		expect(arcadeTest(layer, "STATUS", ["Open", "Closed"])).toBe('Includes(["O","C"], $datapoint["STATUS"])');
		expect(arcadeTest(layer, "JoinDate", { op: "last", value: 2, unit: "month" }))
			.toBe(`!IsEmpty($datapoint["JoinDate"]) && DateDiff(Now(), $datapoint["JoinDate"], 'months') <= 2`);
	});

	it("tabs, columns, colours, date bins, an embedded page and the header", async () => {
		const { data, byName } = await build({ target: ID, subtitle: "Live", logo_url: "https://x.example/logo.png", widgets: [
			{ type: "indicator", title: "Owners", filter: { Role: "owner" }, tab: "Owners", color: "#FACC15" },
			{ type: "indicator", title: "Users", filter: { Role: "user" }, tab: "Users" },
			{ type: "line", field: "JoinDate", period: "day", title: "Trend", color: "#00bfff" },
			{ type: "embed", url: "https://experience.arcgis.com/experience/abc", title: "App", tab: "App" },
			{ type: "pie", field: "Role", column: "left", title: "Pie" }] });
		const owners = byName("Owners");
		expect(owners.datasets[0].filter.rules[0].rules[0].constraint).toEqual({ type: "value", value: "owner" });
		expect(owners.defaultSettings.middleSection.textInfo.fillColor).toBe("#facc15");
		const trend = byName("Trend");
		expect(trend).toMatchObject({ parseDates: true, minPeriod: "DD" });
		expect(trend.chartConfig.series[0]).toMatchObject({ binTemporalData: true, temporalBinning: { size: 1, unit: "days" },
			lineSymbol: { color: [0, 191, 255, 255] } });
		expect(trend.chartConfig.axes[0].valueFormat.type).toBe("date");
		expect(byName("App")).toMatchObject({ type: "embeddedContentWidget", url: "https://experience.arcgis.com/experience/abc" });
		const [left, center, right] = data.desktopView.layout.rootElement.elements;
		expect(left.elements[0]).toMatchObject({ type: "tabsLayoutElement", elements: [
			{ tabName: "Owners", type: "itemLayoutElement", id: owners.id }, { tabName: "Users", id: byName("Users").id }] });
		expect(left.elements[1]).toMatchObject({ type: "itemLayoutElement", id: byName("Pie").id });
		expect(center.elements[0]).toMatchObject({ type: "tabsLayoutElement", elements: [{ tabName: "App" }] });
		expect(right.elements[0].id).toBe(trend.id);
		expect(data.desktopView.header).toMatchObject({ subtitle: "Live", logoImageURL: "https://x.example/logo.png" });
	});

	it("checks period, colours, embed and logo links before anything is created", async () => {
		const { ctx, calls } = fakeCtx(routes());
		await expect(app(ctx, { kind: "dashboard", target: ID, widgets: [{ type: "bar", field: "Role", period: "day" }] }))
			.rejects.toThrow(/period needs a date field/);
		await expect(app(ctx, { kind: "dashboard", target: ID, widgets: [{ type: "indicator", color: "red" }] })).rejects.toThrow(/#rrggbb/);
		await expect(app(ctx, { kind: "dashboard", target: ID, widgets: [{ type: "embed", url: "http://x.example" }] })).rejects.toThrow(/https/);
		await expect(app(ctx, { kind: "dashboard", target: ID, logo_url: "javascript:1" })).rejects.toThrow(/logo_url/);
		expect(sent(calls, "/addItem")).toHaveLength(0);
		expect(autoWidgets(layer, false).map((w) => `${w.type}:${w.field ?? ""}`)).toContain("line:JoinDate");
	});
});

describe("portal_app: professional dashboards", () => {
	const layer = { name: "users", objectIdField: "OBJECTID", displayField: "NAME", fields: [
		{ name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "NAME", type: "esriFieldTypeString" },
		{ name: "Role", type: "esriFieldTypeString", alias: "User role" }, { name: "Team", type: "esriFieldTypeString" },
		{ name: "Units", type: "esriFieldTypeInteger" }, { name: "JoinDate", type: "esriFieldTypeDate" }] };
	const query = (p: Record<string, unknown>) => {
		if (p.groupByFieldsForStatistics === "Team") return { features: [{ attributes: { Team: "A", n: 4 } }, { attributes: { Team: "B", n: 2 } }] };
		if (p.groupByFieldsForStatistics) return { features: [{ attributes: { Role: "owner", n: 5 } }] };
		return { features: [{ attributes: { GAUGE_0: 42, MIN_2: 2, MAX_2: 80 } }] };
	};
	const routes = () => ({ ...common({
		[`/content/items/${ID}`]: () => ({ id: ID, type: "Feature Service", url: SVC }),
		[SVC]: () => ({ layers: [{ id: 0, name: "users" }] }),
		[`${SVC}/0`]: () => layer,
		[`${SVC}/0/query`]: query,
	}), [`/content/items/${MAP}/data`]: () => ({ operationalLayers: [{ id: "op-users", title: "Users", url: `${SVC}/0` }] }) });
	const build = async (args: Record<string, unknown>) => {
		silence();
		const { ctx, calls } = fakeCtx(routes());
		const out: any = await app(ctx, { kind: "dashboard", ...args } as any);
		const data = json(sent(calls, "/addItem")[0].params.text);
		const byName = (name: string) => data.desktopView.widgets.find((w: any) => w.name === name);
		return { out, data, calls, byName };
	};

	it("selectors filter every widget and the map: category by its field, date and number through filterField", async () => {
		const { out, data, byName, calls } = await build({ target: ID, webmap_id: MAP, sidebar_title: "Filters <b>",
			widgets: [{ type: "map" }, { type: "indicator", title: "Users", compare_to: {} }, { type: "table", title: "T" }],
			selectors: [{ type: "category", field: "role", multiple: true }, { type: "date", field: "JoinDate", title: "Joined" },
				{ type: "number", field: "Units", step: 0.5 }] });
		const [map, users, table] = data.desktopView.widgets;
		expect(data.desktopView.header.selectors).toEqual([]);
		const sidebar = data.desktopView.sidebar;
		expect(sidebar).toMatchObject({ type: "sidebar", title: '<p><strong><span style="font-size:16px;">Filters &lt;b&gt;</span></strong></p>' });
		const [role, joined, units] = sidebar.selectors;
		expect(role).toMatchObject({ dashboardItemType: "selector", type: "categorySelectorWidget", label: "User role",
			category: { type: "groupByValues" }, selection: { operator: "is_in", type: "multiple", allowNone: true, noneLabel: "All" },
			displayType: "list", presentationMode: "dropdown" });
		expect(role.datasets[0]).toMatchObject({ groupByFields: ["Role"], statisticDefinitions: [{ onStatisticField: "Role", statisticType: "count" }] });
		expect(role.events[0].actions[0].targets).toEqual([
			{ targetId: `${users.id}#main`, by: "whereClause", requiresSelection: false },
			{ targetId: `${users.id}#reference`, by: "whereClause", requiresSelection: false },
			{ targetId: `${table.id}#main`, by: "whereClause", requiresSelection: false },
			{ targetId: `${map.id}#op-users`, by: "whereClause", requiresSelection: false, fieldMap: [{ sourceName: "Role", targetName: "Role" }] }]);
		const viaFilterField = [{ sourceName: "filterField", targetName: "JoinDate" }];
		expect(joined.events[0].actions[0].targets).toContainEqual({ targetId: `${table.id}#main`, by: "whereClause", requiresSelection: false,
			fieldMap: viaFilterField });
		expect(joined.events[0].actions[0].targets).toContainEqual({ targetId: `${map.id}#op-users`, by: "whereClause", requiresSelection: false,
			fieldMap: viaFilterField });
		const names = joined.definedOptions.namedFilters.map((f: any) => f.displayName);
		expect(names).toEqual(["24 hours", "7 days", "30 days", "12 months", "All"]);
		expect(joined).toMatchObject({ optionType: "definedOptions", definedOptions: { defaultSelection: "last", allowNone: false } });
		expect(joined.definedOptions.namedFilters[1].filter.rules[0].rules[0]).toEqual({ type: "filterRule",
			field: { name: "filterField", type: "esriFieldTypeDate" }, operator: "is_within_last", constraint: { type: "relativeDate", unit: "day", value: 7 } });
		expect(joined.definedOptions.namedFilters[4].filter.rules[0].rules[0]).toMatchObject({ operator: "is_not_null", constraint: { type: "nil" } });
		// the range comes from the layer: one statistics query for every default that needs it
		expect(units).toMatchObject({ type: "numericSelectorWidget", operator: "greater_or_equal", firstDefault: 2, increment: 0.5, precision: 1,
			constraint: { type: "fixed", lowerLimit: 2, upperLimit: 80 } });
		const stats = sent(calls, "/0/query").filter((c) => !c.params.groupByFieldsForStatistics);
		expect(stats).toHaveLength(1);
		expect(stats[0].params.outStatistics).toEqual([{ statisticType: "min", onStatisticField: "Units", outStatisticFieldName: "MIN_2" },
			{ statisticType: "max", onStatisticField: "Units", outStatisticFieldName: "MAX_2" }]);
		expect(out.selectors).toMatchObject({ at: "sidebar", wired: [{ selector: "User role", field: "Role" }, { field: "JoinDate" }, { field: "Units" }] });
		expect(byName("T")).toBe(table);
	});

	it("up to two selectors go in the header; a calendar date and button categories; grouped lists only by their field", async () => {
		const { data, out } = await build({ target: ID, widgets: [{ type: "list", group_by: "Role", title: "Per role" }, { type: "indicator" }],
			selectors: [{ type: "category", field: "Role", display: "buttons" }, { type: "date", field: "JoinDate", display: "calendar" }] });
		const [list] = data.desktopView.widgets;
		const [role, date] = data.desktopView.header.selectors;
		expect(data.desktopView.sidebar).toBeUndefined();
		expect(role).toMatchObject({ displayType: "button_bar", presentationMode: "inline", selection: { operator: "equal", type: "single" } });
		expect(role.events[0].actions[0].targets).toContainEqual({ targetId: `${list.id}#main`, by: "whereClause", requiresSelection: false,
			fieldMap: [{ sourceName: "Role", targetName: "Role" }] });
		expect(date).toMatchObject({ optionType: "datePicker", datePickerOption: { displayType: "calendar", operator: "is_on" } });
		expect(JSON.stringify(date.events)).not.toContain(list.id);
		expect(out.selectors.wired[1]).toMatchObject({ field: "JoinDate", does_not_filter: ["Per role"] });
	});

	it("indicator vs a reference, gauge, split and stacked bars with target lines, highlights, sorting, image, menu", async () => {
		const { data, byName } = await build({ target: ID, logo_url: "https://x.example/l.png", logo_link: "https://x.example",
			menu_links: [{ label: "About", url: "https://x.example/about" }],
			widgets: [{ type: "gauge", title: "Done", filter: { Role: "owner" } },
				{ type: "indicator", title: "This year", filter: { JoinDate: { op: "this_year" } }, compare_to: { JoinDate: { op: "last_year" } },
					higher_is_better: false },
				{ type: "bar", field: "Role", split_by: "Team", stacked: "stacked", labels: true, title: "Stack",
					lines: [{ value: 10, label: "Target" }, { value: 0, to: 5, color: "#36a852" }] },
				{ type: "table", title: "Tab", fields: ["NAME"], sort_by: "JoinDate desc",
					highlight: [{ field: "Units", when: { op: ">=", value: 50 }, background: "#ffdddd" }, { field: "Units", when: { op: "<=", value: 5 }, color: "#008800" }] },
				{ type: "list", title: "Lst", highlight: [{ field: "Role", when: "owner", color: "#ff0000" }] },
				{ type: "embed", url: "https://x.example/photo.JPG?v=2", title: "Pic" }] });
		const gauge = byName("Done");
		expect(gauge.datasets.slice(0, 2)).toEqual([{ type: "staticDataset", name: "min", data: 0 }, { type: "staticDataset", name: "max", data: 42 }]);
		expect(gauge).toMatchObject({ type: "gaugeWidget", style: "progress", chartConfig: { subType: "statisticGauge",
			series: [{ type: "gaugeSeries", x: "COUNT_OBJECTID" }] } });
		expect(gauge.datasets[2].filter.rules[0].rules[0].constraint).toEqual({ type: "value", value: "owner" });
		const year = byName("This year");
		expect(year.comparison).toBe("statistic");
		expect(year.datasets.map((d: any) => d.name)).toEqual(["main", "reference"]);
		expect(year.datasets[1].filter.rules[0].rules[0].constraint).toEqual({ type: "period", value: "lastYear" });
		// lower is better: at or above the reference is red, below it green
		expect(year.defaultSettings.bottomSection.textInfo).toMatchObject({ text: "vs {calculated/reference} ({calculated/percentChange})", fillColor: "#d83020" });
		expect(year.belowReferenceSettings.bottomSection.textInfo.fillColor).toBe("#36a852");
		const stack = byName("Stack");
		expect(stack.datasets[0].groupByFields).toEqual(["Role", "Team"]);
		expect(stack.splitBy).toMatchObject({ fieldName: "Team", missingSeriesTemplate: { id: "__split-by-template__", x: "Role" } });
		expect(stack.chartConfig.series.map((x: any) => [x.id, x.name, x.y])).toEqual([["A", "A", "A"], ["B", "B", "B"]]);
		expect(stack.chartConfig).toMatchObject({ stackedType: "stacked", legend: { visible: true } });
		expect(stack.chartConfig.series[0].dataLabels.visible).toBe(true);
		expect(stack.chartConfig.axes[1].guides).toMatchObject([{ type: "chartGuide", start: 10, style: { type: "esriSLS" }, label: { text: "Target" } },
			{ start: 0, end: 5, style: { type: "esriSFS", color: [54, 168, 82, 76.5] } }]);
		const table = byName("Tab");
		expect(table.datasets[0]).toMatchObject({ orderByFields: ["JoinDate DESC"], outFields: ["NAME", "Units"] });
		expect(table.arcadeEnabled).toBe(true);
		expect(table.expression).toContain(`backgroundColor: IIf($datapoint["Units"] >= 50, '#ffdddd', '')`);
		expect(table.expression).toContain(`textColor: IIf($datapoint["Units"] <= 5, '#008800', '')`);
		const list = byName("Lst");
		expect(list.expression).toContain(`if ($datapoint["Role"] == "owner") {\n  textColor = '#ff0000';`);
		expect(list.datasets[0].outFields).toEqual(["NAME", "Role"]);
		expect(byName("Pic").contentType).toBe("image");
		expect(data.desktopView.header).toMatchObject({ logoURL: "https://x.example", menuContents: [{ key: "About", link: "https://x.example/about" }] });
	});

	it("refuses what a dashboard cannot show before anything is created", async () => {
		const { ctx, calls } = fakeCtx(routes());
		const make = (args: Record<string, unknown>) => app(ctx, { kind: "dashboard", target: ID, ...args } as any);
		await expect(make({ widgets: [{ type: "bar", field: "Role", stacked: "stacked" }] })).rejects.toThrow(/stacked needs split_by/);
		await expect(make({ widgets: [{ type: "bar", field: "Role", split_by: "role" }] })).rejects.toThrow(/split_by must differ/);
		await expect(make({ widgets: [{ type: "gauge", min: 50, max: 10 }] })).rejects.toThrow(/max \(10\) must be above min/);
		await expect(make({ widgets: [{ type: "table", highlight: [{ field: "Units", when: 1 }] }] })).rejects.toThrow(/color and\/or background/);
		await expect(make({ widgets: [{ type: "table", sort_by: "Units sideways" }] })).rejects.toThrow(/sort_by/);
		await expect(make({ selectors: [{ type: "date", field: "Role" }] })).rejects.toThrow(/date selector cannot filter 'Role'/);
		await expect(make({ selectors: [{ type: "number", field: "JoinDate" }] })).rejects.toThrow(/number selector cannot/);
		await expect(make({ selectors: [{ type: "category", field: "Role", display: "calendar" }] })).rejects.toThrow(/calendar is for date/);
		await expect(make({ menu_links: [{ label: "x", url: "http://x.example" }] })).rejects.toThrow(/menu_links\[0\]\.url must be an https/);
		expect(sent(calls, "/addItem")).toHaveLength(0);
		expect(() => chartGuides([{ value: 5, to: 2 }])).toThrow(/"to" a number above it/);
	});
});

describe("portal_app: executive dashboards", () => {
	const HEAT = "9".repeat(32);
	const layer = { name: "users", objectIdField: "OBJECTID", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" },
		{ name: "Gov", type: "esriFieldTypeString" }, { name: "Role", type: "esriFieldTypeString" },
		{ name: "Units", type: "esriFieldTypeInteger" }, { name: "JoinDate", type: "esriFieldTypeDate" }] };
	const routes = () => ({ ...common({
		[`/content/items/${ID}`]: () => ({ id: ID, type: "Feature Service", url: SVC }),
		[`/content/items/${HEAT}`]: () => ({ id: HEAT, type: "Web Map", title: "Heat" }),
		[`/content/items/${ID2}`]: () => ({ id: ID2, type: "CSV", title: "Not a map" }),
		[SVC]: () => ({ layers: [{ id: 0, name: "users" }] }),
		[`${SVC}/0`]: () => layer,
		[`${SVC}/0/query`]: (p) => ({ features: [{ attributes: { [String(p.groupByFieldsForStatistics)]: "Cairo", n: 9 } },
			{ attributes: { [String(p.groupByFieldsForStatistics)]: "Giza", n: 4 } }] }),
	}), [`/content/items/${MAP}/data`]: () => ({ operationalLayers: [{ id: "op-users", title: "Users", url: `${SVC}/0` }] }) });
	const widgets = [
		{ type: "indicator", title: "Owners", filter: { Role: "owner" }, icon: "person", tab: "Owners" },
		{ type: "indicator", title: "Users", filter: { Role: "user" }, icon: "people", color: "#00bfff", tab: "Users" },
		{ type: "list", group_by: "Gov", title: "By governorate", filter: { Role: ["owner", "user"] }, values: [
			{ label: "Owners" }, { label: "Units", field: "Units", statistic: "sum", color: "#00bfff" }] },
		{ type: "pie", field: "Gov", title: "Pie", column: "left" },
		{ type: "map", title: "Main Map", tab: "Main Map" },
		{ type: "map", title: "Heatmap", webmap_id: HEAT, tab: "Heatmap" },
		{ type: "line", field: "JoinDate", period: "day", rotated: true, title: "Trend" }];
	const build = async (extra: Record<string, unknown> = {}) => {
		silence();
		const { ctx, calls } = fakeCtx(routes());
		const out: any = await app(ctx, { kind: "dashboard", target: ID, webmap_id: MAP, style: "executive", widgets, ...extra } as any);
		const data = json(sent(calls, "/addItem")[0].params.text);
		const byName = (name: string) => data.desktopView.widgets.find((w: any) => w.name === name);
		return { out, data, byName, calls };
	};

	it("the navy theme is saved as the dashboard's resource; widgets get the executive look", async () => {
		const { out, data, byName, calls } = await build();
		expect(data.theme).toEqual({ id: "user", type: "resource" });
		const resource = sent(calls, "/addResources")[0].params;
		expect(resource).toMatchObject({ resourcesPrefix: "themes", fileName: "user.json" });
		expect(json(resource.text)).toEqual(NAVY_THEME);
		expect(out).toMatchObject({ theme: "navy", style: "executive" });
		const owners = byName("Owners");
		expect(owners.defaultSettings).toMatchObject({ backgroundColor: "#1e232d", topSection: { textInfo: { text: "Owners", weight: "bold" } },
			middleSection: { textInfo: { fillColor: "#facc15" }, iconInfo: { align: "left" } } });
		expect(owners.defaultSettings.middleSection.iconInfo.icon).toContain('fill="#facc15"');
		expect(byName("Users").defaultSettings.middleSection.iconInfo.icon).toContain('fill="#00bfff"');
		const pie = byName("Pie").chartConfig;
		expect(pie.series[0]).toMatchObject({ innerRadius: 61, startAngle: 270, dataLabels: { visible: true },
			sliceGrouping: { percentageThreshold: 10 } });
		expect(pie.legend.visible).toBe(false);
		const trend = byName("Trend");
		expect(trend.chartConfig.rotated).toBe(true);
		expect(trend.chartConfig.series[0]).toMatchObject({ lineSmoothed: true, showArea: true, areaColor: [0, 191, 255, 127.5],
			temporalBinning: { unit: "days" } });
	});

	it("a grouped list is an Arcade data expression that filters, and is filtered by, its field", async () => {
		const { data, byName } = await build();
		const [expr] = data.arcadeDataSourceItems;
		expect(expr.script).toContain(`FeatureSetByPortalItem(Portal("https://acme.maps.arcgis.com"), "${ID}", 0, ["Gov","Units","Role"], false);`);
		expect(expr.script).toContain(`fs = Filter(fs, "Role IN ('owner', 'user')");`);
		expect(expr.script).toContain(`GroupBy(fs, ["Gov"], [{ name: 'value_1', expression: "1", statistic: 'COUNT' }, `
			+ `{ name: 'value_2', expression: "Units", statistic: 'SUM' }]);`);
		expect(expr.script).toContain("return OrderBy(rows, 'value_1 DESC');");
		const list = byName("By governorate");
		expect(list.datasets[0]).toMatchObject({ dataSource: { type: "arcadeDataSource", itemId: expr.itemId }, outFields: ["Gov", "value_1", "value_2"] });
		expect(list.text).toContain("{field/Gov}");
		expect(list.text).toContain('<span style="color:#00bfff;font-size:14px;"><strong>{field/value_2}</strong>');
		const main = byName("Main Map");
		const pie = byName("Pie");
		const fieldMap = [{ sourceName: "Gov", targetName: "Gov" }];
		expect(list.events[0].actions[0].targets).toContainEqual({ targetId: `${pie.id}#main`, by: "whereClause", requiresSelection: false, fieldMap });
		expect(list.events[0].actions[0].targets).toContainEqual({ targetId: `${main.id}#op-users`, by: "whereClause", requiresSelection: false, fieldMap });
		expect(list.events[0].actions).toHaveLength(1); // no zoom: the rows have no geometry
		expect(pie.events[0].actions[0].targets).toContainEqual({ targetId: `${list.id}#main`, by: "whereClause", requiresSelection: false, fieldMap });
		expect(byName("Trend").events[0].actions[0].targets.map((t: any) => t.targetId)).not.toContain(`${list.id}#main`);
		expect(main.events[0].actions[0].targets.map((t: any) => t.targetId)).not.toContain(`${list.id}#main`);
		expect(main.layers[0].events[0].actions[0].targets).toContainEqual({ targetId: `${list.id}#main`, by: "whereClause", requiresSelection: false, fieldMap });
	});

	it("a second map moves with the main one; tabs hold both", async () => {
		const { data, byName } = await build();
		const main = byName("Main Map");
		expect(byName("Heatmap")).toMatchObject({ itemId: HEAT, linkedMapWidgetIds: [main.id], mapTools: [] });
		expect(main).toMatchObject({ itemId: MAP, linkedMapWidgetIds: [], showNavigation: false });
		const center = data.desktopView.layout.rootElement.elements[1];
		expect(center.elements[0].elements.map((e: any) => e.tabName)).toEqual(["Main Map", "Heatmap"]);
	});

	it("refuses unsafe icons, a second map that is not a web map, and more than 4 list values", async () => {
		expect(() => iconSvg('<svg onload="x()"></svg>', "#fff")).toThrow(/plain <svg>/);
		expect(() => iconSvg("<svg><script>x</script></svg>", "#fff")).toThrow(/plain <svg>/);
		expect(() => iconSvg("rocket", "#fff")).toThrow(/person, people/);
		expect(iconSvg('<svg viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>', "#fff")).toContain("<path");
		const { ctx, calls } = fakeCtx(routes());
		await expect(app(ctx, { kind: "dashboard", target: ID, webmap_id: MAP, widgets: [{ type: "map" }, { type: "map", webmap_id: ID2 }] }))
			.rejects.toThrow(/must be a Web Map/);
		await expect(app(ctx, { kind: "dashboard", target: ID, widgets: [{ type: "list", group_by: "Gov",
			values: [{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }, { label: "e" }] }] })).rejects.toThrow(/up to 4/);
		expect(sent(calls, "/addItem")).toHaveLength(0);
	});

	it("classic dashboards keep the defined theme and add no resource", async () => {
		const { data, calls } = await build({ style: undefined, theme: "dark" });
		expect(data.theme).toEqual({ id: "dark", type: "defined" });
		expect(sent(calls, "/addResources")).toHaveLength(0);
	});
});

describe("portal_app: Experience Builder", () => {
	const template = () => ({ exbVersion: "1.14.0", dataSources: {}, widgets: {
		widget_1: { uri: "widgets/arcgis/arcgis-map/", config: { toolConfig: {} } },
		widget_2: { uri: "widgets/arcgis/legend/", useMapWidgetIds: ["widget_1"] } } });

	it("template from Esri's CDN (no token), web map bound, draft resource, published", async () => {
		silence();
		const { ctx, calls } = fakeCtx(common({ "/billboard/config.json": template }));
		const out: any = await app(ctx, { kind: "experience", webmap_id: MAP });
		expect(calls.find((c) => c.url.endsWith("/billboard/config.json"))!.via).toBe("public");
		expect(String(sent(calls, "/addItem")[0].params.typeKeywords)).toContain("status: Published");
		const res = sent(calls, "/addResources")[0].params;
		expect(res).toMatchObject({ resourcesPrefix: "config", fileName: "config.json" });
		const config = json(res.text);
		expect(config.exbVersion).toBe("1.14.0");
		expect(config.dataSources.dataSource_1).toEqual({ id: "dataSource_1", type: "WEB_MAP", sourceLabel: "Parks", itemId: MAP,
			portalUrl: "https://acme.maps.arcgis.com" });
		expect(config.widgets.widget_1.useDataSources).toEqual([{ dataSourceId: "dataSource_1", mainDataSourceId: "dataSource_1" }]);
		const upd = sent(calls, `/items/${NEW}/update`)[0].params;
		expect(upd.url).toBe(`https://experience.arcgis.com/experience/${NEW}`);
		expect(json(upd.text)).toEqual(config);
		expect(out.edit).toBe(`https://experience.arcgis.com/builder/?id=${NEW}`);
	});

	it("a step that fails removes the half-made item", async () => {
		const { ctx, calls } = fakeCtx(common({ "/billboard/config.json": template,
			[`${USER}/items/${NEW}/addResources`]: () => { throw new Error("resource refused"); } }));
		await expect(app(ctx, { kind: "experience" })).rejects.toThrow(/resource refused/);
		expect(sent(calls, `/items/${NEW}/delete`)).toHaveLength(1);
	});

	it("unknown templates are refused before any request; templates are listed without fetching 50 files", async () => {
		const { ctx, calls } = fakeCtx({});
		await expect(app(ctx, { kind: "experience", template: "nope" })).rejects.toThrow(/Available: blank_fullscreen/);
		const out: any = await app(ctx, { action: "templates", kind: "experience" });
		expect(out.templates).toHaveLength(50);
		expect(out.templates.find((t: any) => t.name === "billboard")).toMatchObject({ map_widgets: 1, ready_with_a_map: true });
		expect(calls).toHaveLength(0);
	});
});

describe("portal_app: StoryMaps", () => {
	it("map placement converts the item extent to Web Mercator", () => {
		const [x0, y0] = mercator(0, 0);
		expect(x0).toBeCloseTo(0, 6);
		expect(y0).toBeCloseTo(0, 6);
		expect(placement(null)).toEqual({ zoom: 2, viewpoint: { rotation: 0, scale: -1, targetGeometry: {} } });
		const p: any = placement([[-10, -5], [10, 5]]);
		expect(p.extent.xmin).toBeCloseTo(-1113194.9, 0);
		expect(p.center.x).toBeCloseTo(0, 6);
	});

	it("a published story: draft + published resources, the JSON as data, then StoryMaps' publish call", async () => {
		silence();
		const { ctx, calls } = fakeCtx(common({
			"storymaps.arcgis.com/version": () => ({ version: "26.39.1367" }),
			[`/content/items/${MAP}/data`]: () => ({ operationalLayers: [{ id: "l1", title: "Parks", visibility: false }] }),
			[`/stories/${NEW}/publish`]: () => ({ success: true }),
		}));
		const out: any = await app(ctx, { kind: "storymap", title: "River", summary: "A story", theme: "obsidian", sections: [
			{ heading: "The <b>river</b>", text: "First paragraph.\n\nSecond paragraph.", webmap_id: MAP }] });
		const kw = String(sent(calls, "/addItem")[0].params.typeKeywords).split(",");
		expect(kw).toEqual(expect.arrayContaining(["StoryMap", "smstatuspublished", "smversionpublished:26.39.1367"]));
		const [draft, published] = sent(calls, "/addResources").map((c) => c.params);
		expect(String(draft.fileName)).toMatch(/^draft_\d{13}\.json$/);
		expect(draft.access).toBe("private");
		expect(published.fileName).toBe("published_data.json");
		const story = json(sent(calls, `/items/${NEW}/update`)[0].params.text);
		const nodes = Object.values<any>(story.nodes);
		expect(nodes.find((n) => n.type === "storycover").data).toMatchObject({ title: "River", summary: "A story", byline: "Jane Doe" });
		expect(nodes.filter((n) => n.type === "text").map((n) => n.data)).toEqual([
			{ type: "h2", text: "The &lt;b&gt;river&lt;/b&gt;" }, { type: "paragraph", text: "First paragraph." },
			{ type: "paragraph", text: "Second paragraph." }]);
		expect(nodes.find((n) => n.type === "webmap").data.map).toBe(`r-${MAP}`);
		expect(story.resources[`r-${MAP}`].data).toMatchObject({ itemId: MAP, itemType: "Web Map", type: "default",
			mapLayers: [{ id: "l1", title: "Parks", visible: false }] });
		expect(Object.values<any>(story.resources).find((r) => r.type === "story-theme").data.themeId).toBe("obsidian");
		expect(calls.at(-2)!.url).toBe(`https://storymaps.arcgis.com/stories/${NEW}/publish`);
		expect(out).toMatchObject({ open: `https://storymaps.arcgis.com/stories/${NEW}`, blocks: 4 });
	});

	it("blocks: rich text, lists, images, embeds, buttons, numbers, swipe, sidecar, timeline; cover image and navigation", async () => {
		silence();
		const { ctx, calls } = fakeCtx(common({
			"storymaps.arcgis.com/version": () => ({ version: "26.39.1367" }),
			[`/content/items/${MAP}/data`]: () => ({ operationalLayers: [] }),
			[`/stories/${NEW}/publish`]: () => ({ success: true }),
		}));
		const out: any = await app(ctx, { kind: "storymap", title: "River", navigation: true,
			cover: { image: "https://x.example/cover.jpg", date: "none" }, blocks: [
				{ type: "heading", text: "Why" }, { type: "text", text: "A **big** *river* — see [the plan](https://x.example/plan) <script>" },
				{ type: "heading", text: "Detail", level: 3 }, { type: "bullets", items: ["one", "two"] }, { type: "quote", text: "Water is life" },
				{ type: "image", url: "https://x.example/a.png", caption: "Banks", size: "wide", link: "https://x.example" },
				{ type: "map", webmap_id: MAP, size: "full" }, { type: "embed", url: "https://x.example/app", display: "card" },
				{ type: "video", url: "https://youtu.be/abc" }, { type: "button", text: "Read more", url: "https://x.example/more" },
				{ type: "separator" }, { type: "number", value: "1,250", text: "homes protected" },
				{ type: "swipe", left: { webmap_id: MAP }, right: { webmap_id: MAP }, caption: "Before / after" },
				{ type: "sidecar", style: "floating", slides: [{ heading: "Upstream", text: "Rain.", webmap_id: MAP }, { text: "Pic", image: "https://x.example/p.png" }] },
				{ type: "timeline", events: [{ heading: "2020", text: "Survey" }, { heading: "2024", image: "https://x.example/t.png" }] }] });
		const story = json(sent(calls, `/items/${NEW}/update`)[0].params.text);
		const n = story.nodes;
		const root = n[story.root];
		const top = root.children.map((id: string) => n[id]);
		expect(top.map((x: any) => x.type)).toEqual(["storycover", "navigation", "text", "text", "text", "text", "text", "image", "webmap", "embed",
			"embed", "button", "separator", "large-number", "swipe", "immersive", "timeline", "credits"]);
		expect(root.config.coverDate).toBe("none");
		const cover = top[0];
		expect(cover.data.type).toBe("full");
		expect(story.resources[n[cover.children[0]].data.image].data).toEqual({ src: "https://x.example/cover.jpg", provider: "uri", height: 300, width: 400 });
		expect(top[1]).toEqual({ type: "navigation", data: { links: [root.children[2]] }, config: { isHidden: false } });
		expect(top[3].data).toEqual({ type: "paragraph", text: 'A <strong>big</strong> <em>river</em> — see <a href="https://x.example/plan" '
			+ 'rel="noopener noreferrer" target="_blank">the plan</a> &lt;script&gt;' });
		expect(top[4].data.type).toBe("h3");
		expect(top[5].data).toEqual({ type: "bullet-list", text: "<li>one</li><li>two</li>" });
		expect(top[7]).toMatchObject({ data: { caption: "Banks", link: "https://x.example" }, config: { size: "wide" } });
		expect(top[8].config).toEqual({ size: "full" });
		expect(top[9].data).toMatchObject({ embedType: "link", display: "card", providerUrl: "x.example", embedSrc: "https://x.example/app" });
		expect(top[10].data).toMatchObject({ embedType: "video", url: "https://youtu.be/abc", addedAsEmbedCode: true });
		expect(top[11].data).toEqual({ text: "Read more", link: "https://x.example/more" });
		expect(top[13].data).toEqual({ title: "1,250", description: "homes protected", alignment: "center" });
		expect(Object.values<string>(top[14].data.contents).map((id) => n[id].type)).toEqual(["webmap", "webmap"]);
		const sidecar = top[15];
		expect(sidecar.data).toEqual({ type: "sidecar", subtype: "floating-panel", narrativePanelPosition: "start", narrativePanelSize: "medium" });
		const [slide1, slide2] = sidecar.children.map((id: string) => n[id]);
		expect(slide1).toMatchObject({ type: "immersive-slide", data: { transition: "fade" } });
		expect(slide1.children.map((id: string) => n[id].type)).toEqual(["immersive-narrative-panel", "webmap"]);
		expect(n[slide1.children[0]].children.map((id: string) => n[id].data.type)).toEqual(["h3", "paragraph"]);
		expect(n[slide2.children[1]].type).toBe("image");
		const events = top[16].children.map((id: string) => n[id]);
		expect(top[16].data).toEqual({ type: "waterfall" });
		expect(events[1].children.map((id: string) => n[id].type)).toEqual(["text", "image"]);
		expect(out.blocks).toBe(15);
	});

	it("story blocks are checked before anything is created", async () => {
		const { ctx, calls } = fakeCtx(common({ [`/content/items/${MAP}/data`]: () => ({ operationalLayers: [] }) }));
		const make = (blocks: any[], extra: Record<string, unknown> = {}) => app(ctx, { kind: "storymap", blocks, ...extra } as any);
		await expect(make([{ type: "image", url: "http://x.example/a.png" }])).rejects.toThrow(/image url must be an https link/);
		await expect(make([{ type: "swipe", left: { webmap_id: MAP }, right: { image: "https://x.example/a.png" } }])).rejects.toThrow(/two web maps/);
		await expect(make([{ type: "sidecar", slides: [{ text: "no media" }] }])).rejects.toThrow(/slides\[0\] needs webmap_id, image or url/);
		await expect(make([{ type: "bullets", items: [] }])).rejects.toThrow(/needs items/);
		await expect(make([{ type: "button", text: "Go", url: "javascript:alert(1)" }])).rejects.toThrow(/url must be an https/);
		await expect(make([{ type: "separator" }], { cover: { type: "poster" } })).rejects.toThrow(/cover type/);
		expect(sent(calls, "/addItem")).toHaveLength(0);
	});
});

describe("portal_app: Survey123", () => {
	const survey = (extra: Record<string, (p: Record<string, unknown>) => unknown> = {}) => common({
		[`${USER}/createService`]: () => ({ itemId: ID2, serviceurl: SVC }),
		[`${USER}/items/${ID2}/update`]: () => ({ success: true }),
		[`${USER}/items/${ID2}/delete`]: () => ({ success: true }),
		[`${USER}/addRelationship`]: () => ({ success: true }),
		...extra,
	});

	it("a draft like the web designer's: versionInfo, its empty survey123_<form id> service, Survey2Service, form.json", async () => {
		silence();
		const { ctx, calls } = fakeCtx(survey());
		const out: any = await app(ctx, { kind: "survey", title: "Site <inspection>", questions: [
			{ type: "text", label: "Inspector", required: true }, { type: "single", label: "Condition", choices: ["Good", "Poor"] },
			{ type: "geopoint", label: "Where" }, { type: "image", label: "Photo" }] });
		const add = sent(calls, "/addItem")[0].params;
		expect(add).toMatchObject({ type: "Form", typeKeywords: "Form,Survey123,Survey123 Hub,Draft" });
		expect((add.properties as any).versionInfo.created).toMatchObject({ build: "3.26.320", env: "prod" });
		const create = sent(calls, "/createService")[0].params;
		expect(create).toMatchObject({ outputType: "featureService" });
		expect((create.createParameters as any).name).toBe(`survey123_${NEW}`);
		expect(sent(calls, `/items/${ID2}/update`)[0].params).toEqual({ title: "Site <inspection>",
			typeKeywords: `Survey123,Survey123 Hub,OwnerView,Source,${NEW}` });
		expect(sent(calls, "/addRelationship")[0].params).toEqual({ originItemId: NEW, destinationItemId: ID2, relationshipType: "Survey2Service" });
		const res = sent(calls, "/addResources")[0].params;
		expect(res).toMatchObject({ resourcesPrefix: "surveyDraft", fileName: "form.json" });
		const form = json(res.text);
		expect(form).toMatchObject({ layerName: "survey", portalUrl: "https://www.arcgis.com", version: "3.26",
			header: { isVisible: true, content: "<p>Site &lt;inspection&gt;</p>" } });
		expect(form.questions.map((q: any) => [q.type, q.name])).toEqual([["esriQuestionTypeGeoPoint", "location"],
			["esriQuestionTypeText", "inspector"], ["esriQuestionTypeSingleChoice", "condition"], ["esriQuestionTypeImage", "photo"]]);
		expect(form.questions[0]).toMatchObject({ fieldType: "esriFieldTypeGeometry", inputTools: ["pin", "search", "locate"] });
		expect(form.questions[1]).toMatchObject({ fieldName: "inspector", isRequired: true, fieldType: "esriFieldTypeString" });
		expect(form.questions[2].choices.items).toEqual([{ isNameModified: false, value: "Good", label: "Good" },
			{ isNameModified: false, value: "Poor", label: "Poor" }]);
		expect(form.questions[3]).toMatchObject({ fieldType: "esriAttachment", inputTools: ["browse", "camera"] });
		expect(out.design).toBe(`https://survey123.arcgis.com/surveys/${NEW}/design`);
	});

	it("questions from a layer's fields: coded values -> dropdown, dates, numbers; long text -> text area", async () => {
		silence();
		const { ctx, calls } = fakeCtx(survey({
			[`/content/items/${ID}`]: () => ({ id: ID, type: "Feature Service", url: SVC }),
			[SVC]: () => ({ layers: [{ id: 0, name: "poles" }] }),
			[`${SVC}/0`]: () => ({ name: "poles", geometryType: "esriGeometryPoint", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" },
				{ name: "KIND", alias: "Pole kind", type: "esriFieldTypeString", domain: { codedValues: [{ code: "W", name: "Wood" }] } },
				{ name: "CHECKED", type: "esriFieldTypeDate" }, { name: "HEIGHT", type: "esriFieldTypeDouble", nullable: false },
				{ name: "NOTE", type: "esriFieldTypeString", length: 2000 }] }),
		}));
		const out: any = await app(ctx, { kind: "survey", title: "Poles", target: ID });
		expect(out.from).toBe("the fields of poles");
		const qs = json(sent(calls, "/addResources")[0].params.text).questions;
		expect(qs.map((q: any) => q.type.replace("esriQuestionType", ""))).toEqual(["GeoPoint", "Dropdown", "Date", "Number", "TextArea"]);
		expect(qs[1].choices.items[0]).toEqual({ isNameModified: false, value: "W", label: "Wood" });
		expect(qs[3].isRequired).toBe(true);
	});

	it("bad questions fail before anything is created; a failed draft removes the item", async () => {
		const { ctx, calls } = fakeCtx(survey({ [`${USER}/items/${NEW}/addResources`]: () => { throw new Error("no draft"); } }));
		await expect(app(ctx, { kind: "survey", title: "S", questions: [{ type: "single", label: "Pick" }] })).rejects.toThrow(/needs choices/);
		await expect(app(ctx, { kind: "survey", title: "S", questions: [{ type: "geopoint", label: "A" }, { type: "geopoint", label: "B" }] }))
			.rejects.toThrow(/one location/);
		expect(sent(calls, "/addItem")).toHaveLength(0);
		await expect(app(ctx, { kind: "survey", title: "S" })).rejects.toThrow(/no draft/);
		expect(sent(calls, `/items/${NEW}/delete`)).toHaveLength(1);
		expect(sent(calls, `/items/${ID2}/delete`)).toHaveLength(1);
	});
});

describe("portal_app: Field Maps", () => {
	const poles = { capabilities: "Create,Query,Update,Sync", fields: [
		{ name: "OBJECTID", type: "esriFieldTypeOID", editable: false },
		{ name: "TYPE", alias: "Pole type", type: "esriFieldTypeString", length: 50, domain: { codedValues: [{ code: "W", name: "Wood" }] } },
		{ name: "INSTALLED", type: "esriFieldTypeDate" }, { name: "NOTE", type: "esriFieldTypeString", length: 1000 },
		{ name: "HEIGHT", type: "esriFieldTypeDouble", nullable: false }, { name: "GlobalID", type: "esriFieldTypeGlobalID" }] };

	it("input types follow the field: coded -> combo box, date -> date picker, long text -> text area", () => {
		expect(inputFor(poles.fields[1]).type).toBe("combo-box");
		expect(inputFor(poles.fields[2])).toEqual({ type: "datetime-picker", includeTime: true });
		expect(inputFor(poles.fields[3]).type).toBe("text-area");
		const form = formFor("Poles", poles, ["height", "type"]);
		expect(form.formElements.map((e: any) => e.fieldName)).toEqual(["HEIGHT", "TYPE"]);
		expect(form.formElements[0]).toMatchObject({ requiredExpression: "expr/system/true", editableExpression: "expr/system/true" });
	});

	it("forms for editable layers only, existing forms kept, offline refused without Sync everywhere", async () => {
		silence();
		const data = { operationalLayers: [{ id: "a", title: "Poles", url: `${SVC}/0` },
			{ id: "b", title: "Roads", url: `${SVC}/1`, formInfo: { title: "mine" } }, { id: "c", title: "Ref", url: `${SVC}/2` }] };
		const { ctx, calls } = fakeCtx(common({ [`/content/items/${MAP}/data`]: () => data, [`${SVC}/0`]: () => poles,
			[`${SVC}/1`]: () => ({ capabilities: "Query,Editing,Sync", fields: [] }), [`${SVC}/2`]: () => ({ capabilities: "Query", fields: [] }),
			[`${USER}/items/${MAP}/update`]: () => ({ success: true }) }));
		const out: any = await app(ctx, { kind: "fieldmaps", webmap_id: MAP, options: { offline: true } });
		expect(out.layers.map((l: any) => l.form)).toEqual(["created", "kept (it already has one)", "skipped: the layer is not editable"]);
		const saved = json(sent(calls, `/items/${MAP}/update`)[0].params.text);
		expect(saved.operationalLayers[0].formInfo.formElements.map((e: any) => e.fieldName)).toEqual(["TYPE", "INSTALLED", "NOTE", "HEIGHT"]);
		expect(saved.operationalLayers[1].formInfo).toEqual({ title: "mine" });
		expect(out.offline).toBe(false);
		expect(out.open_in_field_maps).toBe(`https://fieldmaps.arcgis.app/?portalURL=${encodeURIComponent("https://acme.maps.arcgis.com")}&referenceContext=open&itemID=${MAP}`);
	});
});

describe("portal_app: Experience Builder Developer Edition", () => {
	it("registers the app with ExB's redirect and never returns the client secret", async () => {
		silence();
		const { ctx, calls } = fakeCtx(common({ "/oauth2/registerApp": () => ({ client_id: "abc123", client_secret: "TOP-SECRET",
			redirect_uris: ["https://localhost:3001/"] }) }));
		const out: any = await app(ctx, { kind: "exb_developer" });
		expect(sent(calls, "/addItem")[0].params.type).toBe("Application");
		expect(sent(calls, "/oauth2/registerApp")[0].params).toEqual({ itemId: NEW, appType: "browser", redirect_uris: ["https://localhost:3001/"] });
		expect(out.client_id).toBe("abc123");
		expect(JSON.stringify(out)).not.toContain("TOP-SECRET");
		await expect(app(ctx, { kind: "exb_developer", redirect_uris: ["localhost"] })).rejects.toThrow(/not a redirect URL/);
	});

	it("kind is required, and only some kinds have templates", async () => {
		const { ctx } = fakeCtx({});
		await expect(app(ctx, {} as any)).rejects.toThrow(/kind must be one of/);
		await expect(app(ctx, { action: "templates", kind: "survey" })).rejects.toThrow(/no templates/);
	});
});
