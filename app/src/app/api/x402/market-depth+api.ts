/**
 * @file market-depth+api.ts
 * A real x402 (v2, "exact" scheme on Hedera) protected resource for M10 Lab 01.
 * GET /api/x402/market-depth?payTo=0.0.x&feePayer=0.0.y
 *
 * Without a payment it answers HTTP 402 with the PAYMENT-REQUIRED header (Base64 JSON), as the
 * x402 spec describes. The course passes its own merchant (payTo) and facilitator (feePayer)
 * accounts so the payment in Labs 02-03 lands in the learner's accounts. This endpoint only
 * issues the challenge; it holds no keys and never submits a transaction.
 */

const RESOURCE = '/api/x402/market-depth'
const PRICE_TINYBARS = 1_000_000 // 0.01 HBAR
const ACCOUNT_ID = /^0\.0\.\d{1,12}$/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, PAYMENT-SIGNATURE',
  // Browsers only let a page read the headers listed here.
  'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE'
}

const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function OPTIONS () {
  return new Response(null, { status: 204, headers: CORS })
}

export function GET (request: Request) {
  const url = new URL(request.url)
  const payTo = url.searchParams.get('payTo') || ''
  const feePayer = url.searchParams.get('feePayer') || ''
  if (!ACCOUNT_ID.test(payTo) || !ACCOUNT_ID.test(feePayer)) {
    return Response.json({ error: 'payTo and feePayer must be Hedera account IDs (0.0.x)' }, { status: 400, headers: CORS })
  }
  if (request.headers.get('PAYMENT-SIGNATURE')) {
    return Response.json({ error: 'This demo endpoint only issues the 402 challenge; settlement happens in M10 Lab 03.' }, { status: 400, headers: CORS })
  }
  const paymentRequired = {
    x402Version: 2,
    error: 'Payment required',
    resource: { url: RESOURCE, description: 'Alpha intelligence market-depth feed', mimeType: 'application/json' },
    accepts: [{
      scheme: 'exact',
      network: 'hedera:testnet',
      amount: String(PRICE_TINYBARS),
      asset: '0.0.0',
      payTo,
      maxTimeoutSeconds: 120,
      extra: { feePayer }
    }]
  }
  const body = JSON.stringify(paymentRequired)
  return new Response(body, {
    status: 402,
    headers: { ...CORS, 'Content-Type': 'application/json', 'PAYMENT-REQUIRED': toBase64(body), 'Cache-Control': 'no-store' }
  })
}
