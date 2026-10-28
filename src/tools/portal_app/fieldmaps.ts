/**
 * Field Maps: a web map made ready for field work. Field Maps reads its forms from the web map, so each editable
 * layer gets a formInfo built from its fields, shaped like forms saved by Field Maps Designer / Map Viewer (read from
 * a real map): field elements with an input type, "expr/system/true" expressions for editable/required, and the
 * system true/false expressionInfos. Existing forms are kept unless options.overwrite_forms is true. The link that
 * opens the map in the app follows the ArcGIS API for Python's build_field_maps_url.
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { orgHome, portalSelf, requireItemOfType, updateItem } from "../shared/items";
import { base } from "../shared/lookup";
import type { AppArgs } from "./types";

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

/** A form for a layer from its fields: all editable fields, or `only` in that order. */
export function formFor(title: string, info: any, only?: string[]) {
	const editable = (info.fields ?? []).filter((f: any) => f.editable !== false && !SKIP.test(f.name)
		&& !["esriFieldTypeOID", "esriFieldTypeGlobalID", "esriFieldTypeGeometry", "esriFieldTypeBlob", "esriFieldTypeRaster"].includes(f.type));
	const chosen = only?.length
		? only.map((n) => editable.find((f: any) => f.name.toLowerCase() === n.toLowerCase())).filter(Boolean)
		: editable;
	return { title, expressionInfos: SYSTEM_EXPRESSIONS, formElements: chosen.map((f: any) => ({
		type: "field", label: f.alias || f.name, fieldName: f.name, editableExpression: "expr/system/true", inputType: inputFor(f),
		...(f.nullable === false ? { requiredExpression: "expr/system/true" } : {}) })) };
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
	let sync = true;
	for (const op of data.operationalLayers ?? []) {
		if (!op.url || !/\/FeatureServer\/\d+$/i.test(op.url)) continue;
		if (args.layer !== undefined && ![op.title, op.id].map((v) => String(v).toLowerCase()).includes(String(args.layer).toLowerCase())) continue;
		const info = await ctx.request(op.url);
		const caps = String(info.capabilities ?? "");
		sync &&= /sync/i.test(caps);
		if (!/create|update|editing/i.test(caps)) { report.push({ layer: op.title, form: "skipped: the layer is not editable" }); continue; }
		if (op.formInfo && !overwrite) { report.push({ layer: op.title, form: "kept (it already has one)" }); continue; }
		op.formInfo = formFor(op.title, info, args.fields);
		report.push({ layer: op.title, form: "created", fields: op.formInfo.formElements.map((e: any) => e.fieldName) });
	}
	if (!report.length) throw new ArcGISError("The map has no feature layers to collect into.", "bad_argument");
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
