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
	publicGet?: Call; // GET of public JSON WITHOUT the token (Esri's app templates and version files)
	publicUpload?: Upload; // multipart POST WITHOUT the token (Survey123's XLSForm converter)
	publicPost?: Call; // form POST WITHOUT the token (Survey123's XForm-to-webform converter)
};

export function makeCtx(props: ArcGISProps, extraHosts: string[] = []): Ctx {
	return {
		props,
		extraHosts,
		request: (url, params = {}) => arcgisRequest(url, params, props.accessToken),
		get: (url, params = {}) => arcgisGet(url, params, props.accessToken),
		upload: (url, params, file) => arcgisUpload(url, params, file, props.accessToken),
		publicGet: (url, params = {}) => arcgisGet(url, params, null),
		publicUpload: (url, params, file) => arcgisUpload(url, params, file, null),
		publicPost: (url, params = {}) => arcgisRequest(url, params, null),
	};
}
