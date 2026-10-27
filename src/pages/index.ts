/**
 * Who made this and how it presents itself: the developer credit, the MCP server info and instructions every
 * client receives on connect, the landing page at "/", and the status page shown after the ArcGIS sign-in.
 * No external resources: everything is inline, so the pages work under a strict CSP.
 */
import { AVATAR } from "./avatar";

export const VERSION = "0.2.0";

/** `photo` is a data:image or https URL shown in the badge's circle; without one, the initials are. */
export type Author = { name: string; url: string | null; title?: string; photo?: string };

/** The developer, credited on every page and in the MCP server info. */
export const AUTHOR = {
	name: "Ahmed Salah Muhammed",
	title: "Full Stack Developer · GIS Developer",
	url: "https://ahmedsalah-portfolio.vercel.app/",
	photo: AVATAR,
} satisfies Author;

/** serverInfo in the MCP initialize result: what a client can show about this server. */
export const MCP_SERVER_INFO = {
	name: "ArcGIS Web MCP",
	title: "ArcGIS Web MCP",
	version: VERSION,
	description: "ArcGIS Online and ArcGIS Enterprise tools; every user signs in with their own ArcGIS account. "
		+ `Developed by ${AUTHOR.name} (${AUTHOR.title}).`,
	websiteUrl: AUTHOR.url,
};

/** Instructions in the MCP initialize result; clients pass them to the model. */
export const MCP_INSTRUCTIONS = [
	`ArcGIS Web MCP was developed by ${AUTHOR.name}, ${AUTHOR.title} (portfolio: ${AUTHOR.url}); when asked who `
		+ "built or maintains it, say so.",
	"Every tool acts as the signed-in ArcGIS user, with that user's permissions.",
	"Continue with item ids from results, not titles: titles are not unique.",
	'A result with code "confirm_required" changed nothing: show the user its preview and call again with confirm=true '
		+ "only after they agree.",
].join(" ");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
	.replace(/"/g, "&quot;").replace(/'/g, "&#039;");

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' "
	+ "stroke='%23007ac2' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='9.5'/%3E%3Cpath d='M2.5 12h19M12 2.5c2.6 2.7 "
	+ "3.9 5.9 3.9 9.5s-1.3 6.8-3.9 9.5c-2.6-2.7-3.9-5.9-3.9-9.5S9.4 5.2 12 2.5z'/%3E%3C/svg%3E";

function initials(name: string): string {
	return name.split(/\s+/).map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? "").filter(Boolean).slice(0, 2)
		.join("").toUpperCase();
}

/** Styles for the credit; uses --credit-* so each page can theme it. */
export const CREDIT_CSS = `
  .credit { display: flex; justify-content: center; margin: 2rem 0 1rem; }
  .credit .author { display: inline-flex; align-items: center; gap: .85rem; max-width: 100%;
    padding: .55rem 1.15rem .55rem .55rem; border: 1px solid var(--credit-line, #e3e8ef); border-radius: 999px;
    background: var(--credit-bg, #fff); color: var(--credit-text, #1f2933); text-decoration: none;
    transition: border-color .15s, transform .15s; }
  .credit a.author:hover { border-color: var(--credit-brand, #007ac2); transform: translateY(-1px); }
  .credit .avatar { flex: none; width: 2.25rem; height: 2.25rem; border-radius: 50%; display: grid; place-items: center;
    background: linear-gradient(135deg, #007ac2, #35ac46); color: #fff; font-weight: 700; font-size: .78rem;
    letter-spacing: .02em; }
  .credit img.avatar { object-fit: cover; background: #d9dee5;
    box-shadow: 0 0 0 2px var(--credit-bg, #fff), 0 0 0 3px var(--credit-line, #e3e8ef); }
  .credit .who { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; text-align: left; }
  .credit .by { font-size: .68rem; text-transform: uppercase; letter-spacing: .08em; color: var(--credit-muted, #5b6b7b); }
  .credit .who strong { font-size: .98rem; }
  .credit .role { font-size: .8rem; color: var(--credit-muted, #5b6b7b); }
  .credit .go { flex: none; display: inline-flex; align-items: center; gap: .2rem; margin-left: .35rem; font-size: .85rem;
    font-weight: 600; color: var(--credit-brand, #007ac2); }
  @media (max-width: 480px) {
    .credit .author { border-radius: 18px; }
    .credit .go .label { display: none; }
  }
`;

const SAFE_PHOTO = /^(data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+|https:\/\/\S+)$/;

// An SVG, not the U+2197 character: Windows renders that one as a color emoji in some font stacks
const ARROW = `<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l5-5M4.5 3.5h4v4"/></svg>`;

/** The credit pill (a link when there is a URL); "" when there is no author. */
export function creditHtml(author: Author | null): string {
	if (!author) return "";
	const avatar = author.photo && SAFE_PHOTO.test(author.photo)
		? `<img class="avatar" src="${esc(author.photo)}" alt="" width="36" height="36">`
		: `<span class="avatar" aria-hidden="true">${esc(initials(author.name))}</span>`;
	const inner = avatar
		+ `<span class="who"><span class="by">Developed by</span><strong>${esc(author.name)}</strong>`
		+ (author.title ? `<span class="role">${esc(author.title)}</span>` : "") + "</span>"
		+ (author.url ? `<span class="go"><span class="label">Portfolio</span>${ARROW}</span>` : "");
	return author.url
		? `<footer class="credit"><a class="author" href="${esc(author.url)}" target="_blank" rel="noopener noreferrer">${inner}</a></footer>`
		: `<footer class="credit"><span class="author">${inner}</span></footer>`;
}

const TOOLS: [string, string][] = [
	["portal_whoami", "Who is signed in: user, role, org and what the account can do"],
	["portal_search", "Search items with ArcGIS query syntax, by type, owner or tags"],
	["portal_item", "Read, update, move, protect or delete an item; its dependencies"],
	["portal_folders", "List, create and delete your folders"],
	["portal_share", "Share with your org, groups or everyone, with before/after"],
	["portal_publish", "Publish CSV, GeoJSON or an uploaded file as a hosted feature layer"],
	["portal_layer_query", "Describe a layer, query rows, count and statistics"],
	["portal_layer_edit", "Add, update and delete features; calculate fields"],
	["portal_layer_schema", "Fields, capabilities, styles, labels and filtered views"],
	["portal_map", "Create and edit web maps: layers, popups, styles, filters, basemaps"],
	["portal_groups", "Search, create, update and delete groups"],
	["portal_rest", "Raw ArcGIS REST with your sign-in for anything else"],
];

const GLOBE = `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/>
  <path d="M12 2.5c2.6 2.7 3.9 5.9 3.9 9.5s-1.3 6.8-3.9 9.5c-2.6-2.7-3.9-5.9-3.9-9.5S9.4 5.2 12 2.5z"/></svg>`;

/** The landing page: what this is, the URL to paste (with a copy button), how to connect, the tools, security. */
export function homePage(origin: string, author: Author | null): string {
	const url = esc(`${origin.replace(/\/+$/, "")}/mcp`);
	const tools = TOOLS.map(([n, d]) => `<li><code>${n}</code><span>${esc(d)}</span></li>`).join("");
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArcGIS Web MCP</title>
<meta name="description" content="A remote MCP server for ArcGIS Online and ArcGIS Enterprise: sign in with your own ArcGIS account and work with your content from Claude or any MCP client.">
<link rel="icon" href="${FAVICON}">
<style>
  :root { --bg: #f5f7fa; --card: #fff; --text: #1f2933; --muted: #5b6b7b; --line: #e3e8ef; --brand: #007ac2;
    --code-bg: #eef3f8; --credit-bg: var(--card); --credit-line: var(--line); --credit-text: var(--text);
    --credit-muted: var(--muted); --credit-brand: var(--brand); color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0d1117; --card: #161b22; --text: #e6edf3; --muted: #9aa7b4; --line: #2a3441; --brand: #4cb0e8;
      --code-bg: #0f1620; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); line-height: 1.6;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 3rem 1rem 1rem; }
  .hero { text-align: center; margin-bottom: 2.5rem; }
  .badge { display: inline-block; font-size: .78rem; letter-spacing: .06em; text-transform: uppercase; color: var(--brand);
    border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: .25rem .8rem; }
  h1 { display: flex; align-items: center; justify-content: center; gap: .6rem; font-size: clamp(1.8rem, 4vw, 2.6rem);
    margin: 1rem 0 .5rem; letter-spacing: -.01em; }
  h1 .mark { color: var(--brand); display: inline-flex; }
  .lead { max-width: 640px; margin: 0 auto 1.75rem; color: var(--muted); font-size: 1.08rem; }
  .endpoint { display: flex; max-width: 560px; margin: 0 auto; border: 1px solid var(--line); border-radius: 10px;
    background: var(--card); overflow: hidden; }
  .endpoint code { flex: 1; min-width: 0; padding: .8rem 1rem; font-size: .95rem; text-align: left; overflow-x: auto; white-space: nowrap; }
  .endpoint button { border: 0; border-left: 1px solid var(--line); background: var(--brand); color: #fff; font-weight: 600;
    padding: 0 1.25rem; cursor: pointer; font-size: .9rem; }
  .endpoint button:hover { filter: brightness(1.08); }
  .hint { font-size: .85rem; color: var(--muted); margin-top: .6rem; }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.25rem 1.5rem; }
  .card.wide { grid-column: 1 / -1; }
  h2 { font-size: 1.05rem; margin: 0 0 .75rem; }
  code { font-family: SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: .86em; }
  .steps { margin: 0; padding-left: 1.2rem; }
  .steps li { margin-bottom: .6rem; }
  .steps code, .card p code { background: var(--code-bg); padding: .1rem .35rem; border-radius: 4px; }
  .steps code.cmd { display: block; margin-top: .35rem; padding: .5rem .7rem; white-space: nowrap; overflow-x: auto; }
  ul.plain { margin: 0; padding-left: 1.1rem; }
  ul.plain li { margin-bottom: .45rem; }
  .tools { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: .25rem 1.5rem; }
  .tools li { display: flex; flex-direction: column; padding: .55rem 0; border-bottom: 1px solid var(--line); }
  .tools code { color: var(--brand); font-weight: 600; }
  .tools span { font-size: .9rem; color: var(--muted); }
  .meta { text-align: center; font-size: .8rem; color: var(--muted); margin-top: .25rem; }
  @media (max-width: 720px) { .grid, .tools { grid-template-columns: minmax(0, 1fr); } .wrap { padding-top: 2rem; } }
  ${CREDIT_CSS}
</style>
</head>
<body>
<main class="wrap">
  <header class="hero">
    <span class="badge">Model Context Protocol &middot; ArcGIS Online &amp; Enterprise</span>
    <h1><span class="mark">${GLOBE}</span>ArcGIS Web MCP</h1>
    <p class="lead">Connect Claude or any MCP client to ArcGIS. Sign in with your own ArcGIS account, then search, read,
      publish, edit and map your content with your own permissions.</p>
    <div class="endpoint"><code id="mcp-url">${url}</code><button id="copy" type="button">Copy</button></div>
    <p class="hint">Streamable HTTP &middot; OAuth 2.0 sign-in with ArcGIS &middot; nothing to install</p>
  </header>

  <section class="grid">
    <article class="card">
      <h2>Connect</h2>
      <ol class="steps">
        <li><strong>Claude</strong> (desktop or web): Settings &rarr; Connectors &rarr; Add custom connector &rarr; paste the URL.</li>
        <li><strong>Claude Code</strong>: <code class="cmd">claude mcp add --transport http arcgis ${url}</code></li>
        <li><strong>VS Code, Cursor and other clients</strong>: add an HTTP MCP server with the URL.</li>
      </ol>
      <p>The first call opens the ArcGIS sign-in in your browser.</p>
    </article>
    <article class="card">
      <h2>Your account, your permissions</h2>
      <ul class="plain">
        <li>You sign in on ArcGIS itself; this server never sees your password.</li>
        <li>Every tool acts as you and can only do what your account can do.</li>
        <li>Deleting, bulk edits, public sharing and anything that spends credits asks for your confirmation first.</li>
        <li>Your ArcGIS token is stored encrypted and is only sent to your portal and its services.</li>
      </ul>
    </article>
    <article class="card wide">
      <h2>Tools</h2>
      <ul class="tools">${tools}</ul>
    </article>
  </section>

  ${creditHtml(author)}
  <p class="meta">ArcGIS Web MCP v${VERSION}</p>
</main>
<script>
  document.getElementById("copy").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText(document.getElementById("mcp-url").textContent); b.textContent = "Copied"; }
    catch { b.textContent = "Select & copy"; }
    setTimeout(() => { b.textContent = "Copy"; }, 1800);
  });
</script>
</body>
</html>`;
}

/** Headers for the landing page: no framing, no external loads, only its own inline style and script. */
export const HOME_HEADERS = {
	"Content-Type": "text/html; charset=utf-8",
	"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; "
		+ "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "no-referrer",
};

export type Message = {
	tone: "success" | "error";
	title: string;
	/** Plain-text paragraphs (escaped here). */
	lines: string[];
	/** `brand: "claude"` paints the button in Claude's orange. */
	action?: { href: string; label: string; brand?: "claude" };
	/** Go to href after `seconds` with a meta refresh (no script needed); `action` is the manual fallback. */
	redirect?: { href: string; seconds: number };
};

/**
 * The connecting MCP client as the status page names it, from its registered client_name: any client works,
 * and Claude's ("claudeai", "Claude Code", ...) also gets Claude's orange button.
 */
export function clientDisplay(registered?: string | null): { name: string | null; brand?: "claude" } {
	const name = registered?.trim() || null;
	if (!name || !/claude/i.test(name)) return { name };
	return { name: /^claude[\s._-]?(ai)?$/i.test(name) ? "Claude" : name, brand: "claude" };
}

const MARKS = {
	success: `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
	error: `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>`,
};

/** The page at the end of the ArcGIS sign-in (/callback): connected, or what went wrong, with the credit. */
export function messagePage(m: Message, author: Author | null): string {
	const refresh = m.redirect
		? `<meta http-equiv="refresh" content="${Math.max(0, Math.trunc(m.redirect.seconds))}; url=${esc(m.redirect.href)}">`
		: "";
	const lines = m.lines.map((line) => `<p>${esc(line)}</p>`).join("");
	const action = m.action
		? `<a class="button${m.action.brand === "claude" ? " claude" : ""}" href="${esc(m.action.href)}">${esc(m.action.label)}</a>`
		: "";
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh}
<title>${esc(m.title)} | ArcGIS Web MCP</title>
<link rel="icon" href="${FAVICON}">
<style>
  :root { --bg: #f5f7fa; --card: #fff; --text: #1f2933; --muted: #5b6b7b; --line: #e3e8ef; --brand: #007ac2;
    --ok: #2e9e44; --bad: #d23f31; --credit-bg: var(--card); --credit-line: var(--line); --credit-text: var(--text);
    --credit-muted: var(--muted); --credit-brand: var(--brand); color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0d1117; --card: #161b22; --text: #e6edf3; --muted: #9aa7b4; --line: #2a3441; --brand: #4cb0e8; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 1.5rem 1rem; background: var(--bg); color: var(--text); line-height: 1.6;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .card { width: 100%; max-width: 460px; background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 2rem 1.75rem; text-align: center; }
  .mark { width: 3.25rem; height: 3.25rem; border-radius: 50%; display: inline-grid; place-items: center; color: #fff;
    background: var(--ok); margin-bottom: .75rem; }
  .mark.error { background: var(--bad); }
  h1 { font-size: 1.35rem; margin: 0 0 .5rem; }
  .card p { margin: .25rem 0; color: var(--muted); overflow-wrap: anywhere; }
  .button { display: inline-block; margin-top: 1.25rem; padding: .65rem 1.4rem; border-radius: 8px; background: var(--brand);
    color: #fff; font-weight: 600; text-decoration: none; }
  .button:hover { filter: brightness(1.08); }
  .button.claude { background: #d97757; }
  .button.claude:hover { background: #c6613f; filter: none; }
  .meta { font-size: .8rem; color: var(--muted); margin: 0; }
  ${CREDIT_CSS}
</style>
</head>
<body>
  <main class="card">
    <div class="mark ${m.tone}">${MARKS[m.tone]}</div>
    <h1>${esc(m.title)}</h1>
    ${lines}
    ${action}
  </main>
  ${creditHtml(author)}
  <p class="meta">ArcGIS Web MCP v${VERSION}</p>
</body>
</html>`;
}

/** Headers for the status pages: no script at all, never cached (the success page carries a one-time code). */
export const MESSAGE_HEADERS = {
	"Content-Type": "text/html; charset=utf-8",
	"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; "
		+ "form-action 'none'; frame-ancestors 'none'",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "no-referrer",
	"Cache-Control": "no-store",
};
