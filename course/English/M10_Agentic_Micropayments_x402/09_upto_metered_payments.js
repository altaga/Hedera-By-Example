/**
 * ============================================================================
 * Lab 09: Metered Payments with the x402 upto Scheme
 * [CONCEPT] Sign a Ceiling, Pay for What Was Used (Permit2 on Hedera's EVM)
 * ============================================================================
 * [ KEY CONCEPT ]
 * In x402's `exact` scheme the buyer signs the price. The `upto` scheme is for
 * usage-based pricing: the buyer signs a MAXIMUM, the server meters the request
 * and the facilitator settles the actual amount (<= the maximum, possibly 0).
 * On EVM it uses Permit2's permitWitnessTransferFrom through the
 * x402UptoPermit2Proxy contract. Both are deployed on Hedera testnet at their
 * canonical addresses, so this lab runs the EVM spec as written on eip155:296:
 * a one-time ERC-20 approve(Permit2) through the HTS token's ERC-20 facade, an
 * EIP-712 PermitWitnessTransferFrom signature (witness: to, facilitator,
 * validAfter), the seven verification checks, and settle() for the metered amount.
 * *
 * [ LEARNABLE MOMENT ]
 * The witness binds the payee and the facilitator into the signature, and Permit2's nonce makes it single-use: a server can charge less than the ceiling, but never more, never to another address, never through another facilitator, and never twice. The buyer's risk is the ceiling it chose, so it should keep it small.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://github.com/coinbase/x402/blob/main/specs/schemes/upto/scheme_upto.md
 * - https://github.com/coinbase/x402/blob/main/specs/schemes/upto/scheme_upto_evm.md
 * - https://github.com/coinbase/x402/blob/main/contracts/evm/src/x402UptoPermit2Proxy.sol
 * - https://github.com/Uniswap/permit2
 * - https://hips.hedera.com/hip/hip-218
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 08: Two-Party Settlement (Merchant as Facilitator)
 * - Next:     M10 Lab 10: Commerce Agent with the Hedera Agent Kit
 *
 * [ SEQUENCE ]
 * Buyer -> Hedera: approve(Permit2) on the token's ERC-20 facade (one time)
 * Buyer -> Server: GET /api/v1/mirror/latest-transactions
 * Server -> Buyer: 402 PAYMENT-REQUIRED (scheme upto, amount = maximum)
 * Note Buyer: Signs PermitWitnessTransferFrom (EIP-712)
 * Buyer -> Server: Retry with PAYMENT-SIGNATURE
 * Server -> Facilitator: verify (amount = maximum)
 * Note Server: Serves the data and meters the bytes
 * Server -> Facilitator: settle (amount = actual)
 * Facilitator -> Hedera: x402UptoPermit2Proxy.settle(permit, actual, owner, witness, signature)
 * Server -> Buyer: 200 OK + PAYMENT-RESPONSE
 *
 * [ SIMULATED ]
 * Nothing on-chain is simulated: the token, the approve, the signature checks, the settlement through Permit2 and the audit are real testnet operations. The server and the facilitator are functions in this script (in the browser the server runs in the page).
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the token treasury and the facilitator (it pays the settle() gas).
 * - Practice wallets: ACCOUNT_2 is the seller (payTo). The buyer is a throwaway ECDSA account with an EVM alias (Permit2 recovers the signer's address), deleted at the end.
 * - Cost: ~15 ℏ the first time (token); then about 1-2 ℏ per run (buyer account, approve, settle).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/09_upto_metered_payments.js
 * ============================================================================
 */

import http from 'node:http'
import crypto from 'node:crypto'
import { ethers } from 'ethers'
import {
  AccountId,
  AccountDeleteTransaction,
  ContractExecuteTransaction,
  ContractId,
  Hbar,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenSupplyType,
  TokenType,
  TransferTransaction
} from '@hiero-ledger/sdk'
import {
  getClient,
  createClient,
  createLabAccount,
  reuseToken,
  executeWithGas,
  waitForMirror,
  getMirrorNodeBaseUrl,
  getJsonRpcUrl,
  getHashscanUrl,
  encodeHeader,
  decodeHeader,
  updateState,
  show
} from '../M99_Utilities/index.js'

// Canonical addresses from the spec's annex; both exist on Hedera testnet.
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const X402_UPTO_PERMIT2_PROXY = '0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002'
const NETWORK = 'eip155:296' // Hedera testnet chain id 296, in CAIP-2 form
const CHAIN_ID = 296

// EIP-712 types exactly as @x402/evm signs them (uptoPermit2WitnessTypes).
const UPTO_PERMIT2_WITNESS_TYPES = {
  PermitWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'witness', type: 'Witness' }
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' }
  ],
  Witness: [
    { name: 'to', type: 'address' },
    { name: 'facilitator', type: 'address' },
    { name: 'validAfter', type: 'uint256' }
  ]
}
const PERMIT2_DOMAIN = { name: 'Permit2', chainId: CHAIN_ID, verifyingContract: PERMIT2_ADDRESS }

const ERC20 = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)'
])
const PROXY = new ethers.Interface([
  'function settle(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, uint256 amount, address owner, (address to, address facilitator, uint256 validAfter) witness, bytes signature)'
])

const PORT = 4330
const RESOURCE = `http://127.0.0.1:${PORT}/api/v1/mirror/latest-transactions`
const DECIMALS = 6
const MAX_AMOUNT = 200_000n // 0.20 tUSD ceiling
const PRICE_PER_KB = 1_000n // 0.001 tUSD per KB served

const longZero = (id) => `0x${AccountId.fromString(String(id)).toEvmAddress()}`
const fmt = (units) => `${(Number(units) / 10 ** DECIMALS).toFixed(6)} tUSD`

const rpc = async (method, params) => {
  const res = await fetch(getJsonRpcUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const body = await res.json()
  if (body.error) throw new Error(body.error.message + (body.error.data ? ` ${body.error.data}` : ''))
  return body.result
}
const ethCall = (to, data, from) => rpc('eth_call', [{ to, data, ...(from ? { from } : {}) }, 'latest'])

/** The settle() arguments, in the proxy's ABI shape. */
const settleArgs = (auth, signature, amount) => [
  [[auth.permitted.token, BigInt(auth.permitted.amount)], BigInt(auth.nonce), BigInt(auth.deadline)],
  amount,
  auth.from,
  [auth.witness.to, auth.witness.facilitator, BigInt(auth.witness.validAfter)],
  signature
]

/** The buyer's side, as @x402/evm's createUptoPermit2Payload builds it. */
const createUptoPermit2Payload = async (wallet, requirements) => {
  const now = Math.floor(Date.now() / 1000)
  const permit2Authorization = {
    from: wallet.address,
    permitted: { token: ethers.getAddress(requirements.asset), amount: requirements.amount },
    spender: X402_UPTO_PERMIT2_PROXY,
    nonce: BigInt(ethers.hexlify(crypto.randomBytes(32))).toString(),
    deadline: String(now + requirements.maxTimeoutSeconds),
    witness: { to: ethers.getAddress(requirements.payTo), facilitator: ethers.getAddress(requirements.extra.facilitatorAddress), validAfter: '0' }
  }
  const signature = await wallet.signTypedData(PERMIT2_DOMAIN, UPTO_PERMIT2_WITNESS_TYPES, {
    permitted: { token: permit2Authorization.permitted.token, amount: BigInt(permit2Authorization.permitted.amount) },
    spender: permit2Authorization.spender,
    nonce: BigInt(permit2Authorization.nonce),
    deadline: BigInt(permit2Authorization.deadline),
    witness: { ...permit2Authorization.witness, validAfter: BigInt(permit2Authorization.witness.validAfter) }
  })
  return { x402Version: 2, accepted: requirements, payload: { signature, permit2Authorization } }
}

const recoverSigner = (auth, signature) => ethers.verifyTypedData(PERMIT2_DOMAIN, UPTO_PERMIT2_WITNESS_TYPES, {
  permitted: { token: auth.permitted.token, amount: BigInt(auth.permitted.amount) },
  spender: auth.spender,
  nonce: BigInt(auth.nonce),
  deadline: BigInt(auth.deadline),
  witness: { ...auth.witness, validAfter: BigInt(auth.witness.validAfter) }
}, signature)

/** The facilitator: the verify and settle rules of scheme_upto_evm.md. */
const createFacilitator = ({ client, facilitatorAddress, proxyContractId }) => {
  const verify = async (paymentPayload, requirements) => {
    const { signature, permit2Authorization: auth } = paymentPayload.payload
    const fail = (reason) => ({ isValid: false, invalidReason: reason })
    // 1. The signature recovers to `from`.
    if (recoverSigner(auth, signature).toLowerCase() !== auth.from.toLowerCase()) return fail('invalid_upto_evm_payload_signature')
    // 2. The client approved Permit2 for at least `amount`.
    const allowance = BigInt(await ethCall(auth.permitted.token, ERC20.encodeFunctionData('allowance', [auth.from, PERMIT2_ADDRESS])))
    if (allowance < BigInt(requirements.amount)) return { ...fail('PERMIT2_ALLOWANCE_REQUIRED'), httpStatus: 412 }
    // 3. The client holds enough of the asset.
    const balance = BigInt(await ethCall(auth.permitted.token, ERC20.encodeFunctionData('balanceOf', [auth.from])))
    if (balance < BigInt(requirements.amount)) return fail('insufficient_funds')
    // 4. At verify time the signed maximum equals requirements.amount.
    if (BigInt(auth.permitted.amount) !== BigInt(requirements.amount)) return fail('invalid_upto_evm_payload_amount_mismatch')
    // 5. Time window.
    const now = Math.floor(Date.now() / 1000)
    if (BigInt(auth.deadline) <= BigInt(now)) return fail('invalid_upto_evm_payload_deadline')
    if (BigInt(auth.witness.validAfter) > BigInt(now)) return fail('invalid_upto_evm_payload_not_yet_valid')
    // 6. Token, network, payee, spender and facilitator match.
    if (paymentPayload.accepted.network !== requirements.network) return fail('invalid_network')
    if (auth.permitted.token.toLowerCase() !== requirements.asset.toLowerCase()) return fail('invalid_upto_evm_payload_asset')
    if (auth.witness.to.toLowerCase() !== requirements.payTo.toLowerCase()) return fail('invalid_upto_evm_payload_recipient')
    if (auth.spender.toLowerCase() !== X402_UPTO_PERMIT2_PROXY.toLowerCase()) return fail('invalid_upto_evm_payload_spender')
    if (auth.witness.facilitator.toLowerCase() !== facilitatorAddress.toLowerCase()) return fail('invalid_upto_evm_payload_facilitator')
    // 7. Simulate settle() with the full amount (worst case), from the facilitator's address.
    try {
      await ethCall(X402_UPTO_PERMIT2_PROXY, PROXY.encodeFunctionData('settle', settleArgs(auth, signature, BigInt(auth.permitted.amount))), facilitatorAddress)
    } catch (error) {
      return fail(`simulation_failed: ${error.message.slice(0, 120)}`)
    }
    return { isValid: true, payer: auth.from }
  }

  const settle = async (paymentPayload, requirements) => {
    const { signature, permit2Authorization: auth } = paymentPayload.payload
    const amount = BigInt(requirements.amount)
    // Settle-time verification: the signature is checked against permitted.amount, the ceiling.
    if (recoverSigner(auth, signature).toLowerCase() !== auth.from.toLowerCase()) return { success: false, errorReason: 'invalid_upto_evm_payload_signature', transaction: '', network: NETWORK, amount: '0' }
    if (amount > BigInt(auth.permitted.amount)) return { success: false, errorReason: 'invalid_upto_evm_payload_settlement_exceeds_amount', transaction: '', network: NETWORK, amount: '0' }
    // A zero settlement needs no transaction: the authorization expires unused.
    if (amount === 0n) return { success: true, transaction: '', network: NETWORK, payer: auth.from, amount: '0' }

    const data = Buffer.from(PROXY.encodeFunctionData('settle', settleArgs(auth, signature, amount)).slice(2), 'hex')
    const response = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(proxyContractId)
      .setGas(gas)
      .setFunctionParameters(data), client, { gas: 400_000 })
    const mirrorId = response.transactionId.toString().replace('@', '-').replace(/\.(\d+)$/, '-$1')
    const result = await waitForMirror(async () => {
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/results/${mirrorId}`)
      return res.ok ? res.json() : null
    })
    return { success: true, transaction: result?.hash || '', network: NETWORK, payer: auth.from, amount: amount.toString(), hederaTransactionId: response.transactionId.toString() }
  }

  return { verify, settle }
}

/** The resource server: 402 with an upto requirement, then meters the bytes it serves. */
const startServer = ({ requirements, facilitator, onSettled }) => {
  const server = http.createServer(async (req, res) => {
    const send = (status, headers, body) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    const signatureHeader = req.headers['payment-signature']
    if (!signatureHeader) {
      const paymentRequired = { x402Version: 2, error: 'PAYMENT-SIGNATURE header is required', resource: { url: RESOURCE, description: 'Latest testnet transactions, priced per KB served', mimeType: 'application/json' }, accepts: [requirements] }
      return send(402, { 'payment-required': encodeHeader(paymentRequired) }, paymentRequired)
    }
    const paymentPayload = decodeHeader(signatureHeader)
    const verification = await facilitator.verify(paymentPayload, requirements)
    if (!verification.isValid) return send(verification.httpStatus || 402, {}, { x402Version: 2, error: verification.invalidReason })

    // The work: real data from the Mirror Node, metered by size.
    const data = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions?limit=25&order=desc`).then((r) => r.text())
    const bytes = BigInt(Buffer.byteLength(data))
    const metered = ((bytes + 1023n) / 1024n) * PRICE_PER_KB
    const actual = metered < BigInt(requirements.amount) ? metered : BigInt(requirements.amount)

    // At settle time, requirements.amount carries the actual amount.
    const settlement = await facilitator.settle(paymentPayload, { ...requirements, amount: actual.toString() })
    if (!settlement.success) return send(402, {}, { x402Version: 2, error: settlement.errorReason })
    onSettled({ bytes, actual, settlement })
    send(200, { 'payment-response': encodeHeader(settlement) }, data)
  })
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)))
}

const tokenBalance = async (accountId, tokenId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`)
  return res.ok ? BigInt((await res.json()).tokens?.[0]?.balance ?? 0) : 0n
}

const main = async () => {
  console.log('--- SESSION START: x402 upto Scheme (Permit2 on Hedera) ---\n')
  const { client, operatorId } = getClient()
  const sellerId = process.env.ACCOUNT_2_ID
  const sellerKey = process.env.ACCOUNT_2_PRIVATE_KEY
  if (!sellerId || !sellerKey) {
    console.error('[FAILED] Missing ACCOUNT_2 (the seller) in .env.')
    process.exitCode = 1
    return
  }

  let server = null
  let buyer = null
  let buyerClient = null
  let tokenId = null
  try {
    // 1. The asset: an HTS fungible token, which is also an ERC-20 at its long-zero address (HIP-218).
    tokenId = await reuseToken('REUSE_M10_09_TUSD', async () => {
      const receipt = await (await new TokenCreateTransaction()
        .setTokenName('Lab USD (x402 upto)')
        .setTokenSymbol('tUSD')
        .setDecimals(DECIMALS)
        .setInitialSupply(1_000_000_000_000)
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Infinite)
        .setTreasuryAccountId(operatorId)
        .execute(client)).getReceipt(client)
      return receipt.tokenId
    })
    const tokenAddress = ethers.getAddress(`0x${tokenId.toEvmAddress()}`)
    const payTo = ethers.getAddress(longZero(sellerId))
    const facilitatorAddress = ethers.getAddress(longZero(operatorId))
    console.log(`[INFO] Asset ${tokenId} (ERC-20 at ${tokenAddress}), payTo ${sellerId}, facilitator ${operatorId}`)

    // The seller must be associated with the token to receive it.
    const sellerTokens = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${sellerId}/tokens?token.id=${tokenId}`).then((r) => r.json())
    if (!sellerTokens.tokens?.length) {
      const sellerClient = createClient(sellerId, sellerKey)
      try {
        await (await new TokenAssociateTransaction().setAccountId(sellerId).setTokenIds([tokenId]).execute(sellerClient)).getReceipt(sellerClient)
        console.log(`[SUCCESS] Seller ${sellerId} associated with ${tokenId}`)
      } finally {
        sellerClient.close()
      }
    }

    // 2. The buyer: an ECDSA account with an EVM alias, so the address Permit2 recovers is the account.
    buyer = await createLabAccount(client, { hbar: 3, ecdsa: true, autoAssociations: 1 })
    const wallet = new ethers.Wallet(`0x${buyer.privateKey.toStringRaw()}`)
    console.log(`[SUCCESS] Buyer ${buyer.accountId} (EVM alias ${wallet.address})`)
    await (await new TransferTransaction()
      .addTokenTransfer(tokenId, operatorId, -1_000_000)
      .addTokenTransfer(tokenId, buyer.accountId, 1_000_000)
      .execute(client)).getReceipt(client)
    console.log(`[SUCCESS] Funded the buyer with ${fmt(1_000_000)}`)

    // 3. Phase 1 (one time): the buyer approves Permit2 on the token's ERC-20 facade.
    buyerClient = createClient(buyer.accountId.toString(), buyer.privateKey)
    const approveData = Buffer.from(ERC20.encodeFunctionData('approve', [PERMIT2_ADDRESS, MAX_AMOUNT * 5n]).slice(2), 'hex')
    const approval = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(tokenId.toString()))
      .setGas(gas)
      .setFunctionParameters(approveData), buyerClient, { gas: 1_000_000 })
    console.log(`[SUCCESS] approve(Permit2, ${fmt(MAX_AMOUNT * 5n)}) on the facade: ${approval.transactionId}`)
    await waitForMirror(async () => BigInt(await ethCall(tokenAddress, ERC20.encodeFunctionData('allowance', [wallet.address, PERMIT2_ADDRESS]))) >= MAX_AMOUNT, { timeoutMs: 30_000 })

    // 4. The server and its facilitator.
    const proxy = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/${X402_UPTO_PERMIT2_PROXY}`).then((r) => r.json())
    const facilitator = createFacilitator({ client, facilitatorAddress, proxyContractId: ContractId.fromString(proxy.contract_id) })
    const requirements = { scheme: 'upto', network: NETWORK, amount: MAX_AMOUNT.toString(), asset: tokenAddress, payTo, maxTimeoutSeconds: 300, extra: { name: 'tUSD', version: '1', facilitatorAddress } }
    let settledInfo = null
    server = await startServer({ requirements, facilitator, onSettled: (info) => { settledInfo = info } })
    console.log(`[INFO] Resource server on ${RESOURCE} (x402UptoPermit2Proxy is ${proxy.contract_id})`)

    // 5. The buyer's request: 402, sign the ceiling, retry.
    const before = { buyer: await tokenBalance(buyer.accountId, tokenId), seller: await tokenBalance(sellerId, tokenId) }
    const first = await fetch(RESOURCE)
    const paymentRequired = decodeHeader(first.headers.get('payment-required'))
    const offer = paymentRequired.accepts[0]
    console.log(`\n[LOG] HTTP ${first.status}: scheme ${offer.scheme}, network ${offer.network}, maximum ${fmt(offer.amount)}, facilitator ${offer.extra.facilitatorAddress}`)
    const paymentPayload = await createUptoPermit2Payload(wallet, offer)
    console.log('[SUCCESS] Signed PermitWitnessTransferFrom (EIP-712, domain Permit2 / chain 296):')
    show.json(paymentPayload.payload.permit2Authorization)

    const paid = await fetch(RESOURCE, { headers: { 'payment-signature': encodeHeader(paymentPayload) } })
    if (paid.status !== 200) throw new Error(`server answered ${paid.status}: ${await paid.text()}`)
    const settlement = decodeHeader(paid.headers.get('payment-response'))
    await paid.text()
    console.log(`[SUCCESS] HTTP 200: ${settledInfo.bytes.toLocaleString('en-US')} bytes served → metered ${fmt(settledInfo.actual)} of the ${fmt(MAX_AMOUNT)} maximum`)
    show.json(settlement)
    console.log(`[EXPLORER] ${getHashscanUrl(settlement.hederaTransactionId)}`)

    // 6. Audit on the Mirror Node: exactly the metered amount moved, from the buyer to payTo.
    const after = await waitForMirror(async () => {
      const b = await tokenBalance(buyer.accountId, tokenId)
      return b !== before.buyer ? { buyer: b, seller: await tokenBalance(sellerId, tokenId) } : null
    })
    show.table([
      { party: 'Buyer', before: fmt(before.buyer), after: fmt(after.buyer), change: fmt(after.buyer - before.buyer) },
      { party: 'Seller (payTo)', before: fmt(before.seller), after: fmt(after.seller), change: fmt(after.seller - before.seller) }
    ])
    if (before.buyer - after.buyer !== settledInfo.actual) throw new Error('the buyer was charged a different amount than the metered one')
    console.log(`[SUCCESS] Charged ${fmt(settledInfo.actual)}, not the ${fmt(MAX_AMOUNT)} ceiling`)

    // 7. The rules that protect the buyer (no fees: one simulation and one local check).
    try {
      await ethCall(X402_UPTO_PERMIT2_PROXY, PROXY.encodeFunctionData('settle', settleArgs(paymentPayload.payload.permit2Authorization, paymentPayload.payload.signature, 1n)), facilitatorAddress)
      throw new Error('a used authorization settled again')
    } catch (error) {
      if (error.message === 'a used authorization settled again') throw error
      console.log('[SUCCESS] Settling the same signature again reverts: Permit2 consumed its nonce')
    }
    const over = await facilitator.settle(paymentPayload, { ...requirements, amount: (MAX_AMOUNT + 1n).toString() })
    console.log(`[SUCCESS] Settling above the maximum is refused: ${over.errorReason}`)
    updateState('M10_UPTO_LAST_SETTLEMENT', settlement.hederaTransactionId)

    console.log('\n KEY CONCEPT:')
    console.log('upto: the buyer signs a ceiling, the server meters, the facilitator settles the actual amount.')
    console.log('\n LEARNABLE MOMENT:')
    console.log('The witness pins payee and facilitator; the Permit2 nonce makes the signature single-use.')
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    if (server) server.close()
    // Return the buyer's tokens and HBAR, then delete the throwaway account.
    if (buyer && buyerClient) {
      try {
        const left = await tokenBalance(buyer.accountId, tokenId)
        if (left > 0n) {
          await (await new TransferTransaction()
            .addTokenTransfer(tokenId, buyer.accountId, -Number(left))
            .addTokenTransfer(tokenId, operatorId, Number(left))
            .execute(buyerClient)).getReceipt(buyerClient)
        }
        await (await new AccountDeleteTransaction()
          .setAccountId(buyer.accountId)
          .setTransferAccountId(operatorId)
          .setMaxTransactionFee(new Hbar(2))
          .execute(buyerClient)).getReceipt(buyerClient)
        console.log(`[INFO] Buyer ${buyer.accountId} returned its tokens and HBAR and was deleted`)
      } catch (error) {
        console.log(`[INFO] Could not clean up the buyer ${buyer.accountId}: ${error.message}`)
      }
    }
    if (buyerClient) buyerClient.close()
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
