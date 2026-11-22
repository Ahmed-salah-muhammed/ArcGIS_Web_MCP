/**
 * The MCP tools. Each lives in its own folder: index.ts defines it (name, description, input schema, annotations,
 * handler) and handler.ts does the work; code several tools use is in shared/. Names, arguments and the
 * {"ok": ..., "data": ...} envelope match the ArcGIS Pro Salah MCP portal tools.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import type { ArcGISProps } from "../arcgis";
import { tool as portalApp } from "./portal_app";
import { tool as portalArcade } from "./portal_arcade";
import { tool as portalAudit } from "./portal_audit";
import { batchTool } from "./portal_batch";
import { tool as portalFolders } from "./portal_folders";
import { tool as portalGeocode } from "./portal_geocode";
import { tool as portalGeometry } from "./portal_geometry";
import { tool as portalGroups } from "./portal_groups";
import { tool as portalItem } from "./portal_item";
import { tool as portalLayerEdit } from "./portal_layer_edit";
import { tool as portalLayerQuery } from "./portal_layer_query";
import { tool as portalLayerSchema } from "./portal_layer_schema";
import { tool as portalMap } from "./portal_map";
import { tool as portalPublish } from "./portal_publish";
import { tool as portalRest } from "./portal_rest";
import { tool as portalSearch } from "./portal_search";
import { tool as portalShare } from "./portal_share";
import { tool as portalSurvey123 } from "./portal_survey123";
import { tool as portalWhoami } from "./portal_whoami";
import { type Ctx, DEFAULT_MAX_SUBREQUESTS, makeCtx } from "./shared/context";
import { envelope, toResult, type ToolSpec } from "./shared/mcp";
import { logCall } from "./shared/safety";

/** Everything portal_batch may call, in the order clients list them. */
const BATCHABLE = [portalWhoami, portalSearch, portalGeocode, portalGeometry, portalAudit, portalItem, portalFolders, portalShare,
	portalPublish, portalLayerQuery, portalLayerEdit, portalLayerSchema, portalMap, portalArcade, portalApp, portalSurvey123, portalGroups,
	portalRest] as ToolSpec[];

export const TOOLS: ToolSpec[] = [...BATCHABLE, batchTool(new Map(BATCHABLE.map((t) => [t.name, t]))) as ToolSpec];

/**
 * Progress for long jobs (publish, export): sent only when the client asked for it with a progressToken, and never
 * allowed to fail the call it reports on.
 */
function progressTo(extra: any): Ctx["progress"] {
	const token = extra?.mcpReq?._meta?.progressToken;
	const notify = extra?.mcpReq?.notify;
	if (token === undefined || token === null || typeof notify !== "function") return undefined;
	return (message, done = 0, total) => {
		void Promise.resolve()
			.then(() => notify({ method: "notifications/progress",
				params: { progressToken: token, progress: done, ...(total ? { total } : {}), message } }))
			.catch(() => undefined);
	};
}

export function registerTools(server: McpServer, props: ArcGISProps, extraHosts: string[] = [],
	maxSubrequests = DEFAULT_MAX_SUBREQUESTS, options: { structured?: boolean } = {}): void {
	for (const t of TOOLS) {
		server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.schema, annotations: t.annotations },
			async (args: any, extra: any) => {
				const ctx = makeCtx(props, extraHosts, maxSubrequests, { progress: progressTo(extra) }); // a fresh budget per call
				const started = Date.now();
				const result = await envelope(ctx.props, () => t.handle(ctx, args));
				logCall(props, { tool: t.name, action: typeof args?.action === "string" ? args.action : null, ok: result.ok,
					code: result.ok ? null : result.code, duration_ms: Date.now() - started, requests: ctx.budget?.used ?? 0 });
				return toResult(result, options.structured);
			});
	}
}
