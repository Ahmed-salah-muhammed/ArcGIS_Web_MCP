/**
 * ArcGIS REST for a Worker: OAuth 2.0 authorization code + PKCE (S256), authenticated requests, and the host
 * allowlist that keeps a user's token from ever being sent anywhere but their portal and its services.
 *
 * Facts from Esri's REST reference (users-groups-and-items/authorize, /token):
 * - `response_type=code` + `code_challenge` (S256) works without a client secret (public client).
 * - Authorization-code access tokens live ~30 minutes; the refresh token defaults to 2 weeks
 *   (`expiration` in minutes, up to 90 days, capped by the org's maxTokenExpirationMinutes).
 * - ArcGIS often answers HTTP 200 with `{"error": {...}}`, so the body decides success, not the status.
 */

/** What the OAuth provider stores (encrypted) per grant and hands to every tool call. Never returned to clients. */
export type ArcGISProps = {
	username: string;
	fullName: string | null;
	role: string | null;
	orgId: string | null;
	orgName: string | null;
	isPortal: boolean;
	portal: string; // e.g. https://www.arcgis.com or https://gis.example.com/portal
	accessToken: string;
	refreshToken: string | null;
	expiresAt: number; // epoch ms
};

export type TokenResponse = {
	access_token: string;
	expires_in: number;
	refresh_token?: string;
	refresh_token_expires_in?: number;
	username?: string;
};

export class ArcGISError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly status?: number,
		readonly body?: string, // the response itself when it was not JSON (a file, a page)
	) {
		super(message);
		this.name = "ArcGISError";
	}
}

export type Fetch = typeof fetch;

export function sharingUrl(portal: string): string {
	return `${portal.replace(/\/+$/, "")}/sharing/rest`;
}

// --- PKCE (RFC 7636) ---------------------------------------------------------------------------

export function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes -> a 43-character verifier (allowed alphabet: A-Z a-z 0-9 - . _ ~). */
export function randomVerifier(): string {
	return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeFor(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return base64url(new Uint8Array(digest));
}

// --- OAuth endpoints ----------------------------------------------------------------------------

export function authorizeUrl(opts: {
	portal: string;
	clientId: string;
	redirectUri: string;
	state: string;
	codeChallenge: string;
	refreshTokenMinutes?: number;
}): string {
	const url = new URL(`${sharingUrl(opts.portal)}/oauth2/authorize`);
	url.searchParams.set("client_id", opts.clientId);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("redirect_uri", opts.redirectUri);
	url.searchParams.set("state", opts.state);
	url.searchParams.set("code_challenge", opts.codeChallenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("expiration", String(opts.refreshTokenMinutes ?? 20160)); // 2 weeks
	return url.href;
}

async function tokenCall(portal: string, form: Record<string, string>, fetchImpl: Fetch): Promise<TokenResponse> {
	const res = await fetchImpl(`${sharingUrl(portal)}/oauth2/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ ...form, f: "json" }).toString(),
	});
	let body: any;
	try {
		body = await res.json();
	} catch {
		throw new ArcGISError(`Token endpoint returned HTTP ${res.status} without JSON.`, "token_error", res.status);
	}
	if (body?.error || !body?.access_token) {
		const err = typeof body?.error === "object" ? body.error : body ?? {};
		const message = err.error_description || err.message || err.error || `HTTP ${res.status}`;
		const invalid = /invalid|expired|revoked/i.test(String(message)) || err.error === "invalid_grant";
		throw new ArcGISError(`ArcGIS token request failed: ${message}`, invalid ? "invalid_grant" : "token_error",
			Number(err.code) || res.status);
	}
	return body as TokenResponse;
}

export function exchangeCode(
	opts: { portal: string; clientId: string; redirectUri: string; code: string; verifier: string },
	fetchImpl: Fetch = fetch,
): Promise<TokenResponse> {
	return tokenCall(opts.portal, {
		grant_type: "authorization_code",
		client_id: opts.clientId,
		redirect_uri: opts.redirectUri,
		code: opts.code,
		code_verifier: opts.verifier,
	}, fetchImpl);
}

export function refreshAccessToken(
	opts: { portal: string; clientId: string; refreshToken: string },
	fetchImpl: Fetch = fetch,
): Promise<TokenResponse> {
	return tokenCall(opts.portal, {
		grant_type: "refresh_token",
		client_id: opts.clientId,
		refresh_token: opts.refreshToken,
	}, fetchImpl);
}

// --- Authenticated requests ---------------------------------------------------------------------

function errorCode(code: number): string {
	if (code === 498 || code === 499) return "token_expired";
	if (code === 403) return "forbidden";
	if (code === 400) return "bad_request";
	if (code === 404) return "not_found";
	return "arcgis_error";
}

/**
 * POST a REST request with `f=json`. The token goes in the BODY, never the URL (URLs end up in logs).
 * Objects/arrays in params are JSON-encoded, as the REST API expects (outStatistics, ...).
 */
export async function arcgisRequest(
	url: string,
	params: Record<string, unknown>,
	token: string | null,
	fetchImpl: Fetch = fetch,
): Promise<any> {
	const form = new URLSearchParams({ f: "json" });
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === "") continue;
		form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
	}
	if (token) form.set("token", token);
	return parseArcGIS(await fetchImpl(url, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: form.toString(),
	}));
}

async function parseArcGIS(res: Response): Promise<any> {
	const text = await res.text();
	let body: any;
	try {
		body = JSON.parse(text);
	} catch {
		throw new ArcGISError(`Not a JSON response (HTTP ${res.status}).`, res.ok ? "not_json" : "http_error", res.status, text);
	}
	if (body && typeof body === "object" && body.error) {
		const code = Number(body.error.code) || res.status;
		const details = Array.isArray(body.error.details) ? body.error.details.filter(Boolean).join("; ") : "";
		const message = [body.error.message, details].filter(Boolean).join(" - ") || `Error ${code}`;
		const hint = code === 498 || code === 499 ? " Sign in again (reconnect the MCP server)." : "";
		throw new ArcGISError(`${message}${hint}`, errorCode(code), code);
	}
	return body;
}

/**
 * GET with the token in the `X-Esri-Authorization` header (never in the URL). REST write operations require
 * POST, so a GET cannot change anything - portal_rest relies on that.
 */
export async function arcgisGet(url: string, params: Record<string, unknown>, token: string | null,
	fetchImpl: Fetch = fetch): Promise<any> {
	const u = new URL(url);
	u.searchParams.set("f", "json");
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === "") continue;
		u.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
	}
	const headers: Record<string, string> = {};
	if (token) headers["X-Esri-Authorization"] = `Bearer ${token}`;
	return parseArcGIS(await fetchImpl(u.href, { method: "GET", headers }));
}

/** A multipart file; `field` is the form field ArcGIS expects ("file" for addItem, "attachment" for attachments). */
export type UploadFile = { name: string; content: string | Uint8Array; type: string; field?: string };

/** Multipart upload (addItem with a file). Measured: a CSV added as `text` cannot be analyzed or published. */
export async function arcgisUpload(url: string, params: Record<string, unknown>,
	file: UploadFile, token: string | null, fetchImpl: Fetch = fetch): Promise<any> {
	const form = new FormData();
	form.set("f", "json");
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === "") continue;
		form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
	}
	if (token) form.set("token", token);
	form.set(file.field ?? "file", new Blob([file.content], { type: file.type }), file.name);
	return parseArcGIS(await fetchImpl(url, { method: "POST", body: form }));
}

/** .../rest/services/X/FeatureServer[/N] -> .../rest/admin/services/X/FeatureServer[/N] (hosted services). */
export function adminUrl(url: string): string {
	if (!/\/rest\/services\//i.test(url)) {
		throw new ArcGISError("Schema changes need a HOSTED feature service (.../rest/services/... URL).", "not_hosted");
	}
	return url.replace(/\/rest\/services\//i, "/rest/admin/services/");
}

// --- Host allowlist -----------------------------------------------------------------------------

/**
 * True when `url` may receive the user's token: https, and the portal's own host, ArcGIS Online's service hosts
 * (`*.arcgis.com`, only when the portal is ArcGIS Online), or an explicitly configured extra host.
 */
export function hostAllowed(url: string, portal: string, extraHosts: string[] = []): boolean {
	let parsed: URL;
	let portalHost: string;
	try {
		parsed = new URL(url);
		portalHost = new URL(portal).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (parsed.protocol !== "https:") return false;
	const host = parsed.hostname.toLowerCase();
	if (host === portalHost || extraHosts.map((h) => h.toLowerCase()).includes(host)) return true;
	const online = portalHost === "arcgis.com" || portalHost.endsWith(".arcgis.com");
	return online && (host === "arcgis.com" || host.endsWith(".arcgis.com"));
}

/**
 * The OAuth provider's userId for a grant. It must not contain ':' - the provider builds authorization codes as
 * `userId:grantId:secret` and splits on ':' (measured: "host:user" made every code exchange fail with
 * "Invalid authorization code format").
 */
export function grantUserId(portal: string, username: string): string {
	return `${username}@${new URL(portal).hostname}`.replace(/:/g, "_");
}

/** Remove any token value from text before it reaches a client (errors can echo request details). */
export function scrub(text: string, ...secrets: (string | null | undefined)[]): string {
	let out = text;
	for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("***");
	return out.replace(/(token=)[^&\s"]+/gi, "$1***");
}
