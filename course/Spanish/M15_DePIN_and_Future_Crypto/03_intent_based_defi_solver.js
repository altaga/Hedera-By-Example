/**
 * ============================================================================
 * Lab 03: Solver de Liquidación DeFi Basado en Intenciones (ERC-7683 / CoW Swap)
 * [CONCEPTO] Declaraciones Criptográficas Fuera de Cadena y Ejecución Atómica Multi-Pata
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En los creadores de mercado automatizados (AMM) tradicionales, los usuarios transmiten
 * transacciones a un mempool donde bots de arbitraje ejecutan ataques sandwich, extraen
 * MEV y provocan deslizamiento de precio (slippage). En una arquitectura basada en
 * intenciones (estandarizada por ERC-7683), los usuarios firman "intenciones" declarativas
 * fuera de la cadena (ej. "Deseo intercambiar X por al menos Y antes del tiempo T").
 * Solvers especializados fuera de cadena emparejan Coincidencias de Deseos (CoW) entre
 * contrapartes o enrutan liquidez privada, liquidando el intercambio atómicamente en
 * Hedera mediante una `TransferTransaction` de múltiples patas con balance neto cero.
 *
 * Cada maker firma una `GaslessCrossChainOrder` de ERC-7683 con EIP-712, usando la llave de
 * su propia cuenta de Hedera, para que el solver pueda probar quién aceptó qué antes de liquidar.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Una sola `TransferTransaction` de Hedera puede llevar juntas la pata de HBAR y la del
 * token. Necesita la firma de cada cuenta que debita, y si una pata falla (por ejemplo,
 * un saldo insuficiente) no ocurre ninguna.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M15 Lab 02: Telemetría DePIN Ligera de Cadena de Frío (API Key + HMAC-SHA256)
 * - Siguiente: M15 Lab 04: Autenticador Biométrico Passkeys y WebAuthn P-256
 *
 * [ REFERENCIAS OFICIALES ]
 * - Estándar de Intenciones Entre Cadenas ERC-7683: https://eips.ethereum.org/EIPS/eip-7683
 * - Documentación de Transferencias Atómicas en Hedera: https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/transfer-cryptocurrency
 * - Arquitectura del Protocolo CoW: https://docs.cow.fi/overview/introduction
 *
 * [ SECUENCIA ]
 * Alice -> Solver: Orden firmada con EIP-712: HBAR por tUSD
 * Bob -> Solver: Orden firmada con EIP-712: tUSD por HBAR
 * Nota Solver: Recupera cada firmante y comprueba que sea la llave on-chain de la cuenta
 * Solver -> Hedera: Una TransferTransaction con ambas patas (firmada por Alice y Bob)
 * Solver -> Hedera: Registro de liquidación en HCS
 *
 * [ SIMULADO ]
 * Alice, Bob y el solver corren en un solo proceso (en producción son partes distintas). No existe un
 * contrato settler de ERC-7683 en Hedera, así que `originSettler` es la dirección cero y el solver
 * verifica él mismo las firmas EIP-712. tUSD es un stablecoin de prueba que crea este lab, no USDC.
 * Ambas patas, las firmas y el registro en HCS son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: ~15 ℏ la primera vez (crea el token tUSD, cerca de 1 USD); <1 ℏ al volver a ejecutarlo (lo reutiliza). Alice le envía 0.5 HBAR a Bob en el intercambio.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M15_DePIN_and_Future_Crypto/03_intent_based_defi_solver.js
 * ============================================================================
 */

import {
  TransferTransaction,
  Hbar,
  TokenCreateTransaction,
  TokenAssociateTransaction,
  TokenType,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  AccountId,
  PrivateKey,
  TokenId
} from '@hiero-ledger/sdk'
import { ethers } from 'ethers'
import { getClient, updateState, getHashscanUrl, requireEnv, reuseToken, reuseTopic, getMirrorNodeBaseUrl, sleep } from '../M99_Utilities/index.js'

const CHAIN_ID = 296 // chain ID EVM de Hedera testnet
const HBAR_ADDRESS = ethers.ZeroAddress // HBAR nativo en los datos de la orden
const ALICE_SELLS_TINYBARS = 50_000_000n // 0.5 HBAR

// GaslessCrossChainOrder de ERC-7683, firmada con EIP-712 (https://eips.ethereum.org/EIPS/eip-7683)
const DOMAIN = { name: 'HBE Intent Settler', version: '1', chainId: CHAIN_ID }
const ORDER_TYPES = {
  GaslessCrossChainOrder: [
    { name: 'originSettler', type: 'address' },
    { name: 'user', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'originChainId', type: 'uint256' },
    { name: 'openDeadline', type: 'uint32' },
    { name: 'fillDeadline', type: 'uint32' },
    { name: 'orderDataType', type: 'bytes32' },
    { name: 'orderData', type: 'bytes' }
  ]
}
// Los datos de la orden son un swap: lo que da el maker y lo mínimo que acepta a cambio.
const SWAP_TYPE = 'Swap(address sellToken,uint256 sellAmount,address buyToken,uint256 minBuyAmount)'
const SWAP_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes(SWAP_TYPE))
const coder = ethers.AbiCoder.defaultAbiCoder()

const signOrder = async (wallet, swap) => {
  const now = Math.floor(Date.now() / 1000)
  const order = {
    originSettler: ethers.ZeroAddress, // no hay contrato settler en Hedera: el solver verifica fuera de cadena
    user: wallet.address,
    nonce: BigInt(ethers.hexlify(ethers.randomBytes(8))),
    originChainId: CHAIN_ID,
    openDeadline: now + 3600,
    fillDeadline: now + 3600,
    orderDataType: SWAP_TYPEHASH,
    orderData: coder.encode(['address', 'uint256', 'address', 'uint256'], [swap.sellToken, swap.sellAmount, swap.buyToken, swap.minBuyAmount])
  }
  return { order, swap, signature: await wallet.signTypedData(DOMAIN, ORDER_TYPES, order) }
}

// La dirección EVM de la llave que la cuenta tiene on-chain (leída del Mirror Node).
const onChainKeyAddress = async (accountId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
  if (!res.ok) throw new Error(`El Mirror Node no tiene la cuenta ${accountId}`)
  const { key } = await res.json()
  if (key?._type !== 'ECDSA_SECP256K1') throw new Error(`${accountId} necesita una llave ECDSA para firmar órdenes EIP-712 (tiene ${key?._type}).`)
  return ethers.computeAddress('0x' + key.key)
}

const tokenBalance = async (accountId, tokenId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`)
  const data = res.ok ? await res.json() : {}
  return data.tokens?.length ? Number(data.tokens[0].balance) : null // null = no asociada
}

async function main () {
  console.log('====================================================================')
  console.log('LAB DEFI 03: SOLVER DE LIQUIDACIÓN POR INTENCIONES (ERC-7683 / COW)')
  console.log('====================================================================\n')

  const { client, operatorId, operatorKey, network } = getClient()

  try {
    const aliceId = AccountId.fromString(operatorId.toString())
    const aliceKey = PrivateKey.fromStringDer(operatorKey)
    const bobId = AccountId.fromString(requireEnv('ACCOUNT_1_ID'))
    const bobKey = PrivateKey.fromStringDer(requireEnv('ACCOUNT_1_PRIVATE_KEY'))
    console.log(`[OPERADOR] Alice (maker A) = ${aliceId} | Bob (maker B) = ${bobId} | red ${network}`)

    // 1. El stablecoin de prueba y el tópico de auditoría (se reutilizan en ejecuciones posteriores)
    console.log('\n[1/6] Preparando el stablecoin de prueba tUSD y el tópico de auditoría...')
    const tusdId = await reuseToken('REUSE_M15_03_TUSD', async () => {
      const tx = await new TokenCreateTransaction()
        .setTokenName('HBE Test USD')
        .setTokenSymbol('tUSD')
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(2)
        .setInitialSupply(1_000_000) // 10,000.00 tUSD en la tesorería (Alice)
        .setTreasuryAccountId(aliceId)
        .execute(client)
      return (await tx.getReceipt(client)).tokenId
    })
    const topicId = await reuseTopic('REUSE_M15_03_TOPIC', async () =>
      (await (await new TopicCreateTransaction().setTopicMemo('Liquidaciones del solver de intenciones HBE').execute(client)).getReceipt(client)).topicId)
    console.log(`[REGISTRO] Token tUSD: ${tusdId} | tópico de auditoría: ${topicId}`)

    // Bob necesita tUSD para vender: se le asocia y se le da algo de la tesorería si hace falta.
    let bobTusd = await tokenBalance(bobId, tusdId)
    if (bobTusd === null) {
      console.log(`[PROCESO] Asociando a Bob (${bobId}) con tUSD...`)
      const assoc = await new TokenAssociateTransaction().setAccountId(bobId).setTokenIds([tusdId]).freezeWith(client)
      await (await (await assoc.sign(bobKey)).execute(client)).getReceipt(client)
      bobTusd = 0
    }
    if (bobTusd < 100) {
      console.log('[PROCESO] Enviando 1.00 tUSD de la tesorería a Bob...')
      await (await new TransferTransaction().addTokenTransfer(tusdId, aliceId, -100).addTokenTransfer(tusdId, bobId, 100).execute(client)).getReceipt(client)
    }

    // 2. Precio a partir del tipo de cambio actual de la red
    const rateRes = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/network/exchangerate`)
    const { current_rate: rate } = await rateRes.json()
    const usdPerHbar = rate.cent_equivalent / rate.hbar_equivalent / 100
    const tusdUnits = BigInt(Math.max(1, Math.floor(Number(ALICE_SELLS_TINYBARS) / 1e8 * usdPerHbar * 100))) // tUSD tiene 2 decimales
    console.log(`\n[2/6] Tipo de cambio: 1 HBAR = $${usdPerHbar.toFixed(4)} -> 0.5 HBAR equivalen a ${(Number(tusdUnits) / 100).toFixed(2)} tUSD`)

    // 3. Ambos makers firman órdenes ERC-7683 con las llaves de sus propias cuentas
    console.log('\n[3/6] Los makers firman GaslessCrossChainOrders de ERC-7683 (EIP-712)...')
    const tusdAddress = '0x' + TokenId.fromString(tusdId.toString()).toEvmAddress()
    const aliceWallet = new ethers.Wallet('0x' + aliceKey.toStringRaw())
    const bobWallet = new ethers.Wallet('0x' + bobKey.toStringRaw())
    const aliceOrder = await signOrder(aliceWallet, { sellToken: HBAR_ADDRESS, sellAmount: ALICE_SELLS_TINYBARS, buyToken: tusdAddress, minBuyAmount: tusdUnits })
    const bobOrder = await signOrder(bobWallet, { sellToken: tusdAddress, sellAmount: tusdUnits, buyToken: HBAR_ADDRESS, minBuyAmount: ALICE_SELLS_TINYBARS })
    console.log(`[REGISTRO] Alice firma: da 0.5 HBAR, quiere >= ${tusdUnits} unidades de tUSD | firma ${aliceOrder.signature.slice(0, 18)}...`)
    console.log(`[REGISTRO] Bob firma:   da ${tusdUnits} unidades de tUSD, quiere >= 0.5 HBAR | firma ${bobOrder.signature.slice(0, 18)}...`)

    // 4. El solver verifica cada orden contra la llave on-chain del firmante y luego las empareja
    console.log('\n[4/6] El solver verifica las firmas y empareja las órdenes...')
    const makers = [[aliceOrder, aliceId], [bobOrder, bobId]]
    for (const [{ order, signature }, accountId] of makers) {
      const signer = ethers.verifyTypedData(DOMAIN, ORDER_TYPES, order, signature)
      const expected = await onChainKeyAddress(accountId)
      if (signer !== order.user || signer !== expected) throw new Error(`La orden de ${accountId} no fue firmada con la llave de su cuenta`)
      if (order.fillDeadline < Math.floor(Date.now() / 1000)) throw new Error(`La orden de ${accountId} expiró`)
      console.log(`[VERIFY] ${accountId}: el firmante EIP-712 ${signer} coincide con la llave on-chain de la cuenta`)
    }
    const a = aliceOrder.swap
    const b = bobOrder.swap
    const crosses = a.sellToken === b.buyToken && a.buyToken === b.sellToken && a.sellAmount >= b.minBuyAmount && b.sellAmount >= a.minBuyAmount
    if (!crosses) throw new Error('Las órdenes no se cruzan')
    console.log('[ÉXITO] Coincidencia de deseos: cada orden da al menos lo que pide la otra.')

    // 5. Una sola TransferTransaction liquida ambas patas; la firman Alice y Bob
    console.log('\n[5/6] Liquidando ambas patas de forma atómica en Hedera...')
    const settle = new TransferTransaction()
      .addHbarTransfer(aliceId, Hbar.fromTinybars(-Number(a.sellAmount)))
      .addHbarTransfer(bobId, Hbar.fromTinybars(Number(a.sellAmount)))
      .addTokenTransfer(tusdId, bobId, -Number(b.sellAmount))
      .addTokenTransfer(tusdId, aliceId, Number(b.sellAmount))
      .setTransactionMemo('ERC-7683 CoW settlement')
      .freezeWith(client)
    const settleRes = await (await settle.sign(bobKey)).execute(client)
    const settleReceipt = await settleRes.getReceipt(client)
    console.log(`[ÉXITO] Estado de la liquidación: ${settleReceipt.status.toString()}`)
    console.log(`[EXPLORADOR] ${getHashscanUrl(settleRes)}`)

    // Leer de vuelta en el Mirror Node las transferencias liquidadas
    let legs = null
    for (let i = 0; i < 8 && !legs; i++) {
      await sleep(2500)
      const txId = settleRes.transactionId.toString().replace('@', '-').replace(/\.(\d+)$/, '-$1')
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions/${txId}`)
      const tx = res.ok ? (await res.json()).transactions?.[0] : null
      if (tx) legs = tx
    }
    if (legs) {
      const hbarToBob = legs.transfers.find((t) => t.account === bobId.toString())?.amount
      const tusdToAlice = legs.token_transfers.find((t) => t.account === aliceId.toString() && t.token_id === tusdId.toString())?.amount
      console.log(`[VERIFY] Mirror Node: Bob recibió ${hbarToBob} tinybars y Alice ${tusdToAlice} unidades de tUSD, en una sola transacción.`)
    }

    // 6. Registro de la liquidación en HCS
    const auditRecord = {
      p: 'erc7683-hedera',
      op: 'settle_cow',
      orders: makers.map(([{ order, signature }, accountId]) => ({ account: accountId.toString(), user: order.user, nonce: order.nonce.toString(), signature })),
      settlementTxId: settleRes.transactionId.toString()
    }
    const auditRes = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(JSON.stringify(auditRecord)).execute(client)
    const auditReceipt = await auditRes.getReceipt(client)
    console.log(`\n[6/6] [ÉXITO] Liquidación registrada en el tópico HCS ${topicId}, secuencia #${auditReceipt.topicSequenceNumber}`)

    updateState('INTENT_SOLVER_TOPIC_ID', topicId.toString())
    updateState('INTENT_SOLVER_LAST_TX_ID', settleRes.transactionId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Las intenciones nunca esperan en un mempool público, así que no hay orden pendiente que adelantar ni emparedar.')
    console.log('Cada maker firmó una orden ERC-7683 con su propia llave; el solver comprobó los firmantes,')
    console.log('emparejó las órdenes y liquidó ambas patas en una sola TransferTransaction atómica de Hedera.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('La liquidación necesitó ambas firmas porque debitó ambas cuentas. Si alguno de los')
    console.log('saldos hubiera sido insuficiente, la red habría rechazado las dos patas juntas.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la ejecución del solver de intenciones:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de Ejecución:', error.message)
      process.exit(1)
    })
}
