/**
 * Ready-made Arcade for each place ArcGIS runs it. {FIELD}-style placeholders are filled from `fields`
 * ({"FIELD": "POP_2020"}) by the templates action. Profile variables per context follow the Arcade profiles.
 */

export const CONTEXTS = ["popup", "label", "form", "style", "dashboard"] as const;
export type ArcadeContext = (typeof CONTEXTS)[number];

/** The $variables each profile provides (Arcade is case-insensitive about them). */
export const PROFILE_VARIABLES: Record<ArcadeContext, string[]> = {
	popup: ["$feature", "$layer", "$map", "$datastore", "$view"],
	label: ["$feature", "$view"],
	form: ["$feature", "$originalfeature", "$editcontext", "$layer", "$map", "$datastore", "$featureset"],
	style: ["$feature", "$view"],
	dashboard: ["$datapoint", "$rowindex", "$reference"],
};

/** Contexts where FeatureSet functions (reading other layers) are not available. */
export const NO_FEATURESETS: ArcadeContext[] = ["label", "style"];

export type ArcadeTemplate = { id: string; context: ArcadeContext; title: string; returns: string; expression: string };

export const TEMPLATES: ArcadeTemplate[] = [
	{ id: "percent", context: "popup", title: "Percentage of two fields", returns: "string",
		expression: 'var part = $feature.{PART};\nvar total = $feature.{TOTAL};\nif (IsEmpty(part) || IsEmpty(total) || total == 0) { return "No data" }\nreturn Text(part / total * 100, "#.0") + "%";' },
	{ id: "date_text", context: "popup", title: "A date written out", returns: "string",
		expression: 'IIf(IsEmpty($feature.{DATE}), "Unknown", Text($feature.{DATE}, "D MMMM Y"))' },
	{ id: "days_since", context: "popup", title: "Days since a date", returns: "number",
		expression: 'Round(DateDiff(Now(), $feature.{DATE}, "days"))' },
	{ id: "domain_name", context: "popup", title: "The description of a coded value", returns: "string",
		expression: 'DomainName($feature, "{FIELD}")' },
	{ id: "join_fields", context: "popup", title: "Several fields in one line", returns: "string",
		expression: 'Concatenate([$feature.{A}, $feature.{B}], ", ")' },
	{ id: "classes", context: "popup", title: "High / medium / low from a number", returns: "string",
		expression: 'var v = $feature.{FIELD};\nWhen(IsEmpty(v), "No data", v >= {HIGH}, "High", v >= {MEDIUM}, "Medium", "Low")' },
	{ id: "area_km2", context: "popup", title: "Polygon area in km²", returns: "string",
		expression: 'Text(AreaGeodetic($feature, "square-kilometers"), "#,###.##") + " km²"' },
	{ id: "length_km", context: "popup", title: "Line length in km", returns: "string",
		expression: 'Text(LengthGeodetic($feature, "kilometers"), "#,###.##") + " km"' },
	{ id: "count_inside", context: "popup", title: "How many features of another map layer fall inside", returns: "number",
		expression: 'var others = FeatureSetByName($map, "{OTHER_LAYER}");\nCount(Intersects(others, $feature))' },
	{ id: "name_value", context: "label", title: "Name over a formatted number", returns: "string",
		expression: '$feature.{NAME} + TextFormatting.NewLine + Text($feature.{VALUE}, "#,###")' },
	{ id: "upper", context: "label", title: "Name in capitals", returns: "string", expression: "Upper($feature.{NAME})" },
	{ id: "short_name", context: "label", title: "First 20 characters", returns: "string",
		expression: 'var n = $feature.{NAME};\nIIf(Count(n) > 20, Left(n, 20) + "…", n)' },
	{ id: "area_m2", context: "form", title: "Calculated: area in m²", returns: "number",
		expression: 'Round(AreaGeodetic($feature, "square-meters"), 1)' },
	{ id: "now", context: "form", title: "Calculated: the current date and time", returns: "date", expression: "Now()" },
	{ id: "editor", context: "form", title: "Calculated: who is editing", returns: "string", expression: "GetUser($layer).username" },
	{ id: "show_if_value", context: "form", title: "Visible only when another field has a value", returns: "boolean",
		expression: '$feature.{FIELD} == "{VALUE}"' },
	{ id: "show_if_coded", context: "form", title: "Visible only when a coded field shows a description", returns: "boolean",
		expression: 'DomainName($feature, "{FIELD}") == "{VALUE}"' },
	{ id: "required_if_other", context: "form", title: "Required when another field is Other", returns: "boolean",
		expression: '$feature.{FIELD} == "Other"' },
	{ id: "ratio", context: "style", title: "Style by the ratio of two fields", returns: "number",
		expression: "IIf(IsEmpty($feature.{B}) || $feature.{B} == 0, null, $feature.{A} / $feature.{B})" },
	{ id: "list_highlight", context: "dashboard", title: "List: colour rows above a threshold", returns: "dictionary",
		expression: 'var v = $datapoint.{FIELD};\nreturn {\n  textColor: IIf(v > {LIMIT}, "#d73027", ""),\n  backgroundColor: "",\n  separatorColor: "",\n  selectionColor: "",\n  selectionTextColor: ""\n};' },
];

/** Built-in Arcade functions (lower case) for spotting typos; an unknown name is only a warning. */
export const FUNCTIONS = new Set(`abs acos asin atan atan2 average ceil constrain cos exp floor hash log max mean min pow random round
sin sqrt stdev sum tan variance concatenate find fromcharcode fromcodepoint guid left lower mid proper replace right split
standardizeguid tocharcode tocodepoint tohex trim upper text number boolean date dateadd datediff dateonly day hour isomonth
isoweek isoweekday isoyear millisecond minute month now second time timestamp today tolocal toutc week weekday year
changetimezone timezone timezoneoffset decode defaultvalue iif isempty isnan when equals typeof back count distinct erase filter
first front indexof insert map none any all pop push reduce resize reverse slice sort splice top includes dictionary haskey
hasvalue fromjson feature expects domainname domaincode domain schema subtypes subtypename subtypecode gdbversion attachments
getuser getfeatureset getfeaturesetinfo featureset featuresetbyassociation featuresetbyid featuresetbyname featuresetbyportalitem
featuresetbyrelationshipname featuresetbyrelationshipclass groupby orderby intersects contains crosses disjoint
envelopeintersects overlaps relate touches within portal angle area areageodetic bearing boundary buffer buffergeodetic centroid
clip convexhull cut densify densifygeodetic difference distance distancegeodetic envelope extent generalize geometry
intersection isselfintersecting issimple length length3d lengthgeodetic multiparttosinglepart nearestcoordinate nearestvertex
offset point polygon polyline ringisclockwise rotate setgeometry simplify symmetricdifference union console convertdirection
convexhull measuretocoordinate pointtocoordinate distancetocoordinate knowledgegraphbyportalitem querygraph`.split(/\s+/));

export function fillTemplate(expression: string, values: Record<string, string> = {}): string {
	return expression.replace(/\{([A-Z_]+)\}/g, (m, key) => (values[key] ?? values[key.toLowerCase()] ?? m));
}
