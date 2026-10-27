/**
 * MCP tool registration. Names, arguments and the {"ok": ..., "data": ...} envelope match the ArcGIS Pro Salah MCP
 * (Python) portal tools, so prompts and habits carry over. Writes follow the same rail: anything irreversible,
 * bulk, public or credit-spending returns code "confirm_required" with a preview until called with confirm=true.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type ArcGISProps, ArcGISError, arcgisGet, arcgisRequest, arcgisUpload, scrub } from "./arcgis";
import * as content from "./content";
import * as groupsMod from "./groups";
import * as layerWrites from "./layer-writes";
import * as maps from "./maps";
import * as portal from "./portal";
import * as restMod from "./rest";
import { ConfirmRequired } from "./safety";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;
const WRITES = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

export function makeCtx(props: ArcGISProps, extraHosts: string[] = []): portal.Ctx {
	return {
		props,
		extraHosts,
		request: (url, params = {}) => arcgisRequest(url, params, props.accessToken),
		get: (url, params = {}) => arcgisGet(url, params, props.accessToken),
		upload: (url, params, file) => arcgisUpload(url, params, file, props.accessToken),
	};
}

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

const confirm = z.boolean().optional().describe("Set true only after the user approved the preview");
const target = z.string().describe("Item id, or a .../FeatureServer or .../FeatureServer/N URL");
const layer = z.union([z.number().int().min(0), z.string()]).optional().describe("Index in layers+tables, or name; default 0");

export function registerTools(server: McpServer, props: ArcGISProps, extraHosts: string[] = []): void {
	const ctx = makeCtx(props, extraHosts);

	server.registerTool("portal_whoami", {
		title: "Who am I",
		description: "The signed-in ArcGIS user: username, role, user type, org, platform (ArcGIS Online / Enterprise) and what the account can do.",
		annotations: READ_ONLY,
	}, async () => run(props, () => portal.whoami(ctx)));

	server.registerTool("portal_search", {
		title: "Search items",
		description: 'Search portal items (newest first): query syntax title:"Parcels" AND tags:roads; item_type exact ("Feature Service", "Web Map", "CSV", "Dashboard", ...); owner ("me" ok). Org-only on ArcGIS Online unless outside_org. Page with start/next_start. Titles are not unique - continue with item ids.',
		inputSchema: z.object({
			query: z.string().optional().describe("Search text / ArcGIS query syntax"),
			item_type: z.string().optional().describe('Exact item type, e.g. "Feature Service"'),
			owner: z.string().optional().describe('Owner username, or "me"'),
			tags: z.array(z.string()).optional(),
			max_items: z.number().int().min(1).max(100).optional().describe("Default 20"),
			start: z.number().int().min(1).optional().describe("1-based paging start (use next_start)"),
			sort_field: z.string().optional().describe("e.g. modified, title, numViews; default modified"),
			sort_order: z.enum(["asc", "desc"]).optional(),
			outside_org: z.boolean().optional().describe("Include public items from other orgs"),
		}),
		annotations: READ_ONLY,
	}, async (args) => run(props, () => portal.search(ctx, args)));

	server.registerTool("portal_item", {
		title: "Item: read and manage",
		description: "One item by id: get (card, sharing level, tags, is_hosted/is_view, every layer/table of a service) | data (its JSON) | update (properties: title, snippet, description, tags...; and/or data JSON) | move (folder name/id; omit for root) | protect | unprotect | delete (confirm; refuses protected items; delete views before their source layer) | dependencies (what it uses / what uses it).",
		inputSchema: z.object({
			item_id: z.string().describe("32-character item id"),
			action: z.enum(["get", "data", "update", "move", "protect", "unprotect", "delete", "dependencies"]).optional().describe("Default get"),
			properties: z.record(z.string(), z.unknown()).optional().describe("For update"),
			data: z.unknown().optional().describe("For update: the item's JSON (e.g. a web map)"),
			folder: z.string().optional().describe("For move: folder name or id; omit for root"),
			permanent: z.boolean().optional().describe("For delete: skip the recycle bin"),
			max_chars: z.number().int().min(500).max(100000).optional().describe("For data; default 20000"),
			confirm,
		}),
		annotations: DESTRUCTIVE,
	}, async (args) => run(props, () => {
		const action = args.action ?? "get";
		if (action === "get" || action === "data") return portal.item(ctx, { ...args, action });
		return content.itemWrite(ctx, { ...args, action });
	}));

	server.registerTool("portal_folders", {
		title: "Folders",
		description: "Your folders: list | create (no-op if it exists) | delete (confirm; items inside are deleted too).",
		inputSchema: z.object({
			action: z.enum(["list", "create", "delete"]).optional().describe("Default list"),
			name: z.string().optional(),
			confirm,
		}),
		annotations: DESTRUCTIVE,
	}, async (args) => run(props, () => content.folders(ctx, args)));

	server.registerTool("portal_share", {
		title: "Share items",
		description: "Share items: level private | org | everyone (everyone = public, needs confirm), add_groups / remove_groups (ids or exact titles; ambiguous titles are refused). Returns before/after per item.",
		inputSchema: z.object({
			item_ids: z.array(z.string()).min(1),
			level: z.enum(["private", "org", "everyone"]).optional(),
			add_groups: z.array(z.string()).optional(),
			remove_groups: z.array(z.string()).optional(),
			confirm,
		}),
		annotations: WRITES,
	}, async (args) => run(props, () => content.share(ctx, args)));

	server.registerTool("portal_publish", {
		title: "Publish a hosted feature layer",
		description: "Create a hosted feature layer from ONE source: csv_text (with latitude_field+longitude_field, or address_fields = geocoding credits, confirm), geojson_text, url (a public https CSV/GeoJSON), or item_id (an uploaded CSV / GeoJSON / Shapefile / File Geodatabase item). Up to 5 MB of text. Returns the published item and its layer URLs.",
		inputSchema: z.object({
			title: z.string(),
			csv_text: z.string().optional(),
			geojson_text: z.string().optional(),
			url: z.string().optional(),
			item_id: z.string().optional(),
			folder: z.string().optional().describe("Created if missing; omit for root"),
			tags: z.array(z.string()).optional(),
			snippet: z.string().optional(),
			latitude_field: z.string().optional(),
			longitude_field: z.string().optional(),
			address_fields: z.record(z.string(), z.string()).optional().describe('e.g. {"Address":"ADDR","City":"CITY"}'),
			confirm,
		}),
		annotations: WRITES,
	}, async (args) => run(props, () => content.publish(ctx, args)));

	server.registerTool("portal_layer_query", {
		title: "Query a feature layer",
		description: 'Read a feature layer or table: describe (fields + domains, capabilities, count, view filter) | query (paged rows: limit <= 1000, offset/next_offset; dates as ISO UTC; geometry only if return_geometry) | count | stats (["sum:POP","avg:INCOME"], group_by).',
		inputSchema: z.object({
			target,
			action: z.enum(["describe", "query", "count", "stats"]).optional().describe("Default query"),
			layer,
			where: z.string().optional().describe("SQL where clause; default 1=1"),
			fields: z.array(z.string()).optional().describe("Fields to return; default all"),
			limit: z.number().int().min(1).max(portal.MAX_ROWS).optional().describe("Default 50"),
			offset: z.number().int().min(0).optional(),
			order_by: z.string().optional().describe("e.g. POP DESC"),
			return_geometry: z.boolean().optional(),
			stats: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional()
				.describe('kind:field shorthand ("sum:POP") or raw outStatistics objects'),
			group_by: z.string().optional().describe("Field(s) to group stats by"),
		}),
		annotations: READ_ONLY,
	}, async (args) => run(props, () => portal.layerQuery(ctx, args)));

	server.registerTool("portal_layer_edit", {
		title: "Edit layer data",
		description: 'Change layer data: edit (adds/updates as attribute dicts or features - updates need the object id field; deletes = ids or where (confirm); batched, each result checked; dry_run previews a before/after diff; max 5000 edits) | calculate (where + expressions [{"field","value"} | {"field","sqlExpression"}]; confirm) | truncate (all rows of a hosted layer; confirm).',
		inputSchema: z.object({
			target,
			action: z.enum(["edit", "calculate", "truncate"]).optional().describe("Default edit"),
			layer,
			adds: z.array(z.unknown()).optional(),
			updates: z.array(z.unknown()).optional(),
			deletes: z.array(z.union([z.number(), z.string()])).optional().describe("Object ids to delete"),
			where: z.string().optional().describe("calculate: rows to change; edit: delete what matches"),
			expressions: z.union([z.array(z.record(z.string(), z.unknown())), z.record(z.string(), z.unknown())]).optional(),
			use_global_ids: z.boolean().optional(),
			rollback_on_failure: z.boolean().optional(),
			batch_size: z.number().int().min(1).max(2000).optional().describe("Default 500"),
			dry_run: z.boolean().optional(),
			confirm,
		}),
		annotations: DESTRUCTIVE,
	}, async (args) => run(props, () => layerWrites.edit(ctx, args)));

	server.registerTool("portal_layer_schema", {
		title: "Shape a hosted layer",
		description: 'Shape a HOSTED layer: add_field (fields=[{"name","type":TEXT|SHORT|LONG|BIGINT|DOUBLE|FLOAT|DATE|DATEONLY|GUID,"length","alias"}]; never on a view) | delete_field (field_names; confirm) | capabilities ("Query,Create,Update,Delete,Editing,Sync,Extract") | renderer (Esri JSON, or {"type":"unique","field"} / {"type":"class_breaks","field","classes"} / {"type":"simple","color":[r,g,b]} built from the data) | labels (label_field or Arcade label_expression) | create_view (view_name, view_where filter, view_fields; read-only).',
		inputSchema: z.object({
			target,
			action: z.enum(["add_field", "delete_field", "capabilities", "renderer", "labels", "create_view"]),
			layer,
			fields: z.array(z.object({ name: z.string(), type: z.string().optional(), length: z.number().int().optional(),
				alias: z.string().optional(), nullable: z.boolean().optional() })).optional(),
			field_names: z.array(z.string()).optional(),
			capabilities: z.string().optional(),
			renderer: z.record(z.string(), z.any()).optional(),
			label_field: z.string().optional(),
			label_expression: z.string().optional(),
			view_name: z.string().optional(),
			view_where: z.string().optional(),
			view_fields: z.array(z.string()).optional(),
			confirm,
		}),
		annotations: DESTRUCTIVE,
	}, async (args) => run(props, () => layerWrites.schema(ctx, args)));

	server.registerTool("portal_map", {
		title: "Web maps",
		description: "Web maps: create (title + layers = item ids/layer URLs; basemap omitted = your org's default, or a gallery title/alias e.g. topo-vector, satellite, gray-vector; auto popups; renderer spec as in portal_layer_schema; definition_expression filter) | describe | add_layers | remove_layers | popup (layer, popup_fields, popup_title) | renderer | filter | basemap.",
		inputSchema: z.object({
			action: z.enum(["create", "describe", "add_layers", "remove_layers", "popup", "renderer", "filter", "basemap"]).optional().describe("Default describe"),
			item_id: z.string().optional().describe("The web map (all actions but create)"),
			title: z.string().optional(),
			layers: z.array(z.union([z.string(), z.number()])).optional(),
			basemap: z.string().optional(),
			tags: z.array(z.string()).optional(),
			folder: z.string().optional(),
			snippet: z.string().optional(),
			popups: z.boolean().optional().describe("Default true"),
			renderer: z.record(z.string(), z.any()).optional(),
			layer: z.union([z.string(), z.number()]).optional().describe("Target layer: title, id, url or index"),
			popup_fields: z.array(z.string()).optional(),
			popup_title: z.string().optional(),
			definition_expression: z.string().optional(),
		}),
		annotations: WRITES,
	}, async (args) => run(props, () => maps.webmap(ctx, args)));

	server.registerTool("portal_groups", {
		title: "Groups",
		description: "Groups (group = id or exact title): search | get (members and items) | create (title, access private|org|public - public needs confirm) | update | delete (confirm; items stay).",
		inputSchema: z.object({
			action: z.enum(["search", "get", "create", "update", "delete"]).optional().describe("Default search"),
			group: z.string().optional(),
			query: z.string().optional(),
			title: z.string().optional(),
			tags: z.array(z.string()).optional(),
			description: z.string().optional(),
			access: z.enum(["private", "org", "public"]).optional(),
			is_invitation_only: z.boolean().optional(),
			max_groups: z.number().int().min(1).max(100).optional(),
			confirm,
		}),
		annotations: DESTRUCTIVE,
	}, async (args) => run(props, () => groupsMod.groups(ctx, args)));

	server.registerTool("portal_rest", {
		title: "Raw ArcGIS REST",
		description: 'Raw REST with your sign-in, for anything the other tools do not cover: path relative to <portal>/sharing/rest/ (e.g. "portals/self", "content/users/<me>") or an absolute URL on your portal / its services. GET is free and cannot change anything; POST needs confirm unless read-only (query, search, generateRenderer...).',
		inputSchema: z.object({
			path: z.string(),
			method: z.enum(["GET", "POST"]).optional().describe("Default GET"),
			params: z.record(z.string(), z.unknown()).optional(),
			max_chars: z.number().int().min(500).max(100000).optional(),
			confirm,
		}),
		annotations: DESTRUCTIVE,
	}, async (args) => run(props, () => restMod.rest(ctx, args)));
}
