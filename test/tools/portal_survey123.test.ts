import { describe, expect, it } from "vitest";
import { survey123, surveyLinks, XLS2XFORM } from "../../src/tools/portal_survey123/handler";
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
		expect(survey.slice(1).map((r) => r.slice(0, 5))).toEqual([
			["geopoint", "location", "Where", undefined, undefined],
			["select_one asset_type_list", "asset_type", "Asset type", "yes", "minimal"],
			["select_multiple issues_list", "issues", "Issues", undefined, undefined],
			["text", "notes", "Notes", undefined, "multiline"],
			["text", "email", "Email", undefined, undefined],
			["integer", "count", "Count", undefined, undefined]]);
		expect(survey[5][5]).toMatch(/^regex\(\., /);
		expect(choices.slice(1)).toEqual([["asset_type_list", "Pole", "Pole"], ["asset_type_list", "water_valve", "Water valve"],
			["issues_list", "Rust", "Rust"], ["issues_list", "broken_part", "Broken part"]]);
		expect(settings[1].slice(0, 2)).toEqual(["Site inspection", "site_inspection"]);
		expect(() => xlsformRows("x", [{ type: "single", label: "Pick" }])).toThrow(/needs choices/);
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
