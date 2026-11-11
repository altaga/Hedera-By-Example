// Type-stripped copy of app/src/lib/analyticsSchema.ts (Hedera analytics schema v1) for the
// plain-JavaScript faucet server. Generated with typescript.transpileModule: same logic and catalog.
/**
 * Hedera analytics schema v1 — one event format for every app that writes to the
 * shared PostHog project (Hedera Atlas, Hedera for Dummies, Hedera by Example).
 *
 * This file is byte-identical in the three repos. Change it in one, copy it to the
 * other two, and update ANALYTICS_EVENTS.md (the human-readable spec) in the same
 * commit. Framework-free on purpose: no Node, Next or Hono imports.
 */
export const ANALYTICS_SCHEMA_VERSION = 1;
/**
 * The catalog. Names are `object_action` (past tense), snake_case, no app prefix —
 * the `app` property says who sent it. Failures are `object_action_failed` with
 * `error_code`. An event outside this list is rejected.
 */
export const ANALYTICS_EVENTS = {
    // Shared across apps
    page_viewed: { apps: ['hedera-by-example', 'hedera-atlas', 'hfd-wallet'], legacy: ['hbe_page_viewed'] },
    external_link_opened: { apps: ['hedera-atlas', 'hfd-wallet'], legacy: [] },
    lead_created: { apps: ['hedera-atlas', 'hfd-wallet'], legacy: ['atlas_lead_created', 'hfd_lead_created'] },
    lead_create_failed: { apps: ['hedera-atlas', 'hfd-wallet'], legacy: [] },
    wallet_created: { apps: ['hfd-wallet'], legacy: [] },
    faucet_claimed: { apps: ['hedera-by-example', 'hfd-wallet'], legacy: ['hbe_faucet_claimed'] },
    faucet_claim_failed: { apps: ['hedera-by-example', 'hfd-wallet'], legacy: [] },
    tool_called: {
        apps: ['hedera-atlas', 'hedera-by-example'],
        legacy: ['atlas_tool_call', 'agent_tool_called', 'hbe_mcp_tool_called'],
    },
    tool_call_failed: { apps: ['hedera-by-example'], legacy: [] },
    // Hedera Atlas
    chat_turn_completed: { apps: ['hedera-atlas'], legacy: ['atlas_chat_turn_metrics'] },
    chat_turn_failed: { apps: ['hedera-atlas'], legacy: [] },
    chat_cleared: { apps: ['hedera-atlas'], legacy: [] },
    quick_prompt_used: { apps: ['hedera-atlas'], legacy: [] },
    llm_call_completed: { apps: ['hedera-atlas'], legacy: ['atlas_llm_call'] },
    decision_brief_started: { apps: ['hedera-atlas'], legacy: [] },
    decision_brief_completed: { apps: ['hedera-atlas'], legacy: ['fiveq_completed'] },
    decision_brief_failed: { apps: ['hedera-atlas'], legacy: [] },
    decision_brief_exported: { apps: ['hedera-atlas'], legacy: [] },
    related_projects_viewed: { apps: ['hedera-atlas'], legacy: [] },
    hackathon_project_judged: { apps: ['hedera-atlas'], legacy: [] },
    hackathon_judge_failed: { apps: ['hedera-atlas'], legacy: [] },
    // Hedera for Dummies
    account_activated: { apps: ['hfd-wallet'], legacy: ['wallet_linked'] },
    account_setup_completed: { apps: ['hfd-wallet'], legacy: [] },
    account_setup_failed: { apps: ['hfd-wallet'], legacy: [] },
    contract_called: { apps: ['hfd-wallet'], legacy: [] },
    contract_call_failed: { apps: ['hfd-wallet'], legacy: [] },
    transaction_sent: { apps: ['hfd-wallet'], legacy: [] },
    transaction_send_failed: { apps: ['hfd-wallet'], legacy: [] },
    message_sent: { apps: ['hfd-wallet'], legacy: [] },
    message_send_failed: { apps: ['hfd-wallet'], legacy: [] },
    topic_created: { apps: ['hfd-wallet'], legacy: [] },
    topic_create_failed: { apps: ['hfd-wallet'], legacy: [] },
    topic_joined: { apps: ['hfd-wallet'], legacy: [] },
    nft_claimed: { apps: ['hfd-wallet'], legacy: [] },
    nft_claim_failed: { apps: ['hfd-wallet'], legacy: [] },
    raffle_winners_posted: { apps: ['hfd-wallet'], legacy: [] },
    // Hedera by Example
    mcp_session_started: { apps: ['hedera-by-example'], legacy: ['hbe_mcp_session_started'] },
};
export function isAnalyticsEvent(name) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, name);
}
export function isEventAllowedForApp(name, app) {
    return isAnalyticsEvent(name) && ANALYTICS_EVENTS[name].apps.includes(app);
}
/** Every name (new + legacy) for one event — for HogQL `event IN (...)` over history. */
export function eventNamesWithLegacy(name) {
    return [name, ...ANALYTICS_EVENTS[name].legacy];
}
/**
 * Keys that must never reach PostHog. Leads carry flags only (has_company, …), never
 * the values. Matched case-insensitively after stripping `_` / `-`.
 */
const FORBIDDEN_KEYS = new Set([
    'email', 'name', 'firstname', 'lastname', 'fullname', 'phone', 'company', 'telegram',
    'privatekey', 'mnemonic', 'seed', 'password', 'apikey', 'secret', 'token', 'authorization',
]);
function isForbiddenKey(key) {
    return FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''));
}
/** Properties the envelope owns — callers can't set or override them. */
const ENVELOPE_KEYS = new Set([
    'schema_version', 'app', 'service', 'origin', 'app_version', 'env', 'network',
    'distinct_id', 'id_source', 'timestamp', 'api_key',
]);
// No `$` keys from callers: PostHog reserved props ($ip, $set, …) are set server-side only.
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;
/**
 * Drops envelope keys, forbidden keys, `$` / non-snake_case keys and undefined values.
 * Returns the clean props plus the dropped key names (logged by the caller).
 */
export function sanitizeProperties(props) {
    const properties = {};
    const dropped = [];
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined)
            continue;
        if (ENVELOPE_KEYS.has(key) || isForbiddenKey(key) || !SNAKE_CASE.test(key)) {
            dropped.push(key);
            continue;
        }
        properties[key] = value;
    }
    return { properties, dropped };
}
/**
 * Automated browsers and crawlers never count on browser surfaces (same rule as test
 * traffic): search/preview bots (Googlebot, Twitterbot, Slackbot, TelegramBot…), post-deploy
 * screenshot bots, headless browsers, uptime checkers and HTTP libraries. Matched on the
 * User-Agent of the browser request by the server. Not for API/MCP events: those clients are
 * programs by design.
 */
const BOT_USER_AGENT = /bot[\/\-;)]|bot$|crawler|spider|slurp|headless|lighthouse|pagespeed|vercel-(screenshot|favicon)|facebookexternalhit|whatsapp\/|embedly|curl\/|wget\/|python-requests|axios\/|node-fetch|undici|go-http-client|uptimerobot|pingdom|statuscake/i;
export function isBotUserAgent(userAgent) {
    if (!userAgent)
        return true;
    return BOT_USER_AGENT.test(userAgent);
}
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEDERA_ACCOUNT = /^\d+\.\d+\.\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * One rule for distinct_id everywhere: wallet (lowercase EVM, else 0.0.x) → device UUID →
 * server pseudonymous id → per-event random id with person processing off. Never a shared
 * constant like "anonymous", which merges every unknown visitor into one person.
 */
export function resolveIdentity(input) {
    const evm = input.evmAddress?.trim();
    if (evm && EVM_ADDRESS.test(evm)) {
        return { distinct_id: evm.toLowerCase(), id_source: 'wallet', process_person_profile: true };
    }
    const account = input.accountId?.trim();
    if (account && HEDERA_ACCOUNT.test(account)) {
        return { distinct_id: account, id_source: 'wallet', process_person_profile: true };
    }
    const device = input.deviceId?.trim();
    if (device && UUID.test(device)) {
        return { distinct_id: device.toLowerCase(), id_source: 'device', process_person_profile: true };
    }
    const pseudo = input.pseudonymousId?.trim();
    if (pseudo) {
        return { distinct_id: pseudo, id_source: input.pseudonymousSource ?? 'session', process_person_profile: true };
    }
    return { distinct_id: `anon:${randomId()}`, id_source: 'none', process_person_profile: false };
}
function randomId() {
    const c = globalThis.crypto;
    if (c?.randomUUID)
        return c.randomUUID();
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
/** VERCEL_ENV is the only source of truth; anything off Vercel is development. */
export function resolveEnv(vercelEnv) {
    return vercelEnv === 'production' || vercelEnv === 'preview' ? vercelEnv : 'development';
}
/** `1.0.158+abc1234` — package version plus short commit when known. */
export function formatAppVersion(version, commitSha) {
    return commitSha ? `${version}+${commitSha.slice(0, 7)}` : version;
}
/** Maps any error (string, Error, receipt status) onto the shared error_code list. */
export function normalizeErrorCode(error) {
    const text = (error instanceof Error ? error.message : String(error ?? '')).toUpperCase();
    if (/INSUFFICIENT|BALANCE|FEE|GAS/.test(text))
        return 'INSUFFICIENT_BALANCE';
    if (/TIMEOUT|TIMED OUT|ABORT/.test(text))
        return 'TIMEOUT';
    if (/RATE.?LIMIT|TOO MANY|429/.test(text))
        return 'RATE_LIMITED';
    if (/UNAUTHORI[SZ]ED|FORBIDDEN|INVALID_SIGNATURE|401|403/.test(text))
        return 'UNAUTHORIZED';
    if (/NOT_FOUND|NOT FOUND|404/.test(text))
        return 'NOT_FOUND';
    if (/INVALID|MALFORMED|BAD REQUEST|400/.test(text))
        return 'INVALID_INPUT';
    if (/FETCH FAILED|NETWORK|ECONN|ENOTFOUND|SOCKET/.test(text))
        return 'NETWORK_ERROR';
    if (/5\d\d|UPSTREAM|BAD GATEWAY|UNAVAILABLE/.test(text))
        return 'UPSTREAM_ERROR';
    return 'UNKNOWN';
}
/**
 * Builds the body for POST https://us.i.posthog.com/capture/. Envelope fields are
 * applied last so event properties can never override them. Geo ($ip, country) is
 * added by the caller from the request, after this.
 */
export function buildCapturePayload(apiKey, event, properties, envelope) {
    const timestamp = envelope.timestamp ?? new Date().toISOString();
    return {
        api_key: apiKey,
        event,
        distinct_id: envelope.identity.distinct_id,
        timestamp,
        properties: {
            ...properties,
            ...(envelope.identity.process_person_profile ? {} : { $process_person_profile: false }),
            schema_version: ANALYTICS_SCHEMA_VERSION,
            app: envelope.app,
            service: envelope.service,
            origin: envelope.origin,
            app_version: envelope.appVersion,
            env: envelope.env,
            network: envelope.network ?? null,
            distinct_id: envelope.identity.distinct_id,
            id_source: envelope.identity.id_source,
        },
    };
}
