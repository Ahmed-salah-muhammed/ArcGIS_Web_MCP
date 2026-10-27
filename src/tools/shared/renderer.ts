/**
 * Renderers built from the data, shared by portal_layer_schema (a layer's own style) and portal_map (a style
 * inside a web map): unique values from counts, quantile class breaks, a simple symbol, or raw Esri JSON.
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "./context";

const CATEGORICAL = [[31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40], [148, 103, 189], [140, 86, 75],
	[227, 119, 194], [127, 127, 127], [188, 189, 34], [23, 190, 207], [174, 199, 232], [255, 187, 120]];
const SEQUENTIAL = [[255, 255, 178], [254, 217, 118], [254, 178, 76], [253, 141, 60], [252, 78, 42], [227, 26, 28],
	[177, 0, 38]];

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
