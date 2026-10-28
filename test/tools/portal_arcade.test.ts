import { describe, expect, it } from "vitest";
import { checkArcade, scan } from "../../src/tools/portal_arcade/check";
import { arcade } from "../../src/tools/portal_arcade/handler";
import { fillTemplate, TEMPLATES } from "../../src/tools/portal_arcade/library";
import { fakeCtx, silence, SVC, USER } from "../helpers";

const MAP = "c".repeat(32);
const FIELDS = ["OBJECTID", "NAME", "POP", "AREA_KM2", "STATUS", "REASON", "REASON_OTHER"];

describe("Arcade check", () => {
	it("accepts correct expressions and reports the fields they use", () => {
		const r = checkArcade('var d = $feature.POP / $feature["AREA_KM2"]; // people per km²\nreturn Text(d, "#,###") + " /km²"', "popup", FIELDS);
		expect(r).toMatchObject({ valid: true, errors: [], fields_used: ["POP", "AREA_KM2"], variables: ["$feature"] });
		expect(checkArcade('DomainName($feature, "STATUS") == "Open"', "form", FIELDS).valid).toBe(true);
		expect(checkArcade("$feature.pop > 10", "style", FIELDS).valid).toBe(true); // field names are not case-sensitive
	});

	it("catches the usual mistakes", () => {
		const bad = (expr: string, ctx: any = "popup") => checkArcade(expr, ctx, FIELDS).errors.join(" ");
		expect(bad("$feature.POPULATION * 2")).toMatch(/no field 'POPULATION'/);
		expect(bad("$feature.POP > 1 AND $feature.POP < 9")).toMatch(/&&/);
		expect(bad("$feature.STATUS <> 'Open'")).toMatch(/!=/);
		expect(bad("Round(($feature.POP / 2)")).toMatch(/never closed/);
		expect(bad("'unclosed")).toMatch(/never closed/);
		expect(bad("$map.layers", "label")).toMatch(/\$map is not available in a label/);
		expect(bad('Count(FeatureSetByName($map, "x"))', "label")).toMatch(/reads other data|\$map/);
		expect(bad("$feature.{FIELD}")).toMatch(/placeholder/i);
		expect(bad("")).toMatch(/empty/);
		expect(checkArcade("Rounnd($feature.POP)", "popup", FIELDS).warnings.join(" ")).toMatch(/Rounnd\(\) is not an Arcade function/);
	});

	it("strings and comments are not read as code", () => {
		expect(scan('"a ) b" // AND (').code).toBe('"     "         ');
		expect(checkArcade('"AND <> (" + $feature.NAME /* OR */', "label", FIELDS).valid).toBe(true);
	});

	it("every template is valid once its placeholders are filled", () => {
		const values = { PART: "POP", TOTAL: "POP", DATE: "NAME", FIELD: "POP", A: "POP", B: "POP", HIGH: "100", MEDIUM: "50",
			OTHER_LAYER: "Parks", NAME: "NAME", VALUE: "POP", LIMIT: "10" };
		for (const t of TEMPLATES) {
			const r = checkArcade(fillTemplate(t.expression, values), t.context, FIELDS);
			expect({ id: t.id, errors: r.errors }).toEqual({ id: t.id, errors: [] });
		}
	});
});

describe("portal_arcade", () => {
	const routes = (saved: { text?: string }, extra: Record<string, any> = {}) => ({
		[`/content/items/${MAP}`]: () => ({ id: MAP, title: "M", type: "Web Map", owner: "jdoe_gis" }),
		[`/content/items/${MAP}/data`]: () => ({ operationalLayers: [{ id: "op1", title: "Districts", url: `${SVC}/0` }] }),
		[`${SVC}/0`]: () => ({ geometryType: "esriGeometryPolygon", displayField: "NAME", fields: FIELDS.map((name) => ({ name, type: "esriFieldTypeString" })) }),
		[`${USER}/items/${MAP}/update`]: (p: any) => { saved.text = p.text; return { success: true }; },
		...extra,
	});

	it("templates fill placeholders", async () => {
		const out: any = await arcade(fakeCtx({}).ctx, { action: "templates", context: "label", values: { NAME: "NAME", VALUE: "POP" } });
		expect(out.templates.every((t: any) => t.context === "label")).toBe(true);
		expect(out.templates[0].expression).toBe('$feature.NAME + TextFormatting.NewLine + Text($feature.POP, "#,###")');
	});

	it("check reads the fields of a map layer", async () => {
		const { ctx } = fakeCtx(routes({}));
		const out: any = await arcade(ctx, { action: "check", webmap_id: MAP, expression: "$feature.POPX", context: "popup" });
		expect(out).toMatchObject({ valid: false, fields_checked: true });
	});

	it("popup: the expression becomes a popup field; an invalid one saves nothing", async () => {
		silence();
		const saved: { text?: string } = {};
		const { ctx, calls } = fakeCtx(routes(saved));
		await expect(arcade(ctx, { action: "popup", webmap_id: MAP, expression: "$feature.NOPE", title: "Density" }))
			.rejects.toThrow(/nothing was saved/);
		expect(calls.some((c) => c.url.endsWith("/update"))).toBe(false);
		const out: any = await arcade(ctx, { action: "popup", webmap_id: MAP, expression: "$feature.POP / $feature.AREA_KM2", title: "Density",
			return_type: "number" });
		const op = JSON.parse(saved.text!).operationalLayers[0];
		expect(op.popupInfo.expressionInfos).toEqual([{ name: "density", title: "Density", expression: "$feature.POP / $feature.AREA_KM2", returnType: "number" }]);
		expect(op.popupInfo.fieldInfos).toContainEqual({ fieldName: "expression/density", label: "Density", visible: true });
		expect(out.popup_field).toBe("expression/density");
	});

	it("form: calculated fields are read-only; visibility points at a named expression", async () => {
		silence();
		const saved: { text?: string } = {};
		const { ctx } = fakeCtx(routes(saved));
		await arcade(ctx, { action: "form", webmap_id: MAP, field: "REASON_OTHER", role: "visible", expression: '$feature.REASON == "Other"' });
		const form = JSON.parse(saved.text!).operationalLayers[0].formInfo;
		const el = form.formElements.find((e: any) => e.fieldName === "REASON_OTHER");
		expect(el.visibilityExpression).toBe("expr/visible_reason_other");
		expect(form.expressionInfos).toContainEqual({ name: "expr/visible_reason_other", title: "visible REASON_OTHER",
			expression: '$feature.REASON == "Other"', returnType: "boolean" });
		const { ctx: ctx2 } = fakeCtx(routes(saved, { [`/content/items/${MAP}/data`]: () => JSON.parse(saved.text!) }));
		await arcade(ctx2, { action: "form", webmap_id: MAP, field: "AREA_KM2", role: "calculated", expression: 'Round(AreaGeodetic($feature, "square-kilometers"), 2)',
			return_type: "number" });
		const area = JSON.parse(saved.text!).operationalLayers[0].formInfo.formElements.find((e: any) => e.fieldName === "AREA_KM2");
		expect(area).toMatchObject({ valueExpression: "expr/calculated_area_km2", editableExpression: "expr/system/false" });
	});

	it("label: on the map's layer, placed for its geometry; other owners' maps are refused", async () => {
		silence();
		const saved: { text?: string } = {};
		const { ctx } = fakeCtx(routes(saved));
		await arcade(ctx, { action: "label", webmap_id: MAP, expression: "Upper($feature.NAME)" });
		const op = JSON.parse(saved.text!).operationalLayers[0];
		expect(op.showLabels).toBe(true);
		expect(op.layerDefinition.drawingInfo.labelingInfo[0]).toMatchObject({ labelExpressionInfo: { expression: "Upper($feature.NAME)" },
			labelPlacement: "esriServerPolygonPlacementAlwaysHorizontal" });
		const { ctx: other } = fakeCtx(routes({}, { [`/content/items/${MAP}`]: () => ({ id: MAP, type: "Web Map", owner: "someone" }) }));
		await expect(arcade(other, { action: "label", webmap_id: MAP, expression: "$feature.NAME" })).rejects.toThrow(/Only the map's owner/);
	});
});
