/**
 * A Survey123 survey as the Survey123 web designer keeps a draft, read from real drafts on ArcGIS Online: a "Form"
 * item (Draft) with properties.versionInfo, its own EMPTY feature service survey123_<form id> (the form id in its
 * keywords) related by Survey2Service, and the draft in the resource surveyDraft/form.json (questions typed
 * esriQuestionType*, version 3.26 settings). The designer opens it with the questions in place; its Publish button
 * adds the layer. Tried live: SurveyManager.create's item (no draft, random service name) does not open in the
 * designer, and neither does a draft without versionInfo and the service. Questions come from `questions`, from a
 * layer's fields (`target`: the survey gets a new layer with the same fields), or a default set.
 */
import { ArcGISError } from "../../arcgis";
import { esc } from "../../pages/credit";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { addItem, addRelationship, addResource, orRemove, portalSelf, updateItem } from "../shared/items";
import { base, requireId, resolveLayerUrl, userPath } from "../shared/lookup";
import type { AppArgs } from "../portal_app/types";

export const QUESTION_TYPES = ["text", "textarea", "number", "integer", "date", "datetime", "single", "dropdown", "multi", "email",
	"image", "note", "geopoint"] as const;
export type QuestionSpec = { type: (typeof QUESTION_TYPES)[number]; label: string; choices?: (string | { value: string; label: string })[];
	required?: boolean };

const SKIP = /^(objectid|fid|globalid|shape__?(area|length)|shape|created_(user|date)|last_edited_(user|date)|creationdate|creator|editdate|editor)$/i;
const TYPE: Record<string, string> = { text: "Text", textarea: "TextArea", number: "Number", integer: "Number", date: "Date",
	datetime: "DateTime", single: "SingleChoice", dropdown: "Dropdown", multi: "MultiChoice", email: "Email", image: "Image",
	note: "Note", geopoint: "GeoPoint" };

/** Web Mercator x/y -> lon/lat. */
function lonLat(x: number, y: number): [number, number] {
	const r = 6378137;
	return [(x / r) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / r)) - Math.PI / 2) * (180 / Math.PI)];
}

/** "1. How many trees?" -> "how_many_trees", unique, at most 31 characters (like the designer's names). */
export function questionName(label: string, used: Set<string>): string {
	let name = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 31) || "question";
	if (/^\d/.test(name)) name = `_${name}`.slice(0, 31);
	let out = name;
	for (let i = 2; used.has(out); i++) out = `${name.slice(0, 28)}_${i}`;
	used.add(out);
	return out;
}

export function question(spec: QuestionSpec, n: number, used: Set<string>, extent: any) {
	const t = TYPE[spec.type];
	if (!t) throw new ArcGISError(`Unknown question type '${spec.type}'. Types: ${QUESTION_TYPES.join(", ")}`, "bad_argument");
	const label = String(spec.label ?? "").trim();
	if (!label) throw new ArcGISError("Every question needs a label.", "bad_argument");
	const name = spec.type === "geopoint" ? "location" : questionName(label, used);
	const q: Record<string, unknown> = { isNameModified: false, id: `field_${n}`, name, type: `esriQuestionType${t}`,
		isRequired: Boolean(spec.required), label, description: null };
	if (spec.type !== "note" && spec.type !== "geopoint") q.fieldName = name;
	const choices = () => {
		const items = (spec.choices ?? []).map((c) => (typeof c === "string" ? { value: c, label: c } : c))
			.map((c) => ({ isNameModified: false, value: String(c.value), label: String(c.label ?? c.value) }));
		if (!items.length) throw new ArcGISError(`'${label}' (${spec.type}) needs choices.`, "bad_argument");
		return { items, other: { isNameModified: false, isEnabled: false, value: "other", name: `${name}_other`, fieldName: `${name}_other`, label: "Other" } };
	};
	if (["text", "textarea", "email", "single", "dropdown", "multi"].includes(spec.type)) q.fieldType = "esriFieldTypeString";
	if (spec.type === "text") q.appearance = {};
	if (spec.type === "number" || spec.type === "integer") {
		Object.assign(q, { fieldType: "esriFieldTypeDouble", validation: { isInteger: spec.type === "integer" } });
	}
	if (spec.type === "date" || spec.type === "datetime") Object.assign(q, { fieldType: "esriFieldTypeDate", appearance: { layout: ["day-month-year"] } });
	if (spec.type === "single" || spec.type === "multi") Object.assign(q, { appearance: { layout: ["vertical"] }, choicesOrder: { type: "default" }, choices: choices() });
	if (spec.type === "dropdown") {
		Object.assign(q, { appearance: { layout: ["minimal"] }, choicesOrder: { type: "default" }, selectionMode: "single", choices: choices() });
	}
	if (spec.type === "image") {
		Object.assign(q, { fieldType: "esriAttachment", appearance: {}, inputTools: ["browse", "camera"],
			validation: { allowFileType: { type: "image", exts: ["*"] }, allowFileSize: { min: 0, max: 100 } } });
	}
	if (spec.type === "geopoint") {
		const sr = { wkid: 102100 };
		const cx = (extent.xmin + extent.xmax) / 2;
		const cy = (extent.ymin + extent.ymax) / 2;
		const [lon, lat] = lonLat(cx, cy);
		const span = Math.max(extent.xmax - extent.xmin, 1);
		Object.assign(q, { fieldType: "esriFieldTypeGeometry", defaultValue: { spatialReference: sr, x: cx, y: cy },
			defaultExtent: { spatialReference: sr, xmin: extent.xmin, ymin: extent.ymin, xmax: extent.xmax, ymax: extent.ymax,
				centerLatitude: Number(lat.toFixed(6)), centerLongitude: Number(lon.toFixed(6)),
				zoomLevel: Math.max(1, Math.min(19, Math.round(Math.log2(40075016 / span)))) },
			deviceLocation: { trigger: "locateButton" }, maps: [], search: { sources: [] }, snapping: { isEnabled: false, modes: [] },
			inputTools: ["pin", "search", "locate"], mapTools: ["zoom", "home"], displayFormats: ["DD", "DMS", "UTM", "MGRS"], hasZ: false });
	}
	return q;
}

/** Questions that mirror a layer's fields: coded values become a dropdown, dates a date, numbers a number. */
export function questionsFromFields(info: any): QuestionSpec[] {
	const out: QuestionSpec[] = info.geometryType === "esriGeometryPoint" ? [{ type: "geopoint", label: "Location" }] : [];
	for (const f of info.fields ?? []) {
		if (SKIP.test(f.name) || ["esriFieldTypeOID", "esriFieldTypeGlobalID", "esriFieldTypeGeometry", "esriFieldTypeBlob"].includes(f.type)) continue;
		const label = f.alias || f.name;
		const required = f.nullable === false;
		if (f.domain?.codedValues) {
			out.push({ type: "dropdown", label, required, choices: f.domain.codedValues.map((c: any) => ({ value: String(c.code), label: String(c.name) })) });
		} else if (f.type === "esriFieldTypeDate" || f.type === "esriFieldTypeDateOnly") out.push({ type: "date", label, required });
		else if (["esriFieldTypeInteger", "esriFieldTypeSmallInteger", "esriFieldTypeBigInteger"].includes(f.type)) out.push({ type: "integer", label, required });
		else if (["esriFieldTypeDouble", "esriFieldTypeSingle"].includes(f.type)) out.push({ type: "number", label, required });
		else if (f.type === "esriFieldTypeString") out.push({ type: (f.length ?? 0) > 255 ? "textarea" : "text", label, required });
	}
	return out;
}

export const DEFAULT_QUESTIONS: QuestionSpec[] = [
	{ type: "geopoint", label: "Location" }, { type: "text", label: "Name", required: true },
	{ type: "date", label: "Date" }, { type: "textarea", label: "Notes" }, { type: "image", label: "Photo" },
];

export function draftForm(title: string, summary: string, portalUrl: string, specs: QuestionSpec[], extent: any) {
	if (specs.filter((s) => s.type === "geopoint").length > 1) throw new ArcGISError("A survey has one location question.", "bad_argument");
	const used = new Set<string>(["location"]);
	const ordered = [...specs.filter((s) => s.type === "geopoint"), ...specs.filter((s) => s.type !== "geopoint")];
	return {
		layerName: "survey", portalUrl, version: "3.26",
		questions: ordered.map((s, i) => question(s, i + 1, used, extent)),
		themes: [{ id: "default", name: "theme-color1", isEnabled: true, header: { backgroundColor: "#007ac2", textColor: "#ffffff" },
			form: { backgroundColor: "#ffffff", backgroundOpacity: 1, textColor: "#323232", primaryColor: "#007ac2", primaryTextColor: "#ffffff",
				inputTextColor: "#323232", inputBackgroundColor: "#ffffff" }, webpage: { backgroundColor: "#eef3f6" } }],
		locales: [{ code: "en-us", label: "English-US", isDefault: true }],
		settings: { valueUpdateTrigger: "onInput",
			thankYouScreenContent: '<p style="text-align:center;"><strong style="font-size:16px;">Thank you. Your response was submitted.</strong></p>',
			openStatusInfo: { status: "open", schedule: { start: null, end: null },
				closedStatusContent: '<p style="text-align:center;"><strong style="font-size:16px;">This survey is currently closed.</strong></p>' },
			recordStartEndTime: { isEnabled: false, fieldInfos: [] }, notificationsInfo: { webhooks: [] }, isVersionLocked: true,
			multiSubmissionInfo: { autoReload: -1, maxAllowed: 0, showSubmitAnotherTip: false, redirectUrl: "" }, draftInfo: { isEnabled: false },
			captcha: { isEnabled: false, content: "Please enter the characters (not case-sensitive) you see below to submit the survey." } },
		submit: { buttonText: "Submit" },
		header: { isVisible: true, content: `<p>${esc(title)}</p>` },
		subHeader: { isVisible: Boolean(summary), content: summary ? `<p>${esc(summary)}</p>` : "" },
		footer: { isVisible: true, content: '<p style="text-align:center;">Powered by ArcGIS Survey123</p>' },
	};
}

export async function createSurvey(ctx: Ctx, args: AppArgs) {
	if (!args.title) throw new ArcGISError("title is required.", "bad_argument");
	const self = await portalSelf(ctx);
	let specs: QuestionSpec[] = (args.questions as QuestionSpec[] | undefined) ?? [];
	let extent = self.defaultExtent?.xmin !== undefined && self.defaultExtent?.spatialReference?.wkid === 102100 ? self.defaultExtent
		: { xmin: -20037508, ymin: -15000000, xmax: 20037508, ymax: 15000000 };
	let from = specs.length ? "your questions" : "the default questions";
	if (args.target) {
		const url = await resolveLayerUrl(ctx, requireId(args.target), args.layer ?? 0);
		const info = await ctx.request(url);
		if (!specs.length) { specs = questionsFromFields(info); from = `the fields of ${info.name}`; }
		const e = info.extent;
		if (e?.spatialReference?.wkid === 102100 || e?.spatialReference?.latestWkid === 3857) extent = e;
	}
	if (!specs.length) specs = DEFAULT_QUESTIONS;
	if (specs.length > 60) throw new ArcGISError("Up to 60 questions per survey.", "bad_argument");
	const form = draftForm(args.title, args.summary ?? "", ctx.props.portal.replace(/\/+$/, ""), specs, extent);
	const { id, folderId } = await addItem(ctx, args.folder, { type: "Form", title: args.title,
		typeKeywords: "Form,Survey123,Survey123 Hub,Draft", tags: (args.tags ?? ["arcgis-web-mcp", "Survey123"]).join(","),
		snippet: args.summary ?? "", properties: { versionInfo: { created: { build: SURVEY123_BUILD, timestamp: Date.now(), env: "prod" } } } });
	const made = [id];
	return orRemove(ctx, made, async () => {
		// the draft's own empty service, as the web designer makes it: survey123_<form id>, the form id in its keywords
		const svc = await ctx.request(`${userPath(ctx)}${folderId ? `/${folderId}` : ""}/createService`, {
			createParameters: serviceParams(`survey123_${id}`, id), outputType: "featureService" });
		if (!svc.itemId) throw new ArcGISError("ArcGIS did not create the survey's feature service.", "arcgis_error");
		made.push(svc.itemId);
		await updateItem(ctx, svc.itemId, { title: args.title,
			typeKeywords: `Survey123,Survey123 Hub,OwnerView,Source,${id}${self.isPortal ? ",providerSDS" : ""}` });
		await addRelationship(ctx, id, svc.itemId, "Survey2Service");
		await addResource(ctx, id, "surveyDraft/form.json", JSON.stringify(form));
		const item = await ctx.request(`${base(ctx)}/content/items/${id}`);
		const portal = self.isPortal ? `?portalUrl=${encodeURIComponent(ctx.props.portal)}` : "";
		return { app: itemCard(item, ctx.props.portal), service: { id: svc.itemId, url: svc.serviceurl ?? null },
			design: `https://survey123.arcgis.com/surveys/${id}/design${portal}`,
			questions: form.questions.map((q: any) => `${q.label} (${String(q.type).replace("esriQuestionType", "")})`), from,
			next: "Open it in the Survey123 web designer and click Publish: that adds the survey's layer, then share the survey." };
	});
}

/** The Survey123 website build that made the real drafts this format was read from (2026-10). */
export const SURVEY123_BUILD = "3.26.320";

/** The draft service's create parameters (those of the ArcGIS API for Python, and of real drafts' services). */
export function serviceParams(name: string, formId: string) {
	const sr = { wkid: 4326, latestWkid: 4326 };
	return { name, serviceDescription: `Feature Service for survey ${formId}`, hasStaticData: false, sourceSchemaChangesAllowed: true,
		capabilities: "Create,Delete,Query,Update,Editing,Extract,Sync", description: "", copyrightText: "", spatialReference: sr,
		fullExtent: { xmin: -180, ymin: -90, xmax: 180, ymax: 90, spatialReference: sr }, allowGeometryUpdates: true,
		units: "esriDecimalDegrees", supportsApplyEditsWithGlobalIds: true,
		editorTrackingInfo: { enableEditorTracking: true, enableOwnershipAccessControl: true, allowOthersToUpdate: true,
			allowOthersToDelete: true, allowOthersToQuery: true, allowAnonymousToUpdate: false, allowAnonymousToDelete: false } };
}
