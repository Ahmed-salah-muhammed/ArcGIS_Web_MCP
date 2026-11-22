import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcGISHandler, DOC_ROUTES } from "../src/auth/handler";
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO } from "../src/pages";
import { PROMPTS, registerPrompts } from "../src/prompts";
import { rateLimited } from "../src/rate-limit";
import { registerTools, TOOLS } from "../src/tools";
import { props } from "./helpers";

/** A server with the tools and prompts, and a client side that sends a request and waits for its reply. */
async function connect(options: { structured?: boolean } = {}) {
	const server = new McpServer(MCP_SERVER_INFO, { instructions: MCP_INSTRUCTIONS });
	registerTools(server, props, [], 50, options);
	registerPrompts(server);
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	await server.connect(serverSide);
	const waiting = new Map<number, (message: any) => void>();
	const notifications: any[] = [];
	clientSide.onmessage = (message: any) => {
		if (message.id !== undefined && waiting.has(message.id)) waiting.get(message.id)!(message);
		else notifications.push(message);
	};
	await clientSide.start();
	let id = 0;
	const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve) => {
		waiting.set(++id, resolve);
		void clientSide.send({ jsonrpc: "2.0", id, method, params });
	});
	await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
	await clientSide.send({ jsonrpc: "2.0", method: "notifications/initialized" });
	return { send, notifications, close: () => server.close() };
}

describe("the MCP server", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("lists every tool, and what that costs a conversation stays bounded", async () => {
		const { send, close } = await connect();
		const { result } = await send("tools/list");
		expect(result.tools.map((t: any) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
		// descriptions and schemas are in the model's context for the whole conversation: growth here is a decision
		expect(JSON.stringify(result.tools).length).toBeLessThan(50_000);
		await close();
	});

	it("a tool call answers with the envelope and logs one line: tool, action, ok, time, requests - never arguments", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [], total: 0 }))));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const { send, close } = await connect();
		const { result } = await send("tools/call", { name: "portal_search", arguments: { query: "SECRET-PROJECT-NAME" } });
		expect(JSON.parse(result.content[0].text)).toMatchObject({ ok: true, data: { total: 0, items: [] } });
		expect(result.structuredContent).toBeUndefined();
		const lines = log.mock.calls.map((c) => JSON.parse(String(c[0]))).filter((l) => l.call);
		expect(lines).toHaveLength(1);
		expect(lines[0].call).toMatchObject({ user: "jdoe_gis", tool: "portal_search", action: null, ok: true, code: null, requests: 1 });
		expect(lines[0].call.duration_ms).toBeGreaterThanOrEqual(0);
		expect(JSON.stringify(lines)).not.toContain("SECRET-PROJECT-NAME");
		expect(JSON.stringify(lines)).not.toContain(props.accessToken);

		const bad = await send("tools/call", { name: "portal_item", arguments: { item_id: "not an id", action: "get" } });
		expect(bad.result.isError).toBe(true);
		const last = JSON.parse(String(log.mock.calls.at(-1)![0])).call;
		expect(last).toMatchObject({ tool: "portal_item", action: "get", ok: false, code: "bad_argument", requests: 0 });
		await close();
	});

	it("structured results are opt-in", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [], total: 0 }))));
		vi.spyOn(console, "log").mockImplementation(() => {});
		const { send, close } = await connect({ structured: true });
		const { result } = await send("tools/call", { name: "portal_search", arguments: {} });
		expect(result.structuredContent).toEqual(JSON.parse(result.content[0].text));
		await close();
	});

	it("offers the prompts; each is a message that names only tools and actions that exist", async () => {
		const { send, close } = await connect();
		const { result } = await send("prompts/list");
		expect(result.prompts.map((p: any) => p.name)).toEqual(["publish_and_map", "build_dashboard", "explore_layer", "content_audit"]);
		const got = await send("prompts/get", { name: "build_dashboard", arguments: { target: "Schools", audience: "the planning team" } });
		const text: string = got.result.messages[0].content.text;
		expect(got.result.messages[0].role).toBe("user");
		expect(text).toContain("Build an ArcGIS Dashboard for: Schools");
		expect(text).toContain("Audience: the planning team");

		const byName = new Map(TOOLS.map((t) => [t.name, t]));
		for (const p of PROMPTS) {
			const body = p.text({ source: "x", target: "x", title: "x", stale_days: "90" });
			for (const [, tool, action] of body.matchAll(/(portal_[a-z0-9_]+)(?: action=([a-z_]+))?/g)) {
				expect(byName.has(tool), `${p.name}: ${tool}`).toBe(true);
				if (!action) continue;
				let schema: any = (byName.get(tool)!.schema.shape as Record<string, any>).action;
				while (schema && !schema.options && schema.unwrap) schema = schema.unwrap();
				expect(schema.options, `${p.name}: ${tool} action=${action}`).toContain(action);
			}
		}
		await close();
	});
});

describe("rate limit", () => {
	it("keys on the signed-in user, answers 429 with Retry-After, and never blocks when it cannot decide", async () => {
		const keys: string[] = [];
		const limiter = (success: boolean) => ({ limit: async ({ key }: { key: string }) => (keys.push(key), { success }) });
		expect(await rateLimited(limiter(true), props)).toBeNull();
		expect(keys).toEqual(["jdoe_gis@www.arcgis.com"]);
		const refused = await rateLimited(limiter(false), props);
		expect(refused!.status).toBe(429);
		expect(refused!.headers.get("Retry-After")).toBe("60");
		expect(await refused!.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32029 } });
		expect(await rateLimited(undefined, props)).toBeNull(); // a deployment without the binding
		expect(await rateLimited(limiter(false), undefined)).toBeNull(); // no grant: the OAuth provider answers
		expect(await rateLimited({ limit: async () => { throw new Error("down"); } }, props)).toBeNull();
	});
});

describe("documentation pages", () => {
	const env = {} as any;

	it("every route is the same page, kept with an ETag: a second visit costs a 304, not the page", async () => {
		const first = await ArcGISHandler.request("https://docs.example.dev/overview", {}, env);
		expect(first.status).toBe(200);
		expect(first.headers.get("Cache-Control")).toBe("no-cache");
		const etag = first.headers.get("ETag")!;
		expect(etag).toMatch(/^"[^"]+"$/);
		const html = await first.text();
		expect(html).toContain("https://docs.example.dev/mcp");

		for (const route of DOC_ROUTES.filter((r) => !r.includes(":") && !r.includes("*"))) {
			const res = await ArcGISHandler.request(`https://docs.example.dev${route}`, {}, env);
			expect(res.headers.get("ETag"), route).toBe(etag);
		}
		expect((await ArcGISHandler.request("https://docs.example.dev/tools/portal_map", {}, env)).headers.get("ETag")).toBe(etag);
		expect((await ArcGISHandler.request("https://docs.example.dev/tools-portal_map", {}, env)).headers.get("ETag")).toBe(etag);

		const again = await ArcGISHandler.request("https://docs.example.dev/tools", { headers: { "If-None-Match": etag } }, env);
		expect(again.status).toBe(304);
		expect(await again.text()).toBe("");
		expect(again.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
		// a proxy that compresses the page makes the tag weak; it is still the same page
		const weak = await ArcGISHandler.request("https://docs.example.dev/", { headers: { "If-None-Match": `W/${etag}, "other"` } }, env);
		expect(weak.status).toBe(304);
		const stale = await ArcGISHandler.request("https://docs.example.dev/", { headers: { "If-None-Match": '"old"' } }, env);
		expect(stale.status).toBe(200);
	});

	it("another origin gets its own page (its /mcp URL differs), and the stylesheet revalidates too", async () => {
		const a = await ArcGISHandler.request("https://docs.example.dev/", {}, env);
		const b = await ArcGISHandler.request("https://other.example.dev/", {}, env);
		expect(await b.text()).toContain("https://other.example.dev/mcp");
		expect(b.headers.get("ETag")).not.toBe(a.headers.get("ETag"));
		const css = await ArcGISHandler.request("https://docs.example.dev/home.css", {}, env);
		expect(css.headers.get("Cache-Control")).toBe("no-cache");
		const cssAgain = await ArcGISHandler.request("https://docs.example.dev/home.css",
			{ headers: { "If-None-Match": css.headers.get("ETag")! } }, env);
		expect(cssAgain.status).toBe(304);
	});

	it("the architecture diagram is not downloaded until its page is opened", async () => {
		const html = await (await ArcGISHandler.request("https://docs.example.dev/", {}, env)).text();
		expect(html).toMatch(/<img src="\/arcgis-web-mcp-architecture\.svg\?v=static-card"[^>]*loading="lazy"/);
	});
});
