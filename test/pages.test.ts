import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOPICS } from "../src/contact";
import {
	AUTHOR,
	CATEGORIES,
	clientDisplay,
	creditHtml,
	HOME_CSS_HEADERS,
	HOME_HEADERS,
	homePage,
	MCP_INSTRUCTIONS,
	MCP_SERVER_INFO,
	messagePage,
	TOOL_DOCS,
	VERSION,
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
		expect(html).toContain('id="p-architecture"');
		expect(html).toContain('src="/arcgis-web-mcp-architecture.svg"');
		expect(html).toContain("Ahmed Salah Muhammed");
		expect(homePage("https://a.dev", null)).not.toContain("Developed by");
	});

	it("uses the supplied brand and documentation navigation controls", () => {
		const html = homePage("https://a.dev", AUTHOR);
		expect(html).toContain('src="/brand-logo.png"');
		expect(html).toContain('<link rel="icon" href="/brand-logo.png">');
		expect(html).toContain(`<span class="ver">v${VERSION}</span><span class="ver beta">Beta</span>`);
		expect(html).toContain(`<link rel="stylesheet" href="/home.css?v=${VERSION}&amp;rev=2">`);
		expect(html).toContain('id="search-open"');
		expect(html).toContain('id="search-overlay"');
		expect(html).toContain('aria-label="Breadcrumb"');
		expect(html).toContain('id="copy-page"');
		expect(html).toContain('class="nav-section" open');
		expect(html).toContain('class="navgroup install-group"');
		expect(html).toContain('data-client-tab="desktop"');
		expect(html).toContain(`Tools reference</span><span class="group-count">${TOOL_DOCS.length}</span>`);
		expect(html).toContain('data-group="read"');
		expect(html).toContain('data-group="publish"');
		expect(html).toContain('data-group="apps"');
		expect(html).toContain('data-group="power"');
		expect(html).toContain('>Find &amp; Read</span>');
		expect(html).toContain('>Publish &amp; Edit</span>');
		expect(html).toContain('>Apps &amp; Maps</span>');
		expect(html).toContain('>Power Tools</span>');
		const sidebar = html.slice(html.indexOf('<aside class="side"'), html.indexOf("</aside>"));
		const sideNav = sidebar.slice(sidebar.indexOf("<nav>"), sidebar.indexOf("</nav>"));
		expect(sideNav).toContain('<a class="nav" href="#agent-skills" data-nav="agent-skills">');
		expect(sideNav).toContain('<span>Agent Skills</span><span class="group-count">1</span>');
		expect(sideNav.indexOf(">Power Tools</span>")).toBeLessThan(sideNav.indexOf(">Agent Skills</span>"));
		expect(sideNav.indexOf(">Agent Skills</span>")).toBeLessThan(sideNav.indexOf("Guides &amp; specs"));
		expect(sideNav).toContain('href="#apps" data-nav="apps"');
		expect(sideNav).toContain('class="apps-nav-icons"');
		const clientLinks = [
			["desktop", ["/client-icons/claude.svg"]],
			["claude-code", ["/client-icons/claude.svg"]],
			["cursor", ["/client-icons/cursor.svg", "/client-icons/windsurf.svg"]],
			["vscode", ["/client-icons/vscode.png"]],
		] as const;
		for (const [tab, logos] of clientLinks) {
			const linkStart = sideNav.indexOf(`data-client-tab="${tab}"`);
			expect(linkStart).toBeGreaterThanOrEqual(0);
			const link = sideNav.slice(linkStart, sideNav.indexOf("</a>", linkStart));
			expect(link).toContain('class="client-logos"');
			for (const logo of logos) expect(link).toContain(`src="${logo}"`);
		}
		expect(sideNav.indexOf('href="#apps"')).toBeLessThan(sideNav.indexOf("Tools reference"));
		expect(sideNav).toContain("Overview</span>");
		expect(sideNav).toContain('href="#architecture" data-nav="architecture"');
		expect(sideNav).not.toContain('href="#t-portal_survey123"');
		expect(html).toContain('id="p-t-portal_survey123"');
		expect(sideNav).toContain("Security &amp; Permissions");
		expect(sideNav).not.toContain("Introduction");
		expect(sideNav).not.toContain("Autonomous Agents");
		expect(sideNav).not.toContain("OAuth 2.0 PKCE Flow");
		expect(sideNav).not.toContain("Chatbots vs MCP");
		const headerNav = html.slice(html.indexOf('<header class="top">'), html.indexOf("</header>"));
		expect(headerNav).toContain('class="github-link"');
		expect(headerNav).toContain('href="https://github.com/Ahmed-salah-muhammed/ArcGIS_Web_MCP"');
		expect(headerNav).toContain('target="_blank" rel="noopener noreferrer"');
		expect(headerNav).toContain('aria-label="GitHub repository"');
		expect(headerNav).not.toContain('href="#tools"');
		expect(headerNav).not.toContain('href="#connect"');
		expect(sidebar.indexOf('<footer class="side-foot">')).toBeGreaterThan(sidebar.indexOf("</nav>"));
		expect(sidebar).toContain('class="me" href="#about"');
		expect(sidebar).not.toContain("Full Portfolio");
		for (const tool of TOOL_DOCS) expect(html).toContain(`href="#t-${tool.name}"`);
		expect(html).not.toContain("MCP tools documented");
		expect(html.indexOf('id="p-apps"')).toBeLessThan(html.indexOf('id="p-tools"'));
		expect(html).toContain('id="p-agent-skills" data-title="Agent Skills"');
		expect(html).toContain('document.querySelectorAll(".page")');
		expect(html).toContain("Message/Data Actions");
		expect(html).toContain("https://arcgis.web-mcp.workers.dev/mcp");
		expect(html).toContain(".github/skills/arcgis-exb-widget-dev/");
		expect(html).toContain("~/.copilot/skills/arcgis-exb-widget-dev/");
		expect(html).toContain('data-copy=".github/skills/arcgis-exb-widget-dev/"');
		expect(html).toContain('data-copy="~/.copilot/skills/arcgis-exb-widget-dev/"');
		expect(html).toContain("client/your-extensions/widgets/&lt;name&gt;/");
		expect(html).toContain("npm run tscheck");
		expect(html).toContain("<code>agent_handoff</code>");
		const appsPage = html.slice(html.indexOf('id="p-apps"'), html.indexOf('id="p-agent-skills"'));
		expect(appsPage).toContain('href="#agent-skills" data-nav="agent-skills">Agent Skills</a>');
		const portalAppDoc = html.slice(html.indexOf('id="p-t-portal_app"'), html.indexOf('id="p-t-portal_survey123"'));
		expect(portalAppDoc).toContain('href="#agent-skills" data-nav="agent-skills">Agent Skills</a>');
		expect(html).not.toMatch(/<svg\b[^>]*>\s*<\/svg>/);
		expect(HOME_HEADERS["Content-Security-Policy"]).toContain("style-src 'self'");
		expect(HOME_HEADERS["Content-Security-Policy"]).toContain("img-src 'self' data:");
		expect(HOME_HEADERS["Content-Security-Policy"]).not.toContain("style-src 'unsafe-inline'");
		expect(readFileSync("src/pages/home.css", "utf8")).toContain(".side");
		expect(HOME_CSS_HEADERS["Content-Type"]).toBe("text/css; charset=utf-8");
		expect(HOME_CSS_HEADERS["Cache-Control"]).toBe("no-cache");
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
		expect(html).toContain('data-topic="Question about the MCP" aria-pressed="true"');
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
