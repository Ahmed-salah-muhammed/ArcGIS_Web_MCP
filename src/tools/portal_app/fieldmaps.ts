/**
 * Field Maps: a web map made ready for field work. Field Maps reads its forms from the web map, so each editable
 * layer gets a formInfo built from its fields, shaped like forms saved by Field Maps Designer / Map Viewer (read from
 * a real map): field elements with an input type, "expr/system/true" expressions for editable/required, and the
 * system true/false expressionInfos. Existing forms are kept unless options.overwrite_forms is true. The link that
 * opens the map in the app follows the ArcGIS API for Python's build_field_maps_url.
 * `form` shapes the form like Field Maps Designer does (also read from a real map): groups (collapsed or expanded),
 * hints (description), required and read-only fields, fields shown only when other fields meet a condition (an Arcade
 * visibilityExpression, from the same conditions as dashboard filters) and a photo element for layers with
 * attachments (formInfo.supportsAttachmentElements).
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { orgHome, portalSelf, requireItemOfType, updateItem } from "../shared/items";
import { base } from "../shared/lookup";
import { arcadeTest, type Condition } from "./filters";
import type { AppArgs, FormSpec } from "./types";

const SKIP = /^(objectid|fid|globalid|shape__?(area|length)|shape|created_(user|date)|last_edited_(user|date)|creationdate|creator|editdate|editor)$/i;
const SYSTEM_EXPRESSIONS = [
	{ expression: "false", name: "expr/system/false", returnType: "boolean", title: "False" },
	{ expression: "true", name: "expr/system/true", returnType: "boolean", title: "True" },
];

export function inputFor(f: any) {
	if (f.domain?.codedValues) return { type: "combo-box", noValueOptionLabel: "No value", showNoValueOption: f.nullable !== false };
	if (f.type === "esriFieldTypeDate") return { type: "datetime-picker", includeTime: true };
	if (f.type === "esriFieldTypeDateOnly") return { type: "datetime-picker", includeTime: false };
	if (f.type === "esriFieldTypeString") {
		return { type: (f.length ?? 0) > 255 ? "text-area" : "text-box", maxLength: f.length ?? 255, minLength: 0 };
	}
	return { type: "text-box" };
}

const lower = (names: string[] | undefined) => new Set((names ?? []).map((n) => n.toLowerCase()));
const pick = <T>(byField: Record<string, T> | undefined, name: string) =>
	Object.entries(byField ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

/**
 * A form for a layer from its fields: all editable fields, or `only` in that order, shaped by `spec`: groups, hints,
 * required / read-only fields, show_when conditions, a photo element. Returns the form and the spec's field names it
 * found in this layer.
 */
export function formFor(title: string, info: any, only?: string[], spec: FormSpec = {}) {
	const editable = (info.fields ?? []).filter((f: any) => f.editable !== false && !SKIP.test(f.name)
		&& !["esriFieldTypeOID", "esriFieldTypeGlobalID", "esriFieldTypeGeometry", "esriFieldTypeBlob", "esriFieldTypeRaster"].includes(f.type));
	const chosen = only?.length
		? only.map((n) => editable.find((f: any) => f.name.toLowerCase() === n.toLowerCase())).filter(Boolean)
		: editable;
	const required = lower(spec.required);
	const readOnly = lower(spec.read_only);
	const expressionInfos: any[] = [...SYSTEM_EXPRESSIONS];
	const used = new Set<string>();
	const visibility = (name: string) => {
		const when = pick(spec.show_when, name);
		if (!when) return {};
		used.add(name.toLowerCase());
		const tests = Object.entries(when as Record<string, Condition>).map(([other, c]) => arcadeTest(info, other, c, "$feature"));
		if (!tests.length) return {};
		const id = `expr/show-${expressionInfos.length - 1}`;
		expressionInfos.push({ expression: tests.join(" && "), name: id, returnType: "boolean", title: `Show ${name}` });
		return { visibilityExpression: id };
	};
	const element = (f: any) => {
		const hint = pick(spec.hints, f.name);
		for (const set of [required, readOnly]) if (set.has(f.name.toLowerCase())) used.add(f.name.toLowerCase());
		if (hint !== undefined) used.add(f.name.toLowerCase());
		const locked = readOnly.has(f.name.toLowerCase());
		return { type: "field", label: f.alias || f.name, ...(hint ? { description: String(hint) } : {}), fieldName: f.name,
			editableExpression: locked ? "expr/system/false" : "expr/system/true", inputType: inputFor(f),
			...(!locked && (f.nullable === false || required.has(f.name.toLowerCase())) ? { requiredExpression: "expr/system/true" } : {}),
			...visibility(f.name) };
	};
	const grouped = new Map<string, number>();
	(spec.groups ?? []).forEach((g, i) => g.fields.forEach((n) => grouped.set(n.toLowerCase(), i)));
	const formElements: any[] = [];
	const groups = new Map<number, any>();
	for (const f of chosen) {
		const gi = grouped.get(f.name.toLowerCase());
		if (gi === undefined) { formElements.push(element(f)); continue; }
		used.add(f.name.toLowerCase());
		let group = groups.get(gi);
		if (!group) {
			const g = spec.groups![gi];
			group = { type: "group", label: g.label, initialState: g.collapsed ? "collapsed" : "expanded", formElements: [] };
			groups.set(gi, group);
			formElements.push(group);
		}
		group.formElements.push(element(f));
	}
	const photos = spec.photos && info.hasAttachments;
	if (photos) {
		formElements.push({ type: "attachment", label: typeof spec.photos === "string" ? spec.photos : "Photos", attachmentKeyword: "photos",
			allowUserRename: true, displayFilename: false, editableExpression: "expr/system/true",
			inputType: { type: "image", inputMethod: "any", maxImageSize: 1280 }, useOriginalFilename: true });
	}
	return { form: { title, expressionInfos, formElements, ...(photos ? { supportsAttachmentElements: true } : {}) }, used,
		photos: Boolean(photos) };
}

/** Every field name the form spec mentions. */
export function formSpecFields(spec: FormSpec | undefined): string[] {
	if (!spec) return [];
	return [...(spec.groups ?? []).flatMap((g) => g.fields), ...Object.keys(spec.hints ?? {}), ...(spec.required ?? []),
		...(spec.read_only ?? []), ...Object.keys(spec.show_when ?? {})];
}

export function fieldMapsLink(portal: string, mapId: string): string {
	return `https://fieldmaps.arcgis.app/?portalURL=${encodeURIComponent(portal)}&referenceContext=open&itemID=${mapId}`;
}

export async function prepareFieldMaps(ctx: Ctx, args: AppArgs) {
	const map = await requireItemOfType(ctx, args.webmap_id, ["Web Map"], "webmap_id (the map to use in Field Maps)");
	if (map.owner !== ctx.props.username) throw new ArcGISError(`Only the map's owner (${map.owner}) can save forms in it.`, "forbidden");
	const data = await ctx.request(`${base(ctx)}/content/items/${map.id}/data`);
	const overwrite = args.options?.overwrite_forms === true;
	const report: any[] = [];
	const found = new Set<string>();
	let sync = true;
	for (const op of data.operationalLayers ?? []) {
		if (!op.url || !/\/FeatureServer\/\d+$/i.test(op.url)) continue;
		if (args.layer !== undefined && ![op.title, op.id].map((v) => String(v).toLowerCase()).includes(String(args.layer).toLowerCase())) continue;
		const info = await ctx.request(op.url);
		const caps = String(info.capabilities ?? "");
		sync &&= /sync/i.test(caps);
		if (!/create|update|editing/i.test(caps)) { report.push({ layer: op.title, form: "skipped: the layer is not editable" }); continue; }
		if (op.formInfo && !overwrite) { report.push({ layer: op.title, form: "kept (it already has one)" }); continue; }
		const made = formFor(op.title, info, args.fields, args.form);
		for (const n of made.used) found.add(n);
		op.formInfo = made.form;
		const names = (els: any[]): string[] => els.flatMap((e) => (e.type === "group" ? names(e.formElements) : e.fieldName ? [e.fieldName] : []));
		report.push({ layer: op.title, form: "created", fields: names(made.form.formElements),
			...(made.form.formElements.some((e: any) => e.type === "group") ? { groups: made.form.formElements.filter((e: any) => e.type === "group").map((e: any) => e.label) } : {}),
			...(made.photos ? { photos: true } : args.form?.photos ? { photos: "no: the layer has no attachments" } : {}) });
	}
	if (!report.length) throw new ArcGISError("The map has no feature layers to collect into.", "bad_argument");
	const missing = [...new Set(formSpecFields(args.form))].filter((n) => !found.has(n.toLowerCase()));
	if (missing.length && report.some((r) => r.form === "created")) {
		throw new ArcGISError(`form: no editable field ${missing.map((n) => `'${n}'`).join(", ")} in the forms made (check fields and layer).`, "bad_argument");
	}
	const keywords: string[] = [...(map.typeKeywords ?? [])];
	const notes: string[] = [];
	if (args.options?.offline === true) {
		if (sync && !keywords.includes("Offline")) keywords.push("Offline");
		if (!sync) notes.push("Offline was not turned on: every layer must have Sync enabled (portal_layer_schema capabilities).");
	}
	await updateItem(ctx, map.id, { text: JSON.stringify(data), typeKeywords: keywords.join(",") }, map.owner);
	const self = await portalSelf(ctx);
	const item = await ctx.request(`${base(ctx)}/content/items/${map.id}`);
	return { map: itemCard(item, ctx.props.portal), layers: report, open_in_field_maps: fieldMapsLink(orgHome(self, ctx.props.portal), map.id),
		designer: `${orgHome(self, ctx.props.portal)}/apps/fieldmaps/`, offline: keywords.includes("Offline"), ...(notes.length ? { notes } : {}) };
}
