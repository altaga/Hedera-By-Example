# MCP verification notes (2026-11-05)

Target: `https://hbe.expo.app/api/mcp` (Streamable HTTP, JSON-RPC 2.0). Server `hedera-by-example-mcp` v2.0.0.
Checked by hand with raw JSON-RPC requests (`Content-Type: application/json`, `Accept: application/json, text/event-stream`).

## Protocol
- `GET /api/mcp` returns `{status:"online", version:"2.0.0", tools:10, ...}`.
- `initialize` (protocol 2025-03-26) returns serverInfo, capabilities (tools, resources, prompts) and agent instructions.
- `notifications/initialized` returns 202. `ping` returns `{}`. Unknown method returns JSON-RPC error -32601.
- `resources/list` and `resources/read` (`hbe://guide/guardrails`) work.

## Tools (10, all working)
`search_labs`, `get_lab`, `list_labs`, `query_curriculum`, `anti_hallucination_rules`, `architecture_decision_tree`, `mirror_node_query`, `estimate_cost`, `query_knowledge`, `official_resources`.
- `mirror_node_query` needs `endpoint` (accounts, tokens, topics, transactions, contracts, ...) plus `id` for most endpoints; `transactions` without `id` returns a clear argument error. Tested live on testnet.
- `estimate_cost` takes `operations: [{type, count}]` (e.g. `hbar_transfer`, `token_create`) and prices them with the live exchange rate.
- Invalid input (unknown lab slug, path-like endpoint such as `../../etc`) returns `isError: true` with a readable message.

## Fixed in this PR
- `app/public/mcp/manifest.json` said version 1.0.0 and only listed `http://localhost:3001/mcp`. It now says 2.0.0 and lists the production endpoint.
- `app/public/mcp/tools.json` listed 6 of the 10 tools with older descriptions. It is now the live `tools/list` output.

## Fixed after review
- `query_knowledge` with a query that has no ecosystem entry (for example "hashscan") now falls back to the matching rows of the official resources table instead of returning nothing.

## Known gaps
- The stdio server `mcp/index.js` was not run in this check (dependencies not installed in the sandbox).
- PostHog events: `hbe_faucet_claimed` (faucet claim), `hbe_mcp_session_started` (each MCP `initialize`) and `hbe_mcp_tool_called` (every `tools/call`: tool, is_error, duration_ms, lab_slug for `get_lab`, query_length; the query text itself is never sent). Lab views in the browser are not tracked.
- How MCP callers are told apart (`app/src/server/mcpIdentity.ts`): `initialize` returns an `Mcp-Session-Id` (Streamable HTTP transport) that carries the client's `clientInfo` name and version; compliant clients send it back, so `distinct_id = mcp:<session>` is one MCP connection and `client_name` / `client_version` come from `clientInfo`, not the User-Agent. Clients that ignore sessions get `mcp-anon:<hash>`, a SHA-256 of IP + User-Agent + UTC date (+ optional `MCP_ANALYTICS_SALT`) that changes every day; the IP is never sent or stored. Each event says which one applied in `id_source` (`session` or `daily_hash`).

## Faucet context for the next reviewer (updated 2026-11-05)
- The earlier suspicion that the secrets were invalid was wrong. Production deploys must use `eas deploy --prod --environment production`; without the flag the server gets no env vars, which made the pool look empty.
- `ACTION_FAUCET_MNEMONIC` in GitHub is the same mnemonic as the EAS production `FAUCET_MNEMONIC` (checked with the `check-faucet-mnemonic.yml` workflow). It was stored with surrounding quotes, which the recovery scripts now strip.
- `recover-faucets.yml` passes: 25 pool wallets, default `count` is 25.
- Operator account `0.0.11296718` (EVM twin `0.0.11296890`); Welcome Drop is 25 HBAR.

## Audit fixes (2026-11-05, second pass)
- **Dead links:** 21 docs.hedera.com / GitHub URLs that returned 404 were replaced with their current pages (docs moved to `/learn`, `/native`, `/evm`, `/solutions/tokenization/...`; `hashgraph/hedera-json-rpc-relay` → `hiero-ledger/hiero-json-rpc-relay`; `hashgraph/scaffold-hbar` → `hedera-dev/scaffold-hbar`; ATS repo → `hashgraph/asset-tokenization-studio`) in the catalog, resources doc, lab refs and course sources. Every external URL the MCP serves is curl-checked (200, or 403/405 from bot-blocking/POST-only endpoints).
- **Faucet figure:** the Portal faucet gives 100 HBAR per rolling 24 h (docs.hedera.com/learn/getting-started/testnet-faucet and faucet-api), not "10,000 ℏ daily".
- **estimate_cost:** `count` (and `gas`, 1–15,000,000, contracts only) must be a positive integer; otherwise `isError` with a clear message. `network` must be `testnet` or `mainnet`. Gas is added to the USD and HBAR totals; without `gas` the total is labelled incomplete.
- **mirror_node_query:** `network` must be exactly `testnet`, `mainnet` or `previewnet` (no silent fallback). Mirror 4xx/5xx and timeouts (10 s) return `isError: true`. `next` accepts only the relative `links.next` of the same endpoint/id/sub (no absolute URLs). Regression tests: `npx tsx tests/06_mcp_service_fixes.test.ts` (HTTP dispatcher) and `node tests/08_mcp_stdio_parity.test.mjs` (local stdio server: real stdin/stdout handshake, manifest parity, same fixes; offline Mirror Node mock).
- The local stdio server (`mcp/index.js`) shares the same guardrails, tool schemas and network/error/gas/pagination behavior as the hosted endpoint.
- **query_curriculum:** empty `query` returns `isError` (same as `search_labs`).
- **architecture_decision_tree:** `focus` matches section titles first, then ranks sections by mentions (top 4); no match returns a "no section matches" message with the list of sections.
- **official_resources:** no match returns "No official resource matches" with the category list instead of an empty table.
- **Spanish output:** lab labels are translated (Concepto, Momento clave, Ejecútalo en el navegador, …); the content build now reads `Laboratorio NN:` titles and `[CONCEPTO]` kickers, fixing 21 Spanish titles that were auto-generated from filenames and 131 empty Spanish kickers.
