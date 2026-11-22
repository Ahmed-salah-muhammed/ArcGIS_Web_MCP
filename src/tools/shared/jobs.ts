/**
 * Waiting and working in step: polling an ArcGIS job, and running a list of independent steps a few at a time.
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "./context";

/** Waits before the first status checks; after them, every LATER_DELAY_MS. A small job is done within the first second. */
export const POLL_DELAYS_MS = [500, 1000, 1500];
const LATER_DELAY_MS = 2000;
const MAX_WAIT_MS = 60_000;

export type JobRef = { item_id: string; job_id: string; job_type: "publish" | "export" };

/**
 * Polls a job until it completes, fails (thrown), a minute has passed, or only `reserve` requests are left: the
 * requests the answer itself still needs. "still processing" with a job to check later beats a call cut off midway.
 */
export async function pollJob(ctx: Ctx, opts: { what: string; reserve: number; check: () => Promise<{ status?: string;
	statusMessage?: string }>; failed: string }): Promise<string> {
	const wait = ctx.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	let status = "processing";
	let waited = 0;
	for (let i = 0; status !== "completed" && waited < MAX_WAIT_MS && (ctx.budget?.left() ?? Infinity) > opts.reserve; i++) {
		const delay = POLL_DELAYS_MS[i] ?? LATER_DELAY_MS;
		await wait(delay);
		waited += delay;
		const st = await opts.check();
		status = String(st.status ?? "processing");
		if (status === "failed") throw new ArcGISError(`${opts.what} failed: ${st.statusMessage ?? "no message"}`, opts.failed);
		ctx.progress?.(`${opts.what}: ${status}`, i + 1);
	}
	return status;
}

/** What a call that stopped waiting says about its job, so it can be checked later instead of started again. */
export function stillRunning(status: string, job: JobRef) {
	return { status: `still ${status} (check it with portal_item action=job_status, item_id + job_id + job_type)`, job };
}

/**
 * fn over every item, at most `limit` at a time, results in the order of the list. Cloudflare keeps 6 connections open
 * per call; staying under that leaves room for whatever each step runs in parallel itself.
 */
export async function mapLimit<T, R>(list: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(list.length);
	let next = 0;
	const worker = async () => {
		for (let i = next++; i < list.length; i = next++) out[i] = await fn(list[i], i);
	};
	await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), list.length) }, worker));
	return out;
}
