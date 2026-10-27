/**
 * The MCP side every tool shares: the {"ok": ..., "data": ...} envelope, the tool annotations, and input fields
 * several tools take. Writes follow one rail: anything irreversible, bulk, public or credit-spending returns code
 * "confirm_required" with a preview until called again with confirm=true.
 */
import { z } from "zod";
import { type ArcGISProps, ArcGISError, scrub } from "../../arcgis";
import { ConfirmRequired } from "./safety";

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;
export const WRITES = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

/** Run a tool body and wrap the result; errors become {"ok": false, "error", "code"} with tokens scrubbed. */
export async function run(props: ArcGISProps, body: () => Promise<unknown>): Promise<ToolResult> {
	try {
		const data = await body();
		return { content: [{ type: "text", text: JSON.stringify({ ok: true, data }) }] };
	} catch (e) {
		const code = e instanceof ArcGISError ? e.code : "exception";
		const message = scrub(e instanceof Error ? e.message : String(e), props.accessToken, props.refreshToken);
		const extra = e instanceof ConfirmRequired ? { preview: e.preview, ...(e.hint ? { hint: e.hint } : {}) } : {};
		return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, code, ...extra }) }], isError: true };
	}
}

export const confirm = z.boolean().optional().describe("Set true only after the user approved the preview");
export const target = z.string().describe("Item id, or a .../FeatureServer or .../FeatureServer/N URL");
export const layer = z.union([z.number().int().min(0), z.string()]).optional().describe("Index in layers+tables, or name; default 0");
