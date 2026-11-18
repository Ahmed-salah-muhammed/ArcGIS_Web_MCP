# Copilot instructions

## Commands

- Requires Node.js 22+; install dependencies with `npm ci`.
- `npm run dev` starts Wrangler locally (docs at `/`, MCP endpoint at `/mcp`). Local auth needs `.dev.vars` based on `.dev.vars.example` and an ArcGIS OAuth callback registered at `http://localhost:8788/callback`.
- Run checks in CI order: `npm run type-check`, then `npm test`.
- Run one test file with `npm test -- test/tools/portal_map.test.ts` (replace the path as needed). Tests use fake ArcGIS requests and do not need an ArcGIS account or network.
- There is no configured lint script. `npm run cf-typegen` regenerates `worker-configuration.d.ts` after Wrangler binding or variable changes; do not edit that generated file by hand.

## Architecture

- This is a Cloudflare Worker, not a browser or conventional Node server. `wrangler.jsonc` points to `src/index.ts`, which combines the MCP endpoint (`/mcp`) with the OAuth provider.
- MCP clients authorize through this Worker, then sign in to ArcGIS through the PKCE OAuth flow in `src/auth/handler.ts`. ArcGIS tokens are kept in encrypted grant props; tool calls must use the signed-in user's permissions.
- `src/arcgis.ts` owns ArcGIS OAuth and REST request handling. `src/tools/index.ts` registers tool specs; each `src/tools/<tool>/index.ts` defines its schema and metadata, and its handler implements behavior. `src/tools/shared/` provides common request, lookup, safety, and response helpers.
- `src/pages/` serves the public documentation and identity pages through the Hono fallback. `src/pages/docs.ts` describes tools/actions. Tests in `test/` use Vitest and shared fake contexts from `test/helpers.ts`.

## Experience Builder widget handoff

- `portal_app` with `kind: "exb_widget"` returns a starter file bundle; it does not write to a local Developer Edition installation or implement the user's widget behavior.
- When continuing an `exb_widget` result or editing `client/your-extensions/widgets/**`, invoke `/arcgis-exb-widget-dev` before implementing the widget. Use the installed skill at `.github/skills/arcgis-exb-widget-dev/`.
- If the skill is not installed in the active workspace, follow the `install_instructions_url` in `agent_handoff`; if that is unavailable, inspect version-matched samples, implement the runtime/settings and contracts, add focused tests, and run the validation command in the hand-off.
- Read the actual Developer Edition `client/package.json` and pass its `exb-client.version` as `exb_version`; the MCP's default is only a fallback and cannot detect a local installation.
- If Developer Edition is outside the active workspace, ask the user to open/add its folder before writing the returned files.
- Finish Developer Edition widget work by running `npm run tscheck` from its `client/` directory, then verify the widget in Experience Builder.

## Repository-specific conventions

- Follow the root `AGENTS.md` for detailed setup and operational invariants. In particular, never send an ArcGIS token with raw `fetch`: use `Ctx` methods (`request`, `get`, `upload`, or deliberate `public*` methods). Validate user- or item-supplied service URLs with the existing host allowlist before authenticated requests. ArcGIS may return errors in HTTP 200 bodies, so preserve `src/arcgis.ts` body-based error handling.
- Reuse helpers in `src/tools/shared/lookup.ts`; item IDs are 32 hexadecimal characters and titles are not unique.
- Every write must call `audit(...)`. Irreversible, bulk, public-sharing, or credit-spending operations must call `requireConfirm(...)` with a preview before side effects. Multi-item creation must clean up partial results with existing cleanup helpers and preserve the request-budget reserve.
- Each ordinary tool call gets a fresh request budget. Calls inside `portal_batch` share one budget; the batch limit is 10 calls. Add a tool to `BATCHABLE` in `src/tools/index.ts` only when it should be callable from a batch.
- When changing tools or their `action` enums, update `src/pages/docs.ts` and the public tool table in `README.md`; `test/pages.test.ts` checks tool/action parity. Cover verified app-builder JSON shapes with fixtures rather than guessing unsupported ArcGIS formats.
- Keep the version synchronized in `package.json`, `package-lock.json`, and `src/pages/identity.ts`.
