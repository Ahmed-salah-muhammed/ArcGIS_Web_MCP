/**
 * One signed-in user may send a bounded number of MCP requests a minute (MCP_RATE_LIMITER in wrangler.jsonc; one
 * tool call is one request). Past it the answer is 429 with Retry-After instead of more ArcGIS traffic in that
 * user's name. A deployment without the binding, or a limiter that fails, lets the request through.
 */
import { type ArcGISProps, grantUserId } from "./arcgis";

export type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

export async function rateLimited(limiter: Limiter | undefined, props: ArcGISProps | undefined): Promise<Response | null> {
	if (!limiter || !props?.username) return null;
	try {
		if ((await limiter.limit({ key: grantUserId(props.portal, props.username) })).success) return null;
	} catch {
		return null;
	}
	return new Response(JSON.stringify({ jsonrpc: "2.0", id: null,
		error: { code: -32029, message: "Too many requests from this account; wait a minute and try again." } }),
	{ status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60" } });
}
