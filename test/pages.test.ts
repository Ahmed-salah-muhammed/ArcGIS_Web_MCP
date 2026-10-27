import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcGISHandler } from "../src/arcgis-handler";
import {
	AUTHOR,
	clientDisplay,
	creditHtml,
	homePage,
	MCP_INSTRUCTIONS,
	MCP_SERVER_INFO,
	messagePage,
} from "../src/pages";
import { bindStateToSession, createOAuthState, renderApprovalDialog } from "../src/workers-oauth-utils";

const PORTFOLIO = "https://ahmedsalah-portfolio.vercel.app/";
const TITLE = "Full Stack Developer · GIS Developer";

describe("developer credit", () => {
	it("is the developer, hardcoded, with photo, title and portfolio link", () => {
		expect(AUTHOR).toMatchObject({ name: "Ahmed Salah Muhammed", title: TITLE, url: PORTFOLIO });
		expect(AUTHOR.photo).toMatch(/^data:image\/jpeg;base64,\/9j\//);
		const html = creditHtml(AUTHOR);
		expect(html).toContain("Developed by");
		expect(html).toContain('<img class="avatar" src="data:image/jpeg;base64,');
		expect(html).toContain(`<span class="role">${TITLE}</span>`);
		expect(html).toContain(`href="${PORTFOLIO}" target="_blank" rel="noopener noreferrer"`);
		expect(creditHtml(null)).toBe("");
	});

	it("falls back to initials, escapes the name and ignores unsafe photos", () => {
		expect(creditHtml({ name: "Jane Doe", url: null })).toContain(">JD<");
		expect(creditHtml({ name: "أحمد صلاح", url: null })).toContain(">أص<");
		const unsafe = creditHtml({ name: "Jane Doe", url: null, photo: "javascript:alert(1)" });
		expect(unsafe).not.toContain("<img");
		expect(unsafe).toContain(">JD<");
		const hostile = creditHtml({ name: "Jane <img src=x onerror=alert(1)>", url: null });
		expect(hostile).toContain("Jane &lt;img src=x onerror=alert(1)&gt;");
		expect(hostile).not.toContain("<img");
		expect(hostile).not.toContain("<a ");
	});
});

describe("pages", () => {
	it("the home page shows this server's /mcp URL, the tools and the credit", () => {
		const html = homePage("https://arcgis.example.workers.dev/", AUTHOR);
		expect(html).toContain("https://arcgis.example.workers.dev/mcp");
		expect(html).toContain("portal_publish");
		expect(html).toContain("Ahmed Salah Muhammed");
		expect(homePage("https://a.dev", null)).not.toContain("Developed by");
	});

	it("the consent page carries the credit under the card", async () => {
		const res = renderApprovalDialog(new Request("https://a.dev/authorize"), {
			client: null, csrfToken: "t", setCookie: "c=1", state: {},
			server: { name: "ArcGIS Web MCP", author: AUTHOR },
		});
		const html = await res.text();
		expect(html).toContain(TITLE);
		expect(html.indexOf("Developed by")).toBeGreaterThan(html.indexOf("Approve"));
	});

	it("the status page escapes everything and redirects without script", () => {
		const html = messagePage({ tone: "success", title: "Connected <b>", lines: ["Signed in as <i>x</i>"],
			action: { href: "https://c.dev/cb?code=1&state=2", label: "Continue" },
			redirect: { href: "https://c.dev/cb?code=1&state=2", seconds: 2 } }, AUTHOR);
		expect(html).toContain('<meta http-equiv="refresh" content="2; url=https://c.dev/cb?code=1&amp;state=2">');
		expect(html).toContain("Connected &lt;b&gt;");
		expect(html).toContain("Signed in as &lt;i&gt;x&lt;/i&gt;");
		expect(html).not.toContain("<script");
		expect(messagePage({ tone: "error", title: "x", lines: [] }, AUTHOR)).not.toContain("http-equiv");
	});

	it("names any MCP client, and gives Claude its orange button", () => {
		expect(clientDisplay("claudeai")).toEqual({ name: "Claude", brand: "claude" });
		expect(clientDisplay("Claude")).toEqual({ name: "Claude", brand: "claude" });
		expect(clientDisplay("Claude Code")).toEqual({ name: "Claude Code", brand: "claude" });
		expect(clientDisplay("Cursor")).toEqual({ name: "Cursor" });
		expect(clientDisplay("  ")).toEqual({ name: null });
		expect(clientDisplay(undefined)).toEqual({ name: null });
	});
});

describe("MCP server info", () => {
	it("every client gets the developer in serverInfo and instructions", async () => {
		const server = new McpServer(MCP_SERVER_INFO, { instructions: MCP_INSTRUCTIONS });
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		await server.connect(serverSide);
		const reply = new Promise<any>((resolve) => {
			clientSide.onmessage = (message) => resolve(message);
		});
		await clientSide.start();
		await clientSide.send({ jsonrpc: "2.0", id: 1, method: "initialize",
			params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
		const { result } = await reply;
		expect(result.serverInfo).toMatchObject({ name: "ArcGIS Web MCP", title: "ArcGIS Web MCP", websiteUrl: PORTFOLIO });
		expect(result.serverInfo.description).toContain(`Developed by Ahmed Salah Muhammed (${TITLE})`);
		expect(result.instructions).toContain(`developed by Ahmed Salah Muhammed, ${TITLE} (portfolio: ${PORTFOLIO})`);
		await server.close();
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
