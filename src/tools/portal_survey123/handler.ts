/**
 * portal_survey123: Survey123 for both ways of building a survey.
 * create  - in the browser: a draft the Survey123 web designer opens (draft.ts).
 * publish - a published survey from an XLSForm, as Survey123 Connect publishes one (publish.ts).
 * xlsform - for Survey123 Connect: an XLSForm .xlsx, checked by Survey123's own converter, saved in your content
 *           to download and open in Connect (New survey > File). Not to be published with ArcGIS's Publish button,
 *           which turns a spreadsheet into a hosted table.
 * info    - a survey's status, questions and layer, and the links ArcGIS's "Open in Survey123" menu offers
 *           (formats from doc.arcgis.com/en/survey123/get-started/integratewithotherapps.htm).
 */
import { ArcGISError } from "../../arcgis";
import type { AppArgs } from "../portal_app/types";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { orRemove, portalSelf, requireItemOfType } from "../shared/items";
import { base, requireId, resolveFolder, resolveLayerUrl, userPath } from "../shared/lookup";
import { audit } from "../shared/safety";
import { createSurvey, DEFAULT_QUESTIONS, type QuestionSpec, questionsFromFields } from "./draft";
import { publishSurvey, XLS2XFORM } from "./publish";
import { xlsformFile } from "./xlsform";

export { XLS2XFORM };
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type SurveyArgs = Omit<AppArgs, "action"> & { action?: "create" | "publish" | "xlsform" | "info"; survey_id?: string };

/** The links of ArcGIS's "Open in Survey123" menu for a survey. */
export function surveyLinks(id: string, portal: string, isPortal: boolean) {
	const p = portal.replace(/\/+$/, "");
	const q = isPortal ? `?portalUrl=${encodeURIComponent(p)}` : "";
	return {
		open_in_browser: `https://survey123.arcgis.com/share/${id}${q}`,
		open_in_survey123_app: `https://survey123.arcgis.app?itemID=${id}`,
		open_in_survey123_app_scheme: `arcgis-survey123://?itemID=${id}`,
		manage_in_survey123_website: `https://survey123.arcgis.com/surveys/${id}/overview${q}`,
		edit_in_web_designer: `https://survey123.arcgis.com/surveys/${id}/design${q}`,
		edit_in_survey123_connect: `arcgis-survey123connect://?portalUrl=${p}%26itemID=${id}`,
	};
}

async function specsFor(ctx: Ctx, args: SurveyArgs): Promise<{ specs: QuestionSpec[]; from: string }> {
	if (args.questions?.length) return { specs: args.questions as QuestionSpec[], from: "your questions" };
	if (args.target) {
		const info = await ctx.request(await resolveLayerUrl(ctx, requireId(args.target), args.layer ?? 0));
		return { specs: questionsFromFields(info), from: `the fields of ${info.name}` };
	}
	return { specs: DEFAULT_QUESTIONS, from: "the default questions" };
}

async function xlsform(ctx: Ctx, args: SurveyArgs) {
	if (!args.title) throw new ArcGISError("title is required.", "bad_argument");
	const { specs, from } = await specsFor(ctx, args);
	const bytes = xlsformFile(args.title, specs);
	const fileName = `${args.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "survey"}.xlsx`;
	const self = await portalSelf(ctx);
	let checked = "not checked (Survey123's converter is checked on ArcGIS Online only)";
	if (!self.isPortal && ctx.publicUpload) {
		const res = await ctx.publicUpload(XLS2XFORM, {}, { name: fileName, content: bytes, type: XLSX_TYPE, field: "xlsform" });
		if (!res?.success) throw new ArcGISError(`Survey123's converter rejected the XLSForm: ${res?.error ?? res?.message ?? "no answer"}`, "xlsform_invalid");
		checked = `accepted by Survey123's converter${res.warnings?.length ? ` with warnings: ${res.warnings.join("; ")}` : ", no warnings"}`;
	}
	if (!ctx.upload) throw new ArcGISError("Uploading files is not available here.", "unsupported");
	const folderId = await resolveFolder(ctx, args.folder, true);
	const added = await ctx.upload(`${userPath(ctx)}${folderId ? `/${folderId}` : ""}/addItem`, { type: "Microsoft Excel", title: args.title,
		tags: (args.tags ?? ["arcgis-web-mcp", "Survey123", "XLSForm"]).join(","), snippet: args.summary ?? "XLSForm for Survey123 Connect",
		fileName }, { name: fileName, content: bytes, type: XLSX_TYPE });
	if (!added.id) throw new ArcGISError("ArcGIS did not save the XLSForm.", "arcgis_error");
	return orRemove(ctx, [added.id], async () => {
		const item = await ctx.request(`${base(ctx)}/content/items/${added.id}`);
		return { xlsform: itemCard(item, ctx.props.portal), download: `${base(ctx)}/content/items/${added.id}/data`, file: fileName,
			questions: specs.map((s) => `${s.label} (${s.type})`), from, checked,
			next: ["Download the file.", "In Survey123 Connect: New survey > File, choose it, then Create survey.",
				"Edit the XLSForm in Excel if you like, then Publish from Connect (it creates the layer)."] };
	});
}

async function info(ctx: Ctx, args: SurveyArgs) {
	const form = await requireItemOfType(ctx, args.survey_id, ["Form"], "survey_id (the survey's Form item)");
	const draft = (form.typeKeywords ?? []).includes("Draft");
	const resources = await ctx.request(`${base(ctx)}/content/items/${form.id}/resources`, { num: 100 }).catch(() => ({ resources: [] }));
	const names: string[] = (resources.resources ?? []).map((r: any) => r.resource);
	let questions: string[] | null = null;
	if (names.includes("surveyDraft/form.json")) {
		const f = await ctx.request(`${base(ctx)}/content/items/${form.id}/resources/surveyDraft/form.json`).catch(() => null);
		questions = (f?.questions ?? []).map((q: any) => `${q.label} (${String(q.type).replace("esriQuestionType", "")})`);
	}
	const rel = await ctx.request(`${base(ctx)}/content/items/${form.id}/relatedItems`, { relationshipType: "Survey2Service", direction: "forward" });
	const svcItem = rel.relatedItems?.[0];
	let service: Record<string, unknown> | null = null;
	if (svcItem?.url) {
		const svc = await ctx.request(svcItem.url).catch(() => null);
		const layers = svc?.layers ?? [];
		const records = layers.length
			? await ctx.request(`${svcItem.url}/${layers[0].id}/query`, { where: "1=1", returnCountOnly: true }).then((r: any) => r.count, () => null)
			: null;
		service = { id: svcItem.id, url: svcItem.url, layers: layers.map((l: any) => l.name), records };
	}
	const self = await portalSelf(ctx);
	return { survey: itemCard(form, ctx.props.portal), status: draft ? "draft: not published yet" : "published",
		made_with: names.some((n) => n.startsWith("surveyDraft/")) ? "Survey123 web designer" : "Survey123 Connect or another tool",
		questions, service, links: surveyLinks(form.id, ctx.props.portal, Boolean(self.isPortal)) };
}

export async function survey123(ctx: Ctx, args: SurveyArgs) {
	const action = args.action ?? "create";
	if (action === "info") return info(ctx, args);
	if (action === "publish") {
		const { specs, from } = await specsFor(ctx, args);
		const out: any = await publishSurvey(ctx, args, specs, from);
		audit(ctx.props, { tool: "portal_survey123", action, target: out.survey.id, ok: true });
		const self = await portalSelf(ctx);
		return { ...out, links: surveyLinks(out.survey.id, ctx.props.portal, Boolean(self.isPortal)) };
	}
	if (action !== "create" && action !== "xlsform") throw new ArcGISError("action must be create | publish | xlsform | info.", "bad_action");
	const out: any = action === "create" ? await createSurvey(ctx, { ...args, action: "create" }) : await xlsform(ctx, args);
	const id = out.app?.id ?? out.xlsform?.id;
	audit(ctx.props, { tool: "portal_survey123", action, target: id, ok: true });
	if (action === "create") {
		const self = await portalSelf(ctx);
		return { ...out, links: surveyLinks(id, ctx.props.portal, Boolean(self.isPortal)) };
	}
	return out;
}
