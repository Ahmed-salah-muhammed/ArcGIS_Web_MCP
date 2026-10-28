/**
 * A static check of an Arcade expression: it is not run (Arcade's engine is part of the ArcGIS Maps SDK, too big
 * for a Worker), but the mistakes that break expressions most often are caught before anything is saved:
 * unbalanced brackets and strings, fields the layer does not have, $variables the context does not provide,
 * FeatureSet functions where they are not allowed, and SQL habits (AND, OR, <>).
 */
import { type ArcadeContext, FUNCTIONS, NO_FEATURESETS, PROFILE_VARIABLES } from "./library";

export type ArcadeCheck = { valid: boolean; errors: string[]; warnings: string[]; fields_used: string[]; variables: string[] };

const KEYWORDS = new Set(["if", "else", "for", "while", "function", "return", "var", "in", "break", "continue", "import", "export"]);

/** The expression with strings and comments blanked out (same length), plus the strings' contents and any error. */
export function scan(expr: string): { code: string; strings: string[]; error: string | null } {
	let code = "";
	const strings: string[] = [];
	let i = 0;
	while (i < expr.length) {
		const c = expr[i];
		const next = expr[i + 1];
		if (c === "/" && next === "/") {
			while (i < expr.length && expr[i] !== "\n") { code += " "; i++; }
		} else if (c === "/" && next === "*") {
			const end = expr.indexOf("*/", i + 2);
			if (end < 0) return { code, strings, error: "A /* comment is never closed." };
			code += " ".repeat(end + 2 - i);
			i = end + 2;
		} else if (c === '"' || c === "'" || c === "`") {
			let j = i + 1;
			let text = "";
			while (j < expr.length && expr[j] !== c) {
				if (expr[j] === "\\") { text += expr[j + 1] ?? ""; j += 2; continue; }
				if (c !== "`" && expr[j] === "\n") break;
				text += expr[j];
				j++;
			}
			if (expr[j] !== c) return { code, strings, error: `A string starting with ${c} is never closed (line ${expr.slice(0, i).split("\n").length}).` };
			strings.push(text);
			code += c + " ".repeat(j - i - 1) + c;
			i = j + 1;
		} else {
			code += c;
			i++;
		}
	}
	return { code, strings, error: null };
}

function brackets(code: string): string | null {
	const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
	const stack: { ch: string; line: number }[] = [];
	let line = 1;
	for (const ch of code) {
		if (ch === "\n") line++;
		if ("([{".includes(ch)) stack.push({ ch, line });
		else if (ch in pairs) {
			const open = stack.pop();
			if (!open || open.ch !== pairs[ch]) return `Unexpected '${ch}' on line ${line}.`;
		}
	}
	const left = stack.pop();
	return left ? `'${left.ch}' opened on line ${left.line} is never closed.` : null;
}

export function checkArcade(expression: string, context: ArcadeContext, fields?: string[]): ArcadeCheck {
	const errors: string[] = [];
	const warnings: string[] = [];
	const expr = String(expression ?? "");
	if (!expr.trim()) return { valid: false, errors: ["The expression is empty."], warnings, fields_used: [], variables: [] };
	const { code, error } = scan(expr);
	if (error) errors.push(error);
	const unbalanced = error ? null : brackets(code);
	if (unbalanced) errors.push(unbalanced);

	const variables = [...new Set([...code.matchAll(/\$[A-Za-z_]\w*/g)].map((m) => m[0].toLowerCase()))];
	for (const v of variables) {
		if (!PROFILE_VARIABLES[context].includes(v)) {
			errors.push(`${v} is not available in a ${context} expression (available: ${PROFILE_VARIABLES[context].join(", ")}).`);
		}
	}
	if (/\b(AND|OR|NOT)\b/.test(code)) errors.push("Arcade uses && (and), || (or) and ! (not), not AND / OR / NOT.");
	if (/<>/.test(code)) errors.push("Arcade uses != for 'not equal', not <>.");
	if (/\bif\s*\([^()]*[^=!<>]=[^=][^()]*\)/.test(code)) warnings.push("An if (...) uses a single '='; comparisons need '=='.");

	const declared = new Set([...code.matchAll(/\bfunction\s+([A-Za-z_]\w*)/g)].map((m) => m[1].toLowerCase()));
	for (const m of code.matchAll(/(?<![.$\w])([A-Za-z_]\w*)\s*\(/g)) {
		const name = m[1].toLowerCase();
		if (KEYWORDS.has(name) || declared.has(name)) continue;
		if (NO_FEATURESETS.includes(context) && /^(featureset|filter|intersects|groupby|orderby|getfeatureset)/.test(name)) {
			errors.push(`${m[1]}() reads other data, which ${context} expressions cannot do.`);
		} else if (!FUNCTIONS.has(name)) {
			warnings.push(`${m[1]}() is not an Arcade function I know; check the spelling (it may also be newer than this list).`);
		}
	}

	// field names: $feature.NAME, $feature["NAME"], $datapoint.NAME, DomainName($feature, "NAME"), Expects($feature, "A", "B")
	const stripped = expr.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
	const used = new Set<string>();
	for (const m of stripped.matchAll(/\$(?:feature|originalfeature|datapoint)\s*\.\s*([A-Za-z_]\w*)/gi)) used.add(m[1]);
	for (const m of stripped.matchAll(/\$(?:feature|originalfeature|datapoint)\s*\[\s*["']([^"']+)["']\s*\]/gi)) used.add(m[1]);
	for (const m of stripped.matchAll(/\b(?:DomainName|DomainCode|Domain)\s*\(\s*\$feature\s*,\s*["']([^"']+)["']/gi)) used.add(m[1]);
	for (const m of stripped.matchAll(/\bExpects\s*\(\s*\$feature\s*((?:,\s*["'][^"']+["']\s*)+)\)/gi)) {
		for (const f of m[1].matchAll(/["']([^"']+)["']/g)) if (f[1] !== "*") used.add(f[1]);
	}
	const fieldsUsed = [...used];
	if (fields?.length) {
		const known = new Set(fields.map((f) => f.toLowerCase()));
		for (const f of fieldsUsed) {
			if (!known.has(f.toLowerCase())) errors.push(`The layer has no field '${f}'. Fields: ${fields.join(", ")}`);
		}
	}
	if (/\{[A-Z_]+\}/.test(code)) errors.push("A {PLACEHOLDER} from a template was not filled in.");
	return { valid: errors.length === 0, errors, warnings: [...new Set(warnings)], fields_used: fieldsUsed, variables };
}
