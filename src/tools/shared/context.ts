/**
 * What every tool handler receives: the signed-in user's props and the ways to call ArcGIS with their token.
 * Tests pass a fake context, so no network or ArcGIS SDK is needed.
 */
import { type ArcGISProps, ArcGISError, arcgisGet, arcgisRequest, arcgisUpload, type UploadFile } from "../../arcgis";

/** Cloudflare's limit on the requests one Worker call may make, on the free plan. */
export const DEFAULT_MAX_SUBREQUESTS = 50;

/**
 * Counts the requests one tool call makes, so a call that would pass Cloudflare's limit stops with a clear error
 * instead of being cut off midway. The last `reserve` requests are kept for cleanup (deleting a half-made item).
 */
export class Budget {
	used = 0;
	private cleaning = 0;

	constructor(readonly limit: number, readonly reserve = 3) {}

	/** Requests still available for normal work. */
	left(): number {
		return Math.max(0, this.limit - this.reserve - this.used);
	}

	take(): void {
		if (this.used >= this.limit - (this.cleaning ? 0 : this.reserve)) {
			throw new ArcGISError(`This call reached ${this.limit} requests to ArcGIS, the most one call may make here; `
				+ "what ran before this point was kept. Split the work: fewer calls per portal_batch, or a smaller job.",
				"subrequest_limit");
		}
		this.used++;
	}

	/** Runs cleanup with the reserve available. */
	async cleanup<T>(steps: () => Promise<T>): Promise<T> {
		this.cleaning++;
		try {
			return await steps();
		} finally {
			this.cleaning--;
		}
	}
}

/** Cleanup steps get the budget's reserve (tests' contexts have no budget). */
export function cleanup<T>(ctx: Ctx, steps: () => Promise<T>): Promise<T> {
	return ctx.budget ? ctx.budget.cleanup(steps) : steps();
}

export type Call = (url: string, params?: Record<string, unknown>) => Promise<any>;
export type Upload = (url: string, params: Record<string, unknown>, file: UploadFile) => Promise<any>;

export type Ctx = {
	props: ArcGISProps;
	request: Call; // POST, token in the body
	get?: Call; // GET, token in a header (portal_rest); falls back to request
	upload?: Upload; // multipart addItem (portal_publish)
	extraHosts?: string[];
	wait?: (ms: number) => Promise<void>; // job polling (tests pass a no-op)
	publicGet?: Call; // GET of public JSON WITHOUT the token (Esri's app templates and version files)
	publicUpload?: Upload; // multipart POST WITHOUT the token (Survey123's XLSForm converter)
	publicPost?: Call; // form POST WITHOUT the token (Survey123's XForm-to-webform converter)
	budget?: Budget; // every request above takes one
	progress?: (message: string, done?: number, total?: number) => void; // tells the client a long job is still going
};

/** How long a refused request waits before its one retry. */
export const RETRY_DELAY_MS = 1500;

/**
 * Reads that are asked for again and again inside one call (an item, a service, a layer, the org) are fetched once:
 * item -> service -> layer is resolved by every layer tool, and inside portal_batch each step would repeat it and pay
 * for it from the shared budget. Only requests without parameters to these URLs are remembered.
 */
const MEMO_URL = /\/content\/items\/[0-9a-f]{32}$|\/(?:FeatureServer|MapServer)(?:\/\d+)?$|\/portals\/self$/i;
/**
 * Operations that change nothing. Any OTHER request may be a write, so it empties the memo: what is read after a
 * write is always fresh (publish -> add a field -> map it must see the new field). Job status is left out on purpose:
 * a finished job changes its item.
 */
const READ_OPS = new Set(["query", "search", "queryrelatedrecords", "queryattachments", "groups", "dependencies",
	"listdependentsto", "isservicenameavailable", "data", "self", "attachments", "findaddresscandidates", "reversegeocode",
	"generaterenderer", "project", "buffer", "areasandlengths", "lengths", "distance"]);

function lastSegment(url: string): string {
	return url.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop()!.toLowerCase();
}

export type CtxOptions = { wait?: (ms: number) => Promise<void>; progress?: Ctx["progress"] };

/** A context for ONE tool call: its own request budget, and its own memo of repeated reads. */
export function makeCtx(props: ArcGISProps, extraHosts: string[] = [], maxSubrequests = DEFAULT_MAX_SUBREQUESTS,
	options: CtxOptions = {}): Ctx {
	const budget = new Budget(maxSubrequests);
	const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const memo = new Map<string, Promise<any>>();

	/**
	 * One request, retried once when ArcGIS refused it without doing it: 429 (rate limited) for anything, 503 only for
	 * a GET, which cannot have changed anything. The retry is a second request and takes from the budget like any other.
	 */
	const send = async <T>(isGet: boolean, call: () => Promise<T>): Promise<T> => {
		budget.take();
		try {
			return await call();
		} catch (e) {
			const refused = e instanceof ArcGISError && (e.code === "rate_limited" || (isGet && e.status === 503));
			if (!refused || budget.left() < 1) throw e;
			await wait(RETRY_DELAY_MS);
			budget.take();
			return call();
		}
	};

	const request: Call = async (url, params = {}) => {
		const plain = url.replace(/\/+$/, "");
		if (MEMO_URL.test(plain) && !Object.keys(params).length) {
			let hit = memo.get(plain);
			if (!hit) {
				hit = send(false, () => arcgisRequest(url, params, props.accessToken));
				memo.set(plain, hit);
				hit.catch(() => (memo.get(plain) === hit ? memo.delete(plain) : false)); // a failure is not remembered
			}
			return structuredClone(await hit); // each caller gets its own copy: handlers change what they read
		}
		if (!READ_OPS.has(lastSegment(plain))) memo.clear();
		return send(false, () => arcgisRequest(url, params, props.accessToken));
	};

	return {
		props,
		extraHosts,
		budget,
		wait: options.wait,
		progress: options.progress,
		request,
		get: (url, params = {}) => send(true, () => arcgisGet(url, params, props.accessToken)),
		upload: (url, params, file) => (memo.clear(), send(false, () => arcgisUpload(url, params, file, props.accessToken))),
		publicGet: (url, params = {}) => send(true, () => arcgisGet(url, params, null)),
		publicUpload: (url, params, file) => send(false, () => arcgisUpload(url, params, file, null)),
		publicPost: (url, params = {}) => send(false, () => arcgisRequest(url, params, null)),
	};
}
