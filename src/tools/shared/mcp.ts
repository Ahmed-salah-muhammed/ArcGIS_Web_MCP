/**
 * The MCP side every tool shares: the tool definition shape, the {"ok": ..., "data": ...} envelope, the tool
 * annotations, and input fields several tools take. Writes follow one rail: anything irreversible, bulk, public or
 * credit-spending returns code "confirm_required" with a preview until called again with confirm=true.
 */
import { z } from "zod";
import { type ArcGISProps, ArcGISError, scrub } from "../../arcgis";
import type { Ctx } from "./context";
import { ConfirmRequired } from "./safety";

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
export type Envelope = { ok: true; data: unknown } | ({ ok: false; error: string; code: string } & Record<string, unknown>);

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;
export const WRITES = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

/** One MCP tool: what the model sees (name, title, description, input schema, annotations) and its handler. */
export type ToolSpec<S extends z.ZodObject<any> = z.ZodObject<any>> = {
	name: string;
	title: string;
	description: string;
	schema: S;
	annotations: typeof READ_ONLY | typeof WRITES | typeof DESTRUCTIVE;
	handle: (ctx: Ctx, args: z.infer<S>) => Promise<unknown>;
};

export function defineTool<S extends z.ZodObject<any>>(spec: ToolSpec<S>): ToolSpec<S> {
	return spec;
}

/** Run a tool body; errors become {"ok": false, "error", "code"} (plus preview/hint for confirm_required), scrubbed. */
export async function envelope(props: ArcGISProps, body: () => Promise<unknown>): Promise<Envelope> {
	try {
		return { ok: true, data: await body() };
	} catch (e) {
		const code = e instanceof ArcGISError ? e.code : "exception";
		const error = scrub(e instanceof Error ? e.message : String(e), props.accessToken, props.refreshToken);
		const extra = e instanceof ConfirmRequired ? { preview: e.preview, ...(e.hint ? { hint: e.hint } : {}) } : {};
		return { ok: false, error, code, ...extra };
	}
}

/** The envelope as an MCP tool result. */
export async function run(props: ArcGISProps, body: () => Promise<unknown>): Promise<ToolResult> {
	const result = await envelope(props, body);
	return { content: [{ type: "text", text: JSON.stringify(result) }], ...(result.ok ? {} : { isError: true }) };
}

export const confirm = z.boolean().optional().describe("Set true only after the user approved the preview");
export const target = z.string().describe("Item id, or a .../FeatureServer or .../FeatureServer/N URL");
export const layer = z.union([z.number().int().min(0), z.string()]).optional().describe("Index in layers+tables, or name; default 0");
