/**
 * portal_publish: a hosted feature layer from CSV text, GeoJSON text, a public https URL, or an uploaded item.
 * Verified on ArcGIS Online: a CSV added as `text` cannot be analyzed or published, so it is uploaded as a
 * multipart file; publishing returns a job that is polled until it completes.
 */
import { ArcGISError, hostAllowed } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { base, getItem, resolveFolder, userPath } from "../shared/lookup";
import { audit, GEOCODE_CREDITS_EACH, MAX_UPLOAD_CHARS, requireConfirm } from "../shared/safety";

export type PublishArgs = {
	title: string;
	csv_text?: string;
	geojson_text?: string;
	url?: string;
	item_id?: string;
	folder?: string;
	tags?: string[];
	snippet?: string;
	latitude_field?: string;
	longitude_field?: string;
	address_fields?: Record<string, string>;
	confirm?: boolean;
};

export function serviceName(title: string): string {
	return title.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 80) || "layer";
}

const FILE_TYPES: Record<string, { itemType: string; fileType: string; ext: string; mime: string }> = {
	csv: { itemType: "CSV", fileType: "csv", ext: "csv", mime: "text/csv" },
	geojson: { itemType: "GeoJson", fileType: "geojson", ext: "geojson", mime: "application/geo+json" },
};
const ITEM_FILE_TYPES: Record<string, string> = {
	CSV: "csv", GeoJson: "geojson", Shapefile: "shapefile", "File Geodatabase": "fileGeodatabase",
	"Microsoft Excel": "excel", GeoPackage: "geopackage",
};

async function availableName(ctx: Ctx, wanted: string): Promise<string> {
	const orgId = ctx.props.orgId;
	if (!orgId) return `${wanted}_${Date.now()}`;
	for (let i = 1; i <= 5; i++) {
		const name = i === 1 ? wanted : `${wanted}_${i}`;
		try {
			const res = await ctx.request(`${base(ctx)}/portals/${orgId}/isServiceNameAvailable`,
				{ name, type: "Feature Service" });
			if (res.available) return name;
		} catch {
			return `${wanted}_${Date.now()}`;
		}
	}
	return `${wanted}_${Date.now()}`;
}

export async function publish(ctx: Ctx, args: PublishArgs) {
	const title = args.title?.trim();
	if (!title) throw new ArcGISError("title is required.", "bad_argument");
	const sources = ["csv_text", "geojson_text", "url", "item_id"].filter((k) => (args as any)[k]);
	if (sources.length !== 1) {
		throw new ArcGISError("Give exactly one source: csv_text, geojson_text, url (a public CSV/GeoJSON) or item_id "
			+ "(an uploaded CSV / GeoJSON / Shapefile / File Geodatabase item).", "bad_argument");
	}
	let kind: string | null = args.csv_text ? "csv" : args.geojson_text ? "geojson" : null;
	let content = args.csv_text ?? args.geojson_text ?? null;
	if (args.url) {
		const u = new URL(args.url);
		if (u.protocol !== "https:") throw new ArcGISError("url must be https.", "bad_argument");
		const res = await fetch(u.href); // public fetch (global_fetch_strictly_public); no token is sent
		if (!res.ok) throw new ArcGISError(`Could not download ${u.hostname}: HTTP ${res.status}`, "download_failed");
		content = await res.text();
		kind = /\.(geo)?json(\?|$)/i.test(u.pathname) || content.trimStart().startsWith("{") ? "geojson" : "csv";
	}
	if (content !== null && content.length > MAX_UPLOAD_CHARS) {
		throw new ArcGISError(`The data is ${content.length} characters; the limit here is ${MAX_UPLOAD_CHARS}. Upload `
			+ "large files in ArcGIS Online, then publish them with item_id.", "too_large");
	}

	// Geocoding spends credits: ask BEFORE uploading anything, so a refusal leaves no orphan item behind.
	const rows = kind === "csv" && content !== null ? Math.max(0, content.trim().split(/\r?\n/).length - 1) : 0;
	const geocodeNote = "This spends ArcGIS Online credits.";
	const byAddress = Boolean(args.address_fields) && !(args.latitude_field && args.longitude_field);
	if (byAddress && !ctx.props.isPortal) {
		requireConfirm(args.confirm, `Publishing ${rows || "the"} rows by address (geocoding)`,
			{ estimated_credits: rows ? Math.round(rows * GEOCODE_CREDITS_EACH * 100) / 100 : null }, geocodeNote);
	}

	const folderId = await resolveFolder(ctx, args.folder, true);
	const folderPath = `${userPath(ctx)}${folderId ? `/${folderId}` : ""}`;
	let sourceId: string;
	let fileType: string;
	let uploaded = false;
	if (args.item_id) {
		const src = await getItem(ctx, args.item_id);
		fileType = ITEM_FILE_TYPES[src.type];
		if (!fileType) throw new ArcGISError(`${src.type} items cannot be published here.`, "unsupported");
		sourceId = src.id;
	} else {
		const ft = FILE_TYPES[kind!];
		if (!ctx.upload) throw new ArcGISError("Uploads are not available in this context.", "unsupported");
		const added = await ctx.upload(`${folderPath}/addItem`, {
			type: ft.itemType, title, tags: (args.tags ?? ["arcgis-web-mcp"]).join(","),
			snippet: args.snippet ?? "Uploaded by ArcGIS Web MCP",
		}, { name: `${serviceName(title)}.${ft.ext}`, content: content!, type: ft.mime });
		if (!added.id) throw new ArcGISError(`The upload did not create an item: ${JSON.stringify(added).slice(0, 200)}`, "upload_failed");
		sourceId = added.id;
		fileType = ft.fileType;
		uploaded = true;
	}
	const dropUpload = async () => {
		if (uploaded) await ctx.request(`${userPath(ctx)}/items/${sourceId}/delete`, { permanentDelete: true }).catch(() => null);
	};

	let pp: Record<string, unknown> = {};
	if (fileType === "csv" || fileType === "excel") {
		const analyzed = await ctx.request(`${base(ctx)}/content/features/analyze`,
			{ itemid: sourceId, filetype: fileType, sourceLocale: "en" });
		pp = { ...(analyzed.publishParameters ?? {}) };
		if (args.latitude_field && args.longitude_field) {
			Object.assign(pp, { locationType: "coordinates", latitudeFieldName: args.latitude_field,
				longitudeFieldName: args.longitude_field });
		} else if (args.address_fields) {
			Object.assign(pp, { locationType: "address", addressFields: args.address_fields });
		}
		if (pp.locationType === "address" && !ctx.props.isPortal && !args.confirm) {
			// analyze detected address columns on its own: remove the upload, then ask
			await dropUpload();
			requireConfirm(false, `Publishing ${rows || "the"} rows by address (geocoding; the file has address columns)`,
				{ estimated_credits: rows ? Math.round(rows * GEOCODE_CREDITS_EACH * 100) / 100 : null,
					avoid_credits: "pass latitude_field + longitude_field if the data has coordinates" }, geocodeNote);
		}
	}
	pp.name = await availableName(ctx, serviceName(title));
	const pub = await ctx.request(`${userPath(ctx)}/publish`, { itemid: sourceId, filetype: fileType,
		publishParameters: pp }).catch(async (e) => {
		await dropUpload();
		throw e;
	});
	const svc = (pub.services ?? [])[0] ?? {};
	if (!svc.serviceItemId || svc.success === false) {
		await dropUpload();
		throw new ArcGISError(`Publishing failed: ${JSON.stringify(svc.error ?? svc).slice(0, 300)}`, "publish_failed");
	}
	const wait = ctx.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	let status = "processing";
	for (let i = 0; i < 30 && svc.jobId && status !== "completed"; i++) {
		await wait(2000);
		const st = await ctx.request(`${userPath(ctx)}/items/${svc.serviceItemId}/status`,
			{ jobId: svc.jobId, jobType: "publish" });
		status = st.status;
		if (status === "failed") throw new ArcGISError(`Publishing failed: ${st.statusMessage}`, "publish_failed");
	}
	const published = await getItem(ctx, svc.serviceItemId);
	let layers: unknown[] = [];
	if (published.url && hostAllowed(published.url, ctx.props.portal, ctx.extraHosts)) {
		const s = await ctx.request(published.url);
		layers = [...(s.layers ?? []), ...(s.tables ?? [])].map((l: any, index: number) => ({ index, id: l.id, name: l.name,
			url: `${published.url}/${l.id}` }));
	}
	audit(ctx.props, { tool: "portal_publish", action: "publish", target: title, ok: true,
		details: { source: sourceId, published: svc.serviceItemId } });
	return { source_item_id: sourceId, published_item: itemCard(published, ctx.props.portal), layers,
		status: status === "completed" ? "completed" : `still ${status} (check later with portal_item)` };
}
