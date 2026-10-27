/**
 * What every tool handler receives: the signed-in user's props and the ways to call ArcGIS with their token.
 * Tests pass a fake context, so no network or ArcGIS SDK is needed.
 */
import { type ArcGISProps, arcgisGet, arcgisRequest, arcgisUpload, type UploadFile } from "../../arcgis";

export type Call = (url: string, params?: Record<string, unknown>) => Promise<any>;
export type Upload = (url: string, params: Record<string, unknown>, file: UploadFile) => Promise<any>;

export type Ctx = {
	props: ArcGISProps;
	request: Call; // POST, token in the body
	get?: Call; // GET, token in a header (portal_rest); falls back to request
	upload?: Upload; // multipart addItem (portal_publish)
	extraHosts?: string[];
	wait?: (ms: number) => Promise<void>; // job polling (tests pass a no-op)
};

export function makeCtx(props: ArcGISProps, extraHosts: string[] = []): Ctx {
	return {
		props,
		extraHosts,
		request: (url, params = {}) => arcgisRequest(url, params, props.accessToken),
		get: (url, params = {}) => arcgisGet(url, params, props.accessToken),
		upload: (url, params, file) => arcgisUpload(url, params, file, props.accessToken),
	};
}
