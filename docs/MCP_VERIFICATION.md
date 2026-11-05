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

## Known gaps (not changed here)
- `query_knowledge` with the query "hashscan" finds nothing (the knowledge catalog has no entry for it); "payments" works.
- The stdio server `mcp/index.js` was not run in this check (dependencies not installed in the sandbox).
- The MCP server sends no analytics. The only PostHog event in the repo is `hbe_faucet_claimed`, emitted by the faucet on a successful claim (`app/src/server/faucetService.ts` via `posthogAnalytics.ts`). Lab runs and MCP calls are not tracked.

## Faucet context for the next reviewer
- GitHub workflow `recover-faucets.yml` fails: secret `ACTION_FAUCET_MNEMONIC` is not a valid BIP-39 phrase.
- Production `/api/faucet/health` returned `samplePoolBalances: []` and `uniqueUsersCount: 0`, so the EAS `FAUCET_MNEMONIC` may also be invalid or unset, and the PostHog keys (`HBE_HOG_API_KEY` / `HOG_API_KEY`, `HOG_PERSONAL_API_KEY`, project id) may be missing. Not confirmed (no access to runtime logs or secret values).
- Operator account `0.0.11296718` (EVM twin `0.0.11296890`); pool is 25 wallets derived from the mnemonic; Welcome Drop is 25 HBAR.
