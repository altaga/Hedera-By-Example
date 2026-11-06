/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 09: Préstamos Flash Sin Capital y Liquidación Atómica en Capa 1
 * [CONCEPTO] Préstamo, Arbitraje y Reembolso Atómico en una Única Transacción
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En Ethereum, un préstamo flash necesita un contrato de pool con callbacks; si el
 * prestatario no devuelve el préstamo en la misma llamada, todo se revierte.
 * En Hedera, UNA TransferTransaction puede mover HBAR y tokens entre varias cuentas,
 * firmada por cada parte, y la red la aplica completa o no aplica nada.
 * Este lab lo ejecuta con cuatro cuentas de testnet reales y distintas y un token HTS real:
 *   - Tramo 1: El Vault presta el principal al Arbitrajista.
 *   - Tramo 2: El Arbitrajista compra 100 FLASH al Mercado Alpha por el principal.
 *   - Tramo 3: El Arbitrajista vende los 100 FLASH al Mercado Beta con +0.5%.
 *   - Tramo 4: El Arbitrajista devuelve principal + comisión de 0.09% al Vault y se queda el spread.
 * Después, un segundo intento con un principal que Beta no puede cubrir se rechaza completo.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Hedera compensa todos los tramos por cuenta antes de verificar saldos: el préstamo y
 * el reembolso del vault se reducen a "+comisión". La atomicidad viene de la transacción,
 * no de un contrato.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/transfer-cryptocurrency
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M4 Lab 08: Libro de Órdenes en Memoria y Liquidación L1 Triangular
 * - Siguiente: M5 Lab 01: Temas Inmutables
 *
 * [SECUENCIA]
 * Vault, Arbitrajista, Alpha, Beta -> Hedera: Una transacción: préstamo + compra + venta + reembolso
 * Note Hedera: Todos los tramos se compensan por cuenta y se verifican en consenso
 * Hedera -> Arbitrajista: Se liquida solo si cada parte puede pagar su monto neto
 *
 * [SIMULADO]
 * Los dos "mercados" son cuentas desechables con precios fijos, no exchanges reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (crea 4 cuentas desechables y un token FLASH).
 * - Costo: ~0.6 ℏ para cuentas desechables + comisiones.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M4_Token_Operations_Atomic_Swaps/09_atomic_flash_settlement.js
 * ============================================================================
 */

import { Hbar, TokenCreateTransaction, TokenType, TransferTransaction } from '@hiero-ledger/sdk'
import { createLabAccount, getClient, getHashscanUrl, getMirrorHbarTinybars, sleep, updateState } from '../M99_Utilities/index.js'

const FEE_BPS = 9 // comisión flash de 0.09%
const SPREAD = 0.005 // Beta paga +0.5%
const UNITS = 100

const buildFlashTx = (client, parties, tokenId, principal) => {
  const { vault, arb, alpha, beta } = parties
  const fee = Math.ceil((principal * FEE_BPS) / 10000)
  const sale = Math.floor(principal * (1 + SPREAD))
  const tx = new TransferTransaction()
    // Tramo 1: préstamo
    .addHbarTransfer(vault.accountId, Hbar.fromTinybars(-principal))
    .addHbarTransfer(arb.accountId, Hbar.fromTinybars(principal))
    // Tramo 2: compra a Alpha
    .addHbarTransfer(arb.accountId, Hbar.fromTinybars(-principal))
    .addHbarTransfer(alpha.accountId, Hbar.fromTinybars(principal))
    .addTokenTransfer(tokenId, alpha.accountId, -UNITS)
    .addTokenTransfer(tokenId, arb.accountId, UNITS)
    // Tramo 3: venta a Beta
    .addHbarTransfer(beta.accountId, Hbar.fromTinybars(-sale))
    .addHbarTransfer(arb.accountId, Hbar.fromTinybars(sale))
    .addTokenTransfer(tokenId, arb.accountId, -UNITS)
    .addTokenTransfer(tokenId, beta.accountId, UNITS)
    // Tramo 4: devolución de principal + comisión
    .addHbarTransfer(arb.accountId, Hbar.fromTinybars(-(principal + fee)))
    .addHbarTransfer(vault.accountId, Hbar.fromTinybars(principal + fee))
    .setTransactionMemo('hbe:flash-loan-atomic-settlement')
    .freezeWith(client)
  return { tx, fee, profit: sale - principal - fee }
}

const signAll = async (tx, parties) => {
  for (const p of Object.values(parties)) await tx.sign(p.privateKey)
  return tx
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Préstamo Flash Sin Capital y Liquidación Atómica L1 ---\n')
  const { client } = getClient()

  try {
    console.log('[PROCESO] Paso 1: Creando cuentas de Vault, Arbitrajista, Mercado Alpha y Mercado Beta...')
    const parties = {
      vault: await createLabAccount(client, { hbar: 0.2 }),
      arb: await createLabAccount(client, { hbar: 0.05 }),
      alpha: await createLabAccount(client, { hbar: 0.05 }),
      beta: await createLabAccount(client, { hbar: 0.3 })
    }
    for (const [name, p] of Object.entries(parties)) console.log(`[LOG] ${name.padEnd(6)} ${p.accountId}`)

    console.log('\n[PROCESO] Paso 2: Creando el token FLASH y entregando inventario a Alpha...')
    const tokenId = (await (await new TokenCreateTransaction()
      .setTokenName('Flash Demo Asset').setTokenSymbol('FLASH').setTokenType(TokenType.FungibleCommon)
      .setDecimals(0).setInitialSupply(UNITS * 10).setTreasuryAccountId(client.operatorAccountId)
      .execute(client)).getReceipt(client)).tokenId
    await (await new TransferTransaction()
      .addTokenTransfer(tokenId, client.operatorAccountId, -UNITS)
      .addTokenTransfer(tokenId, parties.alpha.accountId, UNITS)
      .execute(client)).getReceipt(client)
    console.log(`[ÉXITO] Token ${tokenId}; Alpha tiene ${UNITS} FLASH`)

    const principal = 10_000_000 // 0.1 HBAR
    console.log(`\n[PROCESO] Paso 3: Una transacción de 4 tramos, principal ${principal} tinybars, firmada por las cuatro partes...`)
    const arbBefore = await getMirrorHbarTinybars(parties.arb.accountId.toString())
    const { tx, fee, profit } = buildFlashTx(client, parties, tokenId, principal)
    const res = await (await signAll(tx, parties)).execute(client)
    const receipt = await res.getReceipt(client)
    console.log(`[ÉXITO] Estado ${receipt.status} — ${res.transactionId} | ${getHashscanUrl(res)}`)
    console.log(`[LOG] Comisión al vault: ${fee} tinybars | Ganancia esperada del arbitrajista: ${profit} tinybars`)

    await sleep(6000)
    const arbAfter = await getMirrorHbarTinybars(parties.arb.accountId.toString())
    console.log(`[VERIFICACIÓN] Mirror Node: el saldo del arbitrajista cambió ${arbAfter - arbBefore} tinybars (no pagó comisiones; el operador pagó la comisión de la transacción)`)

    console.log('\n[PROCESO] Paso 4: Caso de fallo — principal de 1 ℏ, que Beta no puede pagar...')
    const vaultBefore = await getMirrorHbarTinybars(parties.vault.accountId.toString())
    try {
      const bad = buildFlashTx(client, parties, tokenId, 100_000_000)
      // Alpha ya no tiene FLASH y a Beta le falta HBAR: la red debe rechazarlo todo
      await (await (await signAll(bad.tx, parties)).execute(client)).getReceipt(client)
      throw new Error('Expected the network to reject the transaction')
    } catch (error) {
      if (/Expected the network/.test(error.message)) throw error
      console.log(`[RECHAZADO] ${error.status ?? error.message}`)
    }
    await sleep(4000)
    const vaultAfter = await getMirrorHbarTinybars(parties.vault.accountId.toString())
    console.log(`[VERIFICACIÓN] Saldo del vault sin cambios: ${vaultBefore === vaultAfter} (${vaultAfter} tinybars)`)

    updateState('FLASH_SETTLEMENT_TX_ID', res.transactionId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Cuatro partes, una transacción: o se liquidan todos los tramos o ninguno.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Falló la liquidación del préstamo flash:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLIDO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
