/**
 * The survey's feature layer, built the way the ArcGIS API for Python 2.4.3 builds it when it publishes an XLSForm
 * (apps/survey123/_publish_functions.py: _field_types, _gen_schema, _append_labels, _xml2sd): objectid + globalid,
 * one field per question (strings 255 long, single choices with a cvd_<name> coded-value domain; time, barcode, rank,
 * calculate and hidden questions are text, as _field_types has them), attachments when there is a photo, signature,
 * file or audio question, a point / line / polygon layer for a geopoint / geotrace / geoshape question (the symbols
 * of _xml2sd) and a table otherwise.
 */
import type { NamedQuestion } from "./xlsform";

const FIELD_TYPE: Record<string, string | null> = { text: "esriFieldTypeString", textarea: "esriFieldTypeString",
	email: "esriFieldTypeString", single: "esriFieldTypeString", dropdown: "esriFieldTypeString", multi: "esriFieldTypeString",
	integer: "esriFieldTypeInteger", number: "esriFieldTypeDouble", date: "esriFieldTypeDate", datetime: "esriFieldTypeDate",
	time: "esriFieldTypeString", barcode: "esriFieldTypeString", rank: "esriFieldTypeString", calculate: "esriFieldTypeString",
	hidden: "esriFieldTypeString", geopoint: null, geotrace: null, geoshape: null, image: null, signature: null, file: null, audio: null,
	note: null };
const ATTACHED = new Set(["image", "signature", "file", "audio"]);
const RENDERERS: Record<string, { geometryType: string; symbol: unknown; description?: string }> = {
	geopoint: { geometryType: "esriGeometryPoint", description: "Survey Data Locations", symbol: { type: "esriSMS", style: "esriSMSCircle", size: 8,
		angle: 0, xoffset: 0, yoffset: 0, color: [255, 0, 0, 255], outline: { color: [255, 255, 0, 255], width: 1 } } },
	geotrace: { geometryType: "esriGeometryPolyline", symbol: { color: [0, 178, 255, 255], style: "esriSLSSolid", type: "esriSLS", width: 2 } },
	geoshape: { geometryType: "esriGeometryPolygon", symbol: { color: [0, 178, 255, 48], outline: { color: [0, 178, 255, 255],
		style: "esriSLSSolid", type: "esriSLS", width: 2 }, style: "esriSFSSolid", type: "esriSFS" } },
};

export function surveyFields(questions: NamedQuestion[]) {
	const fields: Record<string, unknown>[] = [
		{ name: "objectid", type: "esriFieldTypeOID", alias: "ObjectID", nullable: false, editable: false, domain: null, defaultValue: null },
		{ name: "globalid", type: "esriFieldTypeGlobalID", alias: "GlobalID", length: 38, nullable: false, editable: false, domain: null,
			defaultValue: null },
	];
	for (const q of questions) {
		const type = FIELD_TYPE[q.spec.type];
		if (!type) continue;
		const single = q.spec.type === "single" || q.spec.type === "dropdown";
		fields.push({ name: q.name, alias: q.label, type, length: type === "esriFieldTypeString" ? 255 : null,
			domain: single ? { type: "codedValue", name: `cvd_${q.name}`, codedValues: q.choices.map((c) => ({ name: c.label, code: c.name })) } : null });
	}
	return fields;
}

const INDEXES = [{ name: "GlobalIDIndex", fields: "globalid", isAscending: false, isUnique: true, description: "GlobalID index" }];

/** addToDefinition for the empty survey service: {layers: [point / line / polygon layer]} or {tables: [table]}. */
export function surveySchema(layerName: string, questions: NamedQuestion[]) {
	const fields = surveyFields(questions);
	const hasAttachments = questions.some((q) => ATTACHED.has(q.spec.type));
	const geo = questions.find((q) => RENDERERS[q.spec.type]);
	if (geo) {
		const r = RENDERERS[geo.spec.type];
		return { layers: [{ allowGeometryUpdates: true, capabilities: "Create", defaultVisibility: true, displayField: "objectid",
			drawingInfo: { labelingInfo: null, transparency: 0, renderer: { type: "simple", ...(r.description ? { description: r.description } : {}),
				label: layerName, symbol: r.symbol } },
			fields, geometryType: r.geometryType, globalIdField: "globalid", hasAttachments, hasM: false, hasZ: false,
			htmlPopupType: "esriServerHTMLPopupTypeAsHTMLText", id: 0, isDataVersioned: false, maxScale: 0, minScale: 0, name: layerName,
			objectIdField: "objectid", propagateVisibleFields: true, relationships: [], supportedQueryFormats: "JSON",
			supportsAdvancedQueries: true, supportsRollbackOnFailureParameter: true, supportsStatistics: true,
			templates: [{ description: "", name: "New Feature", prototype: { attributes: {} } }], type: "Feature Layer", indexes: INDEXES }] };
	}
	return { tables: [{ capabilities: "Create", defaultVisibility: true, displayField: "objectid", editFieldsInfo: null, fields,
		globalIdField: "globalid", hasAttachments, htmlPopupType: "esriServerHTMLPopupTypeNone", id: 0, isDataVersioned: false,
		maxRecordCount: 1000, name: layerName, objectIdField: "objectid", ownershipBasedAccessControlForFeatures: null,
		propagateVisibleFields: true, relationships: [], supportedQueryFormats: "JSON, AMF", supportsAdvancedQueries: true,
		supportsRollbackOnFailureParameter: true, supportsStatistics: true, syncCanReturnChanges: false, type: "Table",
		useStandardizedQueries: true, indexes: INDEXES }] };
}
