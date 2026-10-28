# ArcGIS Web MCP

MCP server for **ArcGIS Online** and **ArcGIS Enterprise**. You sign in with your own ArcGIS account; the server
never sees your password and can only do what your account can do.

**Server URL:** `https://arcgis.web-mcp.workers.dev/mcp`

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
| `portal_item` | Read, update, move, protect or delete an item; dependencies; export to CSV, GeoJSON, File Geodatabase...; automatic summary and tags |
| `portal_folders` | List, create and delete folders |
| `portal_share` | Share with your organization, groups or everyone |
| `portal_publish` | Publish CSV, GeoJSON or an uploaded file as a hosted feature layer |
| `portal_layer_query` | Describe a layer, query rows, count, statistics, attachments and related records |
| `portal_layer_edit` | Add, update and delete features; calculate fields; add and delete attachments |
| `portal_layer_schema` | Fields, capabilities, styles, labels, attachments and filtered views |
| `portal_map` | Create and edit web maps: layers, popups, styles, filters, basemaps |
| `portal_arcade` | Arcade expressions: ready-made templates, a check against the layer's fields, popups, labels and Field Maps form rules |
| `portal_app` | Apps from your maps and layers: Instant Apps, Dashboards, Experience Builder, StoryMaps, Survey123, Field Maps, Experience Builder Developer Edition |
| `portal_groups` | Search, create, update and delete groups |
| `portal_rest` | Any ArcGIS REST request with your sign-in |
| `portal_batch` | Up to 10 tool calls in one request, each reusing earlier results |

Deleting, bulk edits, public sharing and anything that spends credits ask for your confirmation first.

## Development

Building, running locally and deploying: [docs/ArcGIS-Web-MCP-Documentation.docx](docs/ArcGIS-Web-MCP-Documentation.docx).

---

Developed by [Ahmed Salah Muhammed](https://ahmedsalah-portfolio.vercel.app/), Full Stack Developer · GIS Developer
