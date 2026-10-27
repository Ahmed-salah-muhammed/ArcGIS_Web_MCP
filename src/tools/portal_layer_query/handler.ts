/**
 * portal_layer_query: read a feature layer or table: describe (fields, capabilities, count) | query (paged rows,
 * dates as ISO UTC) | count | stats ("sum:POP" shorthand, group_by).
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { iso } from "../shared/format";
import { resolveLayerUrl } from "../shared/lookup";

export const MAX_ROWS = 1000;

export type LayerQueryArgs = {
	action?: "describe" | "query" | "count" | "stats";
	target: string;
	layer?: number | string;
	where?: string;
	fields?: string[];
	limit?: number;
	offset?: number;
	order_by?: string;
	return_geometry?: boolean;
	stats?: (string | Record<string, unknown>)[];
	group_by?: string;
};

export function parseStats(stats: (string | Record<string, unknown>)[]): Record<string, unknown>[] {
	const kinds: Record<string, string> = { avg: "avg", mean: "avg", sum: "sum", min: "min", max: "max", count: "count",
		stddev: "stddev", var: "var" };
	return stats.map((s) => {
		if (typeof s === "object" && s) return s;
		const [kindRaw, field] = String(s).split(":", 2);
		const kind = kinds[(kindRaw ?? "").toLowerCase()];
		if (!kind || !field) {
			throw new ArcGISError(`Bad stat '${s}'; use kind:field (sum|avg|min|max|count|stddev|var).`, "bad_argument");
		}
		return { statisticType: kind, onStatisticField: field, outStatisticFieldName: `${kind}_${field}`.slice(0, 30) };
	});
}

/** Feature JSON -> attribute rows; date fields -> ISO 8601 UTC; huge geometries are replaced by a note. */
export function rowsFrom(features: any[], fields: any[] | undefined, withGeometry: boolean): Record<string, unknown>[] {
	const dates = new Set((fields ?? []).filter((f) => f.type === "esriFieldTypeDate").map((f) => f.name));
	return features.map((f) => {
		const row: Record<string, unknown> = { ...(f.attributes ?? {}) };
		for (const k of Object.keys(row)) if (dates.has(k)) row[k] = iso(row[k]);
		if (withGeometry && f.geometry) {
			const text = JSON.stringify(f.geometry);
			row._geometry = text.length <= 4000 ? f.geometry : { note: `geometry of ${text.length} chars omitted` };
		}
		return row;
	});
}

function describeFields(fields: any[] = []) {
	return fields.map((f) => ({
		name: f.name, type: String(f.type ?? "").replace("esriFieldType", ""), alias: f.alias ?? null,
		nullable: f.nullable ?? null, editable: f.editable ?? null, length: f.length ?? null,
		domain: f.domain ? { name: f.domain.name, type: f.domain.type, codes: f.domain.codedValues?.length ?? null,
			range: f.domain.range ?? null } : null,
	}));
}

export async function layerQuery(ctx: Ctx, args: LayerQueryArgs) {
	const action = args.action ?? "query";
	const url = await resolveLayerUrl(ctx, args.target, args.layer ?? 0);
	const where = args.where?.trim() || "1=1";
	if (action === "describe") {
		const p = await ctx.request(url);
		const count = await ctx.request(`${url}/query`, { where: "1=1", returnCountOnly: true });
		return {
			name: p.name, type: p.type, url, geometryType: p.geometryType ?? null, objectIdField: p.objectIdField ?? null,
			globalIdField: p.globalIdField || null, displayField: p.displayField || null, count: count.count ?? null,
			capabilities: p.capabilities ?? null, maxRecordCount: p.maxRecordCount ?? null,
			hasAttachments: p.hasAttachments ?? null, editorTracking: p.editFieldsInfo ?? null,
			viewDefinitionQuery: p.viewDefinitionQuery || null, isView: p.isView ?? null,
			spatialReference: p.extent?.spatialReference ?? null, fields: describeFields(p.fields),
		};
	}
	if (action === "count") {
		const res = await ctx.request(`${url}/query`, { where, returnCountOnly: true });
		return { where, count: res.count ?? null };
	}
	if (action === "stats") {
		if (!args.stats?.length) {
			throw new ArcGISError('stats is required, e.g. ["sum:POP", "avg:INCOME", "count:OBJECTID"].', "bad_argument");
		}
		const res = await ctx.request(`${url}/query`, {
			where, outStatistics: parseStats(args.stats), groupByFieldsForStatistics: args.group_by,
			orderByFields: args.order_by, returnGeometry: false,
		});
		return { where, group_by: args.group_by ?? null, rows: rowsFrom((res.features ?? []).slice(0, MAX_ROWS), [], false) };
	}
	if (action !== "query") throw new ArcGISError("action must be describe | query | count | stats.", "bad_action");
	const limit = Math.max(1, Math.min(Math.trunc(args.limit ?? 50), MAX_ROWS));
	const offset = Math.max(0, Math.trunc(args.offset ?? 0));
	const res = await ctx.request(`${url}/query`, {
		where, outFields: args.fields?.length ? args.fields.join(",") : "*", returnGeometry: Boolean(args.return_geometry),
		resultOffset: offset, resultRecordCount: limit, orderByFields: args.order_by,
	});
	const rows = rowsFrom(res.features ?? [], res.fields, Boolean(args.return_geometry));
	const more = rows.length >= limit || Boolean(res.exceededTransferLimit);
	const hasDates = (res.fields ?? []).some((f: any) => f.type === "esriFieldTypeDate");
	return {
		where, count: rows.length, offset, next_offset: more ? offset + rows.length : null, rows,
		dates: hasDates ? "ISO 8601 UTC (stored as epoch ms)" : null,
	};
}
