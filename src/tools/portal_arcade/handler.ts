/**
 * portal_arcade: Arcade where ArcGIS runs it. templates (ready-made, placeholders filled from `values`), check (static,
 * against the layer's real fields), and saving into a web map: popup (expressionInfos + a popup field, the
 * web map spec's way), label (labelingInfo on the map's layer) and form (Field Maps: a named expression the field
 * element points at, as Field Maps Designer saves it). Nothing is saved when the check finds errors.
 */
import { ArcGISError } from "../../arcgis";
import { formFor } from "../portal_app/fieldmaps";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { requireItemOfType, updateItem } from "../shared/items";
import { labelClass } from "../shared/labels";
import { base, resolveLayerUrl } from "../shared/lookup";
import { audit } from "../shared/safety";
import { checkArcade } from "./check";
import { type ArcadeContext, CONTEXTS, fillTemplate, TEMPLATES } from "./library";

export const FORM_ROLES = { calculated: "valueExpression", visible: "visibilityExpression", required: "requiredExpression",
	editable: "editableExpression" } as const;

export type ArcadeArgs = {
	action?: "templates" | "check" | "popup" | "label" | "form";
	context?: ArcadeContext;
	expression?: string;
	values?: Record<string, string>;
	webmap_id?: string;
	target?: string;
	layer?: string | number;
	title?: string;
	field?: string;
	role?: keyof typeof FORM_ROLES;
	return_type?: "string" | "number" | "boolean" | "date";
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "expr";

function mapLayer(ops: any[], ref: string | number | undefined) {
	const feature = ops.filter((o) => o.url && /\/(FeatureServer|MapServer)\/\d+$/i.test(o.url));
	if (ref === undefined) {
		if (feature.length === 1) return feature[0];
		throw new ArcGISError(`layer is required: ${feature.map((o) => o.title).join(", ")}`, "bad_argument");
	}
	const key = String(ref).toLowerCase();
	const hit = /^\d+$/.test(key) ? feature[Number(key)] : feature.find((o) => [o.title, o.id].map((v) => String(v).toLowerCase()).includes(key));
	if (!hit) throw new ArcGISError(`No layer '${ref}' in the map: ${feature.map((o) => o.title).join(", ")}`, "not_found");
	return hit;
}

function requireValid(expression: string | undefined, context: ArcadeContext, fields: string[]) {
	if (!expression) throw new ArcGISError("expression is required.", "bad_argument");
	const check = checkArcade(expression, context, fields);
	if (!check.valid) {
		const err = new ArcGISError(`The expression has errors, so nothing was saved: ${check.errors.join(" ")}`, "arcade_invalid");
		(err as any).check = check;
		throw err;
	}
	return check;
}

export async function arcade(ctx: Ctx, args: ArcadeArgs) {
	const action = args.action ?? "check";
	if (action === "templates") {
		const list = TEMPLATES.filter((t) => !args.context || t.context === args.context);
		return { templates: list.map((t) => ({ ...t, expression: fillTemplate(t.expression, args.values) })),
			placeholders: "Fill {FIELD}-style placeholders with values, e.g. {\"FIELD\": \"POP_2020\"}." };
	}
	if (action === "check") {
		const context = args.context ?? "popup";
		if (!CONTEXTS.includes(context)) throw new ArcGISError(`context must be ${CONTEXTS.join(" | ")}.`, "bad_argument");
		let fields: string[] | undefined;
		if (args.target) fields = ((await ctx.request(await resolveLayerUrl(ctx, args.target, args.layer ?? 0))).fields ?? []).map((f: any) => f.name);
		else if (args.webmap_id) {
			const data = await ctx.request(`${base(ctx)}/content/items/${(await requireItemOfType(ctx, args.webmap_id, ["Web Map"], "webmap_id")).id}/data`);
			fields = ((await ctx.request(mapLayer(data.operationalLayers ?? [], args.layer).url)).fields ?? []).map((f: any) => f.name);
		}
		return { context, ...checkArcade(String(args.expression ?? ""), context, fields), fields_checked: Boolean(fields) };
	}
	if (!["popup", "label", "form"].includes(action)) throw new ArcGISError("action must be templates | check | popup | label | form.", "bad_action");

	const map = await requireItemOfType(ctx, args.webmap_id, ["Web Map"], "webmap_id");
	if (map.owner !== ctx.props.username) throw new ArcGISError(`Only the map's owner (${map.owner}) can change it.`, "forbidden");
	const data = await ctx.request(`${base(ctx)}/content/items/${map.id}/data`);
	const op = mapLayer(data.operationalLayers ?? [], args.layer);
	const info = await ctx.request(op.url);
	const fields: string[] = (info.fields ?? []).map((f: any) => f.name);
	let result: Record<string, unknown>;

	if (action === "popup") {
		const check = requireValid(args.expression, "popup", fields);
		const title = args.title ?? "Expression";
		const popup = (op.popupInfo ??= { title: `{${info.displayField ?? fields[0]}}`, fieldInfos: [], popupElements: [{ type: "fields" }] });
		popup.expressionInfos ??= [];
		let name = slug(title);
		while (popup.expressionInfos.some((e: any) => e.name === name)) name = `${name}_2`;
		popup.expressionInfos.push({ name, title, expression: args.expression, returnType: args.return_type ?? "string" });
		(popup.fieldInfos ??= []).push({ fieldName: `expression/${name}`, label: title, visible: true });
		delete op.disablePopup;
		result = { layer: op.title, popup_field: `expression/${name}`, warnings: check.warnings };
	} else if (action === "label") {
		const check = requireValid(args.expression, "label", fields);
		op.layerDefinition ??= {};
		op.layerDefinition.drawingInfo = { ...(op.layerDefinition.drawingInfo ?? {}), labelingInfo: [labelClass(info.geometryType, String(args.expression))] };
		op.showLabels = true;
		result = { layer: op.title, labels: args.expression, warnings: check.warnings };
	} else {
		const role = args.role ?? "calculated";
		if (!(role in FORM_ROLES)) throw new ArcGISError(`role must be ${Object.keys(FORM_ROLES).join(" | ")}.`, "bad_argument");
		if (!args.field) throw new ArcGISError("field (the form field the expression is for) is required.", "bad_argument");
		const check = requireValid(args.expression, "form", fields);
		op.formInfo ??= formFor(op.title, info);
		const element = (op.formInfo.formElements ?? []).flatMap((e: any) => (e.type === "group" ? e.formElements ?? [] : [e]))
			.find((e: any) => e.fieldName?.toLowerCase() === args.field!.toLowerCase());
		if (!element) throw new ArcGISError(`The form has no field '${args.field}'.`, "not_found");
		const infos = (op.formInfo.expressionInfos ??= []);
		let name = `expr/${slug(`${role}_${element.fieldName}`)}`;
		while (infos.some((e: any) => e.name === name)) name = `${name}_2`;
		infos.push({ name, title: args.title ?? `${role} ${element.fieldName}`, expression: args.expression,
			returnType: role === "calculated" ? (args.return_type ?? "string") : "boolean" });
		element[FORM_ROLES[role]] = name;
		if (role === "calculated") {
			if (!infos.some((e: any) => e.name === "expr/system/false")) infos.push({ expression: "false", name: "expr/system/false", returnType: "boolean", title: "False" });
			element.editableExpression = "expr/system/false";
		}
		result = { layer: op.title, field: element.fieldName, role, expression_name: name, warnings: check.warnings };
	}
	await updateItem(ctx, map.id, { text: JSON.stringify(data) }, map.owner);
	audit(ctx.props, { tool: "portal_arcade", action, target: map.id, ok: true });
	return { map: itemCard(map, ctx.props.portal), ...result };
}
