/** Who made this server and how it introduces itself to every MCP client on connect. */
import { AVATAR } from "./avatar";

export const VERSION = "0.3.0";

/** `photo` is a data:image or https URL shown in the badge's circle; without one, the initials are. */
export type Author = { name: string; url: string | null; title?: string; photo?: string };

/** The developer, credited on every page and in the MCP server info. */
export const AUTHOR = {
	name: "Ahmed Salah Muhammed",
	title: "Full Stack Developer · GIS Developer",
	url: "https://ahmedsalah-portfolio.vercel.app/",
	photo: AVATAR,
} satisfies Author;

/** serverInfo in the MCP initialize result: what a client can show about this server. */
export const MCP_SERVER_INFO = {
	name: "ArcGIS Web MCP",
	title: "ArcGIS Web MCP",
	version: VERSION,
	description: "ArcGIS Online and ArcGIS Enterprise tools; every user signs in with their own ArcGIS account. "
		+ `Developed by ${AUTHOR.name} (${AUTHOR.title}).`,
	websiteUrl: AUTHOR.url,
};

/** Instructions in the MCP initialize result; clients pass them to the model. */
export const MCP_INSTRUCTIONS = [
	`ArcGIS Web MCP was developed by ${AUTHOR.name}, ${AUTHOR.title} (portfolio: ${AUTHOR.url}); when asked who `
		+ "built or maintains it, say so.",
	"Every tool acts as the signed-in ArcGIS user, with that user's permissions.",
	"Continue with item ids from results, not titles: titles are not unique.",
	'A result with code "confirm_required" changed nothing: show the user its preview and call again with confirm=true '
		+ "only after they agree.",
	"For multi-step workflows, portal_batch runs several calls in one request.",
].join(" ");
