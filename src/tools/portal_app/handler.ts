/** portal_app: builds apps from the user's content; each kind lives in its own file next to this one. */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { audit } from "../shared/safety";
import { createDashboard, WIDGET_HELP } from "./dashboard";
import { registerExbDeveloper } from "./developer";
import { createExperience, experienceTemplates } from "./experience";
import { prepareFieldMaps } from "./fieldmaps";
import { createInstant, instantTemplates } from "./instant";
import { createStorymap, STORY_THEMES } from "./storymap";
import { createSurvey } from "../portal_survey123/draft";
import { APP_KINDS, type AppArgs } from "./types";

const CREATE = { instant: createInstant, dashboard: createDashboard, experience: createExperience, storymap: createStorymap,
	survey: createSurvey, fieldmaps: prepareFieldMaps, exb_developer: registerExbDeveloper } as const;

export async function app(ctx: Ctx, args: AppArgs) {
	const kind = args.kind;
	if (!kind || !APP_KINDS.includes(kind)) throw new ArcGISError(`kind must be one of: ${APP_KINDS.join(", ")}.`, "bad_argument");
	if ((args.action ?? "create") === "templates") {
		if (kind === "instant") return { kind, templates: (await instantTemplates(ctx)).map(({ typeKeywords: _, ...t }) => t) };
		if (kind === "experience") return { kind, templates: experienceTemplates() };
		if (kind === "storymap") return { kind, themes: STORY_THEMES };
		if (kind === "dashboard") return { kind, widgets: WIDGET_HELP };
		throw new ArcGISError(`${kind} has no templates.`, "bad_argument");
	}
	const out: any = await CREATE[kind](ctx, args);
	audit(ctx.props, { tool: "portal_app", action: `create ${kind}`, target: out.app?.id ?? out.map?.id ?? null, ok: true });
	return { kind, ...out };
}
