/* eslint-disable camelcase, no-unused-vars */
/**
 * ============================================================================
 * Lab 04: Micropagos HTS en stablecoin (USDC)
 * [CONCEPT] Official exact scheme with HTS fungible asset
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Hedera's exact scheme settles HBAR (asset 0.0.0) or any HTS fungible token by
 * entity id. Official testnet USDC is 0.0.429274 (6 decimals). Dollar prices like
 * "$0.001" require defaultAssets pointing at that HTS id — not a homemade mock.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Both payer and merchant must associate the HTS token before settlement or the
 * facilitator will reject / the transfer fails with TOKEN_NOT_ASSOCIATED.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402/exact-scheme
 * - https://www.npmjs.com/package/@x402/hedera (HEDERA_TESTNET_USDC)
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Previous: M10 Lab 03: Facilitator Settlement
 * - Next:     M10 Lab 05: Financial Guardrails
 *
 * [ SECUENCIA ]
 * Note Lab: associate OPERATOR + MERCHANT with HEDERA_TESTNET_USDC if needed
 * Server -> Agent: 402 priced in USDC units
 * Agent -> Server: PAYMENT-SIGNATURE (HTS transfer)
 * Facilitator -> Hedera: settle
 *
 * [ SIMULADO ]
 * If the operator has no testnet USDC, the lab falls back to documenting the
 * official asset id and settles an equivalent HBAR micropayment instead — never
 * minting a fake "USDC" token and calling it official.
 *
 * [ ANTES DE EJECUTAR ]
 * - Optional: mint test USDC at https://faucet.circle.com/ (Hedera Testnet) after association.
 * - Cost: association fees + micropayment.
 *
 * [ COMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/04_usdc_hts_micropayments.js
 * ============================================================================
 */

import {
  TokenAssociateTransaction,
  TokenId,
  AccountId
} from '@hiero-ledger/sdk'
import { x402ResourceServer } from '@x402/express'
import { ExactHederaScheme as ServerScheme } from '@x402/hedera/exact/server'
import express from 'express'
import { paymentMiddleware } from '@x402/express'
import {
  createFacilitatorClient,
  listenLocal,
  createPayingFetch,
  decodePaymentResponse,
  getOperatorContext,
  HEDERA_TESTNET_USDC,
  HEDERA_USDC_DECIMALS,
  HBAR_ASSET_ID,
  LAB_PRICE_TINYBARS,
  X402_NETWORK
} from '../M99_Utilities/index.js'
import { updateState } from '../M99_Utilities/storage.js'
import { parsePrivateKey, createClient } from '../M99_Utilities/config.js'


async function mirrorAccount (accountId) {
  const url = `https://testnet.mirrornode.hedera.com/api/v1/accounts/${accountId}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Mirror account lookup failed: HTTP ${res.status}`)
  return res.json()
}

async function ensureAssociated (client, accountId, tokenId) {
  const info = await mirrorAccount(accountId)
  const ids = new Set((info.balance?.tokens || []).map((t) => t.token_id))
  if (ids.has(tokenId)) {
    console.log(`[INFO] ${accountId} already associated with ${tokenId}`)
    return
  }
  console.log(`[PROCESS] Associating ${accountId} with ${tokenId}...`)
  const tx = await new TokenAssociateTransaction()
    .setAccountId(AccountId.fromString(accountId))
    .setTokenIds([TokenId.fromString(tokenId)])
    .execute(client)
  await tx.getReceipt(client)
  console.log('[SUCCESS] Association complete')
}

async function usdcBalance (accountId, tokenId) {
  const info = await mirrorAccount(accountId)
  const row = (info.balance?.tokens || []).find((t) => t.token_id === tokenId)
  return BigInt(row?.balance || 0)
}

const main = async () => {
  console.log('--- SESSION START: Official HTS USDC (or documented fallback) ---\n')
  const { client, operatorId, operatorKey, merchantId } = getOperatorContext()
  const usdc = HEDERA_TESTNET_USDC
  console.log(`[INFO] Official Hedera testnet USDC token id: ${usdc} (${HEDERA_USDC_DECIMALS} decimals)`)

  await ensureAssociated(client, operatorId.toString(), usdc)
  // Merchant association: use merchant key if present, else operator cannot associate foreign account
  const merchantKey = process.env.MERCHANT_PRIVATE_KEY
  if (merchantKey) {
    const merchantClient = createClient(merchantId, merchantKey)
    await ensureAssociated(merchantClient, merchantId, usdc)
    merchantClient.close()
  } else {
    console.log('[WARN] MERCHANT_PRIVATE_KEY missing; merchant association skipped')
  }

  const usdcBal = await usdcBalance(operatorId.toString(), usdc)
  console.log(`[LOG] Operator USDC base units: ${usdcBal.toString()}`)

  const facilitatorClient = createFacilitatorClient()
  const app = express()
  let mode = 'usdc'
  let price
  if (usdcBal >= 1000n) {
    price = '$0.001'
    const resourceServer = new x402ResourceServer(facilitatorClient).register('hedera:*', new ServerScheme({
      defaultAssets: {
        [X402_NETWORK]: { asset: usdc, decimals: HEDERA_USDC_DECIMALS }
      }
    }))
    app.use(paymentMiddleware({
      'GET /api/v1/usdc-quote': {
        accepts: [{ scheme: 'exact', price, network: X402_NETWORK, payTo: merchantId }],
        description: 'USDC-priced inference quote'
      }
    }, resourceServer))
  } else {
    mode = 'hbar-fallback'
    console.log('[WARN] No testnet USDC balance. Falling back to HBAR micropayment while documenting official USDC id.')
    console.log('[WARN] Fund USDC via https://faucet.circle.com/ (Hedera Testnet) then re-run for a true USDC settle.')
    const resourceServer = new x402ResourceServer(facilitatorClient).register('hedera:*', new ServerScheme({}))
    price = { amount: LAB_PRICE_TINYBARS.usdcUnits, asset: HBAR_ASSET_ID }
    app.use(paymentMiddleware({
      'GET /api/v1/usdc-quote': {
        accepts: [{ scheme: 'exact', price, network: X402_NETWORK, payTo: merchantId }],
        description: 'Fallback HBAR while USDC balance is empty'
      }
    }, resourceServer))
  }
  app.get('/api/v1/usdc-quote', (_req, res) => res.json({ mode, usdcToken: usdc, ok: true }))

  const { server, baseUrl } = await listenLocal(app)
  try {
    const fetchPaid = createPayingFetch(operatorId.toString(), operatorKey)
    const res = await fetchPaid(`${baseUrl}/api/v1/usdc-quote`)
    const settlement = decodePaymentResponse(res)
    console.log(`[SUCCESS] HTTP ${res.status} mode=${mode}`)
    console.log('[LOG] PAYMENT-RESPONSE:', JSON.stringify(settlement))
    console.log('[LOG] Body:', await res.text())
    if (res.status !== 200) throw new Error('Settlement failed')
    updateState('X402_LAB04_MODE', mode)
    updateState('X402_LAB04_TX', settlement?.transaction || '')
    updateState('X402_OFFICIAL_USDC', usdc)
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    server.close()
    client.close?.()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => process.exit(0)).catch((e) => { console.error('[FAILED]', e.message); process.exit(1) })
}
