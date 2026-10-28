/**
 * Dashboard filters as the dashboard editor saves them: a filterGroup (OR) of filterGroups (AND) of filterRules
 * {field: {name, type}, operator, constraint}. Every operator, constraint and field type below was read from real
 * dashboards on ArcGIS Online (2026-10); operators not seen there (not_equal, less, is_null) are left out on purpose,
 * since a wrong name breaks the widget silently: "!=" is written as is_not_in, and "<" has no safe spelling yet.
 */
import { ArcGISError } from "../../arcgis";

/** The filter field types dashboards use, by Esri field type. */
export const FILTER_FIELD_TYPES: Record<string, string> = { esriFieldTypeString: "string", esriFieldTypeDouble: "double",
	esriFieldTypeSingle: "single", esriFieldTypeSmallInteger: "small-integer", esriFieldTypeInteger: "integer",
	esriFieldTypeDate: "date" };
const NUMERIC = new Set(["double", "single", "small-integer", "integer"]);

export const CONDITION_OPS = ["=", "!=", ">", ">=", "<=", "in", "not_in", "not_null", "last", "before_last", "this_year",
	"last_year"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export const DATE_UNITS = ["hour", "day", "month", "year"] as const;
export type DateUnit = (typeof DATE_UNITS)[number];

type Scalar = string | number;
/** A value ({FIELD: "a"}), a list ({FIELD: ["a", "b"]}), or a condition ({FIELD: {op: ">=", value: 10}}). */
export type Condition = Scalar | Scalar[] | { op: ConditionOp; value?: Scalar | Scalar[]; unit?: DateUnit };

const OPERATORS: Record<string, string> = { "=": "equal", ">": "greater", ">=": "greater_or_equal", "<=": "less_or_equal",
	in: "is_in", "!=": "is_not_in", not_in: "is_not_in", not_null: "is_not_null", last: "is_within_last",
	before_last: "is_before_last", this_year: "is_on", last_year: "is_on" };

function fieldInfo(info: any, name: string) {
	const field = (info.fields ?? []).find((f: any) => String(f.name).toLowerCase() === String(name).toLowerCase());
	if (!field) {
		throw new ArcGISError(`filter: no field '${name}'. Fields: ${(info.fields ?? []).map((f: any) => f.name).join(", ")}`, "bad_argument");
	}
	const type = FILTER_FIELD_TYPES[field.type];
	if (!type) throw new ArcGISError(`filter: '${field.name}' (${field.type}) cannot be filtered here.`, "bad_argument");
	return { field, type };
}

/** One condition on one field -> a filterRule. Coded values may be given by their description. */
export function filterRule(info: any, name: string, condition: Condition) {
	const { field, type } = fieldInfo(info, name);
	const c = typeof condition === "object" && !Array.isArray(condition) ? condition
		: { op: (Array.isArray(condition) ? "in" : "=") as ConditionOp, value: condition };
	const operator = OPERATORS[c.op];
	if (!operator) throw new ArcGISError(`filter op must be ${CONDITION_OPS.join(" | ")}.`, "bad_argument");
	const rule = (constraint: Record<string, unknown>) => ({ type: "filterRule", field: { name: field.name, type }, operator, constraint });
	if (c.op === "not_null") return rule({ type: "nil" });
	const isDate = type === "date";
	if (["last", "before_last", "this_year", "last_year"].includes(c.op)) {
		if (!isDate) throw new ArcGISError(`filter '${c.op}' needs a date field; '${field.name}' is ${type}.`, "bad_argument");
		if (c.op === "this_year" || c.op === "last_year") return rule({ type: "period", value: c.op === "this_year" ? "thisYear" : "lastYear" });
		const n = Number(c.value);
		if (!Number.isInteger(n) || n < 1) throw new ArcGISError(`filter '${c.op}' needs value = a whole number of units.`, "bad_argument");
		if (!DATE_UNITS.includes(c.unit as DateUnit)) throw new ArcGISError(`filter '${c.op}' needs unit = ${DATE_UNITS.join(" | ")}.`, "bad_argument");
		return rule({ type: "relativeDate", unit: c.unit, value: n });
	}
	if (isDate) throw new ArcGISError(`Date fields filter with last | before_last | this_year | last_year | not_null.`, "bad_argument");
	if ([">", ">=", "<="].includes(c.op) && !NUMERIC.has(type)) {
		throw new ArcGISError(`filter '${c.op}' needs a number field; '${field.name}' is ${type}.`, "bad_argument");
	}
	const coded: any[] = field.domain?.codedValues ?? [];
	const cast = (v: Scalar) => {
		const code = coded.find((d) => d.name === v)?.code ?? v;
		if (NUMERIC.has(type)) {
			const n = Number(code);
			if (!Number.isFinite(n)) throw new ArcGISError(`filter: '${v}' is not a number for '${field.name}'.`, "bad_argument");
			return n;
		}
		return String(code);
	};
	const list = (Array.isArray(c.value) ? c.value : c.value === undefined ? [] : [c.value]).map(cast);
	if (!list.length) throw new ArcGISError(`filter: no value for '${field.name}'.`, "bad_argument");
	if (c.op === "in" || c.op === "not_in" || c.op === "!=") {
		// a single "in" value is written as equal, like the editor does
		if (c.op === "in" && list.length === 1) return { ...rule({ type: "value", value: list[0] }), operator: "equal" };
		return rule({ type: "values", values: list });
	}
	if (list.length > 1) throw new ArcGISError(`filter '${c.op}' takes one value.`, "bad_argument");
	return rule({ type: "value", value: list[0] });
}

/** All conditions AND-ed, in the dashboard's filterGroup shape; undefined when there are none. */
export function widgetFilter(info: any, filter: Record<string, Condition> | undefined) {
	const entries = Object.entries(filter ?? {});
	if (!entries.length) return undefined;
	return { type: "filterGroup", condition: "OR", rules: [{ type: "filterGroup", condition: "AND",
		rules: entries.map(([name, c]) => filterRule(info, name, c)) }] };
}

/** A SQL string literal. */
const sqlText = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** The same conditions as SQL, for Arcade Filter() in grouped lists (no date conditions there). */
export function filterSql(info: any, filter: Record<string, Condition> | undefined): string {
	return Object.entries(filter ?? {}).map(([name, c]) => {
		const r: any = filterRule(info, name, c);
		const f = r.field.name;
		const lit = (v: Scalar) => (typeof v === "number" ? String(v) : sqlText(String(v)));
		switch (r.operator) {
			case "equal": return `${f} = ${lit(r.constraint.value)}`;
			case "greater": return `${f} > ${lit(r.constraint.value)}`;
			case "greater_or_equal": return `${f} >= ${lit(r.constraint.value)}`;
			case "less_or_equal": return `${f} <= ${lit(r.constraint.value)}`;
			case "is_in": return `${f} IN (${r.constraint.values.map(lit).join(", ")})`;
			case "is_not_in": return `${f} NOT IN (${r.constraint.values.map(lit).join(", ")})`;
			case "is_not_null": return `${f} IS NOT NULL`;
			default: throw new ArcGISError(`A grouped list cannot filter '${f}' by date; use a view of the layer.`, "bad_argument");
		}
	}).join(" AND ");
}

const DATE_DIFF: Record<string, string> = { hour: "hours", day: "days", month: "months", year: "years" };

/** The same condition as an Arcade test on one feature (advanced formatting: $datapoint, or $feature). */
export function arcadeTest(info: any, name: string, condition: Condition, on = "$datapoint"): string {
	const r: any = filterRule(info, name, condition);
	const v = `${on}[${JSON.stringify(r.field.name)}]`;
	const lit = (x: Scalar) => JSON.stringify(x);
	switch (r.operator) {
		case "equal": return `${v} == ${lit(r.constraint.value)}`;
		case "greater": return `${v} > ${lit(r.constraint.value)}`;
		case "greater_or_equal": return `${v} >= ${lit(r.constraint.value)}`;
		case "less_or_equal": return `${v} <= ${lit(r.constraint.value)}`;
		case "is_in": return `Includes(${lit(r.constraint.values)}, ${v})`;
		case "is_not_in": return `!Includes(${lit(r.constraint.values)}, ${v})`;
		case "is_not_null": return `!IsEmpty(${v})`;
		case "is_within_last": return `!IsEmpty(${v}) && DateDiff(Now(), ${v}, '${DATE_DIFF[r.constraint.unit]}') <= ${r.constraint.value}`;
		case "is_before_last": return `!IsEmpty(${v}) && DateDiff(Now(), ${v}, '${DATE_DIFF[r.constraint.unit]}') > ${r.constraint.value}`;
		default: return `!IsEmpty(${v}) && Year(${v}) == Year(Now())${r.constraint.value === "lastYear" ? " - 1" : ""}`;
	}
}
