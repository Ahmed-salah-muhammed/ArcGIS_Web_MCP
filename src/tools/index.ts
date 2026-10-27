/**
 * The MCP tools. Each lives in its own folder: index.ts registers it (name, description, input schema) and
 * handler.ts does the work; code several tools use is in shared/. Names, arguments and the
 * {"ok": ..., "data": ...} envelope match the ArcGIS Pro Salah MCP portal tools.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import type { ArcGISProps } from "../arcgis";
import * as portalFolders from "./portal_folders";
import * as portalGroups from "./portal_groups";
import * as portalItem from "./portal_item";
import * as portalLayerEdit from "./portal_layer_edit";
import * as portalLayerQuery from "./portal_layer_query";
import * as portalLayerSchema from "./portal_layer_schema";
import * as portalMap from "./portal_map";
import * as portalPublish from "./portal_publish";
import * as portalRest from "./portal_rest";
import * as portalSearch from "./portal_search";
import * as portalShare from "./portal_share";
import * as portalWhoami from "./portal_whoami";
import { makeCtx } from "./shared/context";

/** In the order clients list them. */
const TOOLS = [portalWhoami, portalSearch, portalItem, portalFolders, portalShare, portalPublish, portalLayerQuery,
	portalLayerEdit, portalLayerSchema, portalMap, portalGroups, portalRest];

export function registerTools(server: McpServer, props: ArcGISProps, extraHosts: string[] = []): void {
	const ctx = makeCtx(props, extraHosts);
	for (const tool of TOOLS) tool.register(server, ctx);
}
