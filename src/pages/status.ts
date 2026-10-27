/** The page at the end of the ArcGIS sign-in (/callback): connected, or what went wrong, with a documentation link and the credit. */
import { ARROW, CREDIT_CSS, creditHtml, esc, FAVICON } from "./credit";
import { type Author, VERSION } from "./identity";

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

export function messagePage(m: Message, author: Author | null): string {
	const refresh = m.redirect
		? `<meta http-equiv="refresh" content="${Math.max(0, Math.trunc(m.redirect.seconds))}; url=${esc(m.redirect.href)}">`
		: "";
	const lines = m.lines.map((line) => `<p>${esc(line)}</p>`).join("");
	const action = m.action
		? `<a class="button${m.action.brand === "claude" ? " claude" : ""}" href="${esc(m.action.href)}">${esc(m.action.label)}</a>`
		: "";
	// A new tab: in this tab, leaving within the 2 s would cancel the redirect and the client would never get its code.
	const docs = `<a class="button ghost" href="/" target="_blank" rel="noopener">Documentation ${ARROW}</a>`;
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
  .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: .6rem; margin-top: 1.25rem; }
  .button { display: inline-flex; align-items: center; gap: .4rem; padding: .65rem 1.4rem; border-radius: 8px;
    background: var(--brand); border: 1px solid transparent; color: #fff; font-weight: 600; text-decoration: none; }
  .button:hover { filter: brightness(1.08); }
  .button.ghost { background: transparent; border-color: var(--line); color: var(--text); }
  .button.ghost:hover { border-color: var(--brand); color: var(--brand); filter: none; }
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
    <div class="actions">${action}${docs}</div>
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
