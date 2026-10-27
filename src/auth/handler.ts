/**
 * Sign-in with ArcGIS for MCP clients (the OAuthProvider's defaultHandler).
 *
 * MCP client -> /authorize (consent page, CSRF-protected) -> ArcGIS /oauth2/authorize (code + PKCE S256)
 * -> /callback (state checked against KV AND this browser's cookie, code exchanged with the verifier)
 * -> completeAuthorization(props) -> a short "connected" page that continues to the MCP client with its own code.
 *
 * Adapted from Cloudflare's remote-mcp-github-oauth demo; consent/CSRF/state/cookie helpers are its
 * workers-oauth-utils.ts. The PKCE verifier is kept server-side in KV for 10 minutes, never sent to the browser.
 */
import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import {
	type ArcGISProps,
	arcgisRequest,
	authorizeUrl,
	challengeFor,
	exchangeCode,
	grantUserId,
	randomVerifier,
	sharingUrl,
} from "../arcgis";
import {
	addApprovedClient,
	bindStateToSession,
	createOAuthState,
	generateCSRFProtection,
	isClientApproved,
	OAuthError,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./oauth-utils";
import { AUTHOR, clientDisplay, HOME_HEADERS, homePage, type Message, MESSAGE_HEADERS, messagePage } from "../pages";

type Bindings = Env & { OAUTH_PROVIDER: OAuthHelpers };

const app = new Hono<{ Bindings: Bindings }>();
const PKCE_PREFIX = "pkce:";
const SERVER_INFO = {
	name: "ArcGIS Web MCP",
	description: "Sign in with your own ArcGIS account: the tools act with your permissions, anything irreversible "
		+ "asks you first, and this server never sees your password.",
};

export function portalUrl(env: Pick<Env, "ARCGIS_PORTAL_URL">): string {
	return (env.ARCGIS_PORTAL_URL || "https://www.arcgis.com").replace(/\/+$/, "");
}

app.get("/", (c) => new Response(homePage(new URL(c.req.url).origin, AUTHOR), { headers: HOME_HEADERS }));

function statusPage(status: number, message: Message, headers: Record<string, string> = {}) {
	return new Response(messagePage(message, AUTHOR), { status, headers: { ...MESSAGE_HEADERS, ...headers } });
}

const START_AGAIN = "Start the connection again from your MCP client.";

app.get("/authorize", async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) return c.text("Invalid request", 400);

	if (await isClientApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
		const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie } = await bindStateToSession(stateToken);
		return redirectToArcGIS(c.req.raw, c.env, stateToken, { "Set-Cookie": setCookie });
	}

	const { token: csrfToken, setCookie } = generateCSRFProtection();
	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		csrfToken,
		server: { ...SERVER_INFO, author: AUTHOR },
		setCookie,
		state: { oauthReqInfo },
	});
});

app.post("/authorize", async (c) => {
	try {
		const formData = await c.req.raw.formData();
		validateCSRFToken(formData, c.req.raw);
		const encodedState = formData.get("state");
		if (!encodedState || typeof encodedState !== "string") return c.text("Missing state in form data", 400);

		let state: { oauthReqInfo?: AuthRequest };
		try {
			state = JSON.parse(atob(encodedState));
		} catch {
			return c.text("Invalid state data", 400);
		}
		if (!state.oauthReqInfo?.clientId) return c.text("Invalid request", 400);

		const approvedCookie = await addApprovedClient(c.req.raw, state.oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY);
		const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie: sessionCookie } = await bindStateToSession(stateToken);
		const headers = new Headers();
		headers.append("Set-Cookie", approvedCookie);
		headers.append("Set-Cookie", sessionCookie);
		return redirectToArcGIS(c.req.raw, c.env, stateToken, Object.fromEntries(headers));
	} catch (error) {
		if (error instanceof OAuthError) return error.toResponse();
		return c.text("Internal server error", 500);
	}
});

async function redirectToArcGIS(request: Request, env: Bindings, stateToken: string, headers: Record<string, string>) {
	const verifier = randomVerifier();
	await env.OAUTH_KV.put(PKCE_PREFIX + stateToken, verifier, { expirationTtl: 600 });
	const location = authorizeUrl({
		portal: portalUrl(env),
		clientId: env.ARCGIS_CLIENT_ID,
		redirectUri: new URL("/callback", request.url).href,
		state: stateToken,
		codeChallenge: await challengeFor(verifier),
	});
	return new Response(null, { status: 302, headers: { ...headers, location } });
}

app.get("/callback", async (c) => {
	let oauthReqInfo: AuthRequest;
	let clearCookie: string;
	try {
		const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
		oauthReqInfo = result.oauthReqInfo;
		clearCookie = result.clearCookie;
	} catch (error) {
		if (error instanceof OAuthError) return error.toResponse();
		return c.text("Internal server error", 500);
	}

	const state = c.req.query("state") ?? "";
	const verifier = await c.env.OAUTH_KV.get(PKCE_PREFIX + state);
	await c.env.OAUTH_KV.delete(PKCE_PREFIX + state);

	const upstreamError = c.req.query("error");
	if (upstreamError) {
		return statusPage(400, { tone: "error", title: "ArcGIS sign-in did not complete",
			lines: [c.req.query("error_description") ?? upstreamError, START_AGAIN] });
	}
	const code = c.req.query("code");
	if (!code || !verifier || !oauthReqInfo.clientId) {
		return statusPage(400, { tone: "error", title: "The sign-in expired",
			lines: ["The authorization code is missing, or the sign-in took longer than 10 minutes.", START_AGAIN] });
	}

	const portal = portalUrl(c.env);
	let props: ArcGISProps;
	try {
		const token = await exchangeCode({
			portal, clientId: c.env.ARCGIS_CLIENT_ID, redirectUri: new URL("/callback", c.req.url).href, code, verifier,
		});
		const base = sharingUrl(portal);
		const [me, org] = await Promise.all([
			arcgisRequest(`${base}/community/self`, {}, token.access_token),
			arcgisRequest(`${base}/portals/self`, {}, token.access_token),
		]);
		props = {
			username: me.username ?? token.username, fullName: me.fullName ?? null, role: me.role ?? null,
			orgId: org.id ?? me.orgId ?? null, orgName: org.name ?? null, isPortal: Boolean(org.isPortal), portal,
			accessToken: token.access_token, refreshToken: token.refresh_token ?? null,
			expiresAt: Date.now() + token.expires_in * 1000,
		};
	} catch (error) {
		return statusPage(502, { tone: "error", title: "ArcGIS sign-in failed",
			lines: [error instanceof Error ? error.message : String(error), START_AGAIN] });
	}

	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		metadata: { label: props.fullName ?? props.username },
		props, // encrypted by the provider; tools read it through getMcpAuthContext()
		request: oauthReqInfo,
		scope: oauthReqInfo.scope,
		userId: grantUserId(portal, props.username),
	});
	// A short "connected" page (with the developer credit) that continues to the client by itself after 2 s,
	// instead of a bare 302; the button covers browsers that hold back the automatic redirect (custom schemes).
	const client = clientDisplay((await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId).catch(() => null))?.clientName);
	const who = props.fullName ? `${props.fullName} (${props.username})` : props.username;
	return statusPage(200, {
		tone: "success",
		title: "Connected to ArcGIS",
		lines: [`Signed in as ${who}${props.orgName ? ` · ${props.orgName}` : ""}.`,
			`Returning you to ${client.name ?? "your MCP client"}…`],
		action: { href: redirectTo, label: client.name ? `Continue to ${client.name}` : "Continue", brand: client.brand },
		redirect: { href: redirectTo, seconds: 2 },
	}, clearCookie ? { "Set-Cookie": clearCookie } : {});
});

export { app as ArcGISHandler };
