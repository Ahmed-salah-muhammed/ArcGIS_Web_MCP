/**
 * What the documentation page says about each tool. test/pages.test.ts checks it against the real tool definitions,
 * so every tool and every action listed here exists, and every action a tool has is documented.
 */

export type Category = { id: string; name: string; summary: string; icon: string; color: string };
export type ActionDoc = { name: string; does: string; confirm?: string };
export type ToolDoc = {
	name: string;
	category: string;
	summary: string;
	actions?: ActionDoc[];
	/** For tools without an `action` argument: what you give it. */
	inputs?: ActionDoc[];
	examples: string[];
	notes?: string[];
};

export const CATEGORIES: Category[] = [
	{ id: "read", name: "Find & read", summary: "Who you are, and what is in your organization.", icon: "search", color: "blue" },
	{ id: "content", name: "Content", summary: "Items, folders, sharing and groups.", icon: "folder", color: "orange" },
	{ id: "data", name: "Data", summary: "Publish layers, query them, edit them, shape them.", icon: "layers", color: "green" },
	{ id: "apps", name: "Apps & maps", summary: "Web maps, Arcade, and the apps built on them.", icon: "map", color: "blue" },
	{ id: "power", name: "Power tools", summary: "Raw REST and several calls in one request.", icon: "bolt", color: "orange" },
];

export const TOOL_DOCS: ToolDoc[] = [
	{
		name: "portal_whoami", category: "read",
		summary: "Who is signed in: username, role, user type, organization, ArcGIS Online or Enterprise, and what the account can do.",
		examples: ["Who am I signed in as in ArcGIS?", "Can my account publish hosted layers?"],
	},
	{
		name: "portal_search", category: "read",
		summary: "Find items by text, exact type, owner or tags, newest first, in your organization or across public content.",
		inputs: [
			{ name: "query", does: "Text or ArcGIS query syntax, e.g. title:\"Parcels\" AND tags:roads" },
			{ name: "item_type", does: "An exact item type: Feature Service, Web Map, Dashboard..." },
			{ name: "owner", does: "A username, or \"me\"" },
			{ name: "start / max_items", does: "Paging: up to 100 results per call, continue with next_start" },
		],
		examples: ["Find my feature layers about roads.", "List the dashboards shared in my organization."],
	},
	{
		name: "portal_item", category: "content",
		summary: "Everything about one item by its id: read it, change it, move it, protect it, export it, or describe it automatically.",
		actions: [
			{ name: "get", does: "The item card, sharing, and every layer and table of a service" },
			{ name: "data", does: "The item's JSON (web map, app, dashboard)" },
			{ name: "update", does: "Title, summary, description, tags... and/or the item's JSON" },
			{ name: "move", does: "To a folder, or to the root" },
			{ name: "protect", does: "Turn on delete protection" },
			{ name: "unprotect", does: "Turn off delete protection" },
			{ name: "delete", does: "Delete the item (protected items are refused)", confirm: "always" },
			{ name: "dependencies", does: "What the item uses, and what uses it" },
			{ name: "export", does: "A feature layer to CSV, GeoJSON, Shapefile, File Geodatabase, Excel, GeoPackage or KML, with a download link" },
			{ name: "suggest_metadata", does: "A summary, description and tags inferred from the layers, fields and geometry; apply=true writes them" },
		],
		examples: ["Export the Parcels layer to a file geodatabase.", "Write a summary and tags for my Roads layer."],
	},
	{
		name: "portal_folders", category: "content",
		summary: "List, create and delete the folders of your content.",
		actions: [
			{ name: "list", does: "Your folders, including the root" },
			{ name: "create", does: "A new folder (nothing happens if it exists)" },
			{ name: "delete", does: "A folder and the items inside it", confirm: "always" },
		],
		examples: ["Create a folder called Field Survey 2026."],
	},
	{
		name: "portal_share", category: "content",
		summary: "Share items with your organization, groups or everyone, and see the sharing before and after for each item.",
		inputs: [
			{ name: "item_ids", does: "One or more item ids" },
			{ name: "level", does: "private, org, or everyone (public)", confirm: "for everyone" },
			{ name: "add_groups / remove_groups", does: "Group ids or exact titles" },
		],
		examples: ["Share the Schools layer with my Field team group."],
	},
	{
		name: "portal_groups", category: "content",
		summary: "Find, read, create, update and delete groups.",
		actions: [
			{ name: "search", does: "Groups by text" },
			{ name: "get", does: "A group's members and items" },
			{ name: "create", does: "A new group (private by default)", confirm: "for public groups" },
			{ name: "update", does: "Title, tags, description, access", confirm: "to make it public" },
			{ name: "delete", does: "The group (its items stay)", confirm: "always" },
		],
		examples: ["Create a private group for the survey team."],
	},
	{
		name: "portal_publish", category: "data",
		summary: "Turn data into a hosted feature layer: CSV text with coordinates or addresses, GeoJSON, a public file URL, or an uploaded item.",
		inputs: [
			{ name: "csv_text", does: "With latitude_field + longitude_field, or address_fields", confirm: "for addresses (geocoding credits)" },
			{ name: "geojson_text", does: "A GeoJSON feature collection" },
			{ name: "url", does: "A public https CSV or GeoJSON file" },
			{ name: "item_id", does: "An uploaded CSV, GeoJSON, Shapefile, File Geodatabase, Excel or GeoPackage" },
		],
		examples: ["Publish this CSV of cities as a hosted layer; the coordinates are in LAT and LON."],
		notes: ["Up to 5 MB of text per call; bigger files: upload them in ArcGIS, then publish with item_id."],
	},
	{
		name: "portal_layer_query", category: "data",
		summary: "Read a feature layer or table: its schema, its rows, counts, statistics, attachments and related records.",
		actions: [
			{ name: "describe", does: "Fields, domains, capabilities, count, view filter, relationships" },
			{ name: "query", does: "Rows, up to 1,000 per call, dates in ISO UTC" },
			{ name: "count", does: "How many rows match" },
			{ name: "stats", does: "sum / avg / min / max / count / stddev, grouped or not" },
			{ name: "attachments", does: "Each feature's files: names, types, sizes, links" },
			{ name: "related", does: "Records related through a relationship" },
		],
		examples: ["What fields does the Parcels layer have?", "Total population by district."],
	},
	{
		name: "portal_layer_edit", category: "data",
		summary: "Change layer data: add, update and delete features, calculate fields, empty a layer, and manage attachments.",
		actions: [
			{ name: "edit", does: "Adds, updates and deletes in batches; dry_run shows the changes first", confirm: "for deletes" },
			{ name: "calculate", does: "Set a field for the rows that match", confirm: "always" },
			{ name: "truncate", does: "Delete every row of a hosted layer", confirm: "always" },
			{ name: "add_attachment", does: "Attach a file (base64 or text) to a feature" },
			{ name: "delete_attachments", does: "Remove a feature's attachments", confirm: "always" },
		],
		examples: ["Set STATUS to Done where POP is over 40.", "Attach this PDF to feature 12."],
	},
	{
		name: "portal_layer_schema", category: "data",
		summary: "Shape a hosted layer: fields, capabilities, styles, labels, attachments and filtered views.",
		actions: [
			{ name: "add_field", does: "New fields (text, integers, doubles, dates, GUIDs)" },
			{ name: "delete_field", does: "Remove fields and their data", confirm: "always" },
			{ name: "capabilities", does: "Query, editing, sync, export settings" },
			{ name: "renderer", does: "A style built from the data: unique values, class breaks, or simple" },
			{ name: "labels", does: "Labels from a field or an Arcade expression" },
			{ name: "create_view", does: "A read-only view with a filter and chosen fields" },
			{ name: "enable_attachments", does: "Let features carry files" },
		],
		examples: ["Color the parcels by land use.", "Create a view of the schools with more than 500 students."],
	},
	{
		name: "portal_map", category: "apps",
		summary: "Build and edit web maps from your layers, with popups, styles, filters and a basemap from your organization.",
		actions: [
			{ name: "create", does: "A web map from item ids or layer URLs, on your organization's basemap" },
			{ name: "describe", does: "Its layers, styles, filters and basemap" },
			{ name: "add_layers", does: "More layers" },
			{ name: "remove_layers", does: "Layers by title, id, URL or position" },
			{ name: "popup", does: "Which fields a layer's popup shows" },
			{ name: "renderer", does: "A layer's style in this map" },
			{ name: "filter", does: "A layer's definition expression in this map" },
			{ name: "basemap", does: "Any basemap of your organization's gallery" },
		],
		examples: ["Make a web map of the schools on the gray basemap with popups for NAME and STUDENTS."],
	},
	{
		name: "portal_arcade", category: "apps",
		summary: "Arcade, ArcGIS's expression language: ready-made expressions, a check against the layer's real fields, and saving them into a web map's popups, labels and Field Maps forms.",
		actions: [
			{ name: "templates", does: "Ready-made expressions for popups, labels, forms, styles and dashboards; `values` fills their placeholders" },
			{ name: "check", does: "Brackets, strings, field names, the context's `$` variables, and SQL habits such as AND or <>" },
			{ name: "popup", does: "A computed field in a layer's popup" },
			{ name: "label", does: "Labels from an expression on a map layer" },
			{ name: "form", does: "A Field Maps form field: calculated, visible, required or editable when the expression is true" },
		],
		examples: ["Add a popup line with the population density of each district.", "In the field form, show 'Other reason' only when Reason is Other."],
		notes: ["Expressions are checked, not run: the check catches the common mistakes, and anything with errors is not saved."],
	},
	{
		name: "portal_app", category: "apps",
		summary: "Apps built from your maps and layers: Instant Apps, Dashboards, Experience Builder, StoryMaps, Survey123, Field Maps, and Experience Builder Developer Edition.",
		actions: [
			{ name: "templates", does: "A kind's templates: Instant Apps from your org's gallery, Experience Builder templates, StoryMaps themes, dashboard widgets" },
			{ name: "create", does: "Builds the app and returns its item and the link to open it" },
		],
		inputs: [
			{ name: "kind=instant", does: "An Instant App of a web map from any template (Basic, Sidebar...)" },
			{ name: "kind=dashboard", does: "A dashboard of a layer: indicators, pie / bar / line charts, list, table, map, legend, details; automatic when no widgets are given" },
			{ name: "kind=experience", does: "An Experience Builder app from one of 50 templates, with your web map in its maps" },
			{ name: "kind=storymap", does: "A story with a cover, headings, text and maps, in one of six themes" },
			{ name: "kind=survey", does: "A Survey123 draft that opens in the web designer (portal_survey123 also makes XLSForms for Connect)" },
			{ name: "kind=fieldmaps", does: "A web map ready for Field Maps: forms from the layers' fields, optional offline" },
			{ name: "kind=exb_developer", does: "Registers Experience Builder Developer Edition and returns its client ID and setup steps" },
		],
		examples: ["Make a dashboard of the inspections layer with a count, a pie by status and a table.",
			"Create a Sidebar Instant App of my parks map.", "Build a story about the river project with the flood map in the middle."],
		notes: ["Apps are created private in your content; share them with portal_share."],
	},
	{
		name: "portal_survey123", category: "apps",
		summary: "Survey123 surveys both ways: in the browser with the web designer, or as an XLSForm Excel file for Survey123 Connect; plus every link to open and manage a survey.",
		actions: [
			{ name: "create", does: "A survey draft with its questions that opens in the Survey123 web designer; Publish there adds the layer" },
			{ name: "publish", does: "A published survey, ready to fill in, made from an XLSForm the way Survey123 Connect publishes: the form, its layer and the form view" },
			{ name: "xlsform", does: "An XLSForm Excel file for Survey123 Connect, checked by Survey123's own converter and saved in your content to download" },
			{ name: "info", does: "Status, questions, layer and records, and the links: open in browser, open in the Survey123 app, manage in the website, edit in the web designer or in Connect" },
		],
		inputs: [
			{ name: "questions", does: "[{type, label, choices, required}]: text, textarea, number, integer, date, datetime, single, dropdown, multi, email, image, note, geopoint" },
			{ name: "target", does: "A layer whose fields become the questions (coded values become a dropdown)" },
		],
		examples: ["Make a site inspection survey with a condition question, a photo and the location.",
			"Give me an XLSForm of the poles layer for Survey123 Connect.", "Show me the links of my inspection survey."],
		notes: ["Without questions or a layer, a survey starts with location, name, date, notes and photo.",
			"Don't press ArcGIS's Publish button on the XLSForm's Excel item: that publishes the sheet as a table. Use publish, or Survey123 Connect."],
	},
	{
		name: "portal_rest", category: "power",
		summary: "Any ArcGIS REST request with your sign-in, for what the other tools do not cover.",
		inputs: [
			{ name: "path", does: "Relative to your portal's sharing/rest, or a full URL on your portal or its services" },
			{ name: "method", does: "GET (cannot change anything) or POST", confirm: "for POSTs that change things" },
		],
		examples: ["Show my organization's helper services."],
	},
	{
		name: "portal_batch", category: "power",
		summary: "Up to 10 tool calls in one request, each reusing earlier results: a whole workflow in a single round trip.",
		inputs: [
			{ name: "calls", does: "[{tool, args}, ...]; {{call0.data.items.0.id}} reuses an earlier result" },
			{ name: "parallel", does: "Run independent calls at the same time" },
		],
		examples: ["Publish this CSV, add a STATUS field, and make a web map of it."],
		notes: ["Each call is checked as if it ran alone; a call that needs confirmation stops the batch with its preview."],
	},
];
