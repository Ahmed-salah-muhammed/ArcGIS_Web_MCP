/**
 * portal_batch: several tool calls in one request, so a workflow (publish -> add a field -> map it) costs one round
 * trip through the model instead of one per step. Every call is validated and confirmed exactly as if it were called
 * on its own: a call that answers confirm_required stops the batch with its preview. `{{callN.path}}` and
 * `{{prev.path}}` reuse earlier results (paths start at the envelope: {{call0.data.items.0.id}}).
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { type Envelope, envelope, type ToolSpec } from "../shared/mcp";

/** The Workers free plan allows 50 subrequests per request; most tools make 1-5. */
export const MAX_CALLS = 10;

export type BatchCall = { tool: string; args?: Record<string, unknown> };
export type BatchArgs = { calls: BatchCall[]; stop_on_error?: boolean; parallel?: boolean };

const ONE = String.raw`\{\{\s*(prev|call(\d+))((?:\.[^\s.{}]+)*)\s*\}\}`;
const WHOLE = new RegExp(`^${ONE}$`);
const ANY = new RegExp(ONE, "g");

function valueAt(results: Envelope[], current: number, ref: string, index: string | undefined, path: string): unknown {
	const n = ref === "prev" ? current - 1 : Number(index);
	if (n < 0 || n >= current) {
		throw new ArcGISError(`{{${ref}${path}}} refers to a call that has not run before call ${current}.`, "bad_reference");
	}
	let cur: any = results[n];
	for (const seg of path.split(".").filter(Boolean)) {
		cur = Array.isArray(cur) && /^\d+$/.test(seg) ? cur[Number(seg)] : cur?.[seg];
		if (cur === undefined) throw new ArcGISError(`{{${ref}${path}}}: call ${n} has no '${seg}'.`, "bad_reference");
	}
	return cur;
}

/** Replace placeholders; a string that is exactly one placeholder keeps the referenced value's type. */
export function resolve(value: unknown, results: Envelope[], current: number): unknown {
	if (typeof value === "string") {
		const whole = value.match(WHOLE);
		if (whole) return valueAt(results, current, whole[1], whole[2], whole[3]);
		return value.replace(ANY, (_m, ref, index, path) => {
			const v = valueAt(results, current, ref, index, path);
			return typeof v === "string" ? v : JSON.stringify(v);
		});
	}
	if (Array.isArray(value)) return value.map((v) => resolve(v, results, current));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, results, current)]));
	}
	return value;
}

async function runOne(ctx: Ctx, spec: ToolSpec, args: Record<string, unknown>): Promise<Envelope> {
	const parsed = spec.schema.safeParse(args);
	if (!parsed.success) {
		const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(arguments)"}: ${i.message}`).join("; ");
		return { ok: false, error: `Invalid arguments for ${spec.name}: ${issues}`, code: "bad_argument" };
	}
	return envelope(ctx.props, () => spec.handle(ctx, parsed.data));
}

export async function batch(ctx: Ctx, args: BatchArgs, tools: Map<string, ToolSpec>) {
	const calls = args.calls ?? [];
	if (!calls.length) throw new ArcGISError("calls is required: [{\"tool\": \"portal_search\", \"args\": {...}}, ...].", "bad_argument");
	if (calls.length > MAX_CALLS) {
		throw new ArcGISError(`At most ${MAX_CALLS} calls per batch (Cloudflare limits the requests one call may make).`, "too_many");
	}
	const unknown = calls.filter((c) => !tools.has(c.tool)).map((c) => c.tool);
	if (unknown.length) {
		throw new ArcGISError(`Unknown tool(s): ${[...new Set(unknown)].join(", ")}. Batchable: ${[...tools.keys()].join(", ")}.`,
			"bad_argument");
	}
	const stop = args.stop_on_error ?? true;
	const results: Envelope[] = [];
	if (args.parallel) {
		if (ANY.test(JSON.stringify(calls))) {
			ANY.lastIndex = 0;
			throw new ArcGISError("{{callN}} placeholders need the calls to run in order: drop parallel.", "bad_argument");
		}
		results.push(...await Promise.all(calls.map((c) => runOne(ctx, tools.get(c.tool)!, c.args ?? {}))));
	} else {
		for (let i = 0; i < calls.length; i++) {
			let res: Envelope;
			try {
				res = await runOne(ctx, tools.get(calls[i].tool)!, resolve(calls[i].args ?? {}, results, i) as Record<string, unknown>);
			} catch (e) {
				res = await envelope(ctx.props, async () => { throw e; });
			}
			results.push(res);
			if (!res.ok && stop) break;
		}
	}
	const stoppedAt = !args.parallel && stop && results.length < calls.length ? results.length - 1 : null;
	return {
		calls: calls.length, completed: results.length, all_ok: results.length === calls.length && results.every((r) => r.ok),
		stopped_at: stoppedAt,
		results: results.map((r, i) => ({ index: i, tool: calls[i].tool, ...r })),
		skipped: stoppedAt === null ? null : calls.slice(stoppedAt + 1).map((c, k) => ({ index: stoppedAt + 1 + k, tool: c.tool })),
	};
}
