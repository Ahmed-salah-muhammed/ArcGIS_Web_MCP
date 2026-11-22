/**
 * MCP prompts: workflows a user starts by name (clients list them as slash commands or prompt pickers). Each one is
 * only a message that tells the model which tools to use and in what order; it reads and changes nothing by itself,
 * and every write it leads to still goes through the same confirm rail as a tool called directly.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

type PromptSpec = { name: string; title: string; description: string; args: z.ZodObject<any>;
	text: (args: Record<string, string | undefined>) => string };

const RULES = "Use item ids from the results, never titles. When a result has code confirm_required, show me its preview and "
	+ "wait for my answer before calling again with confirm=true.";

export const PROMPTS: PromptSpec[] = [
	{
		name: "publish_and_map",
		title: "Publish data and map it",
		description: "Turn a CSV or GeoJSON (pasted text, a public https link, or an uploaded item) into a hosted layer and a web map.",
		args: z.object({
			source: z.string().describe("The data: pasted CSV/GeoJSON text, a public https URL, or an item id"),
			title: z.string().optional().describe("Title for the layer and the map"),
		}),
		text: (a) => `Publish this data as a hosted feature layer and put it on a web map${a.title ? ` titled "${a.title}"` : ""}.\n\n`
			+ `Data: ${a.source}\n\n`
			+ "1. portal_whoami: check that I can publish.\n"
			+ "2. portal_publish: one source only (csv_text, geojson_text, url or item_id). For a CSV with coordinates pass "
			+ "latitude_field and longitude_field; geocoding by address spends credits, so ask me first.\n"
			+ "3. portal_layer_query action=describe on the new layer: tell me its fields and how many features it has.\n"
			+ "4. portal_map action=create with the layer; pick a renderer that suits the fields (unique values for a category, "
			+ "class breaks for a number).\n"
			+ `5. Give me the links to the layer and the map. ${RULES}`,
	},
	{
		name: "build_dashboard",
		title: "Build a dashboard",
		description: "Design and build an ArcGIS Dashboard from a feature layer or a web map.",
		args: z.object({
			target: z.string().describe("The feature layer or web map: an item id, or words to search for"),
			audience: z.string().optional().describe("Who it is for and what they need to see"),
		}),
		text: (a) => `Build an ArcGIS Dashboard for: ${a.target}${a.audience ? `\nAudience: ${a.audience}` : ""}\n\n`
			+ "1. If that is not an item id, portal_search for it and ask me which item when several match.\n"
			+ "2. portal_layer_query action=describe, then action=distinct or stats on the fields that look useful, so the "
			+ "widgets are chosen from the real data.\n"
			+ "3. portal_app action=templates kind=dashboard: read the guide before choosing widgets.\n"
			+ "4. Propose the layout (indicators, charts, a list or table, selectors) in a few lines and wait for my go-ahead.\n"
			+ `5. portal_app action=create kind=dashboard, then give me the link. ${RULES}`,
	},
	{
		name: "explore_layer",
		title: "Explore a layer",
		description: "A quick profile of a feature layer: fields, counts, value distributions, extent and data-quality notes.",
		args: z.object({ target: z.string().describe("The layer: an item id, a FeatureServer URL, or words to search for") }),
		text: (a) => `Profile this layer for me: ${a.target}\n\n`
			+ "1. If that is not an item id or URL, portal_search for it and ask me which item when several match.\n"
			+ "2. portal_layer_query action=describe: fields, types, domains, count, relationships, attachments.\n"
			+ "3. action=extent for where the data is; action=distinct on the category fields (few values); action=stats "
			+ "(min, max, avg, count) on the numeric ones. portal_batch can run these together with parallel=true.\n"
			+ "4. action=query with a small limit to show a sample.\n"
			+ "5. Summarize: what the layer holds, anything that looks wrong (empty fields, odd values, a suspicious extent), "
			+ "and three maps or charts worth building from it. Read only: change nothing.",
	},
	{
		name: "content_audit",
		title: "Audit my content",
		description: "Review what the signed-in user owns: sharing levels, public layers that can be edited, stale items and credits.",
		args: z.object({ stale_days: z.string().optional().describe("Items not modified for this many days count as stale; default 365") }),
		text: (a) => "Audit my ArcGIS content and tell me what needs attention.\n\n"
			+ "1. portal_audit action=summary: how much I own at each sharing level.\n"
			+ "2. portal_audit action=public: public layers, and which of them anyone can edit.\n"
			+ `3. portal_audit action=stale${a.stale_days ? ` with days=${a.stale_days}` : ""}: items nobody has touched.\n`
			+ "4. portal_audit action=credits: credits and storage.\n"
			+ "5. Report the risks first (public and editable), then the clean-up candidates, each with its item link. "
			+ `Change nothing unless I ask: this is a read-only review. ${RULES}`,
	},
];

export function registerPrompts(server: McpServer): void {
	for (const p of PROMPTS) {
		server.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema: p.args },
			(args: Record<string, unknown>) => ({ messages: [{ role: "user" as const,
				content: { type: "text" as const, text: p.text((args ?? {}) as Record<string, string | undefined>) } }] }));
	}
}
