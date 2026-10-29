/**
 * portal_rest: raw ArcGIS REST with the signed-in user's token, for anything the other tools do not cover.
 * GET sends the token in a header and cannot change anything (REST writes require POST). POST needs confirm=true
 * unless the operation is read-only (query, search, generateRenderer, ...). The token only goes to the portal and
 * its service hosts (hostAllowed). A POST can carry a file (multipart), e.g. an item resource: ArcGIS sanitizes a
 * resource sent as `text` like HTML, a file it keeps as is. A GET of something that is not JSON (a resource file)
 * returns its text.
 */
import { ArcGISError, hostAllowed, sharingUrl } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { truncate } from "../shared/format";
import { audit, requireConfirm } from "../shared/safety";

export const READ_ONLY_POST = new Set(["query", "search", "generaterenderer", "queryrelatedrecords", "queryattachments",
	"querydomains", "querytopfeatures", "identify", "find", "validatesql", "querybins", "queryanalytic", "info", "self",
	"estimate", "querydatastatistics"]);

export function restUrl(portal: string, path: string): string {
	return /^https?:\/\//i.test(path) ? path : `${sharingUrl(portal)}/${path.replace(/^\/+/, "")}`;
}

export function operationOf(url: string): string {
	return new URL(url).pathname.replace(/\/+$/, "").split("/").pop()!.toLowerCase();
}

export type RestFile = { name: string; content: unknown; type?: string; field?: string };

export async function rest(ctx: Ctx, args: { path: string; method?: "GET" | "POST"; params?: Record<string, unknown>;
	file?: RestFile; confirm?: boolean; max_chars?: number }) {
	const method = (args.method ?? "GET").toUpperCase();
	if (method !== "GET" && method !== "POST") throw new ArcGISError("method must be GET or POST.", "bad_argument");
	if (!args.path) throw new ArcGISError("path is required (e.g. portals/self, or a .../FeatureServer/0 URL).", "bad_argument");
	const url = restUrl(ctx.props.portal, args.path);
	if (!hostAllowed(url, ctx.props.portal, ctx.extraHosts)) {
		throw new ArcGISError(`Host ${new URL(url).hostname} is not your portal or one of its services.`, "host_not_allowed");
	}
	const op = operationOf(url);
	const params = { ...(args.params ?? {}) };
	const limit = Math.max(500, Math.min(Math.trunc(args.max_chars ?? 20000), 100000));
	const file = args.file && fileOf(args.file);
	if (file && method !== "POST") throw new ArcGISError("A file is sent with method POST.", "bad_argument");
	let res: unknown;
	if (method === "GET") {
		try {
			res = await (ctx.get ?? ctx.request)(url, params);
		} catch (e) {
			if (!(e instanceof ArcGISError) || e.code !== "not_json" || e.body === undefined) throw e;
			return { url, method, chars: e.body.length, next: null, raw: true, response: truncate(e.body, limit) };
		}
	} else {
		if (!READ_ONLY_POST.has(op)) {
			const sending = file ? { file: { name: file.name, type: file.type, chars: file.content.length } } : {};
			requireConfirm(args.confirm, `POST to ${op}`, { url, params, ...sending });
		}
		const upload = ctx.upload;
		if (file && !upload) throw new ArcGISError("Files cannot be sent from here.", "bad_argument");
		res = file && upload ? await upload(url, params, file) : await ctx.request(url, params);
		if (!READ_ONLY_POST.has(op)) audit(ctx.props, { tool: "portal_rest", action: "post", target: url, ok: true });
	}
	const text = JSON.stringify(res ?? null);
	const body: any = res;
	const next = body && typeof body === "object" && body.nextStart > 0 ? { start: body.nextStart }
		: body?.exceededTransferLimit ? { resultOffset: Number(params.resultOffset ?? 0) + (body.features?.length ?? 0) } : null;
	return { url, method, chars: text.length, next, response: text.length <= limit ? res : truncate(text, limit) };
}

/** The file to send: text as is, anything else as JSON; the type follows the name unless given. */
function fileOf(f: RestFile) {
	if (!f.name || /[\\/]/.test(f.name)) throw new ArcGISError("file.name is a file name such as config.json.", "bad_argument");
	if (f.content === undefined || f.content === null) throw new ArcGISError("file.content is required.", "bad_argument");
	const content = typeof f.content === "string" ? f.content : JSON.stringify(f.content);
	const type = f.type ?? (/\.json$/i.test(f.name) ? "application/json"
		: /\.(html?|xml|csv|txt)$/i.test(f.name) ? "text/plain" : "application/octet-stream");
	return { name: f.name, content, type, ...(f.field ? { field: f.field } : {}) };
}
