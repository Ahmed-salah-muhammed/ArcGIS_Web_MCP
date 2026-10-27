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

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type EditArgs = {
	action?: "edit" | "calculate" | "truncate" | "add_attachment" | "delete_attachments";
	object_id?: number;
	file_name?: string;
	content_base64?: string;
	content_text?: string;
	content_type?: string;
	attachment_ids?: number[];
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

/** Bytes of an attachment given as base64 (any file) or as text. */
export function attachmentBytes(args: Pick<EditArgs, "content_base64" | "content_text">): Uint8Array {
	if (args.content_base64) {
		let raw: string;
		try {
			raw = atob(args.content_base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, ""));
		} catch {
			throw new ArcGISError("content_base64 is not valid base64.", "bad_argument");
		}
		return Uint8Array.from(raw, (c) => c.charCodeAt(0));
	}
	if (args.content_text !== undefined) return new TextEncoder().encode(args.content_text);
	throw new ArcGISError("content_base64 (any file) or content_text is required.", "bad_argument");
}

async function attachmentEdit(ctx: Ctx, url: string, props: any, args: EditArgs) {
	if (!props.hasAttachments) {
		throw new ArcGISError("This layer has no attachments (portal_layer_schema action=enable_attachments can turn them on).",
			"no_attachments");
	}
	const oid = Number(args.object_id);
	if (!Number.isInteger(oid)) throw new ArcGISError("object_id is required.", "bad_argument");
	if (args.action === "add_attachment") {
		if (!args.file_name) throw new ArcGISError("file_name is required, e.g. photo.jpg.", "bad_argument");
		const bytes = attachmentBytes(args);
		if (bytes.length > MAX_ATTACHMENT_BYTES) {
			throw new ArcGISError(`The file is ${bytes.length} bytes; the limit here is ${MAX_ATTACHMENT_BYTES}.`, "too_large");
		}
		if (!ctx.upload) throw new ArcGISError("Uploads are not available in this context.", "unsupported");
		const res = await ctx.upload(`${url}/${oid}/addAttachment`, {}, { name: args.file_name, content: bytes,
			type: args.content_type ?? "application/octet-stream", field: "attachment" });
		const r = res.addAttachmentResult ?? {};
		audit(ctx.props, { tool: "portal_layer_edit", action: "add_attachment", target: url, ok: Boolean(r.success),
			details: { object_id: oid, attachment_id: r.objectId } });
		if (!r.success) throw new ArcGISError(`The attachment was not added: ${JSON.stringify(r.error ?? res).slice(0, 200)}`, "not_added");
		return { layer: props.name, object_id: oid, attachment_id: r.objectId, bytes: bytes.length,
			url: `${url}/${oid}/attachments/${r.objectId}` };
	}
	const ids = (args.attachment_ids ?? []).map(Number).filter(Number.isInteger);
	if (!ids.length) throw new ArcGISError("attachment_ids is required.", "bad_argument");
	requireConfirm(args.confirm, `Deleting ${ids.length} attachment(s) of feature ${oid} in '${props.name}'`,
		{ layer: props.name, object_id: oid, attachment_ids: ids });
	const res = await ctx.request(`${url}/${oid}/deleteAttachments`, { attachmentIds: ids.join(",") });
	const results: any[] = res.deleteAttachmentResults ?? [];
	const failed = results.filter((r) => !r.success).map((r) => r.objectId);
	audit(ctx.props, { tool: "portal_layer_edit", action: "delete_attachments", target: url, ok: !failed.length,
		details: { object_id: oid, attachment_ids: ids } });
	return { layer: props.name, object_id: oid, deleted: results.filter((r) => r.success).map((r) => r.objectId),
		failed: failed.length ? failed : null };
}

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

	if (action === "add_attachment" || action === "delete_attachments") return attachmentEdit(ctx, url, props, args);

	if (action !== "edit") {
		throw new ArcGISError("action must be edit | calculate | truncate | add_attachment | delete_attachments.", "bad_action");
	}
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
