/**
 * Everything the Worker serves as HTML, and how the server presents itself:
 * identity.ts (developer, MCP server info), credit.ts ("Developed by" badge), home.ts (the documentation app at "/"),
 * docs.ts (what that app says about each tool), status.ts (the page after the ArcGIS sign-in), avatar.ts (the photo).
 */
export { CREDIT_CSS, creditHtml } from "./credit";
export { CATEGORIES, TOOL_DOCS } from "./docs";
export { HOME_HEADERS, homePage } from "./home";
export { AUTHOR, type Author, MCP_INSTRUCTIONS, MCP_SERVER_INFO, VERSION } from "./identity";
export { clientDisplay, type Message, MESSAGE_HEADERS, messagePage } from "./status";
