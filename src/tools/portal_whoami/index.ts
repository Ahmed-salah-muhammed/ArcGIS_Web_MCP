import { z } from "zod";
import { defineTool, READ_ONLY } from "../shared/mcp";
import { whoami } from "./handler";

export const tool = defineTool({
	name: "portal_whoami",
	title: "Who am I",
	description: "The signed-in ArcGIS user: username, role, user type, org, platform (ArcGIS Online / Enterprise) and what the account can do.",
	schema: z.object({}),
	annotations: READ_ONLY,
	handle: (ctx) => whoami(ctx),
});
