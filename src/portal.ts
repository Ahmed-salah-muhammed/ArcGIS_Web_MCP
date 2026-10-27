/**
 * Read-only portal operations, ported from the ArcGIS Pro Salah MCP (portal/content.py, portal/layers.py) to
 * plain ArcGIS REST. Each function gets a context with the signed-in user's props and a `request` function, so
 * tests can inject a fake and no ArcGIS SDK is needed in the Worker.
 */
import { type ArcGISProps, ArcGISError, hostAllowed, sharingUrl } from "./arcgis";

export type Request = (url: string, params?: Record<string, unknown>) => Promise<any>;
export type Upload = (url: string, params: Record<string, unknown>,
	file: { name: string; content: string; type: string }) => Promise<any>;

export type Ctx = {
	props: ArcGISProps;
	request: Request; // POST, token in the body
	get?: Request; // GET, token in a header (portal_rest); falls back to request
	upload?: Upload; // multipart addItem (portal_publish)
	extraHosts?: string[];
	wait?: (ms: number) => Promise<void>; // job polling (tests pass a no-op)
};

const ID_RE = /^[0-9a-f]{32}$/i;
const LAYER_URL_RE = /\/(FeatureServer|MapServer)\/\d+\/?$/i;
const SERVICE_URL_RE = /\/(FeatureServer|MapServer)\/?$/i;
export const MAX_ROWS = 1000;

// --- small helpers ---------------------------------------------------------------------------------

export function iso(ms: unknown): string | null {
	if (ms === null || ms === undefined || ms === "" || ms === -1 || ms === 0) return null;
	const n = Number(ms);
	if (!Number.isFinite(n)) return null;
	try {
		return new Date(n).toISOString().replace(/\.\d{3}Z$/, "Z");
	} catch {
		return null;
	}
}

export function truncate(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit)}... [${text.length - limit} more chars]` : text;
}

function itemUrl(portal: string, id: string): string {
	return `${portal.replace(/\/+$/, "")}/home/item.html?id=${id}`;
}

export function itemCard(it: any, portal: string, full = false): Record<string, unknown> {
	const out: Record<string, unknown> = {
		id: it.id, title: it.title, type: it.type, owner: it.owner, access: it.access, url: it.url ?? null,
		modified: iso(it.modified), item_url: it.id ? itemUrl(portal, it.id) : null,
	};
	if (full) {
		const kw: string[] = it.typeKeywords ?? [];
		Object.assign(out, {
			snippet: it.snippet ?? null,
			description: it.description ? truncate(String(it.description), 1500) : null,
			tags: it.tags ?? [], typeKeywords: kw, created: iso(it.created), size_bytes: it.size ?? null,
			numViews: it.numViews ?? null, extent: it.extent ?? null,
			is_hosted: kw.includes("Hosted Service"), is_view: kw.includes("View Service"),
		});
	}
	return out;
}

export function requireAllowed(ctx: Ctx, url: string): void {
	if (!hostAllowed(url, ctx.props.portal, ctx.extraHosts)) {
		throw new ArcGISError(
			`Refusing to send your token to ${new URL(url).hostname}: it is not your portal or one of its services.`,
			"host_not_allowed",
		);
	}
}

// --- whoami -----------------------------------------------------------------------------------------

export async function whoami(ctx: Ctx) {
	const base = sharingUrl(ctx.props.portal);
	const me = await ctx.request(`${base}/community/self`);
	const privileges: string[] = me.privileges ?? [];
	return {
		username: me.username, fullName: me.fullName ?? null, role: me.role ?? null, roleId: me.roleId ?? null,
		user_type: me.userLicenseTypeId ?? null, org: ctx.props.orgName, org_id: me.orgId ?? ctx.props.orgId,
		platform: ctx.props.isPortal ? "ArcGIS Enterprise" : "ArcGIS Online", portal: ctx.props.portal,
		can: {
			create_items: privileges.includes("portal:user:createItem"),
			publish_features: privileges.includes("portal:publisher:publishFeatures"),
			share_public: privileges.includes("portal:user:shareToPublic"),
		},
	};
}

// --- search ------------------------------------------------------------------------------------------

export type SearchArgs = {
	query?: string;
	item_type?: string;
	owner?: string;
	tags?: string[];
	max_items?: number;
	start?: number;
	sort_field?: string;
	sort_order?: "asc" | "desc";
	outside_org?: boolean;
};

/** Same query rules as the Python portal_search: owner "me", exact type via `filter`, org-only on ArcGIS Online. */
export function buildSearchQuery(args: SearchArgs, props: ArcGISProps): { q: string; filter?: string } {
	const parts: string[] = [];
	const query = (args.query ?? "").trim();
	if (query) parts.push(query);
	if (args.owner) parts.push(`owner:${args.owner.toLowerCase() === "me" ? props.username : args.owner}`);
	for (const t of args.tags ?? []) parts.push(`tags:"${t}"`);
	if (!args.outside_org && !props.isPortal && props.orgId && !/orgid:/i.test(query)) parts.push(`orgid:${props.orgId}`);
	const q = parts.map((p) => (/\sOR\s/.test(p) ? `(${p})` : p)).join(" AND ") || "*";
	return { q, filter: args.item_type ? `type:"${args.item_type}"` : undefined };
}

export async function search(ctx: Ctx, args: SearchArgs) {
	const { q, filter } = buildSearchQuery(args, ctx.props);
	const num = Math.max(1, Math.min(Math.trunc(args.max_items ?? 20), 100));
	const res = await ctx.request(`${sharingUrl(ctx.props.portal)}/search`, {
		q, filter, num, start: Math.max(1, Math.trunc(args.start ?? 1)),
		sortField: args.sort_field ?? "modified", sortOrder: args.sort_order ?? (args.sort_field ? "asc" : "desc"),
	});
	const results: any[] = res.results ?? [];
	return {
		query: q, total: res.total ?? results.length, count: results.length,
		next_start: res.nextStart && res.nextStart > 0 ? res.nextStart : null,
		items: results.map((r) => itemCard(r, ctx.props.portal)),
	};
}

// --- item ----------------------------------------------------------------------------------------------

export function requireId(id: string): string {
	const clean = String(id ?? "").trim();
	if (!ID_RE.test(clean)) {
		throw new ArcGISError(`'${id}' is not an item id (32 hex characters). Titles are not unique: find the id with portal_search.`,
			"bad_argument");
	}
	return clean;
}

async function serviceLayers(ctx: Ctx, serviceUrl: string) {
	requireAllowed(ctx, serviceUrl);
	const svc = await ctx.request(serviceUrl.replace(/\/+$/, ""));
	const base = serviceUrl.replace(/\/+$/, "");
	const layers = (svc.layers ?? []).map((l: any) => ({ kind: "layer", id: l.id, name: l.name,
		geometryType: l.geometryType ?? null, url: `${base}/${l.id}` }));
	const tables = (svc.tables ?? []).map((t: any) => ({ kind: "table", id: t.id, name: t.name, geometryType: null,
		url: `${base}/${t.id}` }));
	return { service: svc, candidates: [...layers, ...tables] };
}

export async function item(ctx: Ctx, args: { action?: "get" | "data"; item_id: string; max_chars?: number }) {
	const id = requireId(args.item_id);
	const base = sharingUrl(ctx.props.portal);
	if ((args.action ?? "get") === "data") {
		const data = await ctx.request(`${base}/content/items/${id}/data`);
		const text = JSON.stringify(data ?? null);
		const limit = Math.max(500, Math.min(Math.trunc(args.max_chars ?? 20000), 100000));
		return { item_id: id, chars: text.length, data: text.length <= limit ? data : truncate(text, limit) };
	}
	const it = await ctx.request(`${base}/content/items/${id}`);
	const out = itemCard(it, ctx.props.portal, true);
	if (["Feature Service", "Map Service"].includes(it.type) && it.url) {
		try {
			out.layers = (await serviceLayers(ctx, it.url)).candidates.map((c: any, index: number) => ({ index, ...c }));
		} catch (e) {
			out.layers_error = e instanceof Error ? e.message : String(e);
		}
	}
	return out;
}

// --- layer query -------------------------------------------------------------------------------------------

export type LayerQueryArgs = {
	action?: "describe" | "query" | "count" | "stats";
	target: string;
	layer?: number | string;
	where?: string;
	fields?: string[];
	limit?: number;
	offset?: number;
	order_by?: string;
	return_geometry?: boolean;
	stats?: (string | Record<string, unknown>)[];
	group_by?: string;
};

/** item id / .../FeatureServer / .../FeatureServer/N -> the layer URL (index = position in layers + tables, or name). */
export async function resolveLayerUrl(ctx: Ctx, target: string, layer: number | string = 0): Promise<string> {
	const t = String(target ?? "").trim();
	if (LAYER_URL_RE.test(t)) {
		requireAllowed(ctx, t);
		return t.replace(/\/+$/, "");
	}
	let serviceUrl: string;
	if (SERVICE_URL_RE.test(t)) {
		serviceUrl = t;
	} else if (ID_RE.test(t)) {
		const it = await ctx.request(`${sharingUrl(ctx.props.portal)}/content/items/${t}`);
		if (!it.url) throw new ArcGISError(`Item ${t} (${it.type}) has no service URL.`, "bad_argument");
		serviceUrl = it.url;
	} else {
		throw new ArcGISError("target must be an item id or a .../FeatureServer[/N] URL.", "bad_argument");
	}
	const { candidates } = await serviceLayers(ctx, serviceUrl);
	if (!candidates.length) throw new ArcGISError("The service has no layers or tables.", "bad_argument");
	if (typeof layer === "number" || /^\d+$/.test(String(layer))) {
		const idx = Number(layer);
		const hit = candidates[idx];
		if (!hit) {
			throw new ArcGISError(`layer ${idx} out of range; the service has ${candidates.length} layer(s)/table(s): `
				+ candidates.map((c) => c.name).join(", "), "bad_argument");
		}
		return hit.url;
	}
	const named = candidates.find((c) => String(c.name).toLowerCase() === String(layer).toLowerCase());
	if (!named) throw new ArcGISError(`No layer named '${layer}'.`, "bad_argument");
	return named.url;
}

export function parseStats(stats: (string | Record<string, unknown>)[]): Record<string, unknown>[] {
	const kinds: Record<string, string> = { avg: "avg", mean: "avg", sum: "sum", min: "min", max: "max", count: "count",
		stddev: "stddev", var: "var" };
	return stats.map((s) => {
		if (typeof s === "object" && s) return s;
		const [kindRaw, field] = String(s).split(":", 2);
		const kind = kinds[(kindRaw ?? "").toLowerCase()];
		if (!kind || !field) {
			throw new ArcGISError(`Bad stat '${s}'; use kind:field (sum|avg|min|max|count|stddev|var).`, "bad_argument");
		}
		return { statisticType: kind, onStatisticField: field, outStatisticFieldName: `${kind}_${field}`.slice(0, 30) };
	});
}

/** Feature JSON -> attribute rows; date fields -> ISO 8601 UTC; huge geometries are replaced by a note. */
export function rowsFrom(features: any[], fields: any[] | undefined, withGeometry: boolean): Record<string, unknown>[] {
	const dates = new Set((fields ?? []).filter((f) => f.type === "esriFieldTypeDate").map((f) => f.name));
	return features.map((f) => {
		const row: Record<string, unknown> = { ...(f.attributes ?? {}) };
		for (const k of Object.keys(row)) if (dates.has(k)) row[k] = iso(row[k]);
		if (withGeometry && f.geometry) {
			const text = JSON.stringify(f.geometry);
			row._geometry = text.length <= 4000 ? f.geometry : { note: `geometry of ${text.length} chars omitted` };
		}
		return row;
	});
}

function describeFields(fields: any[] = []) {
	return fields.map((f) => ({
		name: f.name, type: String(f.type ?? "").replace("esriFieldType", ""), alias: f.alias ?? null,
		nullable: f.nullable ?? null, editable: f.editable ?? null, length: f.length ?? null,
		domain: f.domain ? { name: f.domain.name, type: f.domain.type, codes: f.domain.codedValues?.length ?? null,
			range: f.domain.range ?? null } : null,
	}));
}

export async function layerQuery(ctx: Ctx, args: LayerQueryArgs) {
	const action = args.action ?? "query";
	const url = await resolveLayerUrl(ctx, args.target, args.layer ?? 0);
	const where = args.where?.trim() || "1=1";
	if (action === "describe") {
		const p = await ctx.request(url);
		const count = await ctx.request(`${url}/query`, { where: "1=1", returnCountOnly: true });
		return {
			name: p.name, type: p.type, url, geometryType: p.geometryType ?? null, objectIdField: p.objectIdField ?? null,
			globalIdField: p.globalIdField || null, displayField: p.displayField || null, count: count.count ?? null,
			capabilities: p.capabilities ?? null, maxRecordCount: p.maxRecordCount ?? null,
			hasAttachments: p.hasAttachments ?? null, editorTracking: p.editFieldsInfo ?? null,
			viewDefinitionQuery: p.viewDefinitionQuery || null, isView: p.isView ?? null,
			spatialReference: p.extent?.spatialReference ?? null, fields: describeFields(p.fields),
		};
	}
	if (action === "count") {
		const res = await ctx.request(`${url}/query`, { where, returnCountOnly: true });
		return { where, count: res.count ?? null };
	}
	if (action === "stats") {
		if (!args.stats?.length) {
			throw new ArcGISError('stats is required, e.g. ["sum:POP", "avg:INCOME", "count:OBJECTID"].', "bad_argument");
		}
		const res = await ctx.request(`${url}/query`, {
			where, outStatistics: parseStats(args.stats), groupByFieldsForStatistics: args.group_by,
			orderByFields: args.order_by, returnGeometry: false,
		});
		return { where, group_by: args.group_by ?? null, rows: rowsFrom((res.features ?? []).slice(0, MAX_ROWS), [], false) };
	}
	if (action !== "query") throw new ArcGISError("action must be describe | query | count | stats.", "bad_action");
	const limit = Math.max(1, Math.min(Math.trunc(args.limit ?? 50), MAX_ROWS));
	const offset = Math.max(0, Math.trunc(args.offset ?? 0));
	const res = await ctx.request(`${url}/query`, {
		where, outFields: args.fields?.length ? args.fields.join(",") : "*", returnGeometry: Boolean(args.return_geometry),
		resultOffset: offset, resultRecordCount: limit, orderByFields: args.order_by,
	});
	const rows = rowsFrom(res.features ?? [], res.fields, Boolean(args.return_geometry));
	const more = rows.length >= limit || Boolean(res.exceededTransferLimit);
	const hasDates = (res.fields ?? []).some((f: any) => f.type === "esriFieldTypeDate");
	return {
		where, count: rows.length, offset, next_offset: more ? offset + rows.length : null, rows,
		dates: hasDates ? "ISO 8601 UTC (stored as epoch ms)" : null,
	};
}
