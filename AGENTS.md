# Repository guidance

## Runtime and request flow

- This is one Cloudflare Worker, not a browser or conventional Node server. `wrangler.jsonc` points to `src/index.ts`; `/mcp` is the remote MCP endpoint, while the Hono fallback in `src/auth/handler.ts` serves OAuth, documentation, callback, and contact routes.
- The Worker is both an OAuth server for MCP clients and a PKCE OAuth client of ArcGIS. Each grant carries one user's ArcGIS tokens in encrypted provider props; tools must always act with that user's permissions.
- `src/arcgis.ts` owns ArcGIS OAuth/REST and token-host safety. `src/tools/index.ts` registers tools, `src/tools/shared/` holds cross-tool rails, `src/prompts.ts` holds the MCP prompts, and `src/pages/` is the public documentation site.

## Setup and verification

- Use Node.js 22+ and `npm ci`.
- Local development needs `.dev.vars` copied from `.dev.vars.example`. Wrangler requires all four listed secrets, including the two contact-form/Resend secrets. Register `http://localhost:8788/callback` in the ArcGIS OAuth app, then run `npm run dev`; docs are at `/` and MCP at `/mcp`.
- Match CI order before finishing: `npm run type-check`, then `npm test`. There is no configured lint or format command.
- Run one test file with `npm test -- test/tools/portal_map.test.ts` (replace the path as needed). Tests run in Node with fake requests; they need neither network access nor an ArcGIS account.
- After changing Wrangler vars or bindings, run `npm run cf-typegen`; `worker-configuration.d.ts` is generated and must not be hand-edited.
- Deployment with local secrets is `npx wrangler deploy --secrets-file .dev.vars`. A fork must change the Worker name and remove the committed KV namespace `id` before its first deploy.

## Tool changes

- A tool folder normally has `index.ts` for its name, description, Zod schema, annotations, and handler wiring, plus `handler.ts` for behavior. Register new tools in `src/tools/index.ts`; entries in `BATCHABLE` are also callable through `portal_batch`.
- Keep `src/pages/docs.ts` synchronized with every tool and every `action` enum. `test/pages.test.ts` enforces exact parity. Also update the public tool table in `README.md`, which is not covered by that test.
- Tool handlers return domain data or throw `ArcGISError`; `shared/mcp.ts` alone converts that to the MCP `{"ok":...,"data"/"error":...}` envelope and scrubs secrets.
- Use 32-hex item IDs internally; titles are not unique. Reuse `requireId`, `resolveLayerUrl`, folder/group resolvers, and other helpers in `src/tools/shared/lookup.ts` rather than adding looser lookup behavior.

## Security and operational invariants

- Never make authenticated ArcGIS calls with raw `fetch`. Go through `Ctx`: `request` sends the token in a POST body, `get` sends it in `X-Esri-Authorization`, `upload` handles multipart, and `public*` methods deliberately send no token. This also counts Cloudflare subrequests.
- Validate every user- or item-supplied service URL with `requireAllowed`/`hostAllowed` before a token-bearing call. Only HTTPS portal/service hosts and explicit `ARCGIS_EXTRA_HOSTS` are allowed; never put a token in a URL or returned error.
- ArcGIS frequently returns an error object with HTTP 200. Preserve body-based error handling in `src/arcgis.ts` rather than relying on `Response.ok`.
- Every write must emit `audit(...)`. Irreversible, bulk, public-sharing, or credit-spending work must call `requireConfirm(...)` with a useful preview before any side effect; `confirm_required` means nothing changed.
- Multi-item/app creation must clean up partial items via `orRemove`/`cleanup`. Keep the request-budget reserve available for that cleanup.
- One normal tool call gets a fresh request budget; all calls inside `portal_batch` share one. The default is 50 subrequests with 3 reserved for cleanup, and a batch is capped at 10 calls.
- `makeCtx` remembers parameterless reads of an item, a service, a layer and `portals/self` for the length of one call, and forgets them at the first request that is not a known read. A new write operation needs nothing; a new read-only operation that should keep the memo goes in `READ_OPS` in `src/tools/shared/context.ts`.
- Every ArcGIS request has a deadline (`withTimeout`); one refused with 429 is retried once, and the retry counts against the budget. Do not add retries of writes after a timeout or a 5xx: the write may have happened.
- Poll ArcGIS jobs with `pollJob`, and run independent steps with `mapLimit` (both in `src/tools/shared/jobs.ts`) rather than new loops. A step that changes several items checks `ctx.budget.left()` first and refuses the whole call if it cannot finish.
- Tool descriptions and schemas are sent to the model in every conversation. Keep them short and put long per-option detail where it is read on demand (as `portal_app` does with `action=templates` and `guide.ts`).
- Results that can be large are capped by size as well as by count (`capRows`, `max_chars`), and say so when they are cut.
- `registerTools` logs one `call` line per tool call (tool, action, ok, duration, requests) through `logCall`. Never log arguments or results.
- App builders encode ArcGIS item JSON measured from real items or the ArcGIS API for Python. Do not invent unsupported Dashboard, StoryMaps, Survey123, or Experience Builder shapes; leave unverified capabilities to the native builder and cover verified shapes with fixture-based tests.

## Versioning

- Keep the version synchronized in `package.json`, `package-lock.json`, and `src/pages/identity.ts`; the latter is shown on pages and in MCP server metadata.
