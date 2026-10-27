/**
 * portal_layer_schema: shape a HOSTED layer through its admin URL: add_field / delete_field (addToDefinition,
 * deleteFromDefinition), capabilities, renderer and labels (updateDefinition replaces drawingInfo as a whole, so
 * both are merged into the current one), and filtered read-only views (createService isView -> addToDefinition
 * -> viewDefinitionQuery + field visibility).
 */
import { adminUrl, ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { base, isHosted, resolveLayerUrl, serviceOf } from "../shared/lookup";
import { buildRenderer } from "../shared/renderer";
import { audit, requireConfirm } from "../shared/safety";

export const FIELD_TYPES: Record<string, string> = {
	TEXT: "esriFieldTypeString", STRING: "esriFieldTypeString", SHORT: "esriFieldTypeSmallInteger",
	SMALLINT: "esriFieldTypeSmallInteger", LONG: "esriFieldTypeInteger", INTEGER: "esriFieldTypeInteger",
	BIGINT: "esriFieldTypeBigInteger", DOUBLE: "esriFieldTypeDouble", FLOAT: "esriFieldTypeSingle",
	DATE: "esriFieldTypeDate", DATEONLY: "esriFieldTypeDateOnly", GUID: "esriFieldTypeGUID",
};

async function serviceInfo(ctx: Ctx, layerUrl: string) {
	return ctx.request(serviceOf(layerUrl));
}

export type SchemaArgs = {
	action: "add_field" | "delete_field" | "capabilities" | "renderer" | "labels" | "create_view";
	target: string;
	layer?: number | string;
	fields?: { name: string; type?: string; length?: number; alias?: string; nullable?: boolean }[];
	field_names?: string[];
	capabilities?: string;
	renderer?: Record<string, any>;
	label_field?: string;
	label_expression?: string;
	view_name?: string;
	view_where?: string;
	view_fields?: string[];
	confirm?: boolean;
};

export async function schema(ctx: Ctx, args: SchemaArgs) {
	const url = await resolveLayerUrl(ctx, args.target, args.layer ?? 0);
	const props = await ctx.request(url);
	const name = props.name;
	const svc = await serviceInfo(ctx, url);
	const refuseView = (what: string) => {
		if (svc.isView) throw new ArcGISError(`${what}: this is a VIEW - change the schema on its source layer.`, "is_view");
	};

	if (args.action === "add_field") {
		refuseView("add_field");
		if (!args.fields?.length) {
			throw new ArcGISError(`fields is required: [{"name":"STATUS","type":"TEXT","length":50}]. Types: ${Object.keys(FIELD_TYPES).join(", ")}.`,
				"bad_argument");
		}
		const have = new Set((props.fields ?? []).map((f: any) => String(f.name).toLowerCase()));
		const specs: Record<string, unknown>[] = [];
		const skipped: string[] = [];
		for (const f of args.fields) {
			if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(f.name ?? "")) {
				throw new ArcGISError(`Bad field name '${f.name}' (letters, digits, underscore; start with a letter).`, "bad_argument");
			}
			if (have.has(f.name.toLowerCase())) {
				skipped.push(f.name);
				continue;
			}
			const type = FIELD_TYPES[String(f.type ?? "TEXT").toUpperCase()] ?? f.type;
			const spec: Record<string, unknown> = { name: f.name, type, alias: f.alias ?? f.name, nullable: f.nullable ?? true,
				editable: true };
			if (type === "esriFieldTypeString") spec.length = f.length ?? 256;
			specs.push(spec);
		}
		if (specs.length) await ctx.request(`${adminUrl(url)}/addToDefinition`, { addToDefinition: { fields: specs } });
		const now = new Set(((await ctx.request(url)).fields ?? []).map((f: any) => String(f.name).toLowerCase()));
		const notAdded = specs.map((s) => String(s.name)).filter((n) => !now.has(n.toLowerCase()));
		audit(ctx.props, { tool: "portal_layer_schema", action: "add_field", target: url, ok: !notAdded.length });
		return { layer: name, added: specs.map((s) => s.name).filter((n) => !notAdded.includes(String(n))),
			already_existed: skipped.length ? skipped : null, not_added: notAdded.length ? notAdded : null };
	}

	if (args.action === "delete_field") {
		refuseView("delete_field");
		if (!args.field_names?.length) throw new ArcGISError("field_names is required.", "bad_argument");
		requireConfirm(args.confirm, `Deleting field(s) ${args.field_names.join(", ")} from '${name}' (their data is lost)`,
			{ layer: name, fields: args.field_names });
		await ctx.request(`${adminUrl(url)}/deleteFromDefinition`,
			{ deleteFromDefinition: { fields: args.field_names.map((n) => ({ name: n })) } });
		const now = new Set(((await ctx.request(url)).fields ?? []).map((f: any) => String(f.name).toLowerCase()));
		const still = args.field_names.filter((n) => now.has(n.toLowerCase()));
		audit(ctx.props, { tool: "portal_layer_schema", action: "delete_field", target: url, ok: !still.length });
		return { layer: name, deleted: args.field_names.filter((n) => !still.includes(n)), still_there: still.length ? still : null };
	}

	if (args.action === "capabilities") {
		if (!args.capabilities) {
			throw new ArcGISError('capabilities is required, e.g. "Query,Create,Update,Delete,Editing,Sync,Extract".', "bad_argument");
		}
		const before = svc.capabilities;
		await ctx.request(`${adminUrl(serviceOf(url))}/updateDefinition`, { updateDefinition: { capabilities: args.capabilities } });
		const after = (await serviceInfo(ctx, url)).capabilities;
		audit(ctx.props, { tool: "portal_layer_schema", action: "capabilities", target: url, ok: true, details: { before, after } });
		return { service: serviceOf(url), before, after };
	}

	if (args.action === "renderer" || args.action === "labels") {
		const drawing = { ...(props.drawingInfo ?? {}) }; // updateDefinition replaces drawingInfo as a whole: merge
		if (args.action === "renderer") {
			if (!args.renderer) {
				throw new ArcGISError('renderer is required: Esri JSON, or {"type":"unique","field":"X"} / '
					+ '{"type":"class_breaks","field":"POP","classes":5} / {"type":"simple","color":[0,112,255]}.', "bad_argument");
			}
			drawing.renderer = await buildRenderer(ctx, url, props.geometryType, args.renderer);
		} else {
			if (!args.label_field && !args.label_expression) {
				throw new ArcGISError("label_field or label_expression (Arcade) is required.", "bad_argument");
			}
			drawing.labelingInfo = [{
				labelExpressionInfo: { expression: args.label_expression ?? `$feature.${args.label_field}` },
				symbol: { type: "esriTS", color: [0, 0, 0, 255], haloColor: [255, 255, 255, 255], haloSize: 1,
					font: { size: 10, family: "Arial" } },
				labelPlacement: props.geometryType === "esriGeometryPolyline" ? "esriServerLinePlacementAboveAlong"
					: props.geometryType === "esriGeometryPolygon" ? "esriServerPolygonPlacementAlwaysHorizontal"
						: "esriServerPointLabelPlacementAboveRight",
			}];
			drawing.showLabels = true;
		}
		await ctx.request(`${adminUrl(url)}/updateDefinition`, { updateDefinition: { drawingInfo: drawing } });
		audit(ctx.props, { tool: "portal_layer_schema", action: args.action, target: url, ok: true });
		return args.action === "renderer"
			? { layer: name, renderer_type: (drawing.renderer as any).type,
				classes: ((drawing.renderer as any).uniqueValueInfos ?? (drawing.renderer as any).classBreakInfos ?? []).length || null }
			: { layer: name, labels: (drawing.labelingInfo as any)[0].labelExpressionInfo.expression };
	}

	if (args.action === "create_view") {
		if (!isHosted(url)) throw new ArcGISError("create_view works only on HOSTED feature services.", "not_hosted");
		if (!args.view_name) throw new ArcGISError("view_name is required.", "bad_argument");
		const viewName = args.view_name.replace(/[^A-Za-z0-9_]/g, "_");
		const sourceService = serviceOf(url).split("/").slice(-2, -1)[0];
		const layerId = Number(url.split("/").pop());
		const created = await ctx.request(`${base(ctx)}/content/users/${encodeURIComponent(ctx.props.username)}/createService`, {
			createParameters: { name: viewName, isView: true, sourceSchemaChangesAllowed: true, isUpdatableView: false,
				spatialReference: props.extent?.spatialReference, initialExtent: props.extent, capabilities: "Query" },
			outputType: "featureService", isView: true,
		});
		if (!created.serviceurl || !created.itemId) {
			throw new ArcGISError(`createService did not return a view: ${JSON.stringify(created).slice(0, 200)}`, "view_failed");
		}
		try {
			const adminView = adminUrl(created.serviceurl);
			await ctx.request(`${adminView}/addToDefinition`, { addToDefinition: { layers: [{
				adminLayerInfo: { viewLayerDefinition: { sourceServiceName: sourceService, sourceLayerId: layerId,
					sourceLayerFields: "*" } }, name, id: 0 }] } });
			const update: Record<string, unknown> = {};
			if (args.view_where) update.viewDefinitionQuery = args.view_where;
			if (args.view_fields?.length) {
				const keep = new Set([...args.view_fields, props.objectIdField].filter(Boolean).map((f) => String(f).toLowerCase()));
				update.fields = (props.fields ?? []).map((f: any) => ({ name: f.name, visible: keep.has(String(f.name).toLowerCase()) }));
			}
			if (Object.keys(update).length) await ctx.request(`${adminView}/0/updateDefinition`, { updateDefinition: update });
		} catch (e) {
			throw new ArcGISError(`The view item ${created.itemId} was created but configuring it failed: `
				+ `${e instanceof Error ? e.message : String(e)}. Delete it with portal_item action=delete.`, "view_incomplete");
		}
		const count = (await ctx.request(`${created.serviceurl}/0/query`, { where: "1=1", returnCountOnly: true })).count ?? null;
		audit(ctx.props, { tool: "portal_layer_schema", action: "create_view", target: url, ok: true,
			details: { view: created.itemId } });
		return { view_item_id: created.itemId, view_url: `${created.serviceurl}/0`, where: args.view_where ?? null,
			fields: args.view_fields ?? null, view_count: count };
	}
	throw new ArcGISError("action must be add_field | delete_field | capabilities | renderer | labels | create_view.",
		"bad_action");
}
