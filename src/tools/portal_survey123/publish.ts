/**
 * A PUBLISHED Survey123 survey from an XLSForm, as Survey123 Connect makes one: the steps of Survey.publish in the
 * ArcGIS API for Python 2.4.3 for a new survey, done here end to end.
 *  1. XLSForm -> XForm (survey123.arcgis.com/api/xls2xform) -> web form (api/xform2webform): Survey123's own converters.
 *  2. The Form item + its empty survey123_<form id> service (draft.ts's recipe).
 *  3. The layer (schema.ts) added to the service, editor tracking and capabilities set.
 *  4. The "form" view (FieldworkerView) submissions go to: Survey2Service -> the view, Survey2Data -> the service.
 *  5. esriinfo/ (forminfo.json, .itemInfo, .xlsx, .xml, .webform) zipped as the Form's file, with Connect's keywords.
 * Uploading the XLSForm and pressing ArcGIS's Publish button instead makes a hosted TABLE (the sheet as data).
 */
import { adminUrl, ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { addItem, addRelationship, orRemove, portalSelf, updateItem } from "../shared/items";
import { base, userPath } from "../shared/lookup";
import { type QuestionSpec, SURVEY123_BUILD, serviceParams } from "./draft";
import { surveySchema } from "./schema";
import { xlsformRows, xlsx, zip } from "./xlsform";

export const XLS2XFORM = "https://survey123.arcgis.com/api/xls2xform";
export const XFORM2WEBFORM = "https://survey123.arcgis.com/api/xform2webform";
const VERSIONS = "https://doc.arcgis.com/en/survey123/versions.json";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The current Survey123 Connect version, read like the Python API's _get_version (3.25.27 in 2026-10). */
export async function connectVersion(ctx: Ctx): Promise<string> {
	const d = await ctx.publicGet?.(VERSIONS).catch(() => null);
	const versions = d?.secured?.windows64_connect?.versions ?? {};
	const first: any = Object.values(versions)[0];
	const m = /_(\d+)_(\d+)_(\d+)\.exe$/.exec(String(first?.url ?? ""));
	return m ? `${m[1]}.${m[2]}.${m[3]}` : "3.25.27";
}

const fileSafe = (title: string) => title.replace(/[\\/:*?"<>|]+/g, "_").trim() || "survey";
const enc = (s: string) => new TextEncoder().encode(s);

export async function publishSurvey(ctx: Ctx, args: { title?: string; summary?: string; folder?: string; tags?: string[]; pages?: boolean },
	specs: QuestionSpec[], from: string) {
	if (!args.title) throw new ArcGISError("title is required.", "bad_argument");
	if (!ctx.publicUpload || !ctx.publicPost || !ctx.upload) throw new ArcGISError("Publishing surveys is not available here.", "unsupported");
	const title = args.title;
	const name = fileSafe(title);
	const self = await portalSelf(ctx);
	const portal = ctx.props.portal.replace(/\/+$/, "");

	// 1. Survey123's converters, before anything is created
	const rows = xlsformRows(title, specs, { pages: args.pages });
	const xlsxBytes = xlsx([{ name: "survey", rows: rows.survey }, { name: "choices", rows: rows.choices }, { name: "settings", rows: rows.settings }]);
	const conv = await ctx.publicUpload(XLS2XFORM, {}, { name: `${name}.xlsx`, content: xlsxBytes, type: XLSX_TYPE, field: "xlsform" });
	if (!conv?.success || !conv.xform) throw new ArcGISError(`Survey123's converter rejected the XLSForm: ${conv?.error ?? conv?.message ?? "no answer"}`, "xlsform_invalid");
	const version = await connectVersion(ctx);
	const web = await ctx.publicPost(XFORM2WEBFORM, { xform: conv.xform, connectVersion: version });
	if (!web?.form || !web?.surveyFormJson) throw new ArcGISError("Survey123 could not make the web form from the XForm.", "xlsform_invalid");
	const webform = { form: web.form, languageMap: web.languageMap, model: web.model, success: web.success,
		surveyFormJson: { ...web.surveyFormJson, portalUrl: portal }, transformerVersion: web.transformerVersion };

	// 2. the form and its empty service
	const { id, folderId } = await addItem(ctx, args.folder, { type: "Form", title, typeKeywords: "Form,Survey123,Survey123 Hub,Draft",
		tags: (args.tags ?? ["arcgis-web-mcp", "Survey123"]).join(","), snippet: args.summary ?? "",
		properties: { versionInfo: { created: { build: SURVEY123_BUILD, timestamp: Date.now(), env: "prod" } } } });
	const made = [id];
	const inFolder = `${userPath(ctx)}${folderId ? `/${folderId}` : ""}`;
	return orRemove(ctx, made, async () => {
		const svcName = `survey123_${id}`;
		const svc = await ctx.request(`${inFolder}/createService`, { createParameters: serviceParams(svcName, id), outputType: "featureService" });
		if (!svc.itemId || !svc.serviceurl) throw new ArcGISError("ArcGIS did not create the survey's feature service.", "arcgis_error");
		made.push(svc.itemId);
		const portalTag = self.isPortal ? ",providerSDS" : "";
		await updateItem(ctx, svc.itemId, { title, typeKeywords: `Survey123,Survey123 Hub,OwnerView,Source,${id}${portalTag}` });

		// 3. the layer, then editor tracking and capabilities
		const schema = surveySchema(rows.formId, rows.questions);
		await ctx.request(`${adminUrl(svc.serviceurl)}/addToDefinition`, { addToDefinition: schema });
		await ctx.request(`${adminUrl(svc.serviceurl)}/updateDefinition`, { updateDefinition: { hasStaticData: false,
			editorTrackingInfo: { enableEditorTracking: true, enableOwnershipAccessControl: true, allowOthersToUpdate: true,
				allowOthersToDelete: true, allowAnonymousToQuery: false, allowAnonymousToUpdate: false, allowAnonymousToDelete: false },
			capabilities: "Create,Delete,Query,Update,Editing,Extract" } });

		// 4. the form view submissions go to
		const view = await ctx.request(`${inFolder}/createService`, { outputType: "featureService", isView: true,
			createParameters: { name: `survey123_a${crypto.randomUUID().replace(/-/g, "")}_form`, isView: true, sourceSchemaChangesAllowed: true,
				isUpdatableView: true, capabilities: "Create,Editing", spatialReference: { wkid: 4326, latestWkid: 4326 },
				description: `Feature service view of form for the survey ${id}` } });
		if (!view.itemId || !view.serviceurl) throw new ArcGISError("ArcGIS did not create the survey's form view.", "arcgis_error");
		made.push(view.itemId);
		const isTable = "tables" in schema;
		const viewLayer = { adminLayerInfo: { viewLayerDefinition: { sourceServiceName: svcName, sourceLayerId: 0, sourceLayerFields: "*" } },
			name: rows.formId, id: 0 };
		await ctx.request(`${adminUrl(view.serviceurl)}/addToDefinition`, { addToDefinition: isTable ? { tables: [viewLayer] } : { layers: [viewLayer] } });
		await updateItem(ctx, view.itemId, { title: `${title}_form`, typeKeywords: "ArcGIS Server,Data,Feature Access,Feature Service,Service,"
			+ `Singlelayer,Hosted Service,View Service,FieldworkerView,${id},Survey123,Survey123 Hub${portalTag}` });
		// the end state of Python's publish (which first relates the draft's service, then moves that to Survey2Data)
		await addRelationship(ctx, id, view.itemId, "Survey2Service");
		await addRelationship(ctx, id, svc.itemId, "Survey2Data");

		// 5. the form's file and Connect's keywords
		const now = Math.floor(Date.now() / 1000);
		const itemInfo = { access: "private", id, isOrgItem: true, created: now, modified: now, name: `${id}.zip`, orgId: self.id ?? null,
			owner: ctx.props.username, ownerFolder: folderId, properties: { connectVersion: version }, type: "Form",
			typeKeywords: ["xForm, Form, Survey123, Survey123 Connect"] };
		const pack = zip([
			{ name: "esriinfo/", data: new Uint8Array() },
			{ name: "esriinfo/forminfo.json", data: enc(JSON.stringify({ name, type: "xform" }, null, 4)) },
			{ name: `esriinfo/${name}.itemInfo`, data: enc(JSON.stringify(itemInfo, null, 4)) },
			{ name: `esriinfo/${name}.xlsx`, data: xlsxBytes },
			{ name: `esriinfo/${name}.xml`, data: enc(conv.xform) },
			{ name: `esriinfo/${name}.webform`, data: enc(JSON.stringify(webform, null, 2)) },
		]);
		await ctx.upload!(`${userPath(ctx)}/items/${id}/update`, { typeKeywords: "xForm, Form, Survey123, Survey123 Connect" },
			{ name: `${id}.zip`, content: pack, type: "application/zip" });

		const item = await ctx.request(`${base(ctx)}/content/items/${id}`);
		return { survey: itemCard(item, ctx.props.portal), status: "published", from,
			layer: { item_id: svc.itemId, url: `${svc.serviceurl}/0`,
				kind: isTable ? "table" : `${{ esriGeometryPolyline: "line", esriGeometryPolygon: "polygon" }[(schema as any).layers[0].geometryType as string] ?? "point"} layer` },
			form_view: { item_id: view.itemId, url: `${view.serviceurl}/0` }, connect_version: version,
			questions: rows.questions.map((q) => `${q.label} (${q.spec.type})`) };
	});
}
