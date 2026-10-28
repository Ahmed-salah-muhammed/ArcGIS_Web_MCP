/**
 * The documentation app served at "/": a fixed app shell (top bar, sidebar, one panel, "on this page") whose pages
 * switch by URL hash (#overview, #connect, #tools, #t-portal_search, #security, #limits, #contact, #about), so the
 * browser page never scrolls. Everything is inline (no external fonts, scripts or images) for the strict CSP; the
 * contact form posts JSON to /contact on this same origin (src/contact.ts).
 */
import { CONTACT_LIMITS, TOPICS } from "../contact";
import { APP_ICONS } from "./app-icons";
import { ARROW, avatarHtml, esc, FAVICON } from "./credit";
import { CATEGORIES, TOOL_DOCS, type ToolDoc } from "./docs";
import { type Author, VERSION } from "./identity";

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
	briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
	book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5"/>',
	clipboard: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2.5h6V4M9 11h6M9 15h6"/>',
	pin: '<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
	code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
	whatsapp: '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.2 3.1z"/><path d="M9.2 8.6c.2-.5.5-.6.8-.6h.6c.2 0 .4.1.5.4l.7 1.6c.1.3 0 .5-.1.7l-.5.6c.6 1.2 1.6 2.1 2.8 2.7l.6-.5c.2-.2.5-.2.7-.1l1.6.7c.3.1.4.3.4.6v.6c0 .4-.2.7-.6.8-2.6 1-7.3-3.6-6.5-6.5z"/>',
};

const TOPIC_ICONS: Record<string, string> = {
	"Question about the MCP": "chat", "Bug report": "bug", "Feature request": "sparkle", "WebGIS & Full-Stack": "map",
	"ArcGIS Enterprise": "server", "Career / Full-Time": "briefcase",
};

const icon = (name: string, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;

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
    <li>Build the app (<code>portal_app</code>), then share it (<code>portal_share</code>).</li></ol>`);
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
  ${t.notes?.length ? `<h2 id="notes-${t.name}">Good to know</h2><ul class="list">${t.notes.map((n) => `<li>${rich(n)}</li>`).join("")}</ul>` : ""}`,
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
	const topics = TOPICS.map((t) => `<button type="button" class="topic" data-topic="${esc(t)}" aria-pressed="false">`
		+ `${icon(TOPIC_ICONS[t] ?? "chat", 14)}${esc(t)}</button>`).join("");
	return page("contact", "Contact", "Contact us", `
  <p class="lead">Questions, bug reports or ideas for ArcGIS Web MCP, or GIS and full-stack work: write here and I will
  answer by email.</p>
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
	const link = (hash: string, ic: string, label: string) =>
		`<a class="nav" href="#${hash}" data-nav="${hash}">${icon(ic, 18)}<span>${label}</span></a>`;
	const groups = CATEGORIES.map((c) => `<details class="navgroup"><summary>${icon(c.icon, 18)}<span>${esc(c.name)}</span>
    <i class="chev">${icon("chevron", 14)}</i></summary>${(byCategory.get(c.id) ?? []).map((t) =>
		`<a class="nav sub" href="#t-${t.name}" data-nav="t-${t.name}"><span>${t.name}</span></a>`).join("")}</details>`).join("");
	const me = author ? `<a class="me" href="#about" data-nav="about">${avatarHtml(author, "me-photo", 34)}
    <span><b>${esc(author.name)}</b><small>${esc(author.title ?? "Developer")}</small></span></a>` : "";
	return `<aside class="side" id="side">
  <nav>
    <p class="label">Get started</p>${link("overview", "home", "Overview")}${link("connect", "plug", "Connect")}
    <p class="label">Tools</p>${link("tools", "grid", "Tools reference")}${link("apps", "sparkle", "Build apps")}${groups}
    <p class="label">Guides</p>${link("security", "shield", "Security")}${link("limits", "gauge", "Limits")}${link("contact", "mail", "Contact us")}
  </nav>
  <div class="side-foot">${me}</div>
</aside>`;
}

const CSS = `
  :root { --bg: #000; --panel: #121212; --card: #1a1a1a; --card-2: #222; --line: #262626; --line-2: #2f2f2f;
    --text: #f2f2f2; --muted: #a1a1aa; --dim: #71717a; --blue: #3b82f6; --green: #22c55e; --orange: #f59e0b;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; overflow: hidden; background: var(--bg); color: var(--text); line-height: 1.6;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  a { color: inherit; text-decoration: none; }
  code { font-family: var(--mono); font-size: .86em; background: var(--card-2); border: 1px solid var(--line-2);
    padding: .08rem .38rem; border-radius: 6px; color: #e5e7eb; }
  .app { display: grid; grid-template-rows: 60px minmax(0, 1fr); grid-template-columns: minmax(0, 1fr); height: 100vh; height: 100dvh; }
  .top { display: flex; align-items: center; gap: 1.25rem; padding: 0 1.5rem; }
  .brand { display: flex; align-items: center; gap: .6rem; font-weight: 800; font-size: 1.12rem; letter-spacing: -.01em; white-space: nowrap; }
  .brand .logo { color: var(--blue); display: inline-flex; }
  .brand em { font-style: normal; color: var(--blue); }
  .ver { font-size: .7rem; font-weight: 600; color: var(--muted); border: 1px solid var(--line-2); border-radius: 999px; padding: .05rem .5rem; }
  .top nav { margin-left: auto; display: flex; align-items: center; gap: .5rem; color: var(--muted); font-size: .94rem; }
  .top nav a { padding: .38rem .75rem; border-radius: 8px; }
  .top nav a:hover { color: var(--text); }
  .top nav a.on { color: #fff; background: rgba(59,130,246,.16); }
  .top nav .btn { margin-left: .6rem; }
  .btn { display: inline-flex; align-items: center; gap: .45rem; border: 1px solid var(--line-2); background: var(--card);
    color: var(--text); font: inherit; font-weight: 600; font-size: .9rem; padding: .5rem .95rem; border-radius: 9px; cursor: pointer; }
  .btn.primary { background: var(--blue); border-color: var(--blue); color: #fff; }
  .btn.primary:hover { filter: brightness(1.1); }
  .burger { display: none; background: none; border: 0; color: var(--text); cursor: pointer; padding: .25rem; }
  .body { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 0; }
  .side { display: flex; flex-direction: column; min-height: 0; padding: .5rem .75rem 1rem 1rem; }
  .side nav { flex: 1; overflow-y: auto; padding-right: .25rem; scrollbar-width: thin; scrollbar-color: #333 transparent; }
  .label { margin: 1.4rem .5rem .45rem; font-size: .7rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  .nav { display: flex; align-items: center; gap: .7rem; padding: .5rem .65rem; border-radius: 9px; color: #d4d4d8;
    font-size: .93rem; font-weight: 500; }
  .nav:hover { background: var(--card); color: var(--text); }
  .nav.on { background: var(--card-2); color: #fff; }
  .nav.sub { padding: .32rem .65rem .32rem 2.55rem; font-family: var(--mono); font-size: .8rem; color: var(--muted); }
  .nav.sub.on { color: #fff; background: var(--card); box-shadow: inset 2px 0 0 var(--blue); }
  details.navgroup summary { list-style: none; display: flex; align-items: center; gap: .7rem; padding: .5rem .65rem;
    border-radius: 9px; cursor: pointer; color: #d4d4d8; font-size: .93rem; font-weight: 500; }
  details.navgroup summary::-webkit-details-marker { display: none; }
  details.navgroup summary:hover { background: var(--card); }
  details.navgroup .chev { margin-left: auto; display: inline-flex; transition: transform .15s; }
  details.navgroup:not([open]) .chev { transform: rotate(-90deg); }
  .side-foot { border-top: 1px solid var(--line); padding-top: .8rem; margin-top: .5rem; }
  .me { display: flex; align-items: center; gap: .65rem; padding: .45rem .5rem; border-radius: 10px; }
  .me:hover, .me.on { background: var(--card); }
  .me-photo { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; flex: none; box-shadow: 0 0 0 2px #333;
    display: grid; place-items: center; background: linear-gradient(135deg, #007ac2, #35ac46); font-size: .75rem; font-weight: 700; }
  .me span { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
  .me b { font-size: .8rem; white-space: nowrap; }
  .me small { font-size: .72rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .main { min-height: 0; padding: 0 1rem 1rem 0; }
  .panel { height: 100%; display: grid; grid-template-columns: minmax(0, 1fr) 230px; background: var(--panel);
    border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }
  .content { overflow-y: auto; padding: 2rem 2.6rem 2rem; scrollbar-width: thin; scrollbar-color: #333 transparent; }
  .toc { padding: 2.6rem 1.25rem 1rem 0; overflow-y: auto; }
  .toc p { display: flex; align-items: center; gap: .5rem; margin: 0 0 1rem; font-size: .72rem; font-weight: 800; letter-spacing: .07em;
    text-transform: uppercase; color: var(--muted); }
  .toc p svg { color: var(--blue); }
  .toc a { display: block; padding: .42rem .9rem; font-size: .85rem; color: var(--muted); border-left: 2px solid var(--line-2); }
  .toc a:hover { color: var(--text); }
  .toc a.on { color: var(--blue); border-left-color: var(--blue); background: rgba(59,130,246,.08); font-weight: 600; }
  .eyebrow { margin: 0 0 .35rem; color: var(--blue); font-weight: 800; font-size: .82rem; letter-spacing: .02em; text-transform: uppercase; }
  h1 { margin: 0 0 .75rem; font-size: clamp(2rem, 3.4vw, 2.85rem); font-weight: 800; font-style: italic; letter-spacing: -.02em; line-height: 1.12; }
  h1.mono { font-family: var(--mono); font-style: normal; font-size: clamp(1.6rem, 2.8vw, 2.3rem); }
  h2 { margin: 1.6rem 0 .8rem; font-size: 1.4rem; font-weight: 800; letter-spacing: -.01em; }
  h3 { margin: 0 0 .3rem; font-size: 1.02rem; font-weight: 700; }
  .lead { max-width: 760px; margin: 0 0 1.1rem; color: #c4c4cc; font-size: 1.06rem; }
  p { color: #c4c4cc; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 1.3rem 0 0; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .endpoint { display: flex; align-items: center; gap: .9rem; max-width: 760px; padding: .55rem .6rem .55rem 1rem;
    background: var(--card); border: 1px solid var(--line-2); border-radius: 12px; }
  .endpoint-label { font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
  .endpoint code { flex: 1; min-width: 0; background: none; border: 0; font-size: .95rem; overflow-x: auto; white-space: nowrap; color: #fff; }
  .features { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
  .feature { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    overflow: hidden; transition: border-color .15s, transform .15s; }
  .feature:hover { border-color: #3f3f46; transform: translateY(-2px); }
  .feature-art { height: 84px; display: grid; place-items: center; background: #1e1e1e; }
  .feature-body { padding: .8rem 1rem 1rem; }
  .feature-body p, .step p, .tile p, .group-head p { margin: 0; font-size: .86rem; color: var(--muted); }
  .blue { color: var(--blue); } .green { color: var(--green); } .orange { color: var(--orange); }
  .steps, .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .step, .tile { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 1.1rem 1.15rem; }
  .step { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: .8rem; align-items: start; padding: .85rem 1rem; }
  .step .step-ic { grid-row: span 2; margin: 0; }
  .step h3 { margin: 0; font-size: .95rem; }
  .step-n { position: absolute; top: .7rem; right: .9rem; font-family: var(--mono); font-size: .75rem; color: var(--dim); }
  .step-ic, .tile-ic { display: inline-grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; margin-bottom: .6rem;
    background: rgba(59,130,246,.12); color: var(--blue); }
  .tabs { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: 1rem; }
  .tab { border: 1px solid var(--line-2); background: var(--card); color: var(--muted); font: inherit; font-size: .88rem; font-weight: 600;
    padding: .4rem .85rem; border-radius: 999px; cursor: pointer; }
  .tab.on { background: var(--blue); border-color: var(--blue); color: #fff; }
  .tab-panel { max-width: 820px; }
  .list { margin: .3rem 0 .8rem; padding-left: 1.3rem; color: #c4c4cc; }
  .list li { margin-bottom: .35rem; }
  .code { position: relative; margin: .4rem 0 1rem; background: #0b0b0b; border: 1px solid var(--line-2); border-radius: 12px; }
  .code pre { margin: 0; padding: .9rem 6rem .9rem 1rem; overflow-x: auto; }
  .code code { background: none; border: 0; padding: 0; font-size: .86rem; color: #e5e7eb; }
  .copy { position: absolute; top: .5rem; right: .5rem; display: inline-flex; align-items: center; gap: .35rem; border: 1px solid var(--line-2);
    background: var(--card-2); color: var(--muted); font: inherit; font-size: .78rem; font-weight: 600; padding: .3rem .6rem;
    border-radius: 7px; cursor: pointer; }
  .copy:hover { color: #fff; }
  .stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: .7rem; margin-bottom: .9rem; }
  .stat { display: flex; align-items: center; gap: .55rem; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: .6rem .85rem; }
  .stat strong { font-size: 1.35rem; line-height: 1; }
  .stat > span:last-child { font-size: .68rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); line-height: 1.2; }
  .filter { display: flex; align-items: center; gap: .55rem; max-width: 420px; margin: 0 0 .9rem; padding: .5rem .8rem;
    background: var(--card); border: 1px solid var(--line-2); border-radius: 10px; color: var(--muted); }
  .filter input { flex: 1; min-width: 0; background: none; border: 0; outline: 0; color: var(--text); font: inherit; font-size: .9rem; }
  kbd { font-family: var(--mono); font-size: .72rem; border: 1px solid var(--line-2); border-radius: 5px; padding: 0 .35rem; }
  .groups { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .8rem; align-items: start; }
  .group { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: .9rem 1rem; }
  .group-head { display: flex; align-items: flex-start; gap: .75rem; padding-bottom: .75rem; margin-bottom: .75rem; border-bottom: 1px solid var(--line); }
  .group-head p { font-size: .8rem; }
  .group-ic { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; background: #0f172a; flex: none; }
  .group-head h3 { display: flex; align-items: center; gap: .45rem; font-size: 1rem; }
  .tag { font-family: var(--mono); font-size: .72rem; font-weight: 600; color: var(--muted); background: var(--card-2);
    border: 1px solid var(--line-2); border-radius: 6px; padding: .02rem .4rem; }
  .group-meta { margin-left: auto; text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: .2rem; }
  .group-meta span { font-size: .66rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--dim); }
  .group-meta b { font-size: .8rem; background: var(--card-2); border: 1px solid var(--line-2); border-radius: 7px; padding: .1rem .55rem; }
  .chips { display: grid; grid-template-columns: minmax(0, 1fr); gap: .45rem; }
  .chip { display: flex; align-items: center; gap: .6rem; padding: .42rem .75rem; border: 1px solid var(--line-2); border-radius: 10px;
    background: #161616; font-family: var(--mono); font-size: .82rem; color: #e4e4e7; }
  .chip i { width: 6px; height: 6px; border-radius: 50%; background: var(--dim); flex: none; }
  .chip:hover { border-color: var(--blue); } .chip:hover i { background: var(--blue); }
  .table { width: 100%; max-width: 900px; border-collapse: collapse; font-size: .9rem; background: var(--card);
    border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .table th { text-align: left; font-size: .7rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
    background: #1e1e1e; padding: .6rem .85rem; }
  .table td { padding: .6rem .85rem; border-top: 1px solid var(--line); color: #d4d4d8; vertical-align: top; }
  .badge { display: inline-block; font-size: .72rem; font-weight: 700; padding: .08rem .5rem; border-radius: 999px;
    border: 1px solid var(--line-2); color: var(--dim); white-space: nowrap; }
  .badge.warn { color: #fbbf24; border-color: rgba(245,158,11,.45); background: rgba(245,158,11,.08); }
  .prompts { display: grid; gap: .55rem; max-width: 820px; }
  .prompt { display: flex; align-items: flex-start; gap: .65rem; padding: .7rem .9rem; background: var(--card);
    border: 1px solid var(--line); border-radius: 11px; color: #e4e4e7; }
  .prompt svg { color: var(--blue); flex: none; margin-top: .2rem; }
  .person { display: flex; align-items: center; gap: 1.6rem; padding: 1.4rem; max-width: 760px; background: var(--card);
    border: 1px solid var(--line); border-radius: 18px; }
  .person h2 { margin: 0 0 .1rem; }
  .person-photo { width: 112px; height: 112px; border-radius: 50%; object-fit: cover; flex: none; box-shadow: 0 0 0 3px #2a2a2a;
    display: grid; place-items: center; font-size: 2rem; font-weight: 800; background: linear-gradient(135deg, #007ac2, #35ac46); }
  .person-role { margin: 0 0 .5rem; color: var(--blue); font-weight: 600; }
  .apps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .9rem; }
  .app-card { display: flex; flex-direction: column; gap: .6rem; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 1rem; }
  .app-head { display: flex; align-items: center; gap: .7rem; } .app-head .tile-ic { margin: 0; flex: none; }
  .app-head h3 { margin: 0; font-size: .98rem; } .app-head code { font-size: .74rem; }
  .app-logo { position: relative; flex: none; width: 40px; height: 40px; } .app-logo img { display: block; width: 40px; height: 40px; }
  .app-logo i { position: absolute; right: -4px; bottom: -4px; display: grid; place-items: center; width: 18px; height: 18px;
    border-radius: 50%; background: #0b0b0b; border: 1px solid var(--line-2); color: #fff; }
  .app-card > p { margin: 0; font-size: .86rem; color: var(--muted); flex: 1; }
  .app-card .prompt { padding: .5rem .7rem; font-size: .82rem; background: #161616; }
  a.inline { color: var(--blue); font-weight: 600; }
  .contact { display: grid; grid-template-columns: minmax(0, 370px) minmax(0, 1fr); gap: 1rem; align-items: start; max-width: 1060px; }
  .contact-side, .contact-form { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 1.15rem 1.25rem; }
  .contact-side { display: grid; gap: 1rem; justify-items: start; }
  .contact-me { display: flex; align-items: center; gap: .8rem; width: 100%; padding-bottom: 1rem; border-bottom: 1px solid var(--line); }
  .contact-me .me-photo { width: 52px; height: 52px; }
  .contact-me b { display: block; font-size: .95rem; } .contact-me small { color: var(--muted); font-size: .8rem; }
  .contact-item { display: flex; align-items: flex-start; gap: .8rem; min-width: 0; } .contact-item .tile-ic { margin: 0; flex: none; }
  .contact-item.link { align-items: center; } .contact-item small { display: block; font-size: .78rem; color: var(--muted); }
  .contact-item.link b { overflow-wrap: anywhere; } .contact-item.link:hover b { color: var(--blue); }
  .whatsapp { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem .75rem; width: 100%; padding: .75rem .8rem; border-radius: 12px;
    border: 1px solid rgba(34,197,94,.35); background: rgba(34,197,94,.07); }
  .whatsapp:hover { border-color: var(--green); }
  .wa-ic { display: inline-grid; place-items: center; width: 38px; height: 38px; flex: none; border-radius: 10px;
    background: rgba(34,197,94,.15); color: var(--green); }
  .whatsapp div { min-width: 0; } .whatsapp b { display: block; font-size: .9rem; white-space: nowrap; }
  .whatsapp small { display: block; font-size: .8rem; color: var(--muted); white-space: nowrap; }
  .wa-go { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: .3rem; font-size: .78rem; font-weight: 700;
    color: var(--green); border: 1px solid rgba(34,197,94,.35); border-radius: 999px; padding: .25rem .65rem; white-space: nowrap; }
  .contact-item b { font-size: .9rem; } .contact-item p { margin: .1rem 0 0; font-size: .83rem; color: var(--muted); line-height: 1.5; }
  .contact-form h2 { margin: 0 0 .15rem; font-size: 1.3rem; }
  .contact-form > p { margin: 0 0 .9rem; color: var(--muted); font-size: .9rem; }
  .contact-form .field-label { margin: 0 0 .45rem; font-size: .82rem; font-weight: 600; color: #d4d4d8; }
  .topics { display: flex; flex-wrap: wrap; gap: .45rem; margin-bottom: 1rem; }
  .topic { display: inline-flex; align-items: center; gap: .4rem; border: 1px solid var(--line-2); background: #161616; color: #e4e4e7;
    font: inherit; font-size: .8rem; font-weight: 600; padding: .32rem .68rem; border-radius: 8px; cursor: pointer; }
  .topic:hover { border-color: #3f3f46; }
  .topic[aria-pressed="true"] { border-color: var(--blue); background: rgba(59,130,246,.15); color: #fff; }
  .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .7rem; }
  .fields .wide { grid-column: 1 / -1; }
  .fields input, .fields textarea { display: block; width: 100%; background: #0f0f0f; border: 1px solid var(--line-2); border-radius: 10px;
    color: var(--text); font: inherit; font-size: .92rem; padding: .68rem .85rem; outline: 0; }
  .fields input:focus, .fields textarea:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(59,130,246,.18); }
  .fields textarea { resize: vertical; min-height: 120px; max-height: 320px; }
  .count { display: block; text-align: right; font-size: .74rem; color: var(--dim); margin-top: .25rem; }
  .send-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-top: .35rem; }
  .form-status { margin: 0; font-size: .88rem; } .form-status.good { color: var(--green); } .form-status.bad { color: #f87171; }
  .btn:disabled { opacity: .6; cursor: progress; }
  @media (max-width: 1180px) { .panel { grid-template-columns: minmax(0, 1fr); } .toc { display: none; }
    .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); } .groups, .apps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .contact { grid-template-columns: minmax(0, 1fr); max-width: 760px; } }
  @media (max-width: 900px) {
    .top nav a { display: none; } .burger { display: inline-flex; } .body { grid-template-columns: minmax(0, 1fr); }
    .top { gap: .7rem; padding: 0 1rem; } .top nav .btn { margin-left: 0; padding: .5rem .6rem; } .top nav .btn span { display: none; }
    .side { position: fixed; z-index: 10; top: 60px; bottom: 0; left: 0; width: 280px; background: #0a0a0a; border-right: 1px solid var(--line);
      transform: translateX(-100%); transition: transform .2s; }
    .side.open { transform: none; box-shadow: 0 0 0 100vmax rgba(0,0,0,.55); }
    .main { padding: 0 .6rem .6rem; } .content { padding: 1.6rem 1.25rem 2rem; }
    .steps { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 640px) {
    .main { padding: 0 .5rem .5rem; } .content { padding: 1.4rem 1rem 2rem; } .lead { font-size: 1rem; }
    .features, .tiles, .groups, .fields, .apps { grid-template-columns: minmax(0, 1fr); } .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .person { flex-direction: column; align-items: flex-start; padding: 1.1rem; }
    .endpoint { display: grid; grid-template-columns: minmax(0, 1fr); gap: .45rem; padding: .8rem; }
    .endpoint code { white-space: normal; word-break: break-all; padding: 0; } .endpoint .btn { justify-content: center; }
    .code pre { padding: 2.7rem 1rem .9rem; }
    .table thead { display: none; } .table, .table tbody { display: block; }
    .table tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .35rem .75rem; padding: .7rem .85rem; border-top: 1px solid var(--line); }
    .table tr:first-child { border-top: 0; } .table td { padding: 0; border: 0; }
    .table td:nth-child(2) { grid-column: 1 / -1; grid-row: 2; }
    .contact-side, .contact-form { padding: 1rem; } }
  @media (max-width: 420px) {
    .ver, .group-meta { display: none; } .brand { font-size: 1rem; } .top { gap: .5rem; padding: 0 .75rem; } }
`;

const SCRIPT = `
(() => {
  const pages = [...document.querySelectorAll(".page")];
  const content = document.getElementById("content");
  const toc = document.getElementById("toc-links");
  const side = document.getElementById("side");
  let heads = [];
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
    document.title = page.dataset.title + " | ArcGIS Web MCP";
    content.scrollTop = 0;
    side.classList.remove("open");
  }
  toc.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-head]"); if (!a) return;
    e.preventDefault(); heads[+a.dataset.head].scrollIntoView({ behavior: "smooth", block: "start" });
  });
  content.addEventListener("scroll", () => {
    let on = 0;
    heads.forEach((h, i) => { if (h.getBoundingClientRect().top - content.getBoundingClientRect().top < 120) on = i; });
    toc.querySelectorAll("a").forEach((a, i) => a.classList.toggle("on", i === on));
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
          form.reset(); topics.forEach((x) => x.setAttribute("aria-pressed", "false")); count.textContent = "0 / " + max;
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
  addEventListener("keydown", (e) => { if (e.key === "Escape") side.classList.remove("open"); });
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
<style>${CSS}</style>
</head>
<body>
<div class="app">
  <header class="top">
    <button class="burger" id="burger" type="button" aria-label="Menu">${icon("menu", 22)}</button>
    <a class="brand" href="#overview"><span class="logo">${icon("globe", 24)}</span>ArcGIS <em>Web MCP</em></a>
    <span class="ver">v${VERSION}</span>
    <nav><a href="#overview" data-nav="overview">Documentation</a><a href="#tools" data-nav="tools">Tools</a>
      <a href="#connect" data-nav="connect">Connect</a><a href="#contact" data-nav="contact">Contact us</a>
      <button class="btn primary" type="button" data-copy="${url}" title="Copy server URL" aria-label="Copy server URL">${icon("copy", 15)}<span>Copy server URL</span></button></nav>
  </header>
  <div class="body">
    ${sidebar(byCategory, author)}
    <main class="main">
      <div class="panel">
        <div class="content" id="content">
          ${overview(url, TOOL_DOCS.length)}
          ${connect(url)}
          ${tools(byCategory)}
          ${apps()}
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
</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}

/** Headers for the documentation page: no framing, no external loads, only its own inline style and script, and
 * requests only to this origin (the contact form). */
export const HOME_HEADERS = {
	"Content-Type": "text/html; charset=utf-8",
	"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; "
		+ "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "no-referrer",
};
