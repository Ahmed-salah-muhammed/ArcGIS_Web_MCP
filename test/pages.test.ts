import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { TOPICS } from "../src/contact";
import {
	AUTHOR,
	CATEGORIES,
	clientDisplay,
	creditHtml,
	HOME_HEADERS,
	homePage,
	MCP_INSTRUCTIONS,
	MCP_SERVER_INFO,
	messagePage,
	TOOL_DOCS,
} from "../src/pages";
import { TOOLS } from "../src/tools";

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

	it("the status page links the documentation in a new tab, so the redirect still happens", () => {
		const html = messagePage({ tone: "success", title: "Connected", lines: [],
			action: { href: "https://c.dev/cb", label: "Continue" }, redirect: { href: "https://c.dev/cb", seconds: 2 } }, AUTHOR);
		expect(html).toMatch(/<a class="button ghost" href="\/" target="_blank" rel="noopener">Documentation/);
		expect(messagePage({ tone: "error", title: "x", lines: [] }, null)).toContain(">Documentation");
	});

	it("the home page has the contact form, and may only call its own origin", () => {
		const html = homePage("https://a.dev", AUTHOR);
		expect(html).toContain('<a href="#contact" data-nav="contact">Contact us</a>');
		expect(html).toContain('id="contact-form"');
		for (const t of TOPICS) expect(html).toContain(`data-topic="${t.replace(/&/g, "&amp;")}"`);
		expect(html).toContain('name="website" tabindex="-1"');
		expect(HOME_HEADERS["Content-Security-Policy"]).toContain("connect-src 'self'");
		// the developer's email and WhatsApp appear on the contact page, and nowhere else
		const contact = html.slice(html.indexOf('id="p-contact"'), html.indexOf('id="p-about"'));
		expect(contact).toContain(`href="mailto:${AUTHOR.email}"`);
		expect(contact).toContain('href="https://wa.me/201225246488"');
		expect(html.split(AUTHOR.email).length - 1).toBe(contact.split(AUTHOR.email).length - 1);
		expect(homePage("https://a.dev", { name: "Jane Doe", url: null })).not.toMatch(/mailto:|wa\.me/);
	});

	it("documents every tool, and exactly the actions each tool has", () => {
		const documented = new Map(TOOL_DOCS.map((d) => [d.name, d]));
		expect([...documented.keys()].sort()).toEqual(TOOLS.map((t) => t.name).sort());
		for (const t of TOOLS) {
			const doc = documented.get(t.name)!;
			expect(CATEGORIES.map((c) => c.id)).toContain(doc.category);
			let action: any = (t.schema.shape as Record<string, any>).action;
			while (action && !action.options && action.unwrap) action = action.unwrap();
			if (action?.options) expect(doc.actions?.map((a) => a.name)).toEqual(action.options);
			else expect(doc.actions).toBeUndefined();
		}
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
