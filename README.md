# ArcGIS Web MCP

MCP server for **ArcGIS Online** and **ArcGIS Enterprise**. You sign in with your own ArcGIS account; the server
never sees your password and can only do what your account can do.

**Server URL:** `https://arcgis.web-mcp.workers.dev/mcp`

**Documentation URL:** `https://arcgis.web-mcp.workers.dev/`

## Connect

The first time, a browser window opens: click **Approve**, then sign in with ArcGIS.

### Claude (desktop and web)

**Settings → Connectors → Add custom connector** → paste the server URL.

### Claude Code

```bash
claude mcp add --transport http arcgis https://arcgis.web-mcp.workers.dev/mcp
```

Or run it through `mcp-remote` on your machine:

```bash
claude mcp add arcgis -- npx mcp-remote https://arcgis.web-mcp.workers.dev/mcp
```

### Google Antigravity, Claude Desktop, Cursor, Windsurf and other clients

Add this to the client's MCP config ([Node.js](https://nodejs.org) required), then restart the client:

```json
{
  "mcpServers": {
    "Arcgis_Web_MCP": {
      "command": "npx",
      "args": ["mcp-remote", "https://arcgis.web-mcp.workers.dev/mcp"]
    }
  }
}
```

| Client | Config |
| --- | --- |
| Google Antigravity | Agent panel → **MCP Servers → Manage MCP Servers → View raw config** (`mcp_config.json`) |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` (Windows), `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "arcgis": { "type": "http", "url": "https://arcgis.web-mcp.workers.dev/mcp" }
  }
}
```

## Tools

| Tool | What it does |
| --- | --- |
| `portal_whoami` | Who is signed in: user, role, organization, what the account can do |
| `portal_search` | Search items by text, type, owner or tags |
| `portal_geocode` | Address to coordinates and back, with your organization's geocoder |
| `portal_item` | Read, update, move, protect or delete an item; dependencies; export to CSV, GeoJSON, File Geodatabase...; automatic summary and tags |
| `portal_folders` | List, create and delete folders |
| `portal_share` | Share with your organization, groups or everyone |
| `portal_publish` | Publish CSV, GeoJSON or an uploaded file as a hosted feature layer |
| `portal_layer_query` | Describe a layer, query rows, count, statistics, attachments and related records; filter by place (near a point, inside an area) |
| `portal_layer_edit` | Add, update and delete features; calculate fields; add and delete attachments |
| `portal_layer_schema` | Fields, capabilities, styles, labels, attachments and filtered views |
| `portal_map` | Create and edit web maps: layers, popups, styles, filters, basemaps |
| `portal_arcade` | Arcade expressions: ready-made templates, a check against the layer's fields, popups, labels and Field Maps form rules |
| `portal_app` | Apps from your maps and layers: Instant Apps, Dashboards, Experience Builder, StoryMaps, Survey123, Field Maps, Experience Builder Developer Edition |
| `portal_groups` | Search, create, update and delete groups; add, invite and remove members |
| `portal_rest` | Any ArcGIS REST request with your sign-in |
| `portal_batch` | Up to 10 tool calls in one request, each reusing earlier results |

Deleting, bulk edits, public sharing and anything that spends credits ask for your confirmation first.

## Development

You need [Node.js](https://nodejs.org) 22 or newer, a Cloudflare account, and OAuth 2.0 credentials from ArcGIS
(an app in your ArcGIS content). Add these redirect URLs to the credentials: `http://localhost:8788/callback` for
local runs, and `https://<your worker>/callback` for the deployed server.

```bash
npm ci
cp .dev.vars.example .dev.vars   # then fill in the values
npm run dev                      # http://localhost:8788/ (documentation), MCP at http://localhost:8788/mcp
```

Before you push:

```bash
npm run type-check
npm test                         # no network or ArcGIS account needed
```

GitHub Actions runs both on every push to `main` and every pull request.

Deploy (the first deploy creates the KV namespace):

```bash
npx wrangler deploy --secrets-file .dev.vars
```

Settings in `wrangler.jsonc` (`vars`):

| Variable | What it does |
| --- | --- |
| `ARCGIS_PORTAL_URL` | ArcGIS Online by default; an Enterprise portal works too, e.g. `https://gis.example.com/portal` |
| `ARCGIS_EXTRA_HOSTS` | Extra hosts allowed to receive the user's token (e.g. federated servers or a geocoder on another host) |
| `MAX_SUBREQUESTS` | Requests to ArcGIS one tool call may make: 50 on Cloudflare's free plan, more on a paid plan |
| `CONTACT_FROM` | Sender of the contact form's emails |

A fork changes `name` and removes the KV `id` in `wrangler.jsonc`; without a contact form, it also removes
`RESEND_API_KEY` and `CONTACT_TO` from `secrets.required`.

Each tool is a folder in `src/tools/`: `index.ts` defines it (name, description, input schema) and `handler.ts`
does the work; code several tools share is in `src/tools/shared/`. Every tool and action must also be described in
`src/pages/docs.ts`; a test checks that.

The full guide: [docs/ArcGIS-Web-MCP-Documentation.docx](docs/ArcGIS-Web-MCP-Documentation.docx).

---

Developed by [Ahmed Salah Muhammed](https://ahmedsalah-portfolio.vercel.app/), Full Stack Developer · GIS Developer
