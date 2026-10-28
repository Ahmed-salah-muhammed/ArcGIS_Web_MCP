/**
 * XLSForm for Survey123 Connect, written as a real .xlsx without any library: the three XLSForm sheets (survey,
 * choices, settings) as inline-string worksheets in a stored (uncompressed) ZIP. Survey123's own converter
 * (survey123.arcgis.com/api/xls2xform, the one the ArcGIS API for Python calls) checks it before it is saved.
 */
import { ArcGISError } from "../../arcgis";
import { type QuestionSpec, questionName } from "./draft";

type Row = (string | undefined)[];

const XLSFORM_TYPE: Record<string, string> = { text: "text", textarea: "text", number: "decimal", integer: "integer", date: "date",
	datetime: "dateTime", single: "select_one", dropdown: "select_one", multi: "select_multiple", email: "text", image: "image",
	note: "note", geopoint: "geopoint", time: "time", barcode: "barcode", signature: "image", file: "file", audio: "audio",
	geotrace: "geotrace", geoshape: "geoshape", rank: "rank", calculate: "calculate", hidden: "hidden" };
const LISTED = new Set(["select_one", "select_multiple", "rank"]);
const GEO = new Set(["geopoint", "geotrace", "geoshape"]);
const DEFAULT_APPEARANCE: Record<string, string> = { textarea: "multiline", dropdown: "minimal", signature: "signature" };

/** A choice's name: its value when that is already a valid name, otherwise a slug (select_multiple needs no spaces). */
function choiceName(value: string, used: Set<string>): string {
	let name = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value) ? value : value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "choice";
	if (/^\d/.test(name) && !/^[A-Za-z_]/.test(value)) name = `_${name}`;
	let out = name;
	for (let i = 2; used.has(out); i++) out = `${name}_${i}`;
	used.add(out);
	return out;
}

/** A question as the XLSForm names it; the published layer's fields use the same names. */
export type NamedQuestion = { spec: QuestionSpec; name: string; label: string; choices: { name: string; label: string }[] };

const SURVEY_HEADER = ["type", "name", "label", "hint", "required", "required_message", "appearance", "relevant", "constraint",
	"constraint_message", "calculation", "default", "readonly", "choice_filter"];

/** ${name} references in an expression must be questions of the form. */
function checkRefs(expr: string | undefined, names: Set<string>, what: string) {
	for (const m of String(expr ?? "").matchAll(/\$\{([^}]*)\}/g)) {
		if (!names.has(m[1])) throw new ArcGISError(`${what}: \${${m[1]}} is not a question name. Names: ${[...names].join(", ")}`, "bad_argument");
	}
}

/**
 * The XLSForm rows: survey (type, name, label, hint, required, appearance, relevant, constraint, calculation, default,
 * readonly, choice_filter...; consecutive questions of one group inside begin group / end group), choices (with a filter
 * column when choices have one), settings (style pages with pages=true), plus the questions with the names given to
 * them and the form id (the layer's name when published).
 */
export function xlsformRows(title: string, specs: QuestionSpec[], opts: { pages?: boolean } = {}) {
	if (specs.filter((s) => GEO.has(s.type)).length > 1) {
		throw new ArcGISError("A survey has one location question (geopoint, geotrace or geoshape): it is the layer's geometry.", "bad_argument");
	}
	const survey: Row[] = [SURVEY_HEADER];
	const filtered = specs.some((s) => s.choices?.some((c) => typeof c === "object" && c.filter !== undefined));
	const choices: Row[] = [filtered ? ["list_name", "name", "label", "filter"] : ["list_name", "name", "label"]];
	const questions: NamedQuestion[] = [];
	const used = new Set<string>(["location"]);
	// names first, so expressions can point at any question
	const names = specs.map((s, i) => {
		if (s.name !== undefined) {
			if (!/^[A-Za-z_][A-Za-z0-9_]{0,30}$/.test(s.name)) throw new ArcGISError(`questions[${i}] name '${s.name}' must be letters, digits, _ (31 at most).`, "bad_argument");
			if (used.has(s.name)) throw new ArcGISError(`Two questions are named '${s.name}'.`, "bad_argument");
			used.add(s.name);
			return s.name;
		}
		return null;
	}).map((n, i) => {
		const s = specs[i];
		if (n) return n;
		if (s.type === "geopoint") return "location";
		const label = String(s.label ?? "").trim();
		if (!label) throw new ArcGISError(`questions[${i}] needs a label${["calculate", "hidden"].includes(s.type) ? " or a name" : ""}.`, "bad_argument");
		return questionName(label, used);
	});
	const all = new Set(names);
	let group: string | null = null;
	const close = () => { if (group !== null) survey.push(["end group"]); group = null; };
	for (const [i, s] of specs.entries()) {
		const type = XLSFORM_TYPE[s.type];
		if (!type) throw new ArcGISError(`Unknown question type '${s.type}'.`, "bad_argument");
		const name = names[i];
		const label = String(s.label ?? "").trim() || name;
		const what = `'${label}'`;
		if (s.type === "calculate" && !s.calculation) throw new ArcGISError(`${what} (calculate) needs calculation.`, "bad_argument");
		for (const k of ["relevant", "constraint", "calculation", "default", "choice_filter"] as const) checkRefs(s[k], all, `${what} ${k}`);
		if (s.constraint_message && !s.constraint) throw new ArcGISError(`${what}: constraint_message needs constraint.`, "bad_argument");
		if (s.choice_filter && !LISTED.has(type)) throw new ArcGISError(`${what}: choice_filter is for questions with choices.`, "bad_argument");
		const wanted = s.group?.trim() || null;
		if (wanted !== group) {
			close();
			if (wanted) {
				const gName = questionName(`${wanted}_group`, used);
				survey.push(["begin group", gName, wanted, undefined, undefined, undefined, opts.pages ? "field-list" : undefined]);
				group = wanted;
			}
		}
		let fullType = type;
		const named: { name: string; label: string }[] = [];
		if (LISTED.has(type)) {
			const list = `${name}_list`;
			fullType = `${type} ${list}`;
			if (!s.choices?.length) throw new ArcGISError(`${what} (${s.type}) needs choices.`, "bad_argument");
			const taken = new Set<string>();
			for (const c of s.choices) {
				const { value, label: text, filter } = typeof c === "string" ? { value: c, label: c, filter: undefined } : c;
				const choice = { name: choiceName(String(value), taken), label: String(text ?? value) };
				named.push(choice);
				choices.push(filtered ? [list, choice.name, choice.label, filter] : [list, choice.name, choice.label]);
			}
		}
		questions.push({ spec: s, name, label, choices: named });
		const email = s.type === "email";
		const appearance = s.appearance ?? DEFAULT_APPEARANCE[s.type];
		const noLabel = s.type === "calculate" || s.type === "hidden";
		survey.push([fullType, name, noLabel && !s.label ? undefined : label, s.hint, s.required ? "yes" : undefined, s.required_message,
			appearance, s.relevant, s.constraint ?? (email ? "regex(., '^[^@ ]+@[^@ ]+\\.[^@ ]+$')" : undefined),
			s.constraint_message ?? (email && !s.constraint ? "Enter a valid email address" : undefined), s.calculation, s.default,
			s.read_only ? "yes" : undefined, s.choice_filter]);
	}
	close();
	let formId = questionName(title, new Set()) || "survey";
	if (formId.startsWith("_")) formId = `survey${formId}`.slice(0, 31);
	const version = new Date().toISOString().slice(0, 10).replace(/-/g, "");
	const settings: Row[] = opts.pages ? [["form_title", "form_id", "version", "style"], [title, formId, version, "pages"]]
		: [["form_title", "form_id", "version"], [title, formId, version]];
	return { survey, choices, settings, questions, formId };
}

// --- a minimal .xlsx ---------------------------------------------------------------------------------------------

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
	// characters XML 1.0 does not allow
	.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function column(i: number): string {
	let s = "";
	for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
	return s;
}

function sheetXml(rows: Row[]): string {
	const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => (v === undefined || v === "" ? ""
		: `<c r="${column(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`)).join("")}</row>`).join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

let CRC_TABLE: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
	if (!CRC_TABLE) {
		CRC_TABLE = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			CRC_TABLE[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const b of data) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/** A ZIP with every file stored (no compression), which every Office reader accepts; a name ending in / is a folder. */
export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
	const enc = new TextEncoder();
	const local: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	const d = new Date();
	const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
	const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
	for (const f of files) {
		const name = enc.encode(f.name);
		const crc = crc32(f.data);
		const head = new DataView(new ArrayBuffer(30));
		[[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, f.data.length, 4],
			[22, f.data.length, 4], [26, name.length, 2], [28, 0, 2]].forEach(([at, v, n]) => (n === 4 ? head.setUint32(at, v, true) : head.setUint16(at, v, true)));
		local.push(new Uint8Array(head.buffer), name, f.data);
		const dir = new DataView(new ArrayBuffer(46));
		[[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4],
			[20, f.data.length, 4], [24, f.data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4],
			[42, offset, 4]].forEach(([at, v, n]) => (n === 4 ? dir.setUint32(at, v, true) : dir.setUint16(at, v, true)));
		central.push(new Uint8Array(dir.buffer), name);
		offset += 30 + name.length + f.data.length;
	}
	const size = central.reduce((s, p) => s + p.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	[[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4], [20, 0, 2]]
		.forEach(([at, v, n]) => (n === 4 ? end.setUint32(at, v, true) : end.setUint16(at, v, true)));
	const parts = [...local, ...central, new Uint8Array(end.buffer)];
	const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
	let at = 0;
	for (const p of parts) { out.set(p, at); at += p.length; }
	return out;
}

/** The .xlsx bytes of named sheets. */
export function xlsx(sheets: { name: string; rows: Row[] }[]): Uint8Array {
	const enc = new TextEncoder();
	const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
	const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
	const files = [
		{ name: "[Content_Types].xml", text: `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
		{ name: "_rels/.rels", text: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
		{ name: "xl/workbook.xml", text: `${head}<workbook ${ns}><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
		{ name: "xl/_rels/workbook.xml.rels", text: `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>` },
		...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s.rows) })),
	];
	return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.text) })));
}

export function xlsformFile(title: string, specs: QuestionSpec[], opts: { pages?: boolean } = {}): Uint8Array {
	const { survey, choices, settings } = xlsformRows(title, specs, opts);
	return xlsx([{ name: "survey", rows: survey }, { name: "choices", rows: choices }, { name: "settings", rows: settings }]);
}
