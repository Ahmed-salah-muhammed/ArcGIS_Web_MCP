/**
 * portal_layer_edit: change layer data: edit (applyEdits, batched, every result checked, dry_run diff) |
 * calculate | truncate. Deletes, calculate and truncate need confirm.
 */
import { adminUrl, ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { isHosted, resolveLayerUrl } from "../shared/lookup";
import { audit, MAX_EDITS, requireConfirm } from "../shared/safety";

const MAX_BATCHES = 30; // the Workers free plan allows 50 subrequests per call

type Feature = { attributes?: Record<string, unknown>; geometry?: unknown };

function asFeatures(rows: unknown[] | undefined): Feature[] {
	return (rows ?? []).map((r: any) => (r && typeof r === "object" && ("attributes" in r || "geometry" in r) ? r : { attributes: r }));
}

function chunks<T>(list: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

export type EditArgs = {
	action?: "edit" | "calculate" | "truncate";
	target: string;
	layer?: number | string;
	adds?: unknown[];
	updates?: unknown[];
	deletes?: (number | string)[];
	where?: string;
	expressions?: Record<string, unknown>[] | Record<string, unknown>;
	use_global_ids?: boolean;
	rollback_on_failure?: boolean;
	batch_size?: number;
	dry_run?: boolean;
	confirm?: boolean;
};

export async function edit(ctx: Ctx, args: EditArgs) {
	const action = args.action ?? "edit";
	const url = await resolveLayerUrl(ctx, args.target, args.layer ?? 0);
	const props = await ctx.request(url);
	const name = props.name;

	if (action === "calculate") {
		const exprs = Array.isArray(args.expressions) ? args.expressions : args.expressions ? [args.expressions] : [];
		if (!args.where || !exprs.length) {
			throw new ArcGISError('where and expressions are required, e.g. expressions=[{"field":"STATUS","value":"Done"}] '
				+ 'or [{"field":"DENSITY","sqlExpression":"POP / AREA"}].', "bad_argument");
		}
		const affected = (await ctx.request(`${url}/query`, { where: args.where, returnCountOnly: true })).count ?? 0;
		const preview = { layer: name, where: args.where, rows_affected: affected, expressions: exprs };
		if (args.dry_run) return { dry_run: true, preview };
		requireConfirm(args.confirm, `Calculating ${exprs.length} field(s) on ${affected} row(s) of '${name}'`, preview);
		const res = await ctx.request(`${url}/calculate`, { where: args.where, calcExpression: exprs });
		audit(ctx.props, { tool: "portal_layer_edit", action, target: url, ok: Boolean(res.success), details: preview });
		return { layer: name, result: res, rows_affected: res.updatedFeatureCount ?? affected };
	}

	if (action === "truncate") {
		if (!isHosted(url)) throw new ArcGISError("truncate works only on HOSTED feature services.", "not_hosted");
		const before = (await ctx.request(`${url}/query`, { where: "1=1", returnCountOnly: true })).count ?? 0;
		requireConfirm(args.confirm, `TRUNCATE '${name}' (deletes all ${before} rows)`, { layer: name, rows: before },
			"Irreversible. Export the data first.");
		const res = await ctx.request(`${adminUrl(url)}/truncate`, { attachmentOnly: false, async: false });
		const after = (await ctx.request(`${url}/query`, { where: "1=1", returnCountOnly: true })).count ?? null;
		audit(ctx.props, { tool: "portal_layer_edit", action, target: url, ok: after === 0, details: { before, after } });
		return { layer: name, rows_before: before, rows_after: after, result: res };
	}

	if (action !== "edit") throw new ArcGISError("action must be edit | calculate | truncate.", "bad_action");
	const adds = asFeatures(args.adds);
	const updates = asFeatures(args.updates);
	const oid: string = props.objectIdField ?? "OBJECTID";
	const key = args.use_global_ids ? props.globalIdField : oid;
	if (args.use_global_ids && !key) throw new ArcGISError("This layer has no global id field.", "bad_argument");
	const missing = updates.map((f, i) => (f.attributes && key in f.attributes ? -1 : i)).filter((i) => i >= 0);
	if (missing.length) {
		throw new ArcGISError(`Every update needs its '${key}' attribute (rows ${missing.slice(0, 10).join(", ")} lack it).`,
			"bad_argument");
	}
	let deleteIds = (args.deletes ?? []).map(String);
	if (args.where && !deleteIds.length) {
		const res = await ctx.request(`${url}/query`, { where: args.where, returnIdsOnly: true });
		deleteIds = (res.objectIds ?? []).map(String);
	}
	const total = adds.length + updates.length + deleteIds.length;
	if (!total) {
		throw new ArcGISError("Nothing to edit: give adds, updates, deletes (ids) or where (deletes what matches).",
			"nothing_to_do");
	}
	if (total > MAX_EDITS) {
		throw new ArcGISError(`${total} edits exceed the ${MAX_EDITS}-edit limit per call; split the job.`, "too_many");
	}
	const size = Math.max(1, Math.min(Math.trunc(args.batch_size ?? 500), 2000));
	const batches = [...chunks(adds, size).map((c) => ["adds", c] as const),
		...chunks(updates, size).map((c) => ["updates", c] as const),
		...chunks(deleteIds, size).map((c) => ["deletes", c] as const)];
	if (batches.length > MAX_BATCHES) {
		throw new ArcGISError(`${batches.length} batches exceed ${MAX_BATCHES} per call; raise batch_size or split the job.`,
			"too_many");
	}
	const preview: Record<string, unknown> = { layer: name, adds: adds.length, updates: updates.length,
		deletes: deleteIds.length };
	if (updates.length && !args.use_global_ids) {
		const ids = updates.slice(0, 20).map((f) => f.attributes![key]);
		const cur = await ctx.request(`${url}/query`, { objectIds: ids.join(","), outFields: "*", returnGeometry: false });
		const byId = new Map((cur.features ?? []).map((f: any) => [String(f.attributes?.[oid]), f.attributes]));
		preview.update_diff = updates.slice(0, 20).map((f) => {
			const current = (byId.get(String(f.attributes![key])) ?? {}) as Record<string, unknown>;
			return { id: f.attributes![key], changes: Object.fromEntries(Object.entries(f.attributes!)
				.filter(([k]) => k !== key).map(([k, v]) => [k, { from: current[k] ?? null, to: v }])) };
		});
	}
	if (args.dry_run) return { dry_run: true, preview };
	if (deleteIds.length) requireConfirm(args.confirm, `Deleting ${deleteIds.length} feature(s) from '${name}'`, preview);

	const summary: Record<string, { succeeded: number; failed: number }> = {};
	const failures: unknown[] = [];
	for (const [kind, chunk] of batches) {
		const params: Record<string, unknown> = { useGlobalIds: Boolean(args.use_global_ids),
			rollbackOnFailure: args.rollback_on_failure ?? true };
		params[kind] = kind === "deletes" ? (chunk as string[]).join(",") : chunk;
		const res = await ctx.request(`${url}/applyEdits`, params);
		const results: any[] = res[`${kind.slice(0, -1)}Results`] ?? [];
		const s = (summary[kind] ??= { succeeded: 0, failed: 0 });
		for (const r of results) {
			if (r.success) s.succeeded++;
			else {
				s.failed++;
				if (failures.length < 20) failures.push({ kind, id: r.objectId ?? null, error: r.error ?? null });
			}
		}
	}
	const allOk = Object.values(summary).every((s) => s.failed === 0);
	audit(ctx.props, { tool: "portal_layer_edit", action, target: url, ok: allOk, details: summary });
	return { layer: name, result: summary, all_ok: allOk, failures: failures.length ? failures : null };
}
