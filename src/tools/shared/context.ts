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
};

/** A context for ONE tool call: its own request budget. */
export function makeCtx(props: ArcGISProps, extraHosts: string[] = [], maxSubrequests = DEFAULT_MAX_SUBREQUESTS): Ctx {
	const budget = new Budget(maxSubrequests);
	return {
		props,
		extraHosts,
		budget,
		request: async (url, params = {}) => (budget.take(), arcgisRequest(url, params, props.accessToken)),
		get: async (url, params = {}) => (budget.take(), arcgisGet(url, params, props.accessToken)),
		upload: async (url, params, file) => (budget.take(), arcgisUpload(url, params, file, props.accessToken)),
		publicGet: async (url, params = {}) => (budget.take(), arcgisGet(url, params, null)),
		publicUpload: async (url, params, file) => (budget.take(), arcgisUpload(url, params, file, null)),
		publicPost: async (url, params = {}) => (budget.take(), arcgisRequest(url, params, null)),
	};
}
