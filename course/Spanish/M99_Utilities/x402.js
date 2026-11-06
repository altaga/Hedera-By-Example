/* eslint-disable camelcase */
/**
 * Shared helpers for Module 10 — official x402 v2 on Hedera testnet.
 * Packages: @x402/core, @x402/express, @x402/fetch, @x402/hedera
 * Facilitator: https://x402.org/facilitator (hedera:testnet)
 */
import express from 'express'
import { paymentMiddleware, x402ResourceServer } from '@x402/express'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { ExactHederaScheme as ServerScheme } from '@x402/hedera/exact/server'
import { ExactHederaScheme as ClientScheme } from '@x402/hedera/exact/client'
import { createClientHederaSigner, HBAR_ASSET_ID, HEDERA_TESTNET_USDC, HEDERA_USDC_DECIMALS } from '@x402/hedera'
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch'
import { PrivateKey } from '@hiero-ledger/sdk'
import { getClient, loadEnv, parsePrivateKey } from './config.js'

export const X402_FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator'
export const X402_NETWORK = 'hedera:testnet'
export { HBAR_ASSET_ID, HEDERA_TESTNET_USDC, HEDERA_USDC_DECIMALS }

/** Discover the facilitator's advertised Hedera feePayer from GET /supported. */
export async function fetchFacilitatorFeePayer (baseUrl = X402_FACILITATOR_URL) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/supported`, {
    headers: { Accept: 'application/json', 'User-Agent': 'hedera-by-example-x402' }
  })
  if (!res.ok) throw new Error(`Facilitator /supported failed: HTTP ${res.status}`)
  const body = await res.json()
  const kind = (body.kinds || []).find((k) => k.network === X402_NETWORK && k.scheme === 'exact')
  const feePayer = kind?.extra?.feePayer || (body.signers && body.signers['hedera:*'] && body.signers['hedera:*'][0])
  if (!feePayer) throw new Error('No hedera:testnet exact feePayer advertised by facilitator')
  return { feePayer, kind, body }
}

/**
 * Merchant (payTo) must differ from the paying operator — self-transfers collapse
 * to a zero-amount payload in the official Hedera exact client.
 */
export function getMerchantAccountId () {
  loadEnv()
  const id = process.env.MERCHANT_ID
  if (!id) {
    throw new Error('Missing MERCHANT_ID in .env (payTo must differ from OPERATOR_ID for official x402).')
  }
  return id
}

export function createFacilitatorClient (url = X402_FACILITATOR_URL) {
  return new HTTPFacilitatorClient({ url })
}

export function createResourceServer (facilitatorClient = createFacilitatorClient()) {
  return new x402ResourceServer(facilitatorClient).register('hedera:*', new ServerScheme({}))
}

/**
 * Build an Express app gated by official x402 paymentMiddleware.
 * @param {object} opts
 * @param {string} opts.route - e.g. 'GET /paid'
 * @param {string} opts.payTo - Hedera account id receiving funds
 * @param {string|object} opts.price - money string ("$0.01") or { amount, asset }
 * @param {string} [opts.description]
 * @param {(req,res)=>void} [opts.handler]
 */
export function createPaidExpressApp ({
  route = 'GET /paid',
  payTo,
  price = { amount: '100000', asset: HBAR_ASSET_ID },
  description = 'Hedera by Example x402 protected resource',
  handler
}) {
  const facilitatorClient = createFacilitatorClient()
  const resourceServer = createResourceServer(facilitatorClient)
  const app = express()
  app.use(paymentMiddleware({
    [route]: {
      accepts: [{ scheme: 'exact', price, network: X402_NETWORK, payTo }],
      description
    }
  }, resourceServer))
  const method = route.split(' ')[0].toUpperCase()
  const pathName = route.split(' ').slice(1).join(' ') || '/'
  const verb = method === 'GET' ? 'get' : method === 'POST' ? 'post' : 'all'
  app[verb](pathName, handler || ((_req, res) => {
    res.json({ ok: true, unlocked: true, protocol: 'x402', network: X402_NETWORK })
  }))
  return { app, facilitatorClient, resourceServer }
}

export async function listenLocal (app, preferredPort = 0) {
  const server = await new Promise((resolve) => {
    const s = app.listen(preferredPort, '127.0.0.1', () => resolve(s))
  })
  const { port } = server.address()
  return { server, port, baseUrl: `http://127.0.0.1:${port}` }
}

export function createPayingFetch (accountId, privateKey) {
  const key = typeof privateKey === 'string' ? parsePrivateKey(privateKey) : privateKey
  const scheme = new ClientScheme(createClientHederaSigner(accountId, key, { network: X402_NETWORK }))
  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: 'hedera:*', client: scheme }],
    spendControls: false
  })
}

export function decodePaymentRequiredHeader (response) {
  const raw = response.headers.get('PAYMENT-REQUIRED') || response.headers.get('payment-required')
  if (!raw) return null
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
}

export function decodePaymentResponse (response) {
  try {
    return decodePaymentResponseHeader(response.headers)
  } catch {
    const raw = response.headers.get('PAYMENT-RESPONSE') || response.headers.get('payment-response')
    if (!raw) return null
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  }
}

export function getOperatorContext () {
  const ctx = getClient()
  return {
    ...ctx,
    operatorKeyObj: parsePrivateKey(ctx.operatorKey),
    merchantId: getMerchantAccountId()
  }
}

/** Tiny HBAR prices used across labs (tinybars). 100_000 = 0.001 HBAR */
export const LAB_PRICE_TINYBARS = {
  challenge: '50000', // 0.0005 HBAR
  settle: '100000', // 0.001 HBAR
  usdcUnits: '1000', // 0.001 USDC if using HEDERA_TESTNET_USDC
  stream: '50000',
  agent: '75000',
  p2p: '100000'
}
