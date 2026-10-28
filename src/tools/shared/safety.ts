/**
 * The same rails as the ArcGIS Pro Salah MCP: irreversible, bulk, public or credit-spending writes refuse with
 * code "confirm_required" and a preview until the call is repeated with confirm=true; every write is audited.
 */
import { type ArcGISProps, ArcGISError } from "../../arcgis";

export class ConfirmRequired extends ArcGISError {
	constructor(action: string, readonly preview: unknown, readonly hint?: string) {
		super(`${action} needs confirm=true. Show the user the preview, ask, then call again with confirm=true.`,
			"confirm_required");
		this.name = "ConfirmRequired";
	}
}

export function requireConfirm(confirm: boolean | undefined, action: string, preview: unknown, hint?: string): void {
	if (!confirm) throw new ConfirmRequired(action, preview, hint);
}

/**
 * One JSON line per write in the Worker's logs (Workers Logs / `wrangler tail`): who, what, which target, result.
 * Never tokens. The deployment's owner can read these, which the README states.
 */
export function audit(props: ArcGISProps, record: { tool: string; action: string; target: unknown; ok: boolean;
	details?: unknown }): void {
	console.log(JSON.stringify({ audit: { time: new Date().toISOString(), user: props.username, portal: props.portal,
		...record } }));
}

export const MAX_EDITS = 5000; // feature edits per portal_layer_edit call
export const MAX_UPLOAD_CHARS = 5_000_000; // CSV / GeoJSON text accepted by portal_publish
export const MAX_DOWNLOAD_BYTES = MAX_UPLOAD_CHARS * 4; // a url download: UTF-8 takes at most 4 bytes a character
export const GEOCODE_CREDITS_EACH = 0.04; // ArcGIS Online: 40 credits per 1,000 geocoded rows
