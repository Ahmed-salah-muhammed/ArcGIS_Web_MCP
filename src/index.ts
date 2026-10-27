/**
 * ArcGIS Web MCP - a remote MCP server on Cloudflare Workers.
 *
 * The Worker is the OAuth server for MCP clients (@cloudflare/workers-oauth-provider) and an OAuth client of
 * ArcGIS: every user signs in with their own ArcGIS account, and the tools act with that user's permissions.
 * The ArcGIS tokens live only in the grant's props, which the provider stores encrypted.
 */
import OAuthProvider, { GrantType, OAuthError, type TokenExchangeCallbackOptions } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { type ArcGISProps, ArcGISError, refreshAccessToken } from "./arcgis";
import { ArcGISHandler } from "./arcgis-handler";
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO } from "./pages";
import { registerTools } from "./tools";

// ArcGIS authorization-code access tokens live ~30 minutes. MCP access tokens expire a little earlier, so the
// client refreshes first and tokenExchangeCallback renews the ArcGIS token on that refresh.
const ACCESS_TOKEN_TTL = 25 * 60;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function extraHosts(): string[] {
	return (env.ARCGIS_EXTRA_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
}

function createServer() {
	const server = new McpServer(MCP_SERVER_INFO, { instructions: MCP_INSTRUCTIONS });
	const props = getMcpAuthContext()?.props as ArcGISProps | undefined;
	if (props?.accessToken) registerTools(server, props, extraHosts());
	return server;
}

const mcpHandler = createMcpHandler(createServer);
const apiHandler = {
	fetch(request: Request, bindings: Env, ctx: ExecutionContext) {
		return mcpHandler(request, bindings, ctx);
	},
} satisfies ExportedHandler<Env>;

function ttlFor(expiresAt: number): number {
	return Math.max(60, Math.min(ACCESS_TOKEN_TTL, Math.floor((expiresAt - Date.now()) / 1000) - 60));
}

export async function tokenExchange(options: TokenExchangeCallbackOptions) {
	const props = options.props as ArcGISProps;
	if (options.grantType === GrantType.AUTHORIZATION_CODE) {
		return { accessTokenTTL: ttlFor(props.expiresAt) };
	}
	if (options.grantType !== GrantType.REFRESH_TOKEN) return;
	if (props.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
		return { accessTokenTTL: ttlFor(props.expiresAt) };
	}
	if (!props.refreshToken) {
		throw new OAuthError("invalid_grant", { description: "No ArcGIS refresh token; sign in again." });
	}
	try {
		const t = await refreshAccessToken({ portal: props.portal, clientId: env.ARCGIS_CLIENT_ID, refreshToken: props.refreshToken });
		const newProps: ArcGISProps = {
			...props,
			accessToken: t.access_token,
			refreshToken: t.refresh_token ?? props.refreshToken,
			expiresAt: Date.now() + t.expires_in * 1000,
		};
		return { newProps, accessTokenTTL: ttlFor(newProps.expiresAt) };
	} catch (e) {
		if (e instanceof ArcGISError && e.code === "invalid_grant") {
			throw new OAuthError("invalid_grant", { description: "ArcGIS sign-in expired or was revoked; sign in again." });
		}
		throw new OAuthError("temporarily_unavailable", {
			description: "Could not refresh the ArcGIS token; try again shortly.",
			statusCode: 503,
			headers: { "Retry-After": "30" },
		});
	}
}

export default new OAuthProvider({
	allowPlainPKCE: false,
	apiHandler,
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: ArcGISHandler as any,
	tokenEndpoint: "/token",
	accessTokenTTL: ACCESS_TOKEN_TTL,
	tokenExchangeCallback: tokenExchange,
});
