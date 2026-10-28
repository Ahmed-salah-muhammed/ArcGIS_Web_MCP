import { describe, expect, it } from "vitest";
import { survey123, surveyLinks, XLS2XFORM } from "../../src/tools/portal_survey123/handler";
import { question } from "../../src/tools/portal_survey123/draft";
import { XFORM2WEBFORM } from "../../src/tools/portal_survey123/publish";
import { surveySchema } from "../../src/tools/portal_survey123/schema";
import { crc32, xlsformRows } from "../../src/tools/portal_survey123/xlsform";
import { fakeCtx, ID, ID2, silence, SVC, USER } from "../helpers";

const NEW = "d".repeat(32);
const self = () => ({ isPortal: false, urlKey: "acme", customBaseUrl: "maps.arcgis.com" });

describe("XLSForm", () => {
	it("rows follow XLSForm: select lists in choices, multiline/minimal appearances, an email constraint", () => {
		const { survey, choices, settings } = xlsformRows("Site inspection", [
			{ type: "geopoint", label: "Where" }, { type: "dropdown", label: "Asset type", choices: ["Pole", "Water valve"], required: true },
			{ type: "multi", label: "Issues", choices: ["Rust", "Broken part"] }, { type: "textarea", label: "Notes" },
			{ type: "email", label: "Email" }, { type: "integer", label: "Count" }]);
		expect(survey[0].slice(0, 7)).toEqual(["type", "name", "label", "hint", "required", "required_message", "appearance"]);
		// type, name, label, required, appearance
		const cols = (r: unknown[]) => [r[0], r[1], r[2], r[4], r[6]];
		expect(survey.slice(1).map(cols)).toEqual([
			["geopoint", "location", "Where", undefined, undefined],
			["select_one asset_type_list", "asset_type", "Asset type", "yes", "minimal"],
			["select_multiple issues_list", "issues", "Issues", undefined, undefined],
			["text", "notes", "Notes", undefined, "multiline"],
			["text", "email", "Email", undefined, undefined],
			["integer", "count", "Count", undefined, undefined]]);
		expect(survey[5][8]).toMatch(/^regex\(\., /);
		expect(choices.slice(1)).toEqual([["asset_type_list", "Pole", "Pole"], ["asset_type_list", "water_valve", "Water valve"],
			["issues_list", "Rust", "Rust"], ["issues_list", "broken_part", "Broken part"]]);
		expect(settings[1].slice(0, 2)).toEqual(["Site inspection", "site_inspection"]);
		expect(() => xlsformRows("x", [{ type: "single", label: "Pick" }])).toThrow(/needs choices/);
	});

	it("XLSForm-only settings: groups and pages, names in expressions, calculate, signature, choice filters", () => {
		const { survey, choices, settings, questions } = xlsformRows("Damage", [
			{ type: "single", label: "Status", name: "status", choices: ["ok", "damaged"], required: true, required_message: "Pick one",
				group: "Asset" },
			{ type: "number", label: "Cost", hint: "In EGP", relevant: "${status} = 'damaged'", constraint: ". >= 0",
				constraint_message: "No negatives", group: "Asset" },
			{ type: "calculate", label: "", name: "vat", calculation: "${cost} * 0.14" },
			{ type: "dropdown", label: "Region", choices: [{ value: "n", label: "North", filter: "" }] },
			{ type: "dropdown", label: "City", choice_filter: "filter=${region}", choices: [{ value: "alex", label: "Alexandria", filter: "n" }] },
			{ type: "signature", label: "Signed by", read_only: false, group: "Sign" }, { type: "date", label: "When", default: "today()", read_only: true }],
			{ pages: true });
		const h = survey[0];
		const at = (row: unknown[], col: string) => row[h.indexOf(col)];
		expect(survey.map((r) => r[0])).toEqual(["type", "begin group", "select_one status_list", "decimal", "end group", "calculate",
			"select_one region_list", "select_one city_list", "begin group", "image", "end group", "date"]);
		expect(survey[1].slice(0, 3)).toEqual(["begin group", "asset_group", "Asset"]);
		expect(at(survey[1], "appearance")).toBe("field-list");
		expect(at(survey[2], "required_message")).toBe("Pick one");
		expect([at(survey[3], "hint"), at(survey[3], "relevant"), at(survey[3], "constraint"), at(survey[3], "constraint_message")])
			.toEqual(["In EGP", "${status} = 'damaged'", ". >= 0", "No negatives"]);
		expect([survey[5][1], at(survey[5], "label"), at(survey[5], "calculation")]).toEqual(["vat", undefined, "${cost} * 0.14"]);
		expect(at(survey[7], "choice_filter")).toBe("filter=${region}");
		expect(at(survey[9], "appearance")).toBe("signature");
		expect([at(survey[11], "default"), at(survey[11], "readonly")]).toEqual(["today()", "yes"]);
		expect(choices[0]).toEqual(["list_name", "name", "label", "filter"]);
		expect(choices.slice(-1)).toEqual([["city_list", "alex", "Alexandria", "n"]]);
		expect(settings).toEqual([["form_title", "form_id", "version", "style"], ["Damage", "damage", expect.any(String), "pages"]]);
		expect(questions.map((q) => q.name)).toEqual(["status", "cost", "vat", "region", "city", "signed_by", "when"]);
		// expressions must point at questions; one geometry question
		expect(() => xlsformRows("x", [{ type: "text", label: "A", relevant: "${nope} = 1" }])).toThrow(/\$\{nope\} is not a question name/);
		expect(() => xlsformRows("x", [{ type: "calculate", label: "Total" }])).toThrow(/needs calculation/);
		expect(() => xlsformRows("x", [{ type: "geopoint", label: "P" }, { type: "geoshape", label: "Area" }])).toThrow(/one location question/);
		expect(() => xlsformRows("x", [{ type: "text", label: "A", name: "a" }, { type: "text", label: "B", name: "a" }])).toThrow(/Two questions/);
	});

	it("the layer follows the questions: line or polygon geometry, attachments for signatures, text fields for time and calculate", () => {
		const line: any = surveySchema("trail", xlsformRows("trail", [{ type: "geotrace", label: "Path" }, { type: "time", label: "At" },
			{ type: "calculate", label: "Len", calculation: "1" }, { type: "signature", label: "Sig" }]).questions);
		expect(line.layers[0]).toMatchObject({ geometryType: "esriGeometryPolyline", hasAttachments: true,
			drawingInfo: { renderer: { symbol: { type: "esriSLS", width: 2 } } } });
		expect(line.layers[0].fields.map((f: any) => [f.name, f.type])).toEqual([["objectid", "esriFieldTypeOID"], ["globalid", "esriFieldTypeGlobalID"],
			["at", "esriFieldTypeString"], ["len", "esriFieldTypeString"]]);
		const area: any = surveySchema("plots", xlsformRows("plots", [{ type: "geoshape", label: "Plot" }]).questions);
		expect(area.layers[0]).toMatchObject({ geometryType: "esriGeometryPolygon", hasAttachments: false,
			drawingInfo: { renderer: { symbol: { type: "esriSFS", color: [0, 178, 255, 48] } } } });
	});

	it("the web designer's draft takes hints but sends XLSForm-only types and settings to publish / xlsform", () => {
		const used = new Set<string>();
		expect(question({ type: "text", label: "Name", hint: "Full <name>" }, 1, used, {}).description).toBe("Full &lt;name&gt;");
		expect(() => question({ type: "signature", label: "Sig" }, 2, used, {})).toThrow(/made with an XLSForm: use portal_survey123 action=publish/);
		expect(() => question({ type: "text", label: "A", relevant: "1", group: "G" }, 3, used, {})).toThrow(/group, relevant are XLSForm settings/);
	});

	it("the zip's CRC-32 is the standard one", () => {
		expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
	});
});

describe("portal_survey123", () => {
	it("links match ArcGIS's 'Open in Survey123' menu", () => {
		expect(surveyLinks(ID, "https://www.arcgis.com", false)).toEqual({
			open_in_browser: `https://survey123.arcgis.com/share/${ID}`,
			open_in_survey123_app: `https://survey123.arcgis.app?itemID=${ID}`,
			open_in_survey123_app_scheme: `arcgis-survey123://?itemID=${ID}`,
			manage_in_survey123_website: `https://survey123.arcgis.com/surveys/${ID}/overview`,
			edit_in_web_designer: `https://survey123.arcgis.com/surveys/${ID}/design`,
			edit_in_survey123_connect: `arcgis-survey123connect://?portalUrl=https://www.arcgis.com%26itemID=${ID}`,
		});
		expect(surveyLinks(ID, "https://gis.example.com/portal", true).open_in_browser)
			.toBe(`https://survey123.arcgis.com/share/${ID}?portalUrl=${encodeURIComponent("https://gis.example.com/portal")}`);
	});

	it("xlsform: Survey123's converter checks it (without the token), then it is saved as an Excel item", async () => {
		silence();
		const { ctx, calls } = fakeCtx({
			"/portals/self": self,
			[XLS2XFORM]: () => ({ success: true, warnings: [] }),
			[`${USER}/addItem`]: () => ({ id: NEW }),
			[`/content/items/${NEW}`]: () => ({ id: NEW, title: "Site inspection", type: "Microsoft Excel", owner: "jdoe_gis" }),
		});
		const out: any = await survey123(ctx, { action: "xlsform", title: "Site inspection",
			questions: [{ type: "text", label: "Name" }, { type: "single", label: "Condition", choices: ["Good", "Poor"] }] });
		const check = calls.find((c) => c.url === XLS2XFORM)!;
		expect(check.via).toBe("public");
		expect(check.file).toMatchObject({ name: "Site_inspection.xlsx", field: "xlsform" });
		const bytes = (check.file as any).content as Uint8Array;
		expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]); // a ZIP, as .xlsx files are
		const add = calls.find((c) => c.url.endsWith("/addItem"))!;
		expect(add.via).toBe("upload");
		expect(add.params).toMatchObject({ type: "Microsoft Excel", fileName: "Site_inspection.xlsx" });
		expect(out).toMatchObject({ download: `https://www.arcgis.com/sharing/rest/content/items/${NEW}/data`,
			checked: "accepted by Survey123's converter, no warnings" });
	});

	it("xlsform: a form the converter rejects is not saved", async () => {
		const { ctx, calls } = fakeCtx({ "/portals/self": self, [XLS2XFORM]: () => ({ success: false, error: "Bad sheet." }) });
		await expect(survey123(ctx, { action: "xlsform", title: "X" })).rejects.toThrow(/rejected the XLSForm: Bad sheet/);
		expect(calls.some((c) => c.url.endsWith("/addItem"))).toBe(false);
	});

	it("info: draft status, the draft's questions, the layer, and the links", async () => {
		const { ctx } = fakeCtx({
			"/portals/self": self,
			[`/content/items/${ID}`]: () => ({ id: ID, title: "Inspection", type: "Form", owner: "jdoe_gis", typeKeywords: ["Draft", "Form", "Survey123"] }),
			[`/content/items/${ID}/resources`]: () => ({ resources: [{ resource: "surveyDraft/form.json" }] }),
			[`/content/items/${ID}/resources/surveyDraft/form.json`]: () => ({ questions: [{ label: "Name", type: "esriQuestionTypeText" }] }),
			[`/content/items/${ID}/relatedItems`]: () => ({ relatedItems: [{ id: ID2, url: SVC }] }),
			[SVC]: () => ({ layers: [] }),
		});
		const out: any = await survey123(ctx, { action: "info", survey_id: ID });
		expect(out).toMatchObject({ status: "draft: not published yet", made_with: "Survey123 web designer", questions: ["Name (Text)"],
			service: { id: ID2, layers: [], records: null } });
		expect(out.links.edit_in_survey123_connect).toContain(`itemID=${ID}`);
	});

	it("schema: like the Python API's, a point layer with a cvd_ domain on single choices and attachments for photos", () => {
		const { questions, formId } = xlsformRows("Site inspection", [{ type: "geopoint", label: "Where" },
			{ type: "single", label: "Condition", choices: ["Good", "Poor"] }, { type: "integer", label: "Count" }, { type: "image", label: "Photo" }]);
		const schema: any = surveySchema(formId, questions);
		const layer = schema.layers[0];
		expect(layer).toMatchObject({ name: "site_inspection", geometryType: "esriGeometryPoint", hasAttachments: true, objectIdField: "objectid" });
		expect(layer.fields.map((f: any) => `${f.name}:${f.type}`)).toEqual(["objectid:esriFieldTypeOID", "globalid:esriFieldTypeGlobalID",
			"condition:esriFieldTypeString", "count:esriFieldTypeInteger"]);
		expect(layer.fields[2].domain).toEqual({ type: "codedValue", name: "cvd_condition", codedValues: [{ name: "Good", code: "Good" }, { name: "Poor", code: "Poor" }] });
		expect((surveySchema("t", xlsformRows("t", [{ type: "text", label: "A" }]).questions) as any).tables[0].type).toBe("Table");
	});

	it("publish: converters first, then form + service + layer + form view + relationships + the esriinfo zip", async () => {
		silence();
		const VIEW = "https://services1.arcgis.com/ORG/arcgis/rest/services/survey123_form/FeatureServer";
		const VIEW_ID = "e".repeat(32);
		let services = 0;
		const { ctx, calls } = fakeCtx({
			"/portals/self": () => ({ ...self(), id: "ORG" }),
			[XLS2XFORM]: () => ({ success: true, xform: "<h:html/>" }),
			"/survey123/versions.json": () => ({ secured: { windows64_connect: { versions: { "3.25": { url: "https://x/Survey123Connect_x64_3_25_27.exe" } } } } }),
			[XFORM2WEBFORM]: () => ({ form: "<form/>", model: "<model/>", languageMap: {}, success: true, surveyFormJson: {}, transformerVersion: "4" }),
			[`${USER}/addItem`]: () => ({ id: NEW }),
			[`${USER}/createService`]: () => (++services === 1 ? { itemId: ID2, serviceurl: SVC } : { itemId: VIEW_ID, serviceurl: VIEW }),
			[`${USER}/items/${ID2}/update`]: () => ({ success: true }),
			[`${USER}/items/${VIEW_ID}/update`]: () => ({ success: true }),
			"/rest/admin/services/pts/FeatureServer/addToDefinition": () => ({ success: true }),
			"/rest/admin/services/pts/FeatureServer/updateDefinition": () => ({ success: true }),
			"/rest/admin/services/survey123_form/FeatureServer/addToDefinition": () => ({ success: true }),
			[`${USER}/addRelationship`]: () => ({ success: true }),
			[`${USER}/items/${NEW}/update`]: () => ({ success: true }),
			[`/content/items/${NEW}`]: () => ({ id: NEW, title: "Inspection", type: "Form", owner: "jdoe_gis" }),
		});
		const out: any = await survey123(ctx, { action: "publish", title: "Inspection", questions: [{ type: "geopoint", label: "Where" },
			{ type: "single", label: "Condition", choices: ["Good", "Poor"] }] });
		const urls = calls.map((c) => c.url);
		expect(urls.indexOf(XLS2XFORM)).toBeLessThan(urls.findIndex((u) => u.endsWith("/addItem")));
		expect(calls.find((c) => c.url === XFORM2WEBFORM)!.params).toEqual({ xform: "<h:html/>", connectVersion: "3.25.27" });
		const schema: any = calls.find((c) => c.url.endsWith("/pts/FeatureServer/addToDefinition"))!.params.addToDefinition;
		expect(schema.layers[0].name).toBe("inspection");
		const view: any = calls.find((c) => c.url.endsWith("/survey123_form/FeatureServer/addToDefinition"))!.params.addToDefinition;
		expect(view.layers[0].adminLayerInfo.viewLayerDefinition).toEqual({ sourceServiceName: `survey123_${NEW}`, sourceLayerId: 0, sourceLayerFields: "*" });
		expect(String(calls.find((c) => c.url.endsWith(`/items/${VIEW_ID}/update`))!.params.typeKeywords)).toContain(`FieldworkerView,${NEW},Survey123`);
		expect(calls.filter((c) => c.url.endsWith("/addRelationship")).map((c) => [c.params.destinationItemId, c.params.relationshipType]))
			.toEqual([[VIEW_ID, "Survey2Service"], [ID2, "Survey2Data"]]);
		const pack = calls.find((c) => c.url.endsWith(`/items/${NEW}/update`) && c.via === "upload")!;
		expect(pack.params.typeKeywords).toBe("xForm, Form, Survey123, Survey123 Connect");
		const text = new TextDecoder().decode((pack.file as any).content);
		for (const f of ["esriinfo/forminfo.json", "esriinfo/Inspection.itemInfo", "esriinfo/Inspection.xlsx", "esriinfo/Inspection.xml", "esriinfo/Inspection.webform"]) {
			expect(text).toContain(f);
		}
		expect(out).toMatchObject({ status: "published", layer: { item_id: ID2, kind: "point layer" }, form_view: { item_id: VIEW_ID } });
		expect(out.links.open_in_browser).toBe(`https://survey123.arcgis.com/share/${NEW}`);
	});

	it("publish: a form Survey123's converter rejects creates nothing", async () => {
		const { ctx, calls } = fakeCtx({ "/portals/self": self, [XLS2XFORM]: () => ({ success: false, error: "Bad." }) });
		await expect(survey123(ctx, { action: "publish", title: "X" })).rejects.toThrow(/rejected the XLSForm: Bad/);
		expect(calls.some((c) => c.url.endsWith("/addItem") || c.url.endsWith("/createService"))).toBe(false);
	});
});
