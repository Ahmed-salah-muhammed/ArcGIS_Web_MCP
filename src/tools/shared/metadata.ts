/**
 * Infer what a layer is from its name, fields and geometry, and turn that into an item summary, description and
 * tags. Ported from ArcGIS Pro Salah MCP (pro/metadata.py). Pure: no network, unit-tested.
 * Keyword *prefix* matching, not substring: "age" must not match "acreage".
 */

const THEMES: [string, string, string[]][] = [
	["transportation", "a transportation network", ["road", "street", "highway", "route", "traffic", "rail", "railway",
		"railroad", "transit", "metro", "subway", "pavement", "lane", "aadt", "speed", "tunnel", "bridge", "intersection"]],
	["hydrology", "hydrography and water features", ["river", "stream", "lake", "water", "watershed", "basin", "hydro",
		"canal", "reservoir", "wetland", "creek", "shoreline", "coast", "aquifer", "floodplain"]],
	["buildings", "buildings and structures", ["building", "bldg", "structure", "stories", "storey", "floor", "roof",
		"footprint", "rooftop", "heightm", "construct"]],
	["parcels", "land parcels and ownership", ["parcel", "apn", "zoning", "landuse", "owner", "cadastr", "subdivision",
		"acreage", "assessed", "lotsize", "ownername"]],
	["boundaries", "administrative boundaries", ["admin", "boundary", "country", "nation", "province", "county", "district",
		"region", "municipal", "ward", "fips", "iso3", "adm0", "adm1", "adm2", "stateabbr", "govern"]],
	["demographics", "demographics and census statistics", ["population", "popula", "popdens", "density", "census",
		"household", "income", "gender", "employ", "poverty", "literacy", "median", "ethnic"]],
	["environment", "land cover and environmental data", ["landcover", "vegetation", "forest", "ndvi", "soil", "habitat",
		"species", "biome", "canopy", "wildlife", "ecolog"]],
	["elevation", "elevation and terrain", ["elevation", "elev", "slope", "aspect", "contour", "altitude", "relief",
		"bathymetr", "hillshade"]],
	["utilities", "a utility network", ["pipe", "cable", "utility", "power", "electric", "voltage", "sewer", "valve",
		"hydrant", "manhole", "transformer", "feeder", "watermain"]],
	["hazards", "hazards and risk", ["flood", "hazard", "risk", "wildfire", "earthquake", "seismic", "landslide", "drought",
		"vulnerab", "exposure"]],
	["health", "health facilities and public-health data", ["hospital", "clinic", "health", "patient", "disease",
		"mortality", "covid", "vaccine", "incidence"]],
	["education", "education facilities", ["school", "university", "college", "student", "education", "campus", "enrol",
		"pupil"]],
	["poi", "points of interest and places", ["amenity", "address", "category", "store", "restaurant", "hotel", "landmark",
		"facility", "venue", "business"]],
	["climate", "climate and weather", ["temperature", "precip", "rainfall", "climate", "weather", "humidity", "windspeed",
		"pressure"]],
	["geology", "geology and the subsurface", ["geolog", "mineral", "fault", "borehole", "litholog", "formation",
		"drillhole", "outcrop"]],
	["agriculture", "agriculture and crops", ["crop", "farm", "yield", "irrigation", "harvest", "cultivat", "agricultur",
		"orchard"]],
];

const GEOM_NOUN: Record<string, string> = {
	point: "point", multipoint: "point", polyline: "linear", line: "linear", polygon: "area", multipatch: "3D",
};

const BORING_FIELDS = new Set(["objectid", "oid", "fid", "shape", "shape_length", "shape_area", "shape__length",
	"shape__area", "globalid", "created_user", "created_date", "last_edited_user", "last_edited_date",
	"creationdate", "creator", "editdate", "editor", "se_anno_cad_data"]);

const CREDIT = "ArcGIS Web MCP";

/** Lower-case alphanumeric tokens from a name (splits on _, spaces, camelCase). */
export function tokens(text: string): string[] {
	const spaced = (text ?? "").replace(/([a-z0-9])(?=[A-Z])/g, "$1 ");
	return spaced.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

const meaningful = (fields: string[]) => (fields ?? []).filter((f) => f && !BORING_FIELDS.has(f.toLowerCase()));

function hits(keywords: string[], toks: string[]): string[] {
	return keywords.filter((kw) => toks.some((t) => t === kw || (kw.length >= 4 && t.startsWith(kw)))).sort();
}

export function inferTheme(layerName: string, fieldNames: string[]) {
	const toks = [...tokens(layerName), ...meaningful(fieldNames).flatMap(tokens)];
	let best: { theme: string; label: string; score: number; matched: string[] } | null = null;
	for (const [theme, label, keywords] of THEMES) {
		const matched = hits(keywords, toks);
		if (matched.length && (!best || matched.length > best.score)) best = { theme, label, score: matched.length, matched };
	}
	return best ?? { theme: "general", label: "a geospatial dataset", score: 0, matched: [] as string[] };
}

/** 'road_network' / 'RoadNetwork' -> 'Road Network'. */
export function prettify(name: string): string {
	const words = tokens(name);
	return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : name || "Layer";
}

const capitalize = (w: string) => w[0].toUpperCase() + w.slice(1);
const fmt = (n: number) => n.toLocaleString("en-US");

/** Item summary, description and tags for a layer, from its name, geometry, fields and (optional) count. */
export function layerMetadata(layerName: string, geometryType?: string | null, fieldNames: string[] = [],
	featureCount?: number | null) {
	const nice = prettify(layerName);
	const geom = (geometryType ?? "").replace(/^esriGeometry/i, "").trim();
	const noun = GEOM_NOUN[geom.toLowerCase()] ?? "feature";
	const theme = inferTheme(layerName, fieldNames);
	const fields = meaningful(fieldNames);
	const keyFields = fields.slice(0, 8);
	const hasCount = typeof featureCount === "number";
	const countTxt = hasCount ? `${fmt(featureCount!)} features` : "features";
	const geomWord = geom || "vector";

	const summary = theme.score
		? `${nice}: ${theme.label} - ${geomWord} layer (${countTxt})`
		: `${nice}: ${geomWord} layer (${countTxt})`;
	const sentences = [theme.score ? `This ${noun} layer represents ${theme.label}.` : `This is a ${geomWord.toLowerCase()} feature layer.`];
	const detail: string[] = [];
	if (hasCount) detail.push(`${fmt(featureCount!)} ${geomWord.toLowerCase()} features`);
	if (fields.length) detail.push(`${fields.length} attribute field${fields.length === 1 ? "" : "s"}`);
	if (detail.length) sentences.push(`It contains ${detail.join(" and ")}.`);
	if (keyFields.length) {
		const more = fields.length > keyFields.length ? `, and ${fields.length - keyFields.length} more` : "";
		sentences.push(`Key attributes include ${keyFields.join(", ")}${more}.`);
	}
	sentences.push(`Described by ${CREDIT}.`);

	const tags = [CREDIT, ...(geom ? [geom] : [])];
	if (theme.score) tags.push(...theme.label.split(" ").filter((w) => w.length > 3 && !["and", "the"].includes(w)).map(capitalize));
	tags.push(...tokens(layerName).filter((w) => w.length > 2).map(capitalize));
	const seen = new Set<string>();
	const unique = tags.filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase())).slice(0, 12);

	return { theme: theme.theme, theme_label: theme.label, summary, description: sentences.join(" "), tags: unique,
		matched: theme.matched };
}

/** A description for a web map from its layers (names and, when known, their theme labels). */
export function webmapDescription(layers: { name: string; theme_label?: string }[]): string {
	const names = layers.map((l) => l.name).filter(Boolean);
	if (!names.length) return `This web map was assembled with ${CREDIT}.`;
	const themes: string[] = [];
	for (const l of layers) {
		const t = l.theme_label?.replace(/^(a|an)\s+/, "");
		if (t && t !== "geospatial dataset" && !themes.includes(t)) themes.push(t);
	}
	let text = `This web map brings together ${names.length} layer${names.length === 1 ? "" : "s"}: `
		+ `${names.slice(0, 6).join(", ")}${names.length > 6 ? "…" : ""}.`;
	if (themes.length) text += ` It covers ${themes.slice(0, 4).join(", ")}${themes.length > 4 ? "…" : ""}.`;
	return `${text} Described by ${CREDIT}.`;
}
