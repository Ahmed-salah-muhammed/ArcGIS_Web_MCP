# ArcGIS Web MCP

A remote [MCP](https://modelcontextprotocol.io) server on **Cloudflare Workers** for **ArcGIS Online / ArcGIS
Enterprise**. Anyone can connect an MCP client (Claude, Claude Code, MCP Inspector, ...) to one HTTPS URL and
sign in with **their own ArcGIS account** (OAuth 2.0 + PKCE). The tools act with that user's permissions; there is
no shared account and nothing to install.

It is the web companion of [ArcGIS Pro Salah MCP](https://github.com/Ahmed-salah-muhammed/ArcGIS-Pro_Salah_MCP)
(local, Python, ArcPy): same tool names and the same `{"ok": ..., "data": ...}` results, without ArcGIS Pro.

## Tools (v0.2)

| Tool | What it does |
| --- | --- |
| `portal_whoami` | The signed-in user: username, role, user type, org, platform, what the account can do |
| `portal_search` | Search items (ArcGIS query syntax, exact `item_type`, `owner: "me"`, tags, paging with `next_start`) |
| `portal_item` | `get` (card, sharing, every layer/table of a service) / `data` (its JSON) / `update` / `move` / `protect` / `unprotect` / `delete` / `dependencies` |
| `portal_folders` | `list` / `create` / `delete` your folders |
| `portal_share` | Sharing level (`private` / `org` / `everyone`) and groups, with before/after per item |
| `portal_publish` | A hosted feature layer from CSV text (lat/lon or addresses), GeoJSON text, a public https URL, or an uploaded item |
| `portal_layer_query` | `describe` (fields, domains, capabilities, count) / `query` (paged rows, dates as ISO UTC) / `count` / `stats` (`"sum:POP"`, `group_by`) |
| `portal_layer_edit` | `edit` (adds / updates / deletes, batched, `dry_run` diff) / `calculate` / `truncate` |
| `portal_layer_schema` | `add_field` / `delete_field` / `capabilities` / `renderer` (built from the data) / `labels` / `create_view` (filtered, read-only) |
| `portal_map` | Web maps: `create` / `describe` / `add_layers` / `remove_layers` / `popup` / `renderer` / `filter` / `basemap` |
| `portal_groups` | `search` / `get` (members, items) / `create` / `update` / `delete` |
| `portal_rest` | Raw ArcGIS REST with your sign-in for anything else (GET free; POST writes need `confirm`) |

### Confirmation rail

Anything irreversible, bulk, public or credit-spending answers `{"ok": false, "code": "confirm_required",
"preview": ..., "hint": ...}` and does nothing until it is called again with `confirm: true`: deleting items,
folders, groups, fields or features; `calculate`; `truncate`; sharing with everyone; public groups; publishing by
address (geocoding credits, estimated in the preview); any `portal_rest` POST that is not read-only. The model is
expected to show the preview to the user and ask. Delete-protected items are refused even with `confirm`.

## How sign-in works

```
MCP client ──/authorize──▶ consent page (CSRF-protected)
          ──approve──▶ ArcGIS /oauth2/authorize (code + PKCE S256, no client secret)
ArcGIS ──/callback──▶ Worker exchanges the code (verifier kept server-side) and reads /community/self
Worker ──▶ MCP client gets its own token; the ArcGIS tokens stay encrypted in the grant (workers-oauth-provider)
```

ArcGIS access tokens live ~30 minutes. The Worker gives MCP clients tokens that expire a bit earlier, and on each
client refresh it renews the ArcGIS token with the ArcGIS refresh token (2 weeks by default). When that expires
or is revoked, the client is asked to sign in again.

## Set up (local)

1. **Register OAuth credentials in your ArcGIS portal**: ArcGIS Online → *Content* → *New item* → *Developer
   credentials* → *OAuth 2.0 credentials* (older Enterprise: *Register application*). Add the redirect URL
   `http://localhost:8788/callback` and copy the **client ID**. No client secret is used.
2. `cp .dev.vars.example .dev.vars` and fill in `ARCGIS_CLIENT_ID` and a random `COOKIE_ENCRYPTION_KEY`.
   `.dev.vars` is gitignored.
3. `npm install`, then `npm run dev` → `http://localhost:8788/mcp`.
4. Connect a client:
   - Claude Code: `claude mcp add --transport http arcgis-web http://localhost:8788/mcp` (a browser opens for sign-in)
   - MCP Inspector: `npx @modelcontextprotocol/inspector@latest`, transport *Streamable HTTP*, URL above.

## Deploy (Cloudflare free plan)

```bash
npx wrangler login
# a file OUTSIDE the repo with ARCGIS_CLIENT_ID=... and a NEW random COOKIE_ENCRYPTION_KEY=... (.env format)
npx wrangler deploy --secrets-file ../prod-secrets.env
```

The secrets are uploaded with the code (a deploy fails while a required secret is missing); delete the file
afterwards. `wrangler.jsonc` has no KV id on purpose: the first deploy provisions the namespace and writes its id
back into the file. Then add `https://arcgis-web-mcp.<your-subdomain>.workers.dev/callback` as a redirect URL of
the OAuth credentials.

## Connect a client

The server URL is `https://arcgis-web-mcp.<your-subdomain>.workers.dev/mcp`. The first call opens a browser for
the ArcGIS sign-in.

- **Claude (desktop / web)**: *Settings* → *Connectors* → *Add custom connector* → paste the URL.
- **Claude Code**: `claude mcp add --transport http arcgis-web https://arcgis-web-mcp.<your-subdomain>.workers.dev/mcp`
- **VS Code, Cursor and other MCP clients**: add an HTTP (Streamable HTTP) server with that URL.
- **Clients without remote-server support**: `npx mcp-remote https://arcgis-web-mcp.<your-subdomain>.workers.dev/mcp`
  as a local stdio command.

**Credit**: `AUTHOR` in `src/pages.ts` (name, title, portfolio link; the photo is `src/avatar.ts`) is the developer
shown as "Developed by" on the landing page (`/`), the sign-in approval page and the "connected" page after the
ArcGIS sign-in, and sent to every MCP client in the server info (`title`, `description`, `websiteUrl`) and
instructions. The "connected" page names whichever MCP client is connecting; Claude gets an orange button.

**Enterprise**: set `ARCGIS_PORTAL_URL` (e.g. `https://gis.example.com/portal`) in `wrangler.jsonc`. The portal
must be reachable from the internet; federated servers on another host go in `ARCGIS_EXTRA_HOSTS`.

## Security

- Every tool acts with the signed-in user's own ArcGIS permissions; the Worker cannot do anything the user cannot.
- Writes go through the confirmation rail above. Each write logs one JSON line (`{"audit": {time, user, portal,
  tool, action, target, ok}}`, never a token) to the Worker's logs, which the **deployment's owner can read**
  (`wrangler tail` / Workers Logs). Anyone running a public instance should say so to their users.
- The user's token is only ever sent to the portal host, ArcGIS Online's `*.arcgis.com` service hosts (when the
  portal is ArcGIS Online) and `ARCGIS_EXTRA_HOSTS`, over HTTPS. Any other URL is refused before a request is made.
- Tokens go in request bodies (never URLs), are never returned to clients, and are scrubbed from error messages.
- Nothing personal lives in this repo: the client ID, cookie key and KV id are local `.dev.vars` / Worker secrets.

## Limits

Cloudflare's free plan allows 100,000 requests a day and 10 ms of CPU per request; time spent waiting for ArcGIS
does not count. A Worker call may also make at most 50 subrequests. To stay inside that:

- `portal_layer_query` returns at most 1,000 rows per call (50 by default) and no geometry unless asked; page with
  `offset` / `next_offset`.
- `portal_layer_edit` takes at most 5,000 edits and 30 batches per call (`batch_size` default 500).
- `portal_publish` takes up to 5 MB of CSV / GeoJSON text; upload bigger files in ArcGIS Online and publish them
  with `item_id`. It waits up to ~60 s for the publish job, then returns its status.

## What was verified

Every tool ran end to end through a real MCP client (OAuth sign-in, Streamable HTTP) against ArcGIS Online with
throwaway private items that were deleted afterwards (53 checks): folders; publishing CSV text by coordinates
(upload → analyze → publish → job status, ~10 s); describe / query / stats; add and delete fields; adds (with a
WGS84 geometry), updates, `dry_run` diffs, deletes by `where`; `calculate`; class-breaks renderer; labels; a
filtered view (`POP > 40` → 4 of 8 rows, fields hidden); a web map (create, add/remove layers, popup, renderer,
filter, gallery basemap); item update / protect / move / dependencies; a private group with share and unshare;
`portal_rest`; and every refusal (confirm, protected, view schema, foreign hosts).

Facts that shaped the code:

- A CSV sent as item `text` cannot be analyzed or published; it has to be a multipart file upload.
- A layer published from CSV names its object-id field `ObjectId`; the tools always read `objectIdField`.
- Renaming a folder (`updateFolder`) rejected every parameter tried, so it is not offered.
- Deleting a layer that has views fails with "has a related Service item": delete the views first. Views are not
  listed by `dependencies` (they are linked through a service-to-service relationship).
- `updateDefinition` replaces `drawingInfo` as a whole, so renderers and labels are merged into the current one.

## Develop

```bash
npm test             # vitest: PKCE, OAuth, host allowlist, every tool's logic and confirm rail (fake ArcGIS)
npm run type-check   # tsc --noEmit
npm run cf-typegen   # regenerate worker-configuration.d.ts after changing wrangler.jsonc
```

Layout: `src/index.ts` (OAuthProvider + MCP handler + token refresh), `src/arcgis-handler.ts` (sign-in flow),
`src/arcgis.ts` (ArcGIS REST + OAuth + PKCE + allowlist), `src/portal.ts` (read tools), `src/content.ts` (items,
folders, sharing, publishing), `src/layer-writes.ts` (edits, schema, renderers, views), `src/maps.ts` (web maps),
`src/groups.ts`, `src/rest.ts`, `src/safety.ts` (confirm rail, audit, limits), `src/tools.ts` (tool
registration), `src/workers-oauth-utils.ts` (consent page, CSRF, state - from Cloudflare's remote-mcp-github-oauth
demo).
