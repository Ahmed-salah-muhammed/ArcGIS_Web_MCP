/**
 * portal_rest: raw ArcGIS REST with the signed-in user's token, for anything the other tools do not cover.
 * GET sends the token in a header and cannot change anything (REST writes require POST). POST needs confirm=true
 * unless the operation is read-only (query, search, generateRenderer, ...). The token only goes to the portal and
 * its service hosts (hostAllowed).
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

export async function rest(ctx: Ctx, args: { path: string; method?: "GET" | "POST"; params?: Record<string, unknown>;
	confirm?: boolean; max_chars?: number }) {
	const method = (args.method ?? "GET").toUpperCase();
	if (method !== "GET" && method !== "POST") throw new ArcGISError("method must be GET or POST.", "bad_argument");
	if (!args.path) throw new ArcGISError("path is required (e.g. portals/self, or a .../FeatureServer/0 URL).", "bad_argument");
	const url = restUrl(ctx.props.portal, args.path);
	if (!hostAllowed(url, ctx.props.portal, ctx.extraHosts)) {
		throw new ArcGISError(`Host ${new URL(url).hostname} is not your portal or one of its services.`, "host_not_allowed");
	}
	const op = operationOf(url);
	const params = { ...(args.params ?? {}) };
	let res: unknown;
	if (method === "GET") {
		res = await (ctx.get ?? ctx.request)(url, params);
	} else {
		if (!READ_ONLY_POST.has(op)) requireConfirm(args.confirm, `POST to ${op}`, { url, params });
		res = await ctx.request(url, params);
		if (!READ_ONLY_POST.has(op)) audit(ctx.props, { tool: "portal_rest", action: "post", target: url, ok: true });
	}
	const text = JSON.stringify(res ?? null);
	const limit = Math.max(500, Math.min(Math.trunc(args.max_chars ?? 20000), 100000));
	const body: any = res;
	const next = body && typeof body === "object" && body.nextStart > 0 ? { start: body.nextStart }
		: body?.exceededTransferLimit ? { resultOffset: Number(params.resultOffset ?? 0) + (body.features?.length ?? 0) } : null;
	return { url, method, chars: text.length, next, response: text.length <= limit ? res : truncate(text, limit) };
}
