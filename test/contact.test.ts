import { afterEach, describe, expect, it, vi } from "vitest";
import { ArcGISHandler } from "../src/auth/handler";
import { contactEmail, type ContactEnv, handleContact, TOPICS, validateContact } from "../src/contact";

const SITE = "https://w.example.dev";
const KEY = "re_SECRET_KEY_123";

function memoryKV() {
	const store = new Map<string, string>();
	const kv = {
		get: async (k: string) => store.get(k) ?? null,
		put: async (k: string, v: string) => void store.set(k, v),
		delete: async (k: string) => void store.delete(k),
	} as unknown as KVNamespace;
	return { store, kv };
}

const env = (over: Partial<ContactEnv> = {}): ContactEnv =>
	({ OAUTH_KV: memoryKV().kv, RESEND_API_KEY: KEY, CONTACT_TO: "owner@example.com", ...over });

const good = { name: "Jane Doe", email: "jane@example.org", subject: "Hello", topic: "Bug report", message: "portal_search fails." };

function post(body: unknown, headers: Record<string, string> = {}, ip = "203.0.113.7") {
	return new Request(`${SITE}/contact`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: SITE, "CF-Connecting-IP": ip, ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

/** A fake Resend that records what it was sent. */
function resend(status = 200, answer: unknown = { id: "email-1" }) {
	const sent: { url: string; init: RequestInit }[] = [];
	const fetchImpl = (async (url: string, init: RequestInit) => {
		sent.push({ url: String(url), init });
		return new Response(JSON.stringify(answer), { status, headers: { "Content-Type": "application/json" } });
	}) as unknown as typeof fetch;
	return { sent, fetchImpl };
}

describe("validateContact", () => {
	it("trims, keeps one-line fields on one line, and accepts a known topic", () => {
		const r = validateContact({ ...good, name: "  Jane \r\n Doe ", subject: "Hi\r\nBcc: x@y.z", message: " line 1\r\nline 2 " });
		expect(r).toEqual({ ok: true, value: { name: "Jane Doe", email: "jane@example.org", subject: "Hi Bcc: x@y.z",
			topic: "Bug report", message: "line 1\nline 2" } });
		expect(validateContact({ ...good, topic: "" })).toMatchObject({ ok: true, value: { topic: null } });
	});

	it("names the first problem and its field", () => {
		expect(validateContact({ ...good, name: " " })).toMatchObject({ ok: false, field: "name" });
		expect(validateContact({ ...good, email: "jane@example" })).toMatchObject({ ok: false, field: "email" });
		expect(validateContact({ ...good, email: "a b@c.dev" })).toMatchObject({ ok: false, field: "email" });
		expect(validateContact({ ...good, topic: "Spam" })).toMatchObject({ ok: false, field: "topic" });
		expect(validateContact({ ...good, message: "" })).toMatchObject({ ok: false, field: "message" });
		expect(validateContact({ ...good, message: "x".repeat(2001) })).toMatchObject({ ok: false, field: "message" });
		expect(validateContact(null)).toMatchObject({ ok: false, field: "name" });
	});

	it("the email replies to the visitor and escapes what they wrote", () => {
		const m = { ...good, message: "<script>alert(1)</script>", topic: TOPICS[0] };
		const e = contactEmail(m, "owner@example.com", "ArcGIS Web MCP <onboarding@resend.dev>", SITE);
		expect(e).toMatchObject({ to: ["owner@example.com"], reply_to: "jane@example.org",
			subject: "[ArcGIS Web MCP] Question about the MCP: Hello" });
		expect(e.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(e.html).not.toContain("<script>");
		expect(e.text).toContain("Email: jane@example.org");
	});
});

describe("POST /contact", () => {
	afterEach(() => vi.restoreAllMocks());

	it("sends one email through Resend, with the key only in the Authorization header", async () => {
		const { sent, fetchImpl } = resend();
		const res = await handleContact(post(good), env(), fetchImpl);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(sent).toHaveLength(1);
		expect(sent[0].url).toBe("https://api.resend.com/emails");
		const headers = sent[0].init.headers as Record<string, string>;
		expect(headers.Authorization).toBe(`Bearer ${KEY}`);
		expect(headers["User-Agent"]).toMatch(/^arcgis-web-mcp\//);
		const email = JSON.parse(String(sent[0].init.body));
		expect(email).toMatchObject({ from: "ArcGIS Web MCP <onboarding@resend.dev>", to: ["owner@example.com"], reply_to: "jane@example.org" });
		expect(JSON.stringify(email)).not.toContain(KEY);
	});

	it("refuses other sites, non-JSON and a missing setup before anything is sent", async () => {
		const { sent, fetchImpl } = resend();
		expect((await handleContact(post(good, { Origin: "https://evil.example" }), env(), fetchImpl)).status).toBe(403);
		expect((await handleContact(post(good, { "Content-Type": "text/plain" }), env(), fetchImpl)).status).toBe(415);
		const unset = await handleContact(post(good), env({ RESEND_API_KEY: undefined }), fetchImpl);
		expect(unset.status).toBe(503);
		expect(((await unset.json()) as { error: string }).error).toContain("not set up");
		expect((await handleContact(post("{not json"), env(), fetchImpl)).status).toBe(400);
		expect((await handleContact(post({ ...good, email: "nope" }), env(), fetchImpl)).status).toBe(400);
		expect(sent).toHaveLength(0);
	});

	it("a bot that fills the hidden field gets a success and nothing is sent", async () => {
		const { sent, fetchImpl } = resend();
		const res = await handleContact(post({ ...good, website: "https://spam.example" }), env(), fetchImpl);
		expect(await res.json()).toEqual({ ok: true });
		expect(sent).toHaveLength(0);
	});

	it("limits each visitor to 3 messages an hour, without storing the IP", async () => {
		const { store, kv } = memoryKV();
		const { sent, fetchImpl } = resend();
		const e = env({ OAUTH_KV: kv });
		for (let i = 0; i < 3; i++) expect((await handleContact(post(good), e, fetchImpl)).status).toBe(200);
		const fourth = await handleContact(post(good), e, fetchImpl);
		expect(fourth.status).toBe(429);
		expect((await handleContact(post(good, {}, "198.51.100.1"), e, fetchImpl)).status).toBe(200);
		expect(sent).toHaveLength(4);
		expect([...store.keys()].join(" ")).not.toContain("203.0.113.7");
	});

	it("a Resend failure is a 502 that does not leak the key or Resend's answer", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { fetchImpl } = resend(403, { name: "validation_error", message: `bad key ${KEY}` });
		const res = await handleContact(post(good), env(), fetchImpl);
		expect(res.status).toBe(502);
		const text = await res.text();
		expect(text).not.toContain(KEY);
		expect(text).not.toContain("validation_error");
	});

	it("is wired into the Worker: GET goes to the form, POST sends", async () => {
		const get = await ArcGISHandler.request(`${SITE}/contact`, {}, env() as any);
		expect(get.status).toBe(302);
		expect(get.headers.get("location")).toBe("/#contact");
		const unset = await ArcGISHandler.request(post(good), undefined, env({ CONTACT_TO: undefined }) as any);
		expect(unset.status).toBe(503);
	});
});
