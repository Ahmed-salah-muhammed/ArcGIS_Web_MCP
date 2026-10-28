import { describe, expect, it } from "vitest";
import { autoWidgets, layoutFor } from "../../src/tools/portal_app/dashboard";
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
		expect(out).toMatchObject({ open: `https://storymaps.arcgis.com/stories/${NEW}`, sections: 4 });
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
