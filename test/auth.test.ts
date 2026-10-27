import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcGISHandler } from "../src/auth/handler";
import { bindStateToSession, createOAuthState, renderApprovalDialog } from "../src/auth/oauth-utils";
import { AUTHOR } from "../src/pages";

describe("approval page", () => {
	it("carries the credit under the card", async () => {
		const res = renderApprovalDialog(new Request("https://a.dev/authorize"), {
			client: null, csrfToken: "t", setCookie: "c=1", state: {},
			server: { name: "ArcGIS Web MCP", author: AUTHOR },
		});
		const html = await res.text();
		expect(html).toContain("Full Stack Developer · GIS Developer");
		expect(html.indexOf("Developed by")).toBeGreaterThan(html.indexOf("Approve"));
	});
});

describe("/callback", () => {
	afterEach(() => vi.unstubAllGlobals());

	/** ArcGIS's token, self and portal endpoints; returns the token requests it saw. */
	function stubArcGIS() {
		const tokenRequests: URLSearchParams[] = [];
		vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
			const u = String(url);
			if (u.endsWith("/oauth2/token")) tokenRequests.push(new URLSearchParams(String(init?.body)));
			const body = u.endsWith("/oauth2/token")
				? { access_token: "AT-SECRET", expires_in: 1800, refresh_token: "RT-SECRET", username: "jdoe_gis" }
				: u.endsWith("/community/self") ? { username: "jdoe_gis", fullName: "Jane Doe", role: "org_publisher" }
					: u.endsWith("/portals/self") ? { id: "ORG", name: "Example Org", isPortal: false }
						: { error: { code: 404, message: `unexpected ${u}` } };
			return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
		});
		return tokenRequests;
	}

	/** A browser that approved and went to ArcGIS: state in KV, the PKCE verifier, and the session cookie. */
	async function signInStarted(clientName = "claudeai") {
		const store = new Map<string, string>();
		const kv = {
			get: async (k: string) => store.get(k) ?? null,
			put: async (k: string, v: string) => void store.set(k, v),
			delete: async (k: string) => void store.delete(k),
		} as unknown as KVNamespace;
		const request = { responseType: "code", clientId: "client-1", redirectUri: "https://claude.ai/api/mcp/auth_callback",
			scope: [], state: "client-state" } as unknown as AuthRequest;
		const { stateToken } = await createOAuthState(request, kv);
		await kv.put(`pkce:${stateToken}`, "verifier-1");
		const cookie = (await bindStateToSession(stateToken)).setCookie.split(";")[0];
		const completed: any[] = [];
		const env = {
			OAUTH_KV: kv, ARCGIS_CLIENT_ID: "app-id", ARCGIS_PORTAL_URL: "https://www.arcgis.com", ARCGIS_EXTRA_HOSTS: "",
			COOKIE_ENCRYPTION_KEY: "k",
			OAUTH_PROVIDER: {
				completeAuthorization: async (opts: any) => {
					completed.push(opts);
					return { redirectTo: "https://claude.ai/api/mcp/auth_callback?code=mcp-code&state=client-state" };
				},
				lookupClient: async () => ({ clientName }),
			},
		};
		const callback = (query: string) => ArcGISHandler.request(`https://w.example.dev/callback?state=${stateToken}&${query}`,
			{ headers: { Cookie: cookie } }, env as any);
		return { store, completed, callback };
	}

	it("signs in, then shows the connected page with the credit and continues to the client", async () => {
		const tokenRequests = stubArcGIS();
		const { store, completed, callback } = await signInStarted();
		const res = await callback("code=arcgis-code");
		const html = await res.text();

		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(res.headers.get("set-cookie")).toContain("__Host-CONSENTED_STATE=;");
		expect(Object.fromEntries(tokenRequests[0])).toMatchObject({ code: "arcgis-code", code_verifier: "verifier-1",
			redirect_uri: "https://w.example.dev/callback" });
		expect(completed[0]).toMatchObject({ userId: "jdoe_gis@www.arcgis.com", props: { username: "jdoe_gis", orgName: "Example Org" } });
		expect(html).toContain("Signed in as Jane Doe (jdoe_gis) · Example Org.");
		expect(html).toContain('content="2; url=https://claude.ai/api/mcp/auth_callback?code=mcp-code&amp;state=client-state"');
		expect(html).toContain('<a class="button claude" href="https://claude.ai/api/mcp/auth_callback?code=mcp-code&amp;state=client-state">'
			+ "Continue to Claude</a>");
		expect(html).toContain("Ahmed Salah Muhammed");
		expect(html).not.toContain("AT-SECRET");
		expect(html).not.toContain("RT-SECRET");
		expect([...store.keys()]).toEqual([]); // state and verifier are one-time
	});

	it("any other MCP client gets its own name on the default button", async () => {
		stubArcGIS();
		const { callback } = await signInStarted("Cursor");
		const html = await (await callback("code=arcgis-code")).text();
		expect(html).toContain("Returning you to Cursor…");
		expect(html).toContain('<a class="button" href=');
		expect(html).toContain("Continue to Cursor</a>");
		expect(html).not.toContain("button claude");
	});

	it("an ArcGIS error becomes an escaped error page", async () => {
		const { completed, callback } = await signInStarted();
		const res = await callback(`error=access_denied&error_description=${encodeURIComponent("<script>alert(1)</script>")}`);
		const html = await res.text();
		expect(res.status).toBe(400);
		expect(html).toContain("ArcGIS sign-in did not complete");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(html).not.toContain("<script>");
		expect(completed).toHaveLength(0);
	});
});
