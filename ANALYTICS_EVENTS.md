# Hedera analytics schema v1

One event format for every app that writes to the shared PostHog project:
**Hedera Atlas** (`hedera-atlas`), **Hedera for Dummies** (`hfd-wallet`) and **Hedera by Example** (`hedera-by-example`).

This file and `src/lib/analyticsSchema.ts` are **byte-identical in the three repos**. A change to the
format is made in one repo, copied to the other two, and lands in all three. The code is the source of
truth for the catalog (`ANALYTICS_EVENTS`); this file explains it.

---

## 1. Rules

1. **Event names** are `object_action` in snake_case, action in the past tense, **no app prefix**
   (`chat_turn_completed`, not `atlas_chat_turn_metrics`). The `app` property says who sent it, so the
   same event can be compared across apps (`tool_called` broken down by `app`).
2. **Failures** are their own event, `object_action_failed`, with an `error_code` from the shared list
   (§5). Success events never carry `is_error` / `success` flags.
3. **Property keys** are snake_case (`account_id`, never `accountId`). Keys starting with `$` are set
   only by the server (geo, `$process_person_profile`).
4. **One event per fact.** Never send the same fact twice under two names ("dual-emit"). Old names live
   only in the catalog's `legacy` list, for queries over history.
5. **Only catalog events are sent.** `trackServerEvent` / `/api/analytics` reject names not in
   `ANALYTICS_EVENTS` for that app. Adding an event = add it to the catalog (all three repos) + §6.
6. **Every event is captured server-side** through the app's own server (never `posthog-js` straight
   to PostHog, never `HOG_API_KEY` in the browser). The server sets the envelope (§2); a client can't
   override it.
7. **No PII.** Never names, emails, phone numbers, company names, keys, mnemonics or tokens — leads
   send flags and enums only (`has_company`, `industry`). `sanitizeProperties()` drops the known keys.
8. **Test traffic never reaches PostHog.** The server drops the event when the request carries the
   app's test API key, or the properties have `is_test: true`. Test-only events (`*_test_ping`,
   `*_probe`) are not allowed in production at all. **Bots don't count either**: on browser
   surfaces the server drops the event when the request's User-Agent is a crawler, link-preview
   bot, screenshot bot, headless browser, uptime checker or HTTP library (`isBotUserAgent()`).
   API/MCP events are exempt: those clients are programs by design.
9. **Analytics are never blocking and never break the app.** No request, page or user action waits
   on PostHog or fails because of it: callers don't await the track call, every error is caught
   and only logged, the PostHog `fetch` has a 5 s timeout (`AbortSignal.timeout`), the analytics
   route answers before sending, and analytics-only input (e.g. a quick-prompt id) is dropped when
   invalid instead of rejecting the request.
10. **Never fire-and-forget on the server.** A `fetch` to PostHog that isn't awaited is frozen when a
   serverless function returns: before v1 this lost ~3-10% of Atlas events. Send inside Next's
   `after()` (or the platform's `waitUntil`), or await it. Browser → `/api/analytics` calls use
   `fetch(..., { keepalive: true })`.

## 2. Envelope — on every event, set by the server

| Property | Type | Values / example | Notes |
|---|---|---|---|
| `schema_version` | number | `1` | Bump only on a breaking change to this file |
| `app` | string | `hedera-atlas` \| `hfd-wallet` \| `hedera-by-example` | |
| `service` | string | Atlas: `web` `chat` `decision_brief` `hackathon` `ethonline` `leads` · HFD: `web` `wallet` `faucet` `contracts` `chat` `nft` `admin` `leads` · HBE: `web` `mcp` `faucet` | Part of the app that sent it |
| `origin` | string | `client` \| `server` | `client` = a user action relayed by `/api/analytics` |
| `app_version` | string | `1.0.158+abc1234` | `package.json` version + short `VERCEL_GIT_COMMIT_SHA` |
| `env` | string | `production` \| `preview` \| `development` | **Only** from `VERCEL_ENV`; anything off Vercel is `development` |
| `network` | string \| null | `testnet` \| `mainnet` \| `null` | Hedera network; `null` for apps without one (Atlas) |
| `distinct_id` | string | see §3 | Also the top-level `distinct_id` of the capture call |
| `id_source` | string | `wallet` \| `device` \| `session` \| `daily_hash` \| `none` | How `distinct_id` was obtained |
| `lang` | string \| null | `es` | UI locale when known |
| `country`, `$geoip_country_code` | string | `MX` | From `x-vercel-ip-country` / `cf-ipcountry` (no GPS) |
| `$ip` | string | | Client IP from forwarded headers; private IPs omitted |

`timestamp` goes at the top level of the capture payload (ISO-8601 UTC), not inside `properties`.

Capture call (`POST https://us.i.posthog.com/capture/`):

```json
{
  "api_key": "<HOG_API_KEY>",
  "event": "transaction_sent",
  "distinct_id": "0x031cfdd27b43a2b059a73af65ae14cb46a35b0b8",
  "timestamp": "2026-11-11T18:00:00.000Z",
  "properties": {
    "asset": "HBAR", "amount": 5, "destination": "0.0.1234", "tx_id": "0.0.98@1762884000.000000000",
    "evm_address": "0x031cfdd27b43a2b059a73af65ae14cb46a35b0b8", "account_id": "0.0.5005",
    "schema_version": 1, "app": "hfd-wallet", "service": "wallet", "origin": "client",
    "app_version": "1.0.159+abc1234", "env": "production", "network": "testnet",
    "distinct_id": "0x031cfdd27b43a2b059a73af65ae14cb46a35b0b8", "id_source": "wallet",
    "lang": "es", "country": "CO", "$geoip_country_code": "CO", "$ip": "187.13.11.15"
  }
}
```

## 3. Identity (`distinct_id`)

`resolveIdentity()` applies one order everywhere:

1. **Wallet** — lowercase EVM address; if there is none, the Hedera account id (`0.0.x`). `id_source: wallet`.
   Wallet apps also send both ids as plain properties `evm_address` and `account_id` (null when unknown).
2. **Device** — anonymous UUID v4 stored per browser (Atlas: cookie `atlas_metrics_uid`; HFD:
   `localStorage.hfd_analytics_device_id`; HBE: its web visitor UUID). `id_source: device`.
3. **Server pseudonymous id** — for callers with no browser (HBE MCP): an already-prefixed id such as
   `mcp:<session hash>` (`id_source: session`) or `mcp-anon:<daily hash>` (`id_source: daily_hash`).
4. **Nothing known** — a random `anon:<uuid>` per event with `$process_person_profile: false`
   (`id_source: none`). **Never a shared constant** (`anonymous`, `atlas_anonymous_user`): it merges
   every unknown visitor into one person and corrupts unique-user counts.

For unique users, count `distinct_id` and filter `id_source != 'none'`.

## 4. Shared property names

Use these exact names whenever the concept appears, in any app:

| Concept | Property | Notes |
|---|---|---|
| Wallet | `evm_address`, `account_id` | lowercase `0x…`; `0.0.x` |
| Asset / amount | `asset`, `amount` | `asset`: `HBAR`, `USDC`, … `amount` in whole units (not tinybars) |
| Transaction | `tx_id` (Hedera `0.0.x@s.n` or hash shown to the user), `tx_hash` (EVM `0x…`) | |
| HCS / tokens | `topic_id`, `token_id`, `serial` | |
| Smart contracts | `contract_id`, `function_name` | `contract_id` as the app addresses it (`0x…` or `0.0.x`) |
| Links | `link_id`, `link_host` | stable id of the link, host only (never the full URL) |
| Entry / UI origin | `entry_point`, `prompt_id`, `quick_prompt_id` | `prompt_id`: stable id of a quick prompt (same in every locale), never its text |
| Retries | `attempts` | number of tries before success/failure |
| Tool / agent | `tool_name`, `execution_mode` | `tool_name` (never `tool`); `execution_mode` (never `loop_iteration`) |
| LLM usage | `model_id`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost_usd_prompt`, `cost_usd_completion`, `cost_usd_total`, `usage_source` | `usage_source`: `model` \| `estimated` |
| Tokens fed from tools | `llm_context_tokens_estimated` | never `context_tokens_estimated` |
| Timing | `duration_ms` | |
| Leads | `lead_source`, `builders_program`, `has_company`, `has_mainnet_id`, `industry`, `audience`, `job_function`, `pain`, `horizon` | Enums/flags only |
| MCP client | `client_name`, `client_version`, `protocol_version` | |
| Page | `path`, `view`, `referrer`, `screen_width`, `screen_height` | |
| Errors | `error_code` | §5 — only on `*_failed` events |

## 5. `error_code`

`normalizeErrorCode()` maps any error onto: `INSUFFICIENT_BALANCE`, `INVALID_INPUT`, `NOT_FOUND`,
`UNAUTHORIZED`, `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`, `UPSTREAM_ERROR`, `UNKNOWN`.
Never send the raw error message.

## 6. Event catalog

Origin: **S** = emitted by the app's server, **C** = sent by the browser through the app's
`/api/analytics` (which only accepts the C events of that app; S events can't be forged).

### Shared

| Event | Apps | Origin | Legacy names | Event properties |
|---|---|---|---|---|
| `page_viewed` | Atlas, HFD, HBE | C | `hbe_page_viewed` | `view`, `path`, `referrer` (origin only, never the full URL), `screen_width`, `screen_height`; HBE + `lab_slug` |
| `external_link_opened` | Atlas, HFD | C | — | `link_id`, `link_host`, `entry_point` |
| `lead_created` | Atlas, HFD | S | `atlas_lead_created`, `hfd_lead_created` | `lead_source`, `builders_program`, `has_mainnet_id`, `industry`, `audience`; Atlas + `has_company`, `pain`, `horizon`; HFD + `job_function` |
| `lead_create_failed` | Atlas (S), HFD (C) | S/C | — | `error_code` (`INVALID_INPUT` for validation), `error_key` |
| `faucet_claimed` | HFD, HBE | C/S | `hbe_faucet_claimed` | `asset` (`HBAR`), `amount`, `tx_hash`, `evm_address`, `account_id` |
| `faucet_claim_failed` | HFD, HBE | C/S | — | `asset`, `amount`, `error_code` (not sent for a cooldown) |
| `tool_called` | Atlas, HBE | S | `atlas_tool_call`, `agent_tool_called`, `hbe_mcp_tool_called` | `tool_name`, `execution_mode`; Atlas + token attribution: `llm_context_tokens_estimated`, `card_count`, `times_included_in_llm`, `attributed_prompt_tokens`, `nested_llm_prompt_tokens`, `nested_llm_completion_tokens` (pre-v1 these were on the separate `atlas_tool_call_metrics`); HBE + `client_name`, `client_version`, `duration_ms`, `query_length`, `lab_slug` |
| `tool_call_failed` | HBE | S | — (was `hbe_mcp_tool_called` with `is_error: true`) | as `tool_called` + `error_code` |

### Hedera Atlas

`service`: `web` (page views, links), `chat`, `decision_brief`, `hackathon`, `ethonline`, `leads`.

| Event | Origin | Legacy names | Event properties |
|---|---|---|---|
| `chat_turn_completed` | S | `atlas_chat_turn_metrics` | `execution_mode`, `synthesis_path`, `brainstorm_pipeline_used`, `tool_count`, `card_count`, `tools`, `quick_prompt_id`, `tool_context_tokens_estimated`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `grand_total_tokens`, `llm_call_count`, `usage_source`, `cost_usd_prompt`, `cost_usd_completion`, `cost_usd_tool_context_est`, `cost_usd_total`, `cost_is_estimated`, `model_id`, `billable_only`; brainstorm turns + `brainstorm_pass_count`, `brainstorm_model_id`, `brainstorm_prompt_tokens`, `brainstorm_completion_tokens`, `brainstorm_total_tokens` (pre-v1: separate `atlas_brainstorm_pipeline_completed`). Also the `/ethonline2026` judge chat (`service: ethonline`, `execution_mode: ethonline_judge`) |
| `chat_turn_failed` | S | — | `error_code` |
| `chat_cleared` | S | — | (envelope only) |
| `quick_prompt_used` | S | — (same name pre-v1, keyed by `prompt_value` text) | `prompt_id` (`bestToolStack`, `analyzeRepository`, `exploreEcosystem`, `brainstormIdeas`), sent with the completed turn. The Decision Brief prompt opens the wizard instead: `decision_brief_started` with `entry_point: welcome` |
| `llm_call_completed` | S | `atlas_llm_call` | `label`, `parent_tool`, `model_id`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `usage_source`, `cost_usd_prompt`, `cost_usd_completion`, `execution_mode` |
| `related_projects_viewed` | S | — | `corpus_source`, `record_kind`, `result_count` |
| `decision_brief_started` | C | — | `entry_point` (`welcome` \| `chat` \| `web` \| link `src`) — the wizard was opened |
| `decision_brief_completed` | S | `fiveq_completed` (pre-v1 the data rode on `atlas_tool_call_metrics` with `tool_name = themis_decision_brief`) | `entry_point`, `industry`, `audience`, `pain`, `horizon`, `assets_count`, `blockchain_need`, `primary_products`, `draft_valid`, `final_valid`, `section_count`, `product_mentions`, `duration_ms` |
| `decision_brief_failed` | S | — | `entry_point`, `error_code`, `duration_ms` |
| `decision_brief_exported` | C | — | `format` (`pdf`) |
| `hackathon_project_judged` | S | — (was `atlas_tool_call_metrics` with `tool: batch_judge`) | `tool_name` (`apollo_project_judge` single repo \| `batch_judge`), `project_name` or `repo_url`, `track`, `has_rubric`, `entry_point`, `gate`, `final_score`, `total_tokens`, `duration_ms` |
| `hackathon_judge_failed` | S | — | `tool_name`, `project_name` or `repo_url`, `track`, `error_code`, `duration_ms` |

### Hedera for Dummies

`service`: `web` (page views, links), `wallet`, `faucet`, `contracts`, `chat`, `nft`, `admin`, `leads`.
Every HFD event also carries `evm_address` and `account_id` (§3). All are C except `lead_created`.
`page_viewed.view`: `setup`, `dashboard`, `chat`, `transfer`, `nfts`, `contracts`, `contact`, `admin`.

| Event | Event properties |
|---|---|
| `wallet_created` | (identity only) |
| `account_activated` | `account_id` — the wallet got its Hedera account id in this browser (legacy `wallet_linked`) |
| `account_setup_completed` | `tx_id`, `attempts` — auto-associations + USDC association done |
| `account_setup_failed` | `attempts`, `error_code` |
| `contract_called` | `contract_id`, `function_name` (`touch`), `tx_id` |
| `contract_call_failed` | `contract_id`, `function_name`, `error_code` |
| `transaction_sent` | `asset`, `amount`, `destination`, `tx_id` |
| `transaction_send_failed` | `asset`, `amount`, `error_code` |
| `message_sent` | `topic_id`, `tx_id` |
| `message_send_failed` | `topic_id`, `error_code` |
| `topic_created` | `topic_id`, `tx_id` |
| `topic_create_failed` | `error_code` |
| `topic_joined` | `topic_id` |
| `nft_claimed` | `token_id`, `serial`, `tx_id` |
| `nft_claim_failed` | `token_id`, `error_code` |
| `raffle_winners_posted` | `total_winners`, `parts` |

### Hedera by Example

| Event | Legacy names | Event properties |
|---|---|---|
| `mcp_session_started` | `hbe_mcp_session_started` | `client_name`, `client_version`, `protocol_version` |

(plus `page_viewed`, `faucet_claimed`, `faucet_claim_failed`, `tool_called`, `tool_call_failed` above)

### Removed in v1 (one fact = one event)

| Pre-v1 / early-v1 event | Now |
|---|---|
| `atlas_tool_call_metrics`, `tool_usage_measured` | merged into `tool_called` (Atlas) |
| `atlas_brainstorm_pipeline_completed`, `brainstorm_pipeline_completed` | `brainstorm_*` properties on `chat_turn_completed` |
| `hackathon_judge_invoked` (never received an event) | `hackathon_project_judged` / `hackathon_judge_failed` |
| `agent_tool_called`, `chat_turn_completed` duplicates of `atlas_tool_call` / `atlas_chat_turn_metrics` | gone |

## 7. Querying across the v1 cut-over

Events before v1 have no `schema_version` and use the legacy names and camelCase keys. To cover
history in HogQL, match both names and coalesce keys:

```sql
SELECT count(), uniq(distinct_id)
FROM events
WHERE event IN ('chat_turn_completed', 'atlas_chat_turn_metrics')   -- eventNamesWithLegacy()
  AND properties.app = 'hedera-atlas'
  AND properties.env = 'production'
  AND (properties.id_source IS NULL OR properties.id_source != 'none')
```

Notes on the cut-over:
- Before v1, Atlas also sent `chat_turn_completed` as a duplicate of `atlas_chat_turn_metrics`, and
  `agent_tool_called` as a duplicate of `atlas_tool_call`. For pre-v1 data count **only**
  `atlas_chat_turn_metrics` / `atlas_tool_call`, or totals double.
- Before v1, HFD's `env` held the network (`testnet`); v1 moves it to `network`. Pre-v1 HFD events
  have no deployment env — treat them as production.
- Before v1, HFD's `distinct_id` was `accountId` when known, else `evmAddress`; v1 always prefers the
  EVM address, so a returning user may appear under two ids across the cut-over.

### PostHog actions and insights (2026-11-11, tag `analytics-schema-v1`)

Every insight on these events was moved to an action that matches the v1 name **and** its legacy
names, so charts keep their history across the cut-over. New insights should use these actions too:

| Action | Matches |
|---|---|
| `v1 · chat_turn_completed` | `atlas_chat_turn_metrics` + `chat_turn_completed` **with `schema_version`** (pre-v1 `chat_turn_completed` was a duplicate) |
| `v1 · tool_called` | `atlas_tool_call` + `hbe_mcp_tool_called` (no error) + `tool_called` — `agent_tool_called` excluded (duplicate) |
| `v1 · tool_call_failed` | `hbe_mcp_tool_called` with `is_error = true` + `tool_call_failed` |
| `v1 · HBE MCP tool calls (all)` | every HBE MCP call, successful or failed |
| `v1 · llm_call_completed` | `atlas_llm_call` + `llm_call_completed` |
| `v1 · Atlas tool calls (token metrics)` | `atlas_tool_call_metrics` except `tool = batch_judge` + early-v1 `tool_usage_measured` + v1 `tool_called` (Atlas) |
| `v1 · hackathon_project_judged` | `atlas_tool_call_metrics` with `tool = batch_judge` + `hackathon_project_judged` |
| `v1 · brainstorm turns` | `atlas_brainstorm_pipeline_completed` + v1 `chat_turn_completed` with `brainstorm_pipeline_used = true` |
| `v1 · decision_brief_completed` | `fiveq_completed` + `atlas_tool_call_metrics` with `tool_name = themis_decision_brief` + `decision_brief_completed` |
| `v1 · lead_created` / `(HFD)` / `(Atlas)` | `atlas_lead_created`, `hfd_lead_created`, `lead_created` (per app) |
| `v1 · page_viewed` | `hbe_page_viewed` + `page_viewed` |
| `v1 · faucet_claimed` | `hbe_faucet_claimed` + `faucet_claimed` |
| `v1 · mcp_session_started` | `hbe_mcp_session_started` + `mcp_session_started` |
| `v1 · account_activated` | `wallet_linked` + `account_activated` |

Dashboards also have v1 insights for the new events: HFD screens viewed, onboarding funnel
(setup → wallet → faucet → account activated → first transaction), failures by `error_code`,
external links; Atlas Decision Brief funnel (started → completed → exported → lead), quick
prompts, AI cost by surface (chat vs `/ethonline2026`), failures by `error_code`, views.

Renamed properties are read in insights with `coalesce(new, old)` (`client_name`/`client`,
`tool_name`/`tool`, `amount`/`amount_hbar`, `total_winners`/`totalWinners`,
`execution_mode`/`loop_iteration`, `prompt_id`/`prompt_value`). Unique-user series exclude `id_source = 'none'` and the pre-v1
shared ids `anonymous` / `atlas_anonymous_user` (21.7k Atlas events had been merged into that one
"person").
