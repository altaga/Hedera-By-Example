// Preload for MCP tests: replaces fetch with an offline Mirror Node mock (no network).
// Mode via env HBE_MOCK_MODE: ok | 500 | timeout | nofees
globalThis.fetch = async (url) => {
  url = String(url)
  const mode = process.env.HBE_MOCK_MODE || 'ok'
  if (mode === 'timeout') { const e = new Error('t'); e.name = 'TimeoutError'; throw e }
  if (mode === '500') return new Response('boom', { status: 500 })
  if (url.includes('/accounts/0.0.99999999999')) return new Response('{"_status":{"messages":[{"message":"Not found"}]}}', { status: 404 })
  if (url.endsWith('/network/exchangerate')) return new Response(JSON.stringify({ current_rate: { cent_equivalent: 600, hbar_equivalent: 100 } }))
  if (url.endsWith('/network/fees')) return mode === 'nofees' ? new Response('x', { status: 503 }) : new Response(JSON.stringify({ fees: [{ transaction_type: 'ContractCall', gas: 100 }, { transaction_type: 'ContractCreate', gas: 100 }] }))
  if (url.includes('/topics/0.0.5/messages')) return new Response(JSON.stringify({ messages: [], links: { next: '/api/v1/topics/0.0.5/messages?limit=2&timestamp=gt:1.2' } }))
  return new Response(JSON.stringify({ ok: true, url, links: { next: null } }))
}
