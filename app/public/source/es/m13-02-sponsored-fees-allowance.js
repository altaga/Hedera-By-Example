/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Patrocinio Nativo de Tarifas y Asignaciones Delegadas (HIP-1068)
 * [ CONCEPTO ] Incorporación Gasless de Usuarios y Agentes Sin Bundlers ERC-4337
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Patrocinio de Tarifas vs. Asignaciones: En cadenas EVM, patrocinar el gas
 * exige bundlers ERC-4337, contratos paymaster y mempools secundarios.
 * En Hedera, dos primitivos nativos de consenso resuelven esto limpiamente:
 * 1. Pagador de Tarifa Designado (`TransactionId.generate(sponsorId)`): Un agente
 *    con literalmente 0.0000 HBAR firma una operación (ej., actualizar su estado
 *    o mover activos), mientras el Patrocinador co-firma como pagador del
 *    `TransactionId` para absorber el 100% de la tarifa de red.
 * 2. Asignaciones Delegadas (`AccountAllowanceApproveTransaction`): El Patrocinador
 *    autoriza a un operador delegado a gastar HBAR de su tesorería mediante
 *    `addApprovedHbarTransfer` sin compartir su clave privada.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * En Hedera, `addApprovedHbarTransfer` identifica al "spender" por la cuenta
 * pagadora del `TransactionId`. Para patrocinio puro de gas con 0 HBAR se usa
 * `TransactionId.generate(sponsorId)` con doble firma; para gasto delegado de
 * tesorería, el spender autorizado firma el `TransactionId`.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M13 Lab 01: Verificación de Pruebas de Estado CLPR (HIP-1535)
 * - Actual:    M13 Lab 02: Patrocinio Nativo de Tarifas (HIP-1068)
 * - Siguiente: M13 Lab 03: Flujo de Bloques y Firmas TSS (HIP-1056)
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M13_Cross_Ledger_and_Data_Streams/02_sponsored_fees_allowance.js
 * ============================================================================
 */

import {
  Client,
  AccountId,
  AccountAllowanceApproveTransaction,
  AccountCreateTransaction,
  AccountUpdateTransaction,
  PrivateKey,
  TransactionId,
  TransferTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, updateState, sleep, createClient, ensureFunded } from '../M99_Utilities/index.js'

/**
 * Consulta el balance de una cuenta en tinybars y HBAR mediante el REST API del Mirror Node.
 *
 * @param {string} accountId - ID de la cuenta
 * @param {string} network - 'testnet' | 'mainnet'
 * @returns {Promise<{tinybars: number, formatted: string}>} Objeto de balance
 */
const queryBalance = async (accountId, network = 'testnet') => {
  const res = await fetch(`https://${network}.mirrornode.hedera.com/api/v1/accounts/${accountId}`)
  if (!res.ok) return { tinybars: 0, formatted: '0.0000 HBAR' }
  const data = await res.json()
  const tinybars = Number(data?.balance?.balance ?? 0)
  return {
    tinybars,
    formatted: (tinybars / 1e8).toFixed(4) + ' HBAR'
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Patrocinio Nativo de Tarifas y Asignaciones (HIP-1068) ---\n')
  const { client, operatorId, operatorKey, network } = getClient()
  const sponsorAccountId = AccountId.fromString(operatorId)
  const sponsorKey = PrivateKey.fromStringDer(operatorKey)

  const delegateSpenderId = AccountId.fromString(process.env.ACCOUNT_1_ID)
  const delegateSpenderKey = PrivateKey.fromStringDer(process.env.ACCOUNT_1_PRIVATE_KEY)

  try {
    // 1. Crear una cuenta de Agente con literalmente 0.0000 HBAR
    console.log('[⚙️ PROCESO] Paso 1: Creando Agente efímero con 0.0000 HBAR de saldo inicial...')
    const zeroGasAgentKey = PrivateKey.generateED25519()
    const agentCreateTx = await new AccountCreateTransaction()
      .setKeyWithoutAlias(zeroGasAgentKey.publicKey)
      .setInitialBalance(new Hbar(0)) // ¡Literalmente 0.0000 HBAR!
      .execute(client)

    const agentReceipt = await agentCreateTx.getReceipt(client)
    const zeroGasAgentId = agentReceipt.accountId
    console.log(`[✅ ÉXITO] Agente Cero-HBAR Creado: ${zeroGasAgentId.toString()} (Llave: ED25519)`)

    await sleep(3500)
    const initZeroAgentBal = await queryBalance(zeroGasAgentId.toString(), network)
    const initSponsorBal = await queryBalance(operatorId.toString(), network)
    console.log(`[📊 REGISTRO] Balance Inicial Agente 0-Gas:     ${initZeroAgentBal.formatted}`)
    console.log(`[📊 REGISTRO] Balance Inicial del Patrocinador: ${initSponsorBal.formatted}`)

    // 2. Primitivo A: Patrocinio Real de Gas 0-HBAR vía Pagador Designado en TransactionId
    console.log(`\n[⚙️ PROCESO] Paso 2 (Patrocinio Gasless): Agente 0-HBAR (${zeroGasAgentId}) actualizando su estado on-chain...`)
    console.log(`[ℹ️ INFO] El consenso exige la firma de ${zeroGasAgentId}, mientras el Patrocinador (${operatorId}) paga el 100% del gas.`)

    const gaslessUpdateTx = await new AccountUpdateTransaction()
      .setAccountId(zeroGasAgentId)
      .setAccountMemo('HIP-1068:Gasless-Agent-Verified')
      .setTransactionId(TransactionId.generate(sponsorAccountId))
      .freezeWith(client)

    // El Agente firma para autorizar el cambio en su cuenta; el Patrocinador firma para pagar el gas
    const signedByAgent = await gaslessUpdateTx.sign(zeroGasAgentKey)
    const signedByBoth = await signedByAgent.sign(sponsorKey)
    const gaslessResponse = await signedByBoth.execute(client)
    const gaslessReceipt = await gaslessResponse.getReceipt(client)

    console.log(`[✅ ÉXITO] ¡Mutación de Estado Sin Gas Finalizada! Tx: ${gaslessResponse.transactionId.toString()}`)
    console.log(`[📊 REGISTRO] Estado: ${gaslessReceipt.status.toString()}`)

    await sleep(3500)
    const midZeroAgentBal = await queryBalance(zeroGasAgentId.toString(), network)
    const agentGasSpent = ((initZeroAgentBal.tinybars - midZeroAgentBal.tinybars) / 1e8).toFixed(8)
    console.log(`[📊 REGISTRO] Balance Agente Tras Tx: ${midZeroAgentBal.formatted} (Gas Gastado: ${agentGasSpent} HBAR)`)

    // 3. Primitivo B: Asignación Delegada de HBAR (Spender Autónomo de Tesorería)
    const allowanceAmount = new Hbar(2)
    console.log(`\n[⚙️ PROCESO] Paso 3 (Asignación Delegada): Patrocinador (${operatorId}) aprobando ${allowanceAmount.toString()} al Operador (${delegateSpenderId})...`)

    const allowanceTx = await new AccountAllowanceApproveTransaction()
      .approveHbarAllowance(sponsorAccountId, delegateSpenderId, allowanceAmount)
      .execute(client)
    const allowanceReceipt = await allowanceTx.getReceipt(client)
    console.log(`[✅ ÉXITO] ¡Asignación Aprobada! Estado: ${allowanceReceipt.status.toString()}`)

    // El Operador transfiere 0.25 HBAR de la tesorería del Patrocinador al Agente 0-HBAR sin la firma del Patrocinador
    console.log(`\n[⚙️ PROCESO] Operador (${delegateSpenderId}) debitando 0.25 HBAR de la asignación del Patrocinador hacia el Agente (${zeroGasAgentId})...`)
    // Aquí ACCOUNT_1 paga las comisiones de sus transacciones; se mantiene con saldo.
    await ensureFunded(client, delegateSpenderId, 1)
    const spenderClient = createClient()
    spenderClient.setOperator(delegateSpenderId, delegateSpenderKey)

    const allowanceTransfer = await new TransferTransaction()
      .addApprovedHbarTransfer(sponsorAccountId, new Hbar(-0.25))
      .addHbarTransfer(zeroGasAgentId, new Hbar(0.25))
      .setTransactionMemo('HIP-1068:DelegatedAllowanceSpend')
      .execute(spenderClient)
    const transferReceipt = await allowanceTransfer.getReceipt(spenderClient)
    spenderClient.close()

    console.log(`[✅ ÉXITO] ¡Transferencia por Asignación Delegada Ejecutada! Tx: ${allowanceTransfer.transactionId.toString()}`)
    console.log(`[📊 REGISTRO] Estado: ${transferReceipt.status.toString()}`)

    await sleep(3500)
    const finalZeroAgentBal = await queryBalance(zeroGasAgentId.toString(), network)
    const finalSponsorBal = await queryBalance(operatorId.toString(), network)

    console.log('\n[📊 REGISTRO] Auditoría Posterior a la Ejecución (Verificada por Mirror Node):')
    console.log(`[📊 REGISTRO] Gas Gastado por Agente en Paso 2: ${agentGasSpent} HBAR (100% Patrocinado)`)
    console.log(`[📊 REGISTRO] Balance Final del Agente:         ${finalZeroAgentBal.formatted} (Recibió 0.25 HBAR vía Allowance)`)
    console.log(`[📊 REGISTRO] Balance Final del Patrocinador:   ${finalSponsorBal.formatted}`)

    // Persistir estado
    updateState('SPONSORED_AGENT_ID', zeroGasAgentId.toString())
    updateState('SPONSORED_ALLOWANCE_HBAR', allowanceAmount.toString())
    updateState('SPONSORED_LAST_TX_ID', allowanceTransfer.transactionId.toString())
    updateState('SPONSORED_AGENT_GAS_SPENT', `${agentGasSpent} HBAR`)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Hedera provee tanto patrocinio nativo de tarifas (vía co-firma del pagador en TransactionId)')
    console.log('como asignaciones nativas de tesorería (vía AccountAllowanceApproveTransaction), permitiendo')
    console.log('incorporación con 0 HBAR y delegación autónoma de presupuesto en la capa de consenso.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('En Hedera, `addApprovedHbarTransfer` verifica que el pagador del `TransactionId` sea el')
    console.log('spender autorizado, mientras `TransactionId.generate(sponsorId)` permite que cualquier')
    console.log('cuenta con 0 HBAR ejecute transacciones con el gas pagado 100% por un patrocinador.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en Ejecución de Tarifa Patrocinada:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
