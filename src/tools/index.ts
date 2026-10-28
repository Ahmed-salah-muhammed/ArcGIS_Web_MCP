/**
 * The MCP tools. Each lives in its own folder: index.ts defines it (name, description, input schema, annotations,
 * handler) and handler.ts does the work; code several tools use is in shared/. Names, arguments and the
 * {"ok": ..., "data": ...} envelope match the ArcGIS Pro Salah MCP portal tools.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import type { ArcGISProps } from "../arcgis";
import { tool as portalApp } from "./portal_app";
import { tool as portalArcade } from "./portal_arcade";
import { batchTool } from "./portal_batch";
import { tool as portalFolders } from "./portal_folders";
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
import { DEFAULT_MAX_SUBREQUESTS, makeCtx } from "./shared/context";
import { run, type ToolSpec } from "./shared/mcp";

/** Everything portal_batch may call, in the order clients list them. */
const BATCHABLE = [portalWhoami, portalSearch, portalItem, portalFolders, portalShare, portalPublish, portalLayerQuery,
	portalLayerEdit, portalLayerSchema, portalMap, portalArcade, portalApp, portalSurvey123, portalGroups, portalRest] as ToolSpec[];

export const TOOLS: ToolSpec[] = [...BATCHABLE, batchTool(new Map(BATCHABLE.map((t) => [t.name, t]))) as ToolSpec];

export function registerTools(server: McpServer, props: ArcGISProps, extraHosts: string[] = [],
	maxSubrequests = DEFAULT_MAX_SUBREQUESTS): void {
	for (const t of TOOLS) {
		server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.schema, annotations: t.annotations },
			async (args: any) => {
				const ctx = makeCtx(props, extraHosts, maxSubrequests); // a fresh request budget per call
				return run(ctx.props, () => t.handle(ctx, args));
			});
	}
}
