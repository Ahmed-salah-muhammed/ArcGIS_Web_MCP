/** portal_app: builds apps from the user's content; each kind lives in its own file next to this one. */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { audit } from "../shared/safety";
import { createDashboard, WIDGET_HELP } from "./dashboard";
import { registerExbDeveloper } from "./developer";
import { EXB_WIDGET_HELP } from "./exb-build";
import { createExperience, experienceTemplates } from "./experience";
import { customWidget } from "./exb-widget";
import { prepareFieldMaps } from "./fieldmaps";
import { createInstant, instantTemplates, templateSettings } from "./instant";
import { BLOCK_HELP, createStorymap, STORY_THEMES } from "./storymap";
import { createSurvey } from "../portal_survey123/draft";
import { APP_KINDS, type AppArgs } from "./types";

const CREATE = { instant: createInstant, dashboard: createDashboard, experience: createExperience, storymap: createStorymap,
	survey: createSurvey, fieldmaps: prepareFieldMaps, exb_developer: registerExbDeveloper,
	exb_widget: async (_ctx: Ctx, args: AppArgs) => customWidget(args) } as const;

export async function app(ctx: Ctx, args: AppArgs) {
	const kind = args.kind;
	if (!kind || !APP_KINDS.includes(kind)) throw new ArcGISError(`kind must be one of: ${APP_KINDS.join(", ")}.`, "bad_argument");
	if ((args.action ?? "create") === "templates") {
		if (kind === "instant") {
			const list = (await instantTemplates(ctx)).map(({ typeKeywords: _, ...t }) => t);
			if (!args.template) return { kind, templates: list, settings: "Give template to list that template's settings (the options create takes)." };
			const wanted = args.template.toLowerCase().trim();
			const tpl = list.find((t) => t.id === wanted || t.name === wanted || t.title.toLowerCase() === wanted);
			if (!tpl) throw new ArcGISError(`No Instant Apps template '${args.template}'. Available: ${list.map((t) => t.name).join(", ")}`, "not_found");
			return { kind, template: tpl, settings: await templateSettings(ctx, { ...tpl, typeKeywords: [] }) };
		}
		if (kind === "experience") return { kind, templates: experienceTemplates(), build_from_widgets: EXB_WIDGET_HELP };
		if (kind === "storymap") return { kind, themes: STORY_THEMES, blocks: BLOCK_HELP };
		if (kind === "dashboard") return { kind, widgets: WIDGET_HELP };
		throw new ArcGISError(`${kind} has no templates.`, "bad_argument");
	}
	const out: any = await CREATE[kind](ctx, args);
	// a custom widget is files for the user's own machine: nothing changed in ArcGIS, nothing to audit
	if (kind !== "exb_widget") audit(ctx.props, { tool: "portal_app", action: `create ${kind}`, target: out.app?.id ?? out.map?.id ?? null, ok: true });
	return { kind, ...out };
}
