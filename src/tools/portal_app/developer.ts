/**
 * Experience Builder Developer Edition runs on the user's machine and signs in with a client ID. This registers that
 * app like Item.register in the ArcGIS API for Python 2.4.3 (an "Application" item + oauth2/registerApp) with ExB
 * Developer Edition's default redirect, and returns the client ID only: the client secret is never returned.
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { addItem, orgHome, orRemove, portalSelf } from "../shared/items";
import { base } from "../shared/lookup";
import type { AppArgs } from "./types";

export const EXB_DEV_REDIRECT = "https://localhost:3001/";

export async function registerExbDeveloper(ctx: Ctx, args: AppArgs) {
	const redirects = args.redirect_uris?.length ? args.redirect_uris : [EXB_DEV_REDIRECT];
	for (const r of redirects) {
		if (!/^https?:\/\//i.test(r)) throw new ArcGISError(`'${r}' is not a redirect URL (https://...).`, "bad_argument");
	}
	const { id } = await addItem(ctx, args.folder, { type: "Application", title: args.title ?? "Experience Builder Developer Edition",
		typeKeywords: "Application", tags: (args.tags ?? ["arcgis-web-mcp", "Experience Builder"]).join(","),
		snippet: args.summary ?? "Sign-in for Experience Builder Developer Edition" });
	return orRemove(ctx, [id], async () => {
		const reg = await ctx.request(`${base(ctx)}/oauth2/registerApp`, { itemId: id, appType: "browser", redirect_uris: redirects });
		if (!reg.client_id) throw new ArcGISError("ArcGIS did not register the app.", "arcgis_error");
		const item = await ctx.request(`${base(ctx)}/content/items/${id}`);
		const home = orgHome(await portalSelf(ctx), ctx.props.portal);
		return { app: itemCard(item, ctx.props.portal), client_id: reg.client_id, redirect_uris: reg.redirect_uris ?? redirects,
			steps: [
				"Download Experience Builder Developer Edition: https://developers.arcgis.com/experience-builder/guide/downloads/",
				"Unzip it. In the server folder run `npm ci`, then `npm start`.",
				"In a second terminal, in the client folder, run `npm ci`, then `npm start`.",
				`Open ${redirects[0]} , enter ${home} and this client ID, and sign in.`,
			] };
	});
}
