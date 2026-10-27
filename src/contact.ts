/**
 * The documentation page's contact form: POST /contact (JSON) -> one email through Resend (https://resend.com).
 *
 * Nothing personal is in the code: the recipient and the API key are Worker secrets (CONTACT_TO, RESEND_API_KEY),
 * and without them the form answers that it is not set up. Same-origin requests only, a honeypot field, and limits
 * kept in KV (per visitor per hour, and per day for the whole site, under Resend's free 100 emails a day).
 */
import { esc } from "./pages/credit";
import { VERSION } from "./pages/identity";

export const TOPICS = ["Question about the MCP", "Bug report", "Feature request", "WebGIS & Full-Stack",
	"ArcGIS Enterprise", "Career / Full-Time"] as const;

export const CONTACT_LIMITS = { name: 100, email: 254, subject: 150, message: 2000, body: 16_000 };
const PER_VISITOR_PER_HOUR = 3;
const PER_DAY = 50;
const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "ArcGIS Web MCP <onboarding@resend.dev>";

export type ContactEnv = {
	OAUTH_KV: KVNamespace;
	RESEND_API_KEY?: string;
	CONTACT_TO?: string;
	CONTACT_FROM?: string;
};

export type ContactMessage = { name: string; email: string; subject: string; topic: string | null; message: string };

const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/;
/** One line, no control characters (they would end up in the email's subject). */
const oneLine = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/** The form, trimmed and checked; the first problem comes back in words, with the field it is about. */
export function validateContact(body: unknown): { ok: true; value: ContactMessage } | { ok: false; error: string; field: string } {
	const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
	const name = oneLine(b.name);
	const email = oneLine(b.email);
	const subject = oneLine(b.subject);
	const message = String(b.message ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
	const topic = b.topic == null || b.topic === "" ? null : oneLine(b.topic);
	const L = CONTACT_LIMITS;
	if (!name) return { ok: false, field: "name", error: "Please enter your name." };
	if (name.length > L.name) return { ok: false, field: "name", error: `Your name can be up to ${L.name} characters.` };
	if (email.length > L.email || !EMAIL.test(email)) return { ok: false, field: "email", error: "Please enter a valid email address." };
	if (subject.length > L.subject) return { ok: false, field: "subject", error: `The subject can be up to ${L.subject} characters.` };
	if (topic !== null && !(TOPICS as readonly string[]).includes(topic)) return { ok: false, field: "topic", error: "Unknown inquiry type." };
	if (!message) return { ok: false, field: "message", error: "Please write a message." };
	if (message.length > L.message) return { ok: false, field: "message", error: `The message can be up to ${L.message} characters.` };
	return { ok: true, value: { name, email, subject, topic, message } };
}

/** The email Resend sends: replying to it answers the visitor directly. */
export function contactEmail(m: ContactMessage, to: string, from: string, site: string) {
	const label = m.subject || `Message from ${m.name}`;
	const rows: [string, string][] = [["Name", m.name], ["Email", m.email], ["Inquiry type", m.topic ?? "—"], ["Subject", m.subject || "—"]];
	const text = `New message from the ArcGIS Web MCP contact form (${site})\n\n`
		+ rows.map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\n${m.message}\n`;
	const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2933;max-width:600px">
<p style="margin:0 0 12px;color:#5b6b7b">New message from the <a href="${esc(site)}">ArcGIS Web MCP</a> contact form</p>
<table style="border-collapse:collapse;margin:0 0 16px">${rows.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#5b6b7b">${k}</td>`
		+ `<td style="padding:2px 0"><strong>${esc(v)}</strong></td></tr>`).join("")}</table>
<div style="white-space:pre-wrap;border-left:3px solid #007ac2;padding:4px 0 4px 12px">${esc(m.message)}</div></div>`;
	return {
		from,
		to: [to],
		reply_to: m.email,
		subject: `[ArcGIS Web MCP] ${m.topic ? `${m.topic}: ` : ""}${label}`.slice(0, 200),
		text,
		html,
	};
}

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
	status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

async function visitorKey(request: Request): Promise<string> {
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`contact:${ip}`)));
	return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join(""); // the IP itself is never stored
}

/** Counts one more send in KV; false when the limit is already reached. */
async function take(kv: KVNamespace, key: string, limit: number, ttl: number): Promise<boolean> {
	const used = Number(await kv.get(key)) || 0;
	if (used >= limit) return false;
	await kv.put(key, String(used + 1), { expirationTtl: ttl });
	return true;
}

export async function handleContact(request: Request, env: ContactEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
	const site = new URL(request.url).origin;
	if (request.headers.get("Origin") !== site) return json(403, { ok: false, error: "Send the form from this site." });
	if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) {
		return json(415, { ok: false, error: "Expected JSON." });
	}
	if (!env.RESEND_API_KEY || !env.CONTACT_TO) {
		return json(503, { ok: false, error: "The contact form is not set up on this server yet." });
	}
	const raw = await request.text();
	if (raw.length > CONTACT_LIMITS.body) return json(413, { ok: false, error: "The message is too long." });
	let body: Record<string, unknown>;
	try {
		body = JSON.parse(raw);
	} catch {
		return json(400, { ok: false, error: "Expected JSON." });
	}
	// The honeypot is a hidden field people never see: a bot that fills it gets a success and sends nothing.
	if (oneLine(body?.website)) return json(200, { ok: true });
	const checked = validateContact(body);
	if (!checked.ok) return json(400, { ok: false, error: checked.error, field: checked.field });

	const day = new Date().toISOString().slice(0, 10);
	if (!(await take(env.OAUTH_KV, `contact:v:${await visitorKey(request)}`, PER_VISITOR_PER_HOUR, 3600))) {
		return json(429, { ok: false, error: "You have sent several messages already; please try again in an hour." });
	}
	if (!(await take(env.OAUTH_KV, `contact:day:${day}`, PER_DAY, 2 * 86400))) {
		return json(429, { ok: false, error: "The contact form has reached today's limit; please try again tomorrow." });
	}

	const email = contactEmail(checked.value, env.CONTACT_TO, env.CONTACT_FROM || DEFAULT_FROM, site);
	try {
		const res = await fetchImpl(RESEND_URL, {
			method: "POST",
			headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json",
				"User-Agent": `arcgis-web-mcp/${VERSION}` }, // Resend rejects requests without a User-Agent (403)
			body: JSON.stringify(email),
		});
		if (!res.ok) {
			const detail = await res.json().catch(() => ({})) as { name?: string; message?: string };
			console.error("contact: Resend answered", res.status, detail.name ?? "", detail.message ?? "");
			return json(502, { ok: false, error: "The message could not be sent. Please try again later." });
		}
	} catch (e) {
		console.error("contact: Resend unreachable", e instanceof Error ? e.message : String(e));
		return json(502, { ok: false, error: "The message could not be sent. Please try again later." });
	}
	return json(200, { ok: true });
}
