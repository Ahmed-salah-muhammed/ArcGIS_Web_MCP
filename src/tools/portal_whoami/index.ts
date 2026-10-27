import type { McpServer } from "@modelcontextprotocol/server";
import type { Ctx } from "../shared/context";
import { READ_ONLY, run } from "../shared/mcp";
import { whoami } from "./handler";

export function register(server: McpServer, ctx: Ctx): void {
	server.registerTool("portal_whoami", {
		title: "Who am I",
		description: "The signed-in ArcGIS user: username, role, user type, org, platform (ArcGIS Online / Enterprise) and what the account can do.",
		annotations: READ_ONLY,
	}, async () => run(ctx.props, () => whoami(ctx)));
}
