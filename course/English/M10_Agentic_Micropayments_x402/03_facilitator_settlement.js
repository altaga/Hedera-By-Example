/* eslint-disable camelcase, no-unused-vars */
/**
 * ============================================================================
 * Lab 03: Zero-Gas Facilitator Settlement
 * [CONCEPT] Explicit /verify + /settle + PAYMENT-RESPONSE
 * ============================================================================
 * [ KEY CONCEPT ]
 * The resource server does not broadcast the transfer. It asks the facilitator
 * to POST /verify (read-only) and POST /settle (feePayer co-signs and submits).
 * The client then sees PAYMENT-RESPONSE with the Hedera transaction id.
 *
 * [ LEARNABLE MOMENT ]
 * "Facilitator" is not your operator key executing TransferTransaction locally.
 * It is https://x402.org/facilitator (or another host that advertises hedera:testnet).
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/facilitators
 * - https://docs.hedera.com/solutions/ai/x402/how-it-works
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 02: Agent Payment Signature
 * - Next:     M10 Lab 04: HTS USDC Micropayments
 *
 * [SEQUENCE]
 * Agent -> Server: unpaid GET
 * Server -> Agent: 402 PAYMENT-REQUIRED
 * Agent -> Server: PAYMENT-SIGNATURE
 * Server -> Facilitator: POST /verify then POST /settle
 * Facilitator -> Hedera: submit TransferTransaction as feePayer
 * Server -> Agent: 200 + PAYMENT-RESPONSE
 *
 * [SIMULATED]
 * Local Express stands in for the merchant API; settlement is real on testnet.
 *
 * [ BEFORE YOU RUN ]
 * - OPERATOR_ID pays; MERCHANT_ID receives; facilitator sponsors gas.
 * - Cost: ~0.001 HBAR to the merchant.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/03_facilitator_settlement.js
 * ============================================================================
 */

import { x402Client } from '@x402/core/client'
import { ExactHederaScheme as ClientScheme } from '@x402/hedera/exact/client'
import { createClientHederaSigner } from '@x402/hedera'
import {
  createPaidExpressApp,
  listenLocal,
  createFacilitatorClient,
  decodePaymentRequiredHeader,
  getOperatorContext,
  LAB_PRICE_TINYBARS,
  HBAR_ASSET_ID,
  X402_FACILITATOR_URL,
  fetchFacilitatorFeePayer
} from '../M99_Utilities/index.js'
import { updateState } from '../M99_Utilities/storage.js'
import { parsePrivateKey } from '../M99_Utilities/config.js'

const main = async () => {
  console.log('--- SESSION START: Official Facilitator /verify + /settle ---\n')
  const { operatorId, operatorKey, merchantId } = getOperatorContext()
  const { feePayer } = await fetchFacilitatorFeePayer()
  console.log(`[INFO] Facilitator ${X402_FACILITATOR_URL} feePayer=${feePayer}`)

  const pathName = '/api/v1/settlement-demo'
  const { app, facilitatorClient } = createPaidExpressApp({
    route: `GET ${pathName}`,
    payTo: merchantId,
    price: { amount: LAB_PRICE_TINYBARS.settle, asset: HBAR_ASSET_ID },
    description: 'Visible facilitator settlement',
    handler: (_req, res) => res.json({ settledResource: true, quote: 'FINALITY_OK' })
  })
  const { server, baseUrl } = await listenLocal(app)
  try {
    const unpaid = await fetch(`${baseUrl}${pathName}`)
    const paymentRequired = decodePaymentRequiredHeader(unpaid)
    const accept = paymentRequired.accepts[0]
    console.log('[PROCESS] Building official payment payload via x402Client...')
    const client = new x402Client()
      .register('hedera:*', new ClientScheme(createClientHederaSigner(operatorId.toString(), parsePrivateKey(operatorKey), { network: 'hedera:testnet' })))
      .setSpendControls(false)
    const payload = await client.createPaymentPayload(paymentRequired)

    console.log('[PROCESS] Facilitator POST /verify ...')
    const verified = await facilitatorClient.verify(payload, accept)
    console.log('[SUCCESS] verify:', JSON.stringify(verified))
    if (!verified?.isValid) throw new Error(`verify failed: ${verified?.invalidReason || 'unknown'}`)

    console.log('[PROCESS] Facilitator POST /settle ...')
    const settled = await facilitatorClient.settle(payload, accept)
    console.log('[SUCCESS] settle:', JSON.stringify(settled))
    console.log('[INFO] @x402/express paymentMiddleware runs this same /verify + /settle pair internally,')
    console.log('[INFO] then returns HTTP 200 with a Base64 PAYMENT-RESPONSE header to the client.')

    // Show the wire shape the middleware would emit as PAYMENT-RESPONSE
    const paymentResponse = {
      success: !!settled?.success || settled?.success === undefined,
      payer: settled.payer,
      transaction: settled.transaction,
      network: settled.network || 'hedera:testnet'
    }
    console.log('[LOG] PAYMENT-RESPONSE shape:', JSON.stringify(paymentResponse))
    if (!settled?.transaction) throw new Error('settle did not return a transaction id')

    updateState('X402_SETTLED_TX_ID', settled.transaction || '')
    updateState('X402_SETTLED_PAYER', settled.payer || '')
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    server.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => process.exit(0)).catch((e) => { console.error('[FAILED]', e.message); process.exit(1) })
}
