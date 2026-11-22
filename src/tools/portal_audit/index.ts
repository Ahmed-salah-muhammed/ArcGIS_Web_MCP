import { z } from "zod";
import { defineTool, READ_ONLY } from "../shared/mcp";
import { contentAudit } from "./handler";

export const tool = defineTool({
	name: "portal_audit",
	title: "Audit content",
	description: "A read-only review of content, yours (scope=me, default) or everything you can see in your organization (scope=org): summary (how many items at each sharing level) | public (what everyone can see, most viewed first, and which public layers anyone can edit) | stale (items not modified for days, default 365, oldest first) | credits (the organization's credits and subscription, your credit budget and storage). It changes nothing.",
	schema: z.object({
		action: z.enum(["summary", "public", "stale", "credits"]).optional().describe("Default summary"),
		scope: z.enum(["me", "org"]).optional().describe("Default me"),
		days: z.number().int().min(1).optional().describe("stale: not modified for this many days; default 365"),
		max_items: z.number().int().min(1).max(50).optional().describe("public / stale: items listed; default 25"),
	}),
	annotations: READ_ONLY,
	handle: (ctx, args) => contentAudit(ctx, args),
});
