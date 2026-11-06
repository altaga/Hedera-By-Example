/**
 * ============================================================================
 * Lab 02: Bonos por Tramos en HTS y Pago de Cupones (Conceptos ERC-1400)
 * [CONCEPTO] Un Token por Tramo, Snapshot de Tenedores desde el Mirror Node y Pago Atómico de Cupones
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * ERC-1400 modela un valor con "particiones" (p. ej. Senior vs. Mezzanine) dentro de
 * un contrato EVM. En el Token Service nativo de Hedera, el mapeo fiel más simple es
 * un token HTS por tramo, con las llaves del emisor. Este lab:
 * 1. Emite dos tokens de tramo reales (Senior 6.5% / Mezzanine 9.5%).
 * 2. Distribuye bonos a tres cuentas de inversor reales y distintas.
 * 3. Toma el snapshot de tenedores del Mirror Node (/tokens/{id}/balances): la tabla
 *    de capitalización on-chain, no una lista local.
 * 4. Paga el cupón trimestral a cada tenedor en UNA TransferTransaction atómica,
 *    calculada con el snapshot, y verifica el cambio de saldo HBAR de cada tenedor.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Esto NO es un contrato ERC-1400 y no usa el Asset Tokenization Studio: las particiones
 * son tokens HTS separados y los montos de cupón están escalados a tinybars para testnet.
 * Para un bono en producción con semántica ERC-1400/ERC-3643 (acciones corporativas,
 * particiones, módulos de cumplimiento) usa el Asset Tokenization Studio de Hedera.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/define-a-token
 * - https://docs.hedera.com/hedera/sdks-and-apis/rest-api/tokens
 * - https://github.com/hashgraph/asset-tokenization-studio
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M11 Lab 01: Transferencias RWA con Permisos — Registro de Identidad + KYC de HTS (Conceptos ERC-3643)
 * - Siguiente: M11 Lab 03: Roles de Stablecoin en HTS (Conceptos de Stablecoin Studio)
 *
 * [ SECUENCIA ]
 * Emisor -> Hedera: Crea los tokens de tramo Senior y Mezzanine
 * Emisor -> Inversores: Distribuye los bonos
 * Emisor -> MirrorNode: Lee los saldos de tenedores (tabla de capitalización)
 * Emisor -> Inversores: Una transferencia atómica de cupones a todos los tenedores
 *
 * [ SIMULADO ]
 * La fecha del cupón es "ahora" en lugar de un cierre de trimestre real, y los montos están escalados a tinybars. Los tokens, tenedores, snapshot y pagos son reales y van a cuentas distintas.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (crea 3 cuentas de inversor desechables y 2 tokens).
 * - Costo: ~18 ℏ (crear el token ~15 ℏ en testnet) + ~0.3 ℏ para cuentas desechables + comisiones.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/02_security_token_erc1400_bonds.js
 * ============================================================================
 */

import {
  Hbar,
  TokenCreateTransaction,
  TokenSupplyType,
  TokenType,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { createLabAccount, getClient, getHashscanUrl, getMirrorHbarTinybars, getMirrorNodeBaseUrl, sleep, updateState, waitForMirror } from '../M99_Utilities/index.js'

const BOND = {
  issuer: 'Hedera Renewable Energy Holdings Inc.',
  isin: 'US42312A1099',
  tranches: [
    { id: 'SENIOR', symbol: 'GRE31-SR', couponApy: 0.065, units: 500 },
    { id: 'MEZZANINE', symbol: 'GRE31-MZ', couponApy: 0.095, units: 250 }
  ]
}
// Escala testnet: cada unidad de bono tiene un "valor nominal" de 100,000 tinybars (0.001 ℏ).
const FACE_VALUE_TINYBARS = 100_000

const createTranche = async (client, operatorId, tranche) => {
  const receipt = await (await new TokenCreateTransaction()
    .setTokenName(`Green Energy 2031 Bond ${tranche.id}`)
    .setTokenSymbol(tranche.symbol)
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(0)
    .setInitialSupply(tranche.units)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(tranche.units)
    .setTreasuryAccountId(operatorId)
    .setAdminKey(client.operatorPublicKey)
    .setFreezeKey(client.operatorPublicKey)
    .setWipeKey(client.operatorPublicKey)
    .setTokenMemo(`bond:${BOND.isin}:tranche:${tranche.id}`)
    .execute(client)).getReceipt(client)
  return receipt.tokenId
}

/** Tabla de capitalización on-chain: cada tenedor (no tesorería) del token, desde el Mirror Node. */
const holderSnapshot = async (tokenId, treasury, expectedHolders) => waitForMirror(async () => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/tokens/${tokenId}/balances?limit=100`)
  if (!res.ok) return null
  const holders = (await res.json()).balances.filter((b) => b.account !== treasury && b.balance > 0)
  return holders.length >= expectedHolders ? holders : null
})

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Bonos por Tramos en HTS y Pago de Cupones ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Tokens de tramo
    console.log(`[PROCESO] Paso 1: Emitiendo tokens de tramo para ${BOND.issuer} (ISIN ${BOND.isin})...`)
    for (const t of BOND.tranches) {
      t.tokenId = await createTranche(client, operatorId, t)
      console.log(`[ÉXITO] ${t.id} tramo: ${t.tokenId} | ${t.units} unidades | ${(t.couponApy * 100).toFixed(1)}% APY`)
    }

    // 2. Inversores reales y asignación
    console.log('\n[PROCESO] Paso 2: Creando 3 cuentas de inversor y asignando bonos...')
    const investors = []
    for (let i = 0; i < 3; i++) investors.push(await createLabAccount(client, { hbar: 0.1 }))
    const [sr, mz] = BOND.tranches
    const allocation = new TransferTransaction()
      .addTokenTransfer(sr.tokenId, operatorId, -300)
      .addTokenTransfer(sr.tokenId, investors[0].accountId, 200)
      .addTokenTransfer(sr.tokenId, investors[1].accountId, 100)
      .addTokenTransfer(mz.tokenId, operatorId, -150)
      .addTokenTransfer(mz.tokenId, investors[1].accountId, 50)
      .addTokenTransfer(mz.tokenId, investors[2].accountId, 100)
    const allocRes = await allocation.execute(client)
    await allocRes.getReceipt(client)
    console.log(`[ÉXITO] Asignación ${allocRes.transactionId}`)
    investors.forEach((inv, i) => console.log(`[REGISTRO] Inversor ${i + 1}: ${inv.accountId}`))

    // 3. Snapshot de tenedores desde el Mirror Node
    console.log('\n[PROCESO] Paso 3: Leyendo la tabla de capitalización on-chain desde el Mirror Node...')
    const payouts = new Map()
    for (const t of BOND.tranches) {
      const holders = await holderSnapshot(t.tokenId.toString(), operatorId.toString(), 2)
      if (!holders) throw new Error(`El Mirror Node no devolvió tenedores para ${t.tokenId}`)
      const perUnit = Math.floor(FACE_VALUE_TINYBARS * t.couponApy / 4)
      for (const h of holders) {
        const amount = h.balance * perUnit
        payouts.set(h.account, (payouts.get(h.account) || 0) + amount)
        console.log(`[SNAPSHOT] ${t.id} tenedor ${h.account}: ${h.balance} unidades -> cupón ${amount} tinybars`)
      }
    }

    // 4. Un pago atómico de cupones a todos los tenedores
    console.log('\n[PROCESO] Paso 4: Pagando el cupón trimestral a todos los tenedores en una transacción...')
    const before = Object.fromEntries(await Promise.all([...payouts.keys()].map(async (a) => [a, await getMirrorHbarTinybars(a)])))
    const total = [...payouts.values()].reduce((s, v) => s + v, 0)
    const couponTx = new TransferTransaction()
      .addHbarTransfer(operatorId, Hbar.fromTinybars(-total))
      .setTransactionMemo(`bond:${BOND.isin}:coupon`)
    for (const [account, amount] of payouts) couponTx.addHbarTransfer(account, Hbar.fromTinybars(amount))
    const couponRes = await couponTx.execute(client)
    const couponReceipt = await couponRes.getReceipt(client)
    console.log(`[ÉXITO] Pago de cupones ${couponReceipt.status} — ${couponRes.transactionId}`)
    console.log(`[EXPLORADOR] ${getHashscanUrl(couponRes)}`)

    await sleep(6000)
    for (const [account, amount] of payouts) {
      const delta = (await getMirrorHbarTinybars(account)) - before[account]
      console.log(`[VERIFICACIÓN] ${account}: esperado +${amount}, el Mirror Node muestra +${delta} tinybars`)
    }

    updateState('BOND_SENIOR_TOKEN_ID', sr.tokenId.toString())
    updateState('BOND_MEZZANINE_TOKEN_ID', mz.tokenId.toString())
    updateState('BOND_COUPON_TX_ID', couponRes.transactionId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('El cupón se calculó con la tabla de capitalización on-chain y se pagó a cada tenedor')
    console.log('de forma atómica. Los tramos son tokens HTS separados; las particiones ERC-1400 viven en contratos de ATS.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló el lab de bonos:', error.message)
    process.exit(1)
  } finally {
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
