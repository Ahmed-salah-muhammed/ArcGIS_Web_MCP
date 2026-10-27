/**
 * Feature-layer writes over ArcGIS REST, ported from the ArcGIS Pro Salah MCP (portal/layers.py):
 * applyEdits (batched, every result checked), calculate, truncate, addToDefinition / deleteFromDefinition /
 * updateDefinition on the admin URL, renderers built from the data, labels, and filtered read-only views
 * (createService isView -> addToDefinition -> viewDefinitionQuery + field visibility).
 * All verified on ArcGIS Online with throwaway layers before being written here.
 */
import { adminUrl, ArcGISError, sharingUrl } from "./arcgis";
import { type Ctx, resolveLayerUrl } from "./portal";
import { audit, MAX_EDITS, requireConfirm } from "./safety";

export const FIELD_TYPES: Record<string, string> = {
	TEXT: "esriFieldTypeString", STRING: "esriFieldTypeString", SHORT: "esriFieldTypeSmallInteger",
	SMALLINT: "esriFieldTypeSmallInteger", LONG: "esriFieldTypeInteger", INTEGER: "esriFieldTypeInteger",
	BIGINT: "esriFieldTypeBigInteger", DOUBLE: "esriFieldTypeDouble", FLOAT: "esriFieldTypeSingle",
	DATE: "esriFieldTypeDate", DATEONLY: "esriFieldTypeDateOnly", GUID: "esriFieldTypeGUID",
};
const CATEGORICAL = [[31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40], [148, 103, 189], [140, 86, 75],
	[227, 119, 194], [127, 127, 127], [188, 189, 34], [23, 190, 207], [174, 199, 232], [255, 187, 120]];
const SEQUENTIAL = [[255, 255, 178], [254, 217, 118], [254, 178, 76], [253, 141, 60], [252, 78, 42], [227, 26, 28],
	[177, 0, 38]];
const MAX_BATCHES = 30; // the Workers free plan allows 50 subrequests per call

type Feature = { attributes?: Record<string, unknown>; geometry?: unknown };

function asFeatures(rows: unknown[] | undefined): Feature[] {
	return (rows ?? []).map((r: any) => (r && typeof r === "object" && ("attributes" in r || "geometry" in r) ? r : { attributes: r }));
}

function chunks<T>(list: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

function serviceOf(layerUrl: string): string {
	return layerUrl.replace(/\/\d+\/?$/, "");
}

async function serviceInfo(ctx: Ctx, layerUrl: string) {
	return ctx.request(serviceOf(layerUrl));
}

function isHosted(url: string): boolean {
	return /services\d*\.arcgis\.com/i.test(url) || /\/Hosted\//i.test(url);
}

// --- edit / calculate / truncate ------------------------------------------------------------------

export type EditArgs = {
	action?: "edit" | "calculate" | "truncate";
	target: string;
	layer?: number | string;
	adds?: unknown[];
	updates?: unknown[];
	deletes?: (number | string)[];
	where?: string;
	expressions?: Record<string, unknown>[] | Record<string, unknown>;
	use_global_ids?: boolean;
	rollback_on_failure?: boolean;
	batch_size?: number;
	dry_run?: boolean;
	confirm?: boolean;
};

export async function edit(ctx: Ctx, args: EditArgs) {
	const action = args.action ?? "edit";
	const url = await resolveLayerUrl(ctx, args.target, args.layer ?? 0);
	const props = await ctx.request(url);
	const name = props.name;

	if (action === "calculate") {
		const exprs = Array.isArray(args.expressions) ? args.expressions : args.expressions ? [args.expressions] : [];
		if (!args.where || !exprs.length) {
			throw new ArcGISError('where and expressions are required, e.g. expressions=[{"field":"STATUS","value":"Done"}] '
				+ 'or [{"field":"DENSITY","sqlExpression":"POP / AREA"}].', "bad_argument");
		}
		const affected = (await ctx.request(`${url}/query`, { where: args.where, returnCountOnly: true })).count ?? 0;
		const preview = { layer: name, where: args.where, rows_affected: affected, expressions: exprs };
		if (args.dry_run) return { dry_run: true, preview };
		requireConfirm(args.confirm, `Calculating ${exprs.length} field(s) on ${affected} row(s) of '${name}'`, preview);
		const res = await ctx.request(`${url}/calculate`, { where: args.where, calcExpression: exprs });
		audit(ctx.props, { tool: "portal_layer_edit", action, target: url, ok: Boolean(res.success), details: preview });
		return { layer: name, result: res, rows_affected: res.updatedFeatureCount ?? affected };
	}

	if (action === "truncate") {
		if (!isHosted(url)) throw new ArcGISError("truncate works only on HOSTED feature services.", "not_hosted");
		const before = (await ctx.request(`${url}/query`, { where: "1=1", returnCountOnly: true })).count ?? 0;
		requireConfirm(args.confirm, `TRUNCATE '${name}' (deletes all ${before} rows)`, { layer: name, rows: before },
			"Irreversible. Export the data first.");
		const res = await ctx.request(`${adminUrl(url)}/truncate`, { attachmentOnly: false, async: false });
		const after = (await ctx.request(`${url}/query`, { where: "1=1", returnCountOnly: true })).count ?? null;
		audit(ctx.props, { tool: "portal_layer_edit", action, target: url, ok: after === 0, details: { before, after } });
		return { layer: name, rows_before: before, rows_after: after, result: res };
	}

	if (action !== "edit") throw new ArcGISError("action must be edit | calculate | truncate.", "bad_action");
	const adds = asFeatures(args.adds);
	const updates = asFeatures(args.updates);
	const oid: string = props.objectIdField ?? "OBJECTID";
	const key = args.use_global_ids ? props.globalIdField : oid;
	if (args.use_global_ids && !key) throw new ArcGISError("This layer has no global id field.", "bad_argument");
	const missing = updates.map((f, i) => (f.attributes && key in f.attributes ? -1 : i)).filter((i) => i >= 0);
	if (missing.length) {
		throw new ArcGISError(`Every update needs its '${key}' attribute (rows ${missing.slice(0, 10).join(", ")} lack it).`,
			"bad_argument");
	}
	let deleteIds = (args.deletes ?? []).map(String);
	if (args.where && !deleteIds.length) {
		const res = await ctx.request(`${url}/query`, { where: args.where, returnIdsOnly: true });
		deleteIds = (res.objectIds ?? []).map(String);
	}
	const total = adds.length + updates.length + deleteIds.length;
	if (!total) {
		throw new ArcGISError("Nothing to edit: give adds, updates, deletes (ids) or where (deletes what matches).",
			"nothing_to_do");
	}
	if (total > MAX_EDITS) {
		throw new ArcGISError(`${total} edits exceed the ${MAX_EDITS}-edit limit per call; split the job.`, "too_many");
	}
	const size = Math.max(1, Math.min(Math.trunc(args.batch_size ?? 500), 2000));
	const batches = [...chunks(adds, size).map((c) => ["adds", c] as const),
		...chunks(updates, size).map((c) => ["updates", c] as const),
		...chunks(deleteIds, size).map((c) => ["deletes", c] as const)];
	if (batches.length > MAX_BATCHES) {
		throw new ArcGISError(`${batches.length} batches exceed ${MAX_BATCHES} per call; raise batch_size or split the job.`,
			"too_many");
	}
	const preview: Record<string, unknown> = { layer: name, adds: adds.length, updates: updates.length,
		deletes: deleteIds.length };
	if (updates.length && !args.use_global_ids) {
		const ids = updates.slice(0, 20).map((f) => f.attributes![key]);
		const cur = await ctx.request(`${url}/query`, { objectIds: ids.join(","), outFields: "*", returnGeometry: false });
		const byId = new Map((cur.features ?? []).map((f: any) => [String(f.attributes?.[oid]), f.attributes]));
		preview.update_diff = updates.slice(0, 20).map((f) => {
			const current = (byId.get(String(f.attributes![key])) ?? {}) as Record<string, unknown>;
			return { id: f.attributes![key], changes: Object.fromEntries(Object.entries(f.attributes!)
				.filter(([k]) => k !== key).map(([k, v]) => [k, { from: current[k] ?? null, to: v }])) };
		});
	}
	if (args.dry_run) return { dry_run: true, preview };
	if (deleteIds.length) requireConfirm(args.confirm, `Deleting ${deleteIds.length} feature(s) from '${name}'`, preview);

	const summary: Record<string, { succeeded: number; failed: number }> = {};
	const failures: unknown[] = [];
	for (const [kind, chunk] of batches) {
		const params: Record<string, unknown> = { useGlobalIds: Boolean(args.use_global_ids),
			rollbackOnFailure: args.rollback_on_failure ?? true };
		params[kind] = kind === "deletes" ? (chunk as string[]).join(",") : chunk;
		const res = await ctx.request(`${url}/applyEdits`, params);
		const results: any[] = res[`${kind.slice(0, -1)}Results`] ?? [];
		const s = (summary[kind] ??= { succeeded: 0, failed: 0 });
		for (const r of results) {
			if (r.success) s.succeeded++;
			else {
				s.failed++;
				if (failures.length < 20) failures.push({ kind, id: r.objectId ?? null, error: r.error ?? null });
			}
		}
	}
	const allOk = Object.values(summary).every((s) => s.failed === 0);
	audit(ctx.props, { tool: "portal_layer_edit", action, target: url, ok: allOk, details: summary });
	return { layer: name, result: summary, all_ok: allOk, failures: failures.length ? failures : null };
}

// --- renderers ---------------------------------------------------------------------------------------

function symbol(geometry: string | undefined, color: number[]) {
	if (geometry === "esriGeometryPolyline") return { type: "esriSLS", style: "esriSLSSolid", color: [...color, 230], width: 2 };
	if (geometry === "esriGeometryPolygon") {
		return { type: "esriSFS", style: "esriSFSSolid", color: [...color, 170],
			outline: { type: "esriSLS", style: "esriSLSSolid", color: [110, 110, 110, 255], width: 0.7 } };
	}
	return { type: "esriSMS", style: "esriSMSCircle", color: [...color, 230], size: 8,
		outline: { type: "esriSLS", style: "esriSLSSolid", color: [255, 255, 255, 255], width: 0.7 } };
}

/** Renderer JSON from a spec read against the data, or a raw renderer passed through. */
export async function buildRenderer(ctx: Ctx, layerUrl: string, geometry: string | undefined,
	spec: Record<string, any>): Promise<Record<string, unknown>> {
	if (!["unique", "class_breaks", "simple"].includes(spec.type)) return spec;
	if (spec.type === "simple") return { type: "simple", symbol: symbol(geometry, spec.color ?? CATEGORICAL[0]) };
	const field = spec.field;
	if (!field) throw new ArcGISError(`a ${spec.type} renderer needs 'field'.`, "bad_argument");
	if (spec.type === "unique") {
		const res = await ctx.request(`${layerUrl}/query`, { where: `${field} IS NOT NULL`, returnGeometry: false,
			outStatistics: [{ statisticType: "count", onStatisticField: field, outStatisticFieldName: "n" }],
			groupByFieldsForStatistics: field });
		const counts = (res.features ?? []).map((f: any) => [f.attributes?.[field], Number(f.attributes?.n ?? 0)] as const)
			.sort((a: any, b: any) => b[1] - a[1]);
		const top = counts.slice(0, CATEGORICAL.length);
		const others = counts.length > top.length;
		return { type: "uniqueValue", field1: field,
			uniqueValueInfos: top.map(([v]: any, i: number) => ({ value: String(v), label: String(v), symbol: symbol(geometry, CATEGORICAL[i]) })),
			defaultSymbol: others ? symbol(geometry, [200, 200, 200]) : null, defaultLabel: others ? "Other" : null };
	}
	const classes = Math.max(2, Math.min(Math.trunc(spec.classes ?? 5), SEQUENTIAL.length));
	const res = await ctx.request(`${layerUrl}/query`, { where: `${field} IS NOT NULL`, outFields: field,
		returnGeometry: false, resultRecordCount: 2000 });
	const values = (res.features ?? []).map((f: any) => Number(f.attributes?.[field])).filter(Number.isFinite)
		.sort((a: number, b: number) => a - b);
	if (!values.length) throw new ArcGISError(`field '${field}' has no values to classify.`, "bad_argument");
	const breaks = [...new Set(Array.from({ length: classes }, (_, i) =>
		values[Math.min(values.length - 1, Math.round(((i + 1) * values.length) / classes) - 1)]))];
	let low = values[0];
	const infos = breaks.map((b, i) => {
		const color = SEQUENTIAL[Math.round((i * (SEQUENTIAL.length - 1)) / Math.max(1, breaks.length - 1))];
		const info = { classMaxValue: b, label: `${low} - ${b}`, symbol: symbol(geometry, color) };
		low = b;
		return info;
	});
	return { type: "classBreaks", field, minValue: values[0], classificationMethod: "esriClassifyQuantile",
		classBreakInfos: infos };
}

// --- schema -------------------------------------------------------------------------------------------

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
		const created = await ctx.request(`${sharingUrl(ctx.props.portal)}/content/users/${encodeURIComponent(ctx.props.username)}/createService`, {
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
