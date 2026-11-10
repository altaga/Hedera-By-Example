/**
 * ============================================================================
 * Lab 09: Pagos Medidos con el Esquema upto de x402
 * [CONCEPTO] Firma un Tope, Paga lo que se Usó (Permit2 en la EVM de Hedera)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En el esquema `exact` de x402 el comprador firma el precio. El esquema `upto` es
 * para cobro por uso: el comprador firma un MÁXIMO, el servidor mide la solicitud
 * y el facilitador liquida el monto real (<= el máximo, incluso 0). En EVM usa
 * permitWitnessTransferFrom de Permit2 a través del contrato x402UptoPermit2Proxy.
 * Ambos están desplegados en testnet de Hedera en sus direcciones canónicas, así
 * que este lab ejecuta la especificación EVM tal cual en eip155:296: un
 * approve(Permit2) ERC-20 de una sola vez a través de la fachada ERC-20 del token
 * HTS, una firma EIP-712 PermitWitnessTransferFrom (witness: to, facilitator,
 * validAfter), las siete verificaciones y settle() por el monto medido.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El witness amarra el beneficiario y el facilitador dentro de la firma, y el nonce de Permit2 la hace de un solo uso: un servidor puede cobrar menos que el tope, pero nunca más, nunca a otra dirección, nunca por otro facilitador y nunca dos veces. El riesgo del comprador es el tope que eligió, así que conviene que sea pequeño.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://github.com/coinbase/x402/blob/main/specs/schemes/upto/scheme_upto.md
 * - https://github.com/coinbase/x402/blob/main/specs/schemes/upto/scheme_upto_evm.md
 * - https://github.com/coinbase/x402/blob/main/contracts/evm/src/x402UptoPermit2Proxy.sol
 * - https://github.com/Uniswap/permit2
 * - https://hips.hedera.com/hip/hip-218
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 08: Liquidación entre Dos Partes (el Comercio como Facilitador)
 * - Siguiente: M10 Lab 10: Agente de Comercio con el Hedera Agent Kit
 *
 * [ SECUENCIA ]
 * Comprador -> Hedera: approve(Permit2) en la fachada ERC-20 del token (una vez)
 * Comprador -> Servidor: GET /api/v1/mirror/latest-transactions
 * Servidor -> Comprador: 402 PAYMENT-REQUIRED (esquema upto, amount = máximo)
 * Note Comprador: Firma PermitWitnessTransferFrom (EIP-712)
 * Comprador -> Servidor: Reintenta con PAYMENT-SIGNATURE
 * Servidor -> Facilitador: verify (amount = máximo)
 * Note Servidor: Entrega los datos y mide los bytes
 * Servidor -> Facilitador: settle (amount = real)
 * Facilitador -> Hedera: x402UptoPermit2Proxy.settle(permit, real, owner, witness, firma)
 * Servidor -> Comprador: 200 OK + PAYMENT-RESPONSE
 *
 * [ SIMULADO ]
 * Nada on-chain es simulado: el token, el approve, las verificaciones de firma, la liquidación por Permit2 y la auditoría son operaciones reales en testnet. El servidor y el facilitador son funciones de este script (en el navegador el servidor corre en la página).
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es la tesorería del token y el facilitador (paga el gas de settle()).
 * - Wallets de práctica: ACCOUNT_2 es el vendedor (payTo). El comprador es una cuenta ECDSA desechable con alias EVM (Permit2 recupera la dirección del firmante), que se borra al final.
 * - Costo: ~15 ℏ la primera vez (token); luego unos 1-2 ℏ por ejecución (cuenta del comprador, approve, settle).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/09_upto_metered_payments.js
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

// Direcciones canónicas del anexo de la especificación; ambas existen en testnet de Hedera.
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const X402_UPTO_PERMIT2_PROXY = '0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002'
const NETWORK = 'eip155:296' // chain id 296 de testnet de Hedera, en formato CAIP-2
const CHAIN_ID = 296

// Tipos EIP-712 exactamente como los firma @x402/evm (uptoPermit2WitnessTypes).
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
const MAX_AMOUNT = 200_000n // tope de 0.20 tUSD
const PRICE_PER_KB = 1_000n // 0.001 tUSD por KB entregado

const longZero = (id) => `0x${AccountId.fromString(String(id)).toEvmAddress()}`
const fmt = (units) => `${(Number(units) / 10 ** DECIMALS).toFixed(6)} tUSD`

const rpc = async (method, params) => {
  const res = await fetch(getJsonRpcUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const body = await res.json()
  if (body.error) throw new Error(body.error.message + (body.error.data ? ` ${body.error.data}` : ''))
  return body.result
}
const ethCall = (to, data, from) => rpc('eth_call', [{ to, data, ...(from ? { from } : {}) }, 'latest'])

/** Los argumentos de settle(), con la forma del ABI del proxy. */
const settleArgs = (auth, signature, amount) => [
  [[auth.permitted.token, BigInt(auth.permitted.amount)], BigInt(auth.nonce), BigInt(auth.deadline)],
  amount,
  auth.from,
  [auth.witness.to, auth.witness.facilitator, BigInt(auth.witness.validAfter)],
  signature
]

/** El lado del comprador, como lo arma createUptoPermit2Payload de @x402/evm. */
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

/** El facilitador: las reglas de verify y settle de scheme_upto_evm.md. */
const createFacilitator = ({ client, facilitatorAddress, proxyContractId }) => {
  const verify = async (paymentPayload, requirements) => {
    const { signature, permit2Authorization: auth } = paymentPayload.payload
    const fail = (reason) => ({ isValid: false, invalidReason: reason })
    // 1. La firma recupera a `from`.
    if (recoverSigner(auth, signature).toLowerCase() !== auth.from.toLowerCase()) return fail('invalid_upto_evm_payload_signature')
    // 2. El cliente aprobó a Permit2 por al menos `amount`.
    const allowance = BigInt(await ethCall(auth.permitted.token, ERC20.encodeFunctionData('allowance', [auth.from, PERMIT2_ADDRESS])))
    if (allowance < BigInt(requirements.amount)) return { ...fail('PERMIT2_ALLOWANCE_REQUIRED'), httpStatus: 412 }
    // 3. El cliente tiene saldo suficiente del activo.
    const balance = BigInt(await ethCall(auth.permitted.token, ERC20.encodeFunctionData('balanceOf', [auth.from])))
    if (balance < BigInt(requirements.amount)) return fail('insufficient_funds')
    // 4. Al verificar, el máximo firmado es igual a requirements.amount.
    if (BigInt(auth.permitted.amount) !== BigInt(requirements.amount)) return fail('invalid_upto_evm_payload_amount_mismatch')
    // 5. Ventana de tiempo.
    const now = Math.floor(Date.now() / 1000)
    if (BigInt(auth.deadline) <= BigInt(now)) return fail('invalid_upto_evm_payload_deadline')
    if (BigInt(auth.witness.validAfter) > BigInt(now)) return fail('invalid_upto_evm_payload_not_yet_valid')
    // 6. Coinciden token, red, beneficiario, spender y facilitador.
    if (paymentPayload.accepted.network !== requirements.network) return fail('invalid_network')
    if (auth.permitted.token.toLowerCase() !== requirements.asset.toLowerCase()) return fail('invalid_upto_evm_payload_asset')
    if (auth.witness.to.toLowerCase() !== requirements.payTo.toLowerCase()) return fail('invalid_upto_evm_payload_recipient')
    if (auth.spender.toLowerCase() !== X402_UPTO_PERMIT2_PROXY.toLowerCase()) return fail('invalid_upto_evm_payload_spender')
    if (auth.witness.facilitator.toLowerCase() !== facilitatorAddress.toLowerCase()) return fail('invalid_upto_evm_payload_facilitator')
    // 7. Simula settle() con el monto completo (peor caso), desde la dirección del facilitador.
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
    // Verificación al liquidar: la firma se revisa contra permitted.amount, el tope.
    if (recoverSigner(auth, signature).toLowerCase() !== auth.from.toLowerCase()) return { success: false, errorReason: 'invalid_upto_evm_payload_signature', transaction: '', network: NETWORK, amount: '0' }
    if (amount > BigInt(auth.permitted.amount)) return { success: false, errorReason: 'invalid_upto_evm_payload_settlement_exceeds_amount', transaction: '', network: NETWORK, amount: '0' }
    // Una liquidación de cero no necesita transacción: la autorización expira sin usarse.
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

/** El servidor del recurso: 402 con un requisito upto, y luego mide los bytes que entrega. */
const startServer = ({ requirements, facilitator, onSettled }) => {
  const server = http.createServer(async (req, res) => {
    const send = (status, headers, body) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    const signatureHeader = req.headers['payment-signature']
    if (!signatureHeader) {
      const paymentRequired = { x402Version: 2, error: 'PAYMENT-SIGNATURE header is required', resource: { url: RESOURCE, description: 'Últimas transacciones de testnet, con precio por KB entregado', mimeType: 'application/json' }, accepts: [requirements] }
      return send(402, { 'payment-required': encodeHeader(paymentRequired) }, paymentRequired)
    }
    const paymentPayload = decodeHeader(signatureHeader)
    const verification = await facilitator.verify(paymentPayload, requirements)
    if (!verification.isValid) return send(verification.httpStatus || 402, {}, { x402Version: 2, error: verification.invalidReason })

    // El trabajo: datos reales del Mirror Node, medidos por tamaño.
    const data = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions?limit=25&order=desc`).then((r) => r.text())
    const bytes = BigInt(Buffer.byteLength(data))
    const metered = ((bytes + 1023n) / 1024n) * PRICE_PER_KB
    const actual = metered < BigInt(requirements.amount) ? metered : BigInt(requirements.amount)

    // Al liquidar, requirements.amount lleva el monto real.
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
  console.log('--- INICIO DE SESIÓN: Esquema upto de x402 (Permit2 en Hedera) ---\n')
  const { client, operatorId } = getClient()
  const sellerId = process.env.ACCOUNT_2_ID
  const sellerKey = process.env.ACCOUNT_2_PRIVATE_KEY
  if (!sellerId || !sellerKey) {
    console.error('[FALLO] Falta ACCOUNT_2 (el vendedor) en .env.')
    process.exitCode = 1
    return
  }

  let server = null
  let buyer = null
  let buyerClient = null
  let tokenId = null
  try {
    // 1. El activo: un token fungible HTS, que también es un ERC-20 en su dirección long-zero (HIP-218).
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
    console.log(`[INFO] Activo ${tokenId} (ERC-20 en ${tokenAddress}), payTo ${sellerId}, facilitador ${operatorId}`)

    // El vendedor debe estar asociado al token para recibirlo.
    const sellerTokens = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${sellerId}/tokens?token.id=${tokenId}`).then((r) => r.json())
    if (!sellerTokens.tokens?.length) {
      const sellerClient = createClient(sellerId, sellerKey)
      try {
        await (await new TokenAssociateTransaction().setAccountId(sellerId).setTokenIds([tokenId]).execute(sellerClient)).getReceipt(sellerClient)
        console.log(`[ÉXITO] Vendedor ${sellerId} asociado a ${tokenId}`)
      } finally {
        sellerClient.close()
      }
    }

    // 2. El comprador: una cuenta ECDSA con alias EVM, para que la dirección que recupera Permit2 sea la cuenta.
    buyer = await createLabAccount(client, { hbar: 3, ecdsa: true, autoAssociations: 1 })
    const wallet = new ethers.Wallet(`0x${buyer.privateKey.toStringRaw()}`)
    console.log(`[ÉXITO] Comprador ${buyer.accountId} (alias EVM ${wallet.address})`)
    await (await new TransferTransaction()
      .addTokenTransfer(tokenId, operatorId, -1_000_000)
      .addTokenTransfer(tokenId, buyer.accountId, 1_000_000)
      .execute(client)).getReceipt(client)
    console.log(`[ÉXITO] Se fondeó al comprador con ${fmt(1_000_000)}`)

    // 3. Fase 1 (una vez): el comprador aprueba a Permit2 en la fachada ERC-20 del token.
    buyerClient = createClient(buyer.accountId.toString(), buyer.privateKey)
    const approveData = Buffer.from(ERC20.encodeFunctionData('approve', [PERMIT2_ADDRESS, MAX_AMOUNT * 5n]).slice(2), 'hex')
    const approval = await executeWithGas((gas) => new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(tokenId.toString()))
      .setGas(gas)
      .setFunctionParameters(approveData), buyerClient, { gas: 1_000_000 })
    console.log(`[ÉXITO] approve(Permit2, ${fmt(MAX_AMOUNT * 5n)}) en la fachada: ${approval.transactionId}`)
    await waitForMirror(async () => BigInt(await ethCall(tokenAddress, ERC20.encodeFunctionData('allowance', [wallet.address, PERMIT2_ADDRESS]))) >= MAX_AMOUNT, { timeoutMs: 30_000 })

    // 4. El servidor y su facilitador.
    const proxy = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/contracts/${X402_UPTO_PERMIT2_PROXY}`).then((r) => r.json())
    const facilitator = createFacilitator({ client, facilitatorAddress, proxyContractId: ContractId.fromString(proxy.contract_id) })
    const requirements = { scheme: 'upto', network: NETWORK, amount: MAX_AMOUNT.toString(), asset: tokenAddress, payTo, maxTimeoutSeconds: 300, extra: { name: 'tUSD', version: '1', facilitatorAddress } }
    let settledInfo = null
    server = await startServer({ requirements, facilitator, onSettled: (info) => { settledInfo = info } })
    console.log(`[INFO] Servidor del recurso en ${RESOURCE} (x402UptoPermit2Proxy es ${proxy.contract_id})`)

    // 5. La solicitud del comprador: 402, firma el tope, reintenta.
    const before = { buyer: await tokenBalance(buyer.accountId, tokenId), seller: await tokenBalance(sellerId, tokenId) }
    const first = await fetch(RESOURCE)
    const paymentRequired = decodeHeader(first.headers.get('payment-required'))
    const offer = paymentRequired.accepts[0]
    console.log(`\n[REGISTRO] HTTP ${first.status}: esquema ${offer.scheme}, red ${offer.network}, máximo ${fmt(offer.amount)}, facilitador ${offer.extra.facilitatorAddress}`)
    const paymentPayload = await createUptoPermit2Payload(wallet, offer)
    console.log('[ÉXITO] PermitWitnessTransferFrom firmado (EIP-712, dominio Permit2 / cadena 296):')
    show.json(paymentPayload.payload.permit2Authorization)

    const paid = await fetch(RESOURCE, { headers: { 'payment-signature': encodeHeader(paymentPayload) } })
    if (paid.status !== 200) throw new Error(`el servidor respondió ${paid.status}: ${await paid.text()}`)
    const settlement = decodeHeader(paid.headers.get('payment-response'))
    await paid.text()
    console.log(`[ÉXITO] HTTP 200: ${settledInfo.bytes.toLocaleString('es-MX')} bytes entregados → se midieron ${fmt(settledInfo.actual)} de un máximo de ${fmt(MAX_AMOUNT)}`)
    show.json(settlement)
    console.log(`[EXPLORER] ${getHashscanUrl(settlement.hederaTransactionId)}`)

    // 6. Auditoría en el Mirror Node: se movió exactamente el monto medido, del comprador a payTo.
    const after = await waitForMirror(async () => {
      const b = await tokenBalance(buyer.accountId, tokenId)
      return b !== before.buyer ? { buyer: b, seller: await tokenBalance(sellerId, tokenId) } : null
    })
    show.table([
      { parte: 'Comprador', antes: fmt(before.buyer), después: fmt(after.buyer), cambio: fmt(after.buyer - before.buyer) },
      { parte: 'Vendedor (payTo)', antes: fmt(before.seller), después: fmt(after.seller), cambio: fmt(after.seller - before.seller) }
    ])
    if (before.buyer - after.buyer !== settledInfo.actual) throw new Error('al comprador se le cobró un monto distinto al medido')
    console.log(`[ÉXITO] Se cobraron ${fmt(settledInfo.actual)}, no el tope de ${fmt(MAX_AMOUNT)}`)

    // 7. Las reglas que protegen al comprador (sin comisiones: una simulación y una verificación local).
    try {
      await ethCall(X402_UPTO_PERMIT2_PROXY, PROXY.encodeFunctionData('settle', settleArgs(paymentPayload.payload.permit2Authorization, paymentPayload.payload.signature, 1n)), facilitatorAddress)
      throw new Error('una autorización usada se liquidó otra vez')
    } catch (error) {
      if (error.message === 'una autorización usada se liquidó otra vez') throw error
      console.log('[ÉXITO] Liquidar la misma firma otra vez revierte: Permit2 consumió su nonce')
    }
    const over = await facilitator.settle(paymentPayload, { ...requirements, amount: (MAX_AMOUNT + 1n).toString() })
    console.log(`[ÉXITO] Liquidar por encima del máximo se rechaza: ${over.errorReason}`)
    updateState('M10_UPTO_LAST_SETTLEMENT', settlement.hederaTransactionId)

    console.log('\n CONCEPTO CLAVE:')
    console.log('upto: el comprador firma un tope, el servidor mide y el facilitador liquida el monto real.')
    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('El witness fija beneficiario y facilitador; el nonce de Permit2 hace la firma de un solo uso.')
    console.log('\n--- SESIÓN COMPLETADA ---')
  } finally {
    if (server) server.close()
    // Devuelve los tokens y HBAR del comprador y luego borra la cuenta desechable.
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
        console.log(`[INFO] El comprador ${buyer.accountId} devolvió sus tokens y HBAR y se borró`)
      } catch (error) {
        console.log(`[INFO] No se pudo limpiar al comprador ${buyer.accountId}: ${error.message}`)
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
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
