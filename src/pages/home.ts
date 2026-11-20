/**
 * The documentation app served at "/": a fixed app shell (top bar, sidebar, one panel, "on this page") whose pages
 * switch by URL hash (#overview, #architecture, #connect, #tools, #t-portal_search, #security, #limits, #contact, #about), so the
 * browser page never scrolls. The stylesheet is imported from this folder and served by the Worker; the contact form
 * posts JSON to /contact on this same origin (src/contact.ts).
 */
import { CONTACT_LIMITS, TOPICS } from "../contact";
import { APP_ICONS } from "./app-icons";
import { ARROW, avatarHtml, esc, FAVICON } from "./credit";
import { CATEGORIES, TOOL_DOCS, type ToolDoc } from "./docs";
import { type Author, VERSION } from "./identity";
import HOME_CSS from "./home.css";

const PATHS: Record<string, string> = {
	home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
	plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>',
	grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
	search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
	folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
	layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
	map: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
	bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
	shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
	gauge: '<path d="m12 14 4-4"/><path d="M3.5 16a9 9 0 1 1 17 0"/>',
	user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
	copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
	globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.7 3.9 5.9 3.9 9.5s-1.3 6.8-3.9 9.5c-2.6-2.7-3.9-5.9-3.9-9.5S9.4 5.2 12 2.5z"/>',
	chevron: '<path d="m6 9 6 6 6-6"/>',
	menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
	list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
	lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
	zap: '<path d="M4 14h7l-1 8 10-12h-7l1-8z"/>',
	chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/>',
	mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
	send: '<path d="M21.5 2.5 10.5 13.5"/><path d="m21.5 2.5-7 19-4-8-8-4z"/>',
	bug: '<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 11v9M4 13h4M16 13h4M5 8l3 2M19 8l-3 2M5 19l3-2M19 19l-3-2M10 6 9 3M14 6l1-3"/>',
	sparkle: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/><path d="M19 17v4M17 19h4"/>',
	server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
	github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.2.1 15 1.9a13.4 13.4 0 0 0-6 0C5.8.1 4.7.5 4.7.5A5 5 0 0 0 4.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 9 18v4"/><path d="M9 18c-5 1.5-5-2.5-7-3"/>',
	briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
	book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5"/>',
	clipboard: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2.5h6V4M9 11h6M9 15h6"/>',
	pin: '<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
	code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
	arrows: '<path d="M7 7h11m0 0-3-3m3 3-3 3M17 17H6m0 0 3 3m-3-3 3-3"/>',
	terminal: '<path d="m4 7 5 5-5 5m8 0h8"/>',
	sliders: '<path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h9m4 0h3"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/>',
	whatsapp: '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.2 3.1z"/><path d="M9.2 8.6c.2-.5.5-.6.8-.6h.6c.2 0 .4.1.5.4l.7 1.6c.1.3 0 .5-.1.7l-.5.6c.6 1.2 1.6 2.1 2.8 2.7l.6-.5c.2-.2.5-.2.7-.1l1.6.7c.3.1.4.3.4.6v.6c0 .4-.2.7-.6.8-2.6 1-7.3-3.6-6.5-6.5z"/>',
};

const TOPIC_ICONS: Record<string, string> = {
	"Question about the MCP": "chat", "Bug report": "bug", "Feature request": "sparkle", "WebGIS & Full-Stack": "map",
	"ArcGIS Enterprise": "server", "Career / Full-Time": "briefcase",
};

const icon = (name: string, size = 18) => {
	const path = PATHS[name];
	if (!path) throw new Error(`Unknown documentation icon: ${name}`);
	return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
};

const code = (text: string) => `<div class="code"><pre><code>${esc(text)}</code></pre>`
	+ `<button class="copy" type="button" data-copy="${esc(text)}" title="Copy">${icon("copy", 15)}<span>Copy</span></button></div>`;

/** Inline `code` and **bold** inside the (trusted, escaped) doc strings. */
const rich = (text: string) => esc(text).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

function page(id: string, eyebrow: string, title: string, body: string, opts: { mono?: boolean } = {}) {
	return `<section class="page" id="p-${id}" data-title="${esc(title)}" hidden>
  <p class="eyebrow">${esc(eyebrow)}</p>
  <h1 class="${opts.mono ? "mono" : ""}" id="top-${id}">${esc(title)}</h1>
  ${body}
</section>`;
}

function overview(url: string, toolCount: number) {
	const cards = [
		["search", "blue", "Find & read", "Search your organization, read items, query layers, count and summarize.", "#tools"],
		["layers", "green", "Publish & edit", "Turn CSV or GeoJSON into hosted layers, edit features, add fields and styles.", "#tools"],
		["map", "orange", "Maps & apps", "Web maps, dashboards, Instant Apps, StoryMaps, Experience Builder, Survey123 and Field Maps.", "#apps"],
	].map(([ic, color, title, text, href]) => `<a class="feature" href="${href}"><div class="feature-art ${color}">${icon(ic, 34)}</div>
    <div class="feature-body"><h3>${title}</h3><p>${text}</p></div></a>`).join("");
	const steps = [
		["plug", "Connect", "Add the server URL to Claude, Claude Code, Antigravity, VS Code or any MCP client."],
		["lock", "Sign in", "Approve once, then sign in on ArcGIS itself. The server never sees your password."],
		["chat", "Ask", "Ask in plain language. Anything irreversible shows you a preview and waits for your OK."],
	].map(([ic, t, d], i) => `<div class="step"><span class="step-n">${i + 1}</span><div class="step-ic">${icon(ic, 20)}</div>
    <h3>${t}</h3><p>${d}</p></div>`).join("");
	return page("overview", "Documentation", "ArcGIS Web MCP", `
  <p class="lead">Connect Claude or any MCP client to <strong>ArcGIS Online</strong> and <strong>ArcGIS Enterprise</strong>.
  You sign in with your own ArcGIS account; ${toolCount} tools then search, read, publish, edit and map your content with
  your own permissions. Nothing to install.</p>
  <div class="endpoint"><span class="endpoint-label">Server URL</span><code>${url}</code>
    <button class="btn primary copy-url" type="button" data-copy="${url}">${icon("copy", 15)}<span>Copy</span></button></div>
  <hr>
  <h2 id="what">What you can do</h2>
  <div class="features">${cards}</div>
  <h2 id="how">How it works</h2>
  <div class="steps">${steps}</div>`);
}

function architecture() {
	return page("architecture", "System design", "Architecture", `
	<p class="lead">ArcGIS Web MCP connects MCP clients to ArcGIS Online or ArcGIS Enterprise through a secure Cloudflare
	Worker. The signed-in ArcGIS user keeps their own identity and permissions across every tool call.</p>
	<div class="architecture-actions">
	  <a class="btn primary" href="/arcgis-web-mcp-architecture.svg?v=static-card" target="_blank" rel="noopener noreferrer">
	    ${icon("search", 16)}<span>Open full size</span>
	  </a>
	</div>
	<figure class="architecture">
	  <img src="/arcgis-web-mcp-architecture.svg?v=static-card" alt="ArcGIS Web MCP enterprise architecture">
	</figure>
	<h2 id="flow">Request flow</h2>
	<div class="steps">
	  <div class="step"><span class="step-n">1</span><div class="step-ic">${icon("chat", 20)}</div>
	    <h3>MCP client</h3><p>The assistant discovers tools and sends a signed HTTPS MCP request.</p></div>
	  <div class="step"><span class="step-n">2</span><div class="step-ic">${icon("lock", 20)}</div>
	    <h3>Secure sign-in</h3><p>The Cloudflare Worker uses OAuth 2.1 and ArcGIS OAuth 2.0 PKCE.</p></div>
	  <div class="step"><span class="step-n">3</span><div class="step-ic">${icon("globe", 20)}</div>
	    <h3>ArcGIS permissions</h3><p>REST calls run as the signed-in user in ArcGIS Online or Enterprise.</p></div>
	</div>`);
}

function connect(url: string) {
	const json = `{\n  "mcpServers": {\n    "Arcgis_Web_MCP": {\n      "command": "npx",\n      "args": ["mcp-remote", "${url}"]\n    }\n  }\n}`;
	const vscode = `{\n  "servers": {\n    "arcgis": { "type": "http", "url": "${url}" }\n  }\n}`;
	const tabs: [string, string, string][] = [
		["claude", "Claude", `<ol class="list"><li>Open <strong>Settings &rarr; Connectors &rarr; Add custom connector</strong>.</li>
      <li>Name it <code>ArcGIS</code> and paste the server URL:</li></ol>${code(url)}
      <ol class="list" start="3"><li>Click <strong>Connect</strong>, approve, then sign in with ArcGIS.</li></ol>`],
		["claude-code", "Claude Code", `<p>Add it as a remote server:</p>${code(`claude mcp add --transport http arcgis ${url}`)}
      <p>Or run it through <code>mcp-remote</code> on your machine:</p>${code(`claude mcp add arcgis -- npx mcp-remote ${url}`)}`],
		["antigravity", "Antigravity", `<ol class="list"><li>In the Agent panel open <strong>MCP Servers &rarr; Manage MCP Servers &rarr; View raw config</strong>.</li>
      <li>Add this to <code>mcp_config.json</code> (needs Node.js), save, and restart Antigravity:</li></ol>${code(json)}`],
		["desktop", "Claude Desktop", `<p>Add this to <code>%APPDATA%\\Claude\\claude_desktop_config.json</code> (Windows) or
      <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS), then restart Claude:</p>${code(json)}`],
		["cursor", "Cursor & Windsurf", `<p>The same block goes in <code>~/.cursor/mcp.json</code> (Cursor) or
      <code>~/.codeium/windsurf/mcp_config.json</code> (Windsurf):</p>${code(json)}`],
		["vscode", "VS Code", `<p>Add a remote server to <code>.vscode/mcp.json</code>:</p>${code(vscode)}`],
	];
	return page("connect", "Get started", "Connect a client", `
  <p class="lead">One URL works everywhere. The first time a client calls a tool, a browser window opens: approve, then
  sign in with your ArcGIS account.</p>
  <h2 id="clients">Choose your client</h2>
  <div class="tabs" role="tablist">${tabs.map(([id, name], i) => `<button type="button" role="tab" class="tab${i ? "" : " on"}"
    data-tab="${id}">${name}</button>`).join("")}</div>
  ${tabs.map(([id, , body], i) => `<div class="tab-panel" data-panel="${id}"${i ? " hidden" : ""}>${body}</div>`).join("")}
  <h2 id="then">Then</h2>
  <p>Try <em>"Who am I signed in as in ArcGIS?"</em> or <em>"Find my feature layers about roads."</em>
  The approval is remembered for 30 days in each browser.</p>`);
}

function tools(byCategory: Map<string, ToolDoc[]>) {
	const stats = CATEGORIES.map((c) => `<div class="stat"><span class="stat-ic ${c.color}">${icon(c.icon, 18)}</span>
    <strong>${byCategory.get(c.id)?.length ?? 0}</strong><span>${esc(c.name)}</span></div>`).join("");
	const groups = CATEGORIES.map((c) => {
		const list = byCategory.get(c.id) ?? [];
		return `<div class="group" data-group>
  <div class="group-head"><span class="group-ic ${c.color}">${icon(c.icon, 20)}</span>
    <div><h3>${esc(c.name)} <span class="tag">${c.id}</span></h3><p>${esc(c.summary)}</p></div>
    <div class="group-meta"><span>Tools</span><b>${list.length}</b></div></div>
  <div class="chips">${list.map((t) => `<a class="chip" href="#t-${t.name}" data-search="${esc(`${t.name} ${t.summary}`.toLowerCase())}">
    <i></i><span>${t.name}</span></a>`).join("")}</div>
</div>`;
	}).join("");
	return page("tools", "API documentation", "MCP Tools Reference", `
  <p class="lead">Every tool your MCP client can call, grouped by what it works on. Each one acts as you, with your
  ArcGIS permissions; results use item ids.</p>
  <div class="stats">${stats}</div>
  <div class="filter">${icon("search", 16)}<input id="filter" type="search" placeholder="Filter tools..." autocomplete="off"><kbd>/</kbd></div>
  <h2 id="groups" class="sr">Tool groups</h2>
  <div class="groups">${groups}</div>`);
}

const APPS = [
	["zap", "instant", "Instant Apps", "A ready app of a web map from any template in your org's gallery: Basic, Sidebar, Exhibit and more.",
		"Create a Sidebar Instant App of my parks map."],
	["gauge", "dashboard", "Dashboards", "Interactive: indicators, pie, bar and line charts, list, table, map and more, filtering each other; in tabs, or chosen for you.",
		"Make a dashboard of the inspections with a count, a pie by status and a table."],
	["grid", "experience", "Experience Builder", "An app from one of 50 Experience Builder templates, with your web map in its maps.",
		"Build an Experience Builder app of the flood map with the billboard template."],
	["book", "storymap", "StoryMaps", "A story with a cover, headings, text and maps, in one of six themes.",
		"Write a short story about the river project with the flood map in the middle."],
	["clipboard", "survey", "Survey123", "In the browser (a draft for the web designer) or with Survey123 Connect (an XLSForm Excel file), with portal_survey123.",
		"Make a Site inspection survey with a condition question and a photo."],
	["pin", "fieldmaps", "Field Maps", "A web map ready for the field: forms from the layers' fields, Arcade rules, offline.",
		"Prepare my assets map for Field Maps with a form for the poles layer."],
	["code", "exb_developer", "Experience Builder Developer Edition", "Registers the app and gives you its client ID and the setup steps.",
		"Set me up for Experience Builder Developer Edition."],
];

function apps() {
	const logo = (kind: string, ic: string) => {
		const src = APP_ICONS[kind === "exb_developer" ? "experience" : kind];
		if (!src) return `<span class="tile-ic">${icon(ic, 20)}</span>`;
		return `<span class="app-logo"><img src="${src}" alt="" width="40" height="40">${kind === "exb_developer" ? `<i>${icon("code", 11)}</i>` : ""}</span>`;
	};
	const cards = APPS.map(([ic, kind, name, what, ask]) => `<div class="app-card"><div class="app-head">${logo(kind, ic)}
    <div><h3>${name}</h3><code>kind=${kind}</code></div></div><p>${what}</p>
    <div class="prompt">${icon("chat", 16)}<span>${esc(ask)}</span></div></div>`).join("");
	return page("apps", "Apps & maps", "Build apps", `
  <p class="lead">From a web map or a layer to a finished app in one request, with <a class="inline" href="#t-portal_app">portal_app</a>.
  Each app is created private in your content, with the link to open it.</p>
  <div class="apps">${cards}</div>
  <h2 id="apps-flow">A typical flow</h2>
  <ol class="list"><li>Publish your data (<code>portal_publish</code>) or find a layer (<code>portal_search</code>).</li>
    <li>Make a web map (<code>portal_map</code>) and add Arcade popups or labels (<code>portal_arcade</code>).</li>
    <li>Build the app (<code>portal_app</code>), then share it (<code>portal_share</code>).</li></ol>
  <p>For custom Experience Builder widgets developed locally, see <a class="inline" href="#agent-skills" data-nav="agent-skills">Agent Skills</a>.</p>`);
}

function agentSkills() {
	const skillPath = ".github/skills/arcgis-exb-widget-dev/";
	const personalSkillPath = "~/.copilot/skills/arcgis-exb-widget-dev/";
	return page("agent-skills", "Tools reference", "Agent Skills", `
  <p class="lead"><code>arcgis-exb-widget-dev</code> complements the cloud MCP tools: <code>portal_app</code> can generate a
  widget scaffold, while a local coding agent uses the Skill to complete and validate it in an Experience Builder
  Developer Edition workspace.</p>
  <h2 id="overview">Overview</h2>
  <div class="tiles">
    <div class="tile"><span class="tile-ic">${icon("grid", 20)}</span><h3>Cloud scaffold</h3>
      <p>Call <code>portal_app</code> with <code>kind: "exb_widget"</code> to generate the starter structure and hand-off
      instructions. The MCP tool does not write files into your local Developer Edition project.</p></div>
    <div class="tile"><span class="tile-ic">${icon("code", 20)}</span><h3>Local implementation</h3>
      <p>The <code>arcgis-exb-widget-dev</code> Skill guides the local agent through the widget's behavior, map
      interactions, communication between widgets with Message/Data Actions, and focused tests.</p></div>
  </div>
  <h2 id="remote">Remote MCP limitation</h2>
  <div class="tile"><span class="tile-ic">${icon("server", 20)}</span><h3>Why install it manually?</h3>
    <p>The remote server at <a class="inline" href="https://arcgis.web-mcp.workers.dev/mcp" target="_blank" rel="noopener noreferrer">https://arcgis.web-mcp.workers.dev/mcp</a>
    runs separately from your computer and cannot write files into your workspace. This endpoint does not currently
    provide the Skill through VS Code's experimental Skills from MCP servers feature, so install the folder locally once.</p>
  </div>
  <h2 id="installation">Installation</h2>
  <div class="tiles">
    <div class="tile"><span class="tile-ic">${icon("folder", 20)}</span><h3>Cloned repository</h3>
      <p>The Skill is already included and VS Code discovers it when you open this repository.</p>${code(skillPath)}</div>
    <div class="tile"><span class="tile-ic">${icon("copy", 20)}</span><h3>Remote MCP users</h3>
      <p>Copy the entire Skill folder from the
      <a class="inline" href="https://github.com/Ahmed-salah-muhammed/ArcGIS_Web_MCP/tree/main/.github/skills/arcgis-exb-widget-dev" target="_blank" rel="noopener noreferrer">repository</a>
      into either your current workspace or your personal Copilot skills directory.</p>
      <p>Workspace path:</p>${code(skillPath)}
      <p>Personal path (available across workspaces):</p>${code(personalSkillPath)}</div>
  </div>
  <div class="tile"><span class="tile-ic">${icon("shield", 20)}</span><h3>Check your Developer Edition version</h3>
    <p>The Skill does not install Experience Builder Developer Edition or guarantee compatibility with every release.
    Confirm that its guidance and the widget APIs match the version installed in your <code>client/</code> project.</p>
  </div>
  <h2 id="workflow">End-to-end workflow</h2>
  <div class="steps">
    <div class="tile"><span class="step-n">1</span><span class="tile-ic">${icon("grid", 20)}</span><h3>Generate</h3>
      <p>Call <code>portal_app</code> with <code>kind: "exb_widget"</code> and put the generated files in the widget directory below.</p></div>
    <div class="tile"><span class="step-n">2</span><span class="tile-ic">${icon("sparkle", 20)}</span><h3>Complete locally</h3>
      <p>In your local coding agent, invoke <code>/arcgis-exb-widget-dev</code> to implement the behavior and tests.</p></div>
    <div class="tile"><span class="step-n">3</span><span class="tile-ic">${icon("terminal", 20)}</span><h3>Validate</h3>
      <p>Run the type check from the Developer Edition client directory.</p></div>
  </div>
  <p>Widget folder:</p>${code("client/your-extensions/widgets/<name>/")}
  <p>From the repository root:</p>${code("cd client\nnpm run tscheck")}
  <h2 id="fallback">Fallback: <code>agent_handoff</code></h2>
  <p>If the local agent cannot find the Skill, <code>portal_app</code> returns <code>agent_handoff</code> with a fallback:
  inspect existing widget patterns and SDK samples, implement the behavior, add focused tests, and run
  <code>npm run tscheck</code> from <code>client/</code>.</p>`);
}

function toolPage(t: ToolDoc) {
	const cat = CATEGORIES.find((c) => c.id === t.category)!;
	const rows = (list: { name: string; does: string; confirm?: string }[], head: string) => `<table class="table">
    <thead><tr><th>${head}</th><th>What it does</th><th>Confirmation</th></tr></thead><tbody>${list.map((a) => `<tr>
      <td><code>${esc(a.name)}</code></td><td>${rich(a.does)}</td>
      <td>${a.confirm ? `<span class="badge warn">${esc(a.confirm)}</span>` : `<span class="badge">no</span>`}</td></tr>`).join("")}
    </tbody></table>`;
	return page(`t-${t.name}`, cat.name, t.name, `
  <p class="lead">${rich(t.summary)}</p>
  ${t.actions ? `<h2 id="actions-${t.name}">Actions</h2>${rows(t.actions, "Action")}` : ""}
  ${t.inputs ? `<h2 id="inputs-${t.name}">What you give it</h2>${rows(t.inputs, "Argument")}` : ""}
  <h2 id="ask-${t.name}">Try asking</h2>
  <div class="prompts">${t.examples.map((e) => `<div class="prompt">${icon("chat", 16)}<span>${esc(e)}</span></div>`).join("")}</div>
  ${t.notes?.length ? `<h2 id="notes-${t.name}">Good to know</h2><ul class="list">${t.notes.map((n) => `<li>${rich(n)}</li>`).join("")}</ul>` : ""}
  ${t.relatedPages?.length ? `<p>Related guide: ${t.relatedPages.map(({ title, id }) =>
		`<a class="inline" href="#${esc(id)}" data-nav="${esc(id)}">${esc(title)}</a>`).join(", ")}</p>` : ""}`,
	{ mono: true });
}

function security() {
	const items = [
		["lock", "Your account", "You sign in on ArcGIS itself, with OAuth 2.0 and PKCE. The server never sees your password and has no shared account."],
		["user", "Your permissions", "Every tool acts as you, so it can only do what your ArcGIS account can do."],
		["shield", "Ask first", "Deleting, bulk edits, public sharing and anything that spends credits answer with a preview and wait for your OK."],
		["globe", "Your token stays home", "Your ArcGIS token is stored encrypted, is only sent to your portal and its services, and never appears in results."],
	].map(([ic, t, d]) => `<div class="tile"><span class="tile-ic">${icon(ic, 20)}</span><h3>${t}</h3><p>${d}</p></div>`).join("");
	return page("security", "Guides", "Security & permissions", `
  <p class="lead">Built so an assistant can work on your ArcGIS content without ever holding your password or doing
  something irreversible behind your back.</p>
  <h2 id="principles">Principles</h2><div class="tiles">${items}</div>
  <h2 id="confirm">What asks for confirmation</h2>
  <p>Deleting items, folders, groups, fields, features or attachments; <code>calculate</code>; <code>truncate</code>;
  sharing with everyone; public groups; publishing by address (geocoding credits); and raw REST writes. Delete-protected
  items are refused even with confirmation.</p>`);
}

function limits() {
	const rows = [
		["Requests", "100,000 a day on Cloudflare's free plan"],
		["Rows per query", "Up to 1,000 per call (50 by default); page with offset"],
		["Edits per call", "Up to 5,000, in at most 30 batches"],
		["Publishing", "Up to 5 MB of CSV or GeoJSON text per call"],
		["Attachments", "Up to 10 MB per file"],
		["Batch", "Up to 10 tool calls per portal_batch"],
		["Requests to ArcGIS", "Up to 50 per call on Cloudflare's free plan; a call that needs more stops with subrequest_limit"],
	].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
	return page("limits", "Guides", "Limits", `
  <p class="lead">Limits that keep every call fast and inside the free hosting plan.</p>
  <h2 id="table">At a glance</h2><table class="table"><tbody>${rows}</tbody></table>`);
}

function about(author: Author | null) {
	if (!author) return page("about", "About", "About", `<p class="lead">ArcGIS Web MCP v${VERSION}.</p>`);
	return page("about", "About", "Developer", `
  <div class="person">${avatarHtml(author, "person-photo", 112)}
    <div><h2 id="dev">${esc(author.name)}</h2>${author.title ? `<p class="person-role">${esc(author.title)}</p>` : ""}
    <p>Designed and built ArcGIS Web MCP and ArcGIS Pro Salah MCP.</p>
    ${author.url ? `<a class="btn primary" href="${esc(author.url)}" target="_blank" rel="noopener noreferrer">Portfolio ${ARROW}</a>` : ""}</div></div>
  <h2 id="version">Version</h2><p>ArcGIS Web MCP v${VERSION}.</p>`);
}

function contact(author: Author | null) {
	const L = CONTACT_LIMITS;
	const me = author ? `<div class="contact-me">${avatarHtml(author, "me-photo", 52)}<div><b>${esc(author.name)}</b>
    <small>${esc(author.title ?? "Developer")}</small></div></div>` : "";
	const email = author?.email ? `<a class="contact-item link" href="mailto:${esc(author.email)}"><span class="tile-ic">${icon("mail", 19)}</span>
    <div><small>Email</small><b>${esc(author.email)}</b></div></a>` : "";
	const wa = author?.whatsapp ? `<a class="whatsapp" href="https://wa.me/${author.whatsapp.replace(/\D/g, "")}" target="_blank"
    rel="noopener noreferrer"><span class="wa-ic">${icon("whatsapp", 20)}</span><div><b>Chat on WhatsApp</b>
    <small>${esc(author.whatsapp)}</small></div><span class="wa-go">Open chat ${ARROW}</span></a>` : "";
	const tip = `<div class="contact-item"><span class="tile-ic">${icon("bug", 19)}</span><div><b>Reporting a problem?</b>
    <p>Include the tool, what you asked and the error text. Never paste a token or a password.</p></div></div>`;
	const portfolio = author?.url
		? `<a class="btn" href="${esc(author.url)}" target="_blank" rel="noopener noreferrer">Portfolio ${ARROW}</a>` : "";
	const items = email + wa + tip;
	const topics = TOPICS.map((t) => `<button type="button" class="topic" data-topic="${esc(t)}" aria-pressed="${t === "Question about the MCP"}">`
		+ `${icon(TOPIC_ICONS[t] ?? "chat", 14)}${esc(t)}</button>`).join("");
	return page("contact", "Contact", "Contact us", `
  <p class="lead">Questions, bug reports or ideas for ArcGIS Web MCP, or GIS and full-stack work: write here and I will
  answer.</p>
  <div class="contact">
    <div class="contact-side">${me}${items}${portfolio}</div>
    <form class="contact-form" id="contact-form" novalidate>
      <h2 id="send">Send a message</h2>
      <p>It lands straight in my inbox; hit reply and I will answer you directly.</p>
      <p class="field-label">Inquiry type (optional)</p>
      <div class="topics">${topics}</div>
      <div class="fields">
        <input name="name" placeholder="Your name" maxlength="${L.name}" autocomplete="name" required aria-label="Your name">
        <input name="email" type="email" placeholder="Your email" maxlength="${L.email}" autocomplete="email" required aria-label="Your email">
        <input class="wide" name="subject" placeholder="Subject (optional)" maxlength="${L.subject}" aria-label="Subject">
        <div class="wide"><textarea name="message" placeholder="Message" maxlength="${L.message}" rows="6" required
          aria-label="Message"></textarea><span class="count" id="count">0 / ${L.message}</span></div>
      </div>
      <input class="sr" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="send-row"><button class="btn primary" type="submit"><span>Send message</span>${icon("send", 16)}</button>
        <p class="form-status" id="form-status" role="status"></p></div>
    </form>
  </div>`);
}

function sidebar(byCategory: Map<string, ToolDoc[]>, author: Author | null) {
	const link = (hash: string, ic: string, label: string, nav = hash) =>
		`<a class="nav" href="#${hash}" data-nav="${nav}">${icon(ic, 18)}<span>${label}</span></a>`;
	const toolGroups = [
		{ id: "read", name: "Find &amp; Read", icon: "search", categories: ["read"] },
		{ id: "publish", name: "Publish &amp; Edit", icon: "layers", categories: ["data"] },
		{ id: "apps", name: "Apps &amp; Maps", icon: "grid", categories: ["apps"] },
		{ id: "power", name: "Power Tools", icon: "bolt", categories: ["content", "power"] },
	].map((group) => {
		const tools = group.categories.flatMap((category) => byCategory.get(category) ?? [])
			.filter((tool) => tool.name !== "portal_survey123");
		return `<details class="navgroup tool-group" data-group="${group.id}"><summary>${icon(group.icon, 18)}<span>${group.name}</span>
      <span class="group-count">${tools.length}</span><i class="chev">${icon("chevron", 14)}</i></summary>${tools.map((t) =>
			`<a class="nav sub" href="#t-${t.name}" data-nav="t-${t.name}"><span>${t.name}</span></a>`).join("")}</details>`;
	}).join("");
	const clientOptions: [string, string, string[]][] = [
		["desktop", "Claude Desktop", ["/client-icons/claude.svg"]],
		["claude-code", "Claude Code CLI", ["/client-icons/claude.svg"]],
		["cursor", "Cursor &amp; Windsurf", ["/client-icons/cursor.svg", "/client-icons/windsurf.svg"]],
		["vscode", "VS Code", ["/client-icons/vscode.png"]],
	];
	const clients = clientOptions.map(([tab, name, logos]) => `<a class="nav sub" href="#connect" data-client-tab="${tab}"><span class="client-logos">${logos
		.map((src) => `<img src="${src}" alt="" width="14" height="14">`).join("")}</span><span>${name}</span></a>`).join("");
	const appIcons = ["instant", "dashboard", "experience", "storymap", "survey", "fieldmaps"]
		.map((kind) => `<img src="${APP_ICONS[kind]}" alt="" width="16" height="16">`).join("");
	return `<aside class="side" id="side">
  <nav>
    <details class="nav-section" open><summary class="label section-toggle">${icon("sliders", 14)}<span>Get started</span>
      <i class="chev">${icon("chevron", 14)}</i></summary>
      ${link("overview", "arrows", "Overview")}
      ${link("architecture", "server", "Architecture")}
    <details class="navgroup install-group" open><summary data-nav="connect">${icon("terminal", 18)}<span>Install Client</span>
      <i class="chev">${icon("chevron", 14)}</i></summary>${clients}</details>
    </details>
    <p class="label">ArcGIS Online apps</p><a class="nav apps-link" href="#apps" data-nav="apps">
      <span class="apps-nav-icons">${appIcons}</span><span>Build  Apps</span></a>
    <p class="label label-counted"><span>Tools reference</span><span class="group-count">${TOOL_DOCS.length}</span></p>${toolGroups}
    <a class="nav" href="#agent-skills" data-nav="agent-skills">${icon("sparkle", 18)}<span>Agent Skills</span><span class="group-count">1</span></a>
    <p class="label">Guides &amp; specs</p>${link("security", "shield", "Security &amp; Permissions")}
    ${link("limits", "gauge", "Limits")}
  </nav>
  <footer class="side-foot">
    ${author ? `<a class="me" href="#about" data-nav="about">${avatarHtml(author, "me-photo", 34)}
      <span><b>${esc(author.name)}</b><small>${esc(author.title ?? "Developer")}</small></span></a>` : ""}
  </footer>
</aside>`;
}

const SCRIPT = `
(() => {
  const pages = [...document.querySelectorAll(".page")];
  const content = document.getElementById("content");
  const toc = document.getElementById("toc-links");
  const side = document.getElementById("side");
  const breadcrumb = document.getElementById("breadcrumb");
  const copyPage = document.getElementById("copy-page");
  const searchOverlay = document.getElementById("search-overlay");
  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");
  const searchOpen = document.getElementById("search-open");
  const searchItems = pages.map((p) => ({
    id: p.id.slice(2),
    title: p.dataset.title,
    section: p.querySelector(".eyebrow")?.textContent.trim() || "Documentation",
    terms: p.textContent.toLowerCase()
  }));
  let heads = [];
  function addCrumb(text, className) {
    const item = document.createElement("span");
    item.className = className;
    item.textContent = text;
    breadcrumb.append(item);
  }
  function show() {
    const id = decodeURIComponent(location.hash.slice(1)) || "overview";
    const page = document.getElementById("p-" + id) || document.getElementById("p-overview");
    const current = page.id.slice(2);
    pages.forEach((p) => { p.hidden = p !== page; });
    document.querySelectorAll("[data-nav]").forEach((a) => {
      const on = a.dataset.nav === current;
      a.classList.toggle("on", on);
      if (on && a.closest("details")) a.closest("details").open = true;
    });
    heads = [page.querySelector("h1"), ...page.querySelectorAll("h2[id]:not(.sr)")];
    toc.innerHTML = heads.map((h, i) => '<a href="#' + current + '" data-head="' + i + '"' + (i ? "" : ' class="on"') + ">"
      + h.textContent.trim() + "</a>").join("");
    breadcrumb.replaceChildren();
    addCrumb(page.querySelector(".eyebrow")?.textContent.trim() || "Documentation", "crumb-section");
    addCrumb("/", "crumb-separator");
    addCrumb(page.dataset.title, "crumb-current");
    copyPage.dataset.copy = location.href;
    document.title = page.dataset.title + " | ArcGIS Web MCP";
    content.scrollTop = 0;
    side.classList.remove("open");
  }
  function renderSearch() {
    const query = searchInput.value.trim().toLowerCase();
    const matches = searchItems.filter((item) => !query || (item.title + " " + item.section + " " + item.terms).includes(query)).slice(0, 8);
    searchResults.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = "No documentation pages found.";
      searchResults.append(empty);
      return;
    }
    matches.forEach((item) => {
      const link = document.createElement("a");
      link.className = "search-result";
      link.setAttribute("role", "option");
      link.href = "#" + item.id;
      const title = document.createElement("span");
      title.textContent = item.title;
      const section = document.createElement("small");
      section.textContent = item.section;
      link.append(title, section);
      searchResults.append(link);
    });
  }
  function openSearch() {
    searchOverlay.hidden = false;
    searchInput.value = "";
    renderSearch();
    searchInput.focus();
  }
  function closeSearch() {
    if (searchOverlay.hidden) return;
    searchOverlay.hidden = true;
    searchOpen.focus();
  }
  searchOpen.addEventListener("click", openSearch);
  searchInput.addEventListener("input", renderSearch);
  searchResults.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeSearch();
  });
  searchOverlay.addEventListener("click", (e) => {
    if (e.target.closest("[data-search-close]")) closeSearch();
  });
  toc.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-head]"); if (!a) return;
    e.preventDefault();
    const head = heads[+a.dataset.head];
    content.scrollTo({
      top: content.scrollTop + head.getBoundingClientRect().top - content.getBoundingClientRect().top,
      behavior: "smooth"
    });
  });
  content.addEventListener("scroll", () => {
    let on = 0;
    heads.forEach((h, i) => { if (h.getBoundingClientRect().top - content.getBoundingClientRect().top < 120) on = i; });
    toc.querySelectorAll("a").forEach((a, i) => a.classList.toggle("on", i === on));
  });
  side.addEventListener("click", (e) => {
    const link = e.target.closest("[data-client-tab]");
    if (!link) return;
    const page = document.getElementById("p-connect");
    const tab = page.querySelector('[data-tab="' + link.dataset.clientTab + '"]');
    page.querySelectorAll(".tab").forEach((item) => item.classList.toggle("on", item === tab));
    page.querySelectorAll(".tab-panel").forEach((item) => { item.hidden = item.dataset.panel !== link.dataset.clientTab; });
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy]"); if (!b) return;
    const label = b.querySelector("span"); const was = label ? label.textContent : "";
    try { await navigator.clipboard.writeText(b.dataset.copy); if (label) label.textContent = "Copied"; }
    catch { if (label) label.textContent = "Select & copy"; }
    setTimeout(() => { if (label) label.textContent = was; }, 1600);
  });
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    const box = t.closest(".page");
    box.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === t));
    box.querySelectorAll(".tab-panel").forEach((p) => { p.hidden = p.dataset.panel !== t.dataset.tab; });
  }));
  const filter = document.getElementById("filter");
  filter.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    document.querySelectorAll("[data-group]").forEach((g) => {
      let any = false;
      g.querySelectorAll(".chip").forEach((c) => { const hit = !q || c.dataset.search.includes(q); c.hidden = !hit; any ||= hit; });
      g.hidden = !any;
    });
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); return; }
    if (e.key === "Escape") { closeSearch(); side.classList.remove("open"); }
    if (e.key === "/" && document.activeElement !== filter && !document.getElementById("p-tools").hidden) { e.preventDefault(); filter.focus(); }
  });
  const form = document.getElementById("contact-form");
  if (form) {
    const field = (n) => form.elements.namedItem(n);
    const status = document.getElementById("form-status");
    const count = document.getElementById("count");
    const max = field("message").maxLength;
    const say = (text, tone) => { status.textContent = text; status.className = "form-status " + (tone || ""); };
    const topics = [...form.querySelectorAll(".topic")];
    field("message").addEventListener("input", () => { count.textContent = field("message").value.length + " / " + max; });
    topics.forEach((t) => t.addEventListener("click", () => {
      const on = t.getAttribute("aria-pressed") !== "true";
      topics.forEach((x) => x.setAttribute("aria-pressed", String(x === t && on)));
    }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const picked = topics.find((t) => t.getAttribute("aria-pressed") === "true");
      const body = { name: field("name").value, email: field("email").value, subject: field("subject").value,
        message: field("message").value, topic: picked ? picked.dataset.topic : null, website: field("website").value };
      if (!body.name.trim() || !body.email.trim() || !body.message.trim()) { say("Please fill in your name, email and message.", "bad"); return; }
      if (!field("email").checkValidity()) { say("Please enter a valid email address.", "bad"); field("email").focus(); return; }
      const button = form.querySelector("button[type=submit]");
      button.disabled = true; say("Sending...");
      try {
        const res = await fetch("/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const out = await res.json().catch(() => ({}));
        if (res.ok && out.ok) {
          form.reset(); topics.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.topic === "Question about the MCP"))); count.textContent = "0 / " + max;
          say("Thanks! Your message is on its way; I will reply by email.", "good");
        } else {
          say(out.error || "The message could not be sent. Please try again later.", "bad");
          if (out.field && field(out.field) && field(out.field).focus) field(out.field).focus();
        }
      } catch { say("No connection. Please try again.", "bad"); }
      button.disabled = false;
    });
  }
  document.getElementById("burger").addEventListener("click", (e) => { e.stopPropagation(); side.classList.toggle("open"); });
  document.querySelector(".main").addEventListener("click", () => side.classList.remove("open"));
  addEventListener("hashchange", show);
  show();
})();
`;

/** The documentation app; `origin` is this deployment's own origin, so the URL shown is always the right one. */
export function homePage(origin: string, author: Author | null): string {
	const url = esc(`${origin.replace(/\/+$/, "")}/mcp`);
	const byCategory = new Map<string, ToolDoc[]>();
	for (const t of TOOL_DOCS) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArcGIS Web MCP</title>
<meta name="description" content="A remote MCP server for ArcGIS Online and ArcGIS Enterprise: sign in with your own ArcGIS account and work with your content from Claude or any MCP client.">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/home.css?v=${VERSION}&amp;rev=2">
</head>
<body>
<div class="app">
  <header class="top">
    <button class="burger" id="burger" type="button" aria-label="Menu">${icon("menu", 22)}</button>
    <a class="brand" href="#overview" aria-label="ArcGIS Web MCP documentation"><span class="logo"><img class="brand-logo" src="/brand-logo.png" alt=""></span><span>ArcGIS <em>Web MCP</em></span></a>
    <span class="ver">v${VERSION}</span><span class="ver beta">Beta</span>
    <button class="search-trigger" id="search-open" type="button" aria-label="Search documentation" aria-haspopup="dialog" aria-controls="search-overlay">
      ${icon("search", 16)}<span>Search documentation…</span><kbd>Ctrl K</kbd></button>
    <nav><a class="github-link" href="https://github.com/Ahmed-salah-muhammed/ArcGIS_Web_MCP" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository">${icon("github", 16)}<span>GitHub</span></a>
      <a href="${author?.url ? esc(author.url) : "#about"}" ${author?.url ? 'target="_blank" rel="noopener noreferrer"' : 'data-nav="about"'}>Go to Portfolio</a>
      <a href="#contact" data-nav="contact">Contact us</a><a href="#overview" data-nav="overview">Documentation</a>
      <button class="btn primary" type="button" data-copy="${url}" title="Copy server URL" aria-label="Copy server URL">${icon("copy", 15)}<span>Copy Server URL</span></button></nav>
  </header>
  <div class="body">
    ${sidebar(byCategory, author)}
    <main class="main">
      <div class="panel">
        <div class="content" id="content">
          <div class="article-toolbar"><nav class="breadcrumb" id="breadcrumb" aria-label="Breadcrumb"></nav>
            <button class="copy-page" id="copy-page" type="button" data-copy="" title="Copy page link">${icon("copy", 14)}<span>Copy link</span></button></div>
          ${overview(url, TOOL_DOCS.length)}
          ${architecture()}
          ${connect(url)}
          ${apps()}
          ${agentSkills()}
          ${tools(byCategory)}
          ${TOOL_DOCS.map(toolPage).join("\n")}
          ${security()}
          ${limits()}
          ${contact(author)}
          ${about(author)}
        </div>
        <aside class="toc"><p>${icon("list", 14)}On this page</p><div id="toc-links"></div></aside>
      </div>
    </main>
  </div>
  <div class="search-overlay" id="search-overlay" hidden>
    <div class="search-backdrop" data-search-close></div>
    <section class="search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-title">
      <h2 class="sr" id="search-title">Search documentation</h2>
      <div class="search-input-wrap">${icon("search", 18)}<input id="search-input" type="search" placeholder="Search pages and tools…" autocomplete="off" aria-label="Search pages and tools">
        <button type="button" data-search-close aria-label="Close search">Esc</button></div>
      <div class="search-results" id="search-results" role="listbox" aria-label="Search results"></div>
      <p class="search-footer"><span><kbd>Esc</kbd> to close</span><span>Search documentation and tools</span></p>
    </section>
  </div>
</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}

/** Headers for the documentation page: no framing, only its own stylesheet and inline script, and same-origin requests. */
export const HOME_HEADERS = {
	"Content-Type": "text/html; charset=utf-8",
	"Content-Security-Policy": "default-src 'none'; style-src 'self'; script-src 'unsafe-inline'; img-src 'self' data:; "
		+ "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "no-referrer",
};

export const HOME_CSS_HEADERS = {
	"Content-Type": "text/css; charset=utf-8",
	"Cache-Control": "no-cache",
	"X-Content-Type-Options": "nosniff",
};

export { HOME_CSS };
