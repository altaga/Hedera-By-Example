/**
 * ============================================================================
 * Lab 02: Probando la Autoridad de la Multi-firma
 * [CONCEPTO] Capa de Permisos Aplicada Criptográficamente
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La Capa de Cumplimiento: En sistemas tradicionales, la lógica de permisos
 * reside en el código de la aplicación. En Hedera, la "Base de Datos" (el
 * Ledger) es quien se niega a procesar la transacción si no se alcanza el
 * umbral criptográfico definido. Al intentar una transferencia con una sola
 * firma, la red rechaza el bloque de forma atómica; solo al presentar el
 * quorum (2 de 3), los nodos validan y ejecutan el movimiento de fondos.
 * La lógica de permisos es, por lo tanto, parte integral e indisoluble de
 * los datos.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Ejecutar transferencias multifirma exige recopilar las firmas requeridas antes del envío o usar Transacciones Programadas para que los firmantes aprueben de forma asíncrona desde diferentes ubicaciones.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/schedule-transaction
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M7 Lab 01: Gobernanza con Multi-firma (KeyList y Thresholds)
 * - Siguiente: M7 Lab 03: Transacciones Programadas (Cron Nativo)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 01 de M7 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M7_Governance_Cron/02_multisig_transfer.js
 * ============================================================================
 */

import {
  TransferTransaction, Hbar, PrivateKey, AccountId
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Ejecución de Umbral Multifirma ---\n')

  const { client, operatorId } = getClient()

  // Recuperar contexto de gobernanza del estado local
  const multisigId = getState('MULTISIG_ACCOUNT_ID')
  const aliceKeyStr = getState('MULTISIG_KEY_ALICE')
  const bobKeyStr = getState('MULTISIG_KEY_BOB')

  if (!multisigId || !aliceKeyStr || !bobKeyStr) {
    console.error('[FALLO] No se encontró el ID de la cuenta multi-firma. Ejecuta el Lab 01 primero.')
    process.exitCode = 1
    return
  }

  const aliceKey = PrivateKey.fromString(aliceKeyStr)
  const bobKey = PrivateKey.fromString(bobKeyStr)

  console.log(`[INFO] Aplicando auditoría sobre la cuenta corporativa: ${multisigId}`)

  try {
    // --- FASE 1: INTENTO CON FIRMA INSUFICIENTE (1 de 2) ---
    console.log('\n---  [REGISTRO] Fase 1: Intento de Transferencia Insuficiente ---')
    console.log('[PROCESO] Firmando transferencia de 0.1 HBAR solo con la llave de Alice...')

    const failTx = await new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(multisigId), new Hbar(-0.1))
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(0.1))
      .freezeWith(client)
      .sign(aliceKey)

    try {
      const response = await failTx.execute(client)
      await response.getReceipt(client)
      console.log('[ERROR] Crítico: La red permitió una transacción sin el quorum requerido.')
    } catch (e) {
      console.log('└─ [ÉXITO] La red rechazó la transacción como se esperaba (INVALID_SIGNATURE).')
      console.log(`└─ Razón del consenso: ${e.message}`)
    }

    // --- FASE 2: INTENTO CON QUORUM ALCANZADO (2 de 2) ---
    console.log('\n---  [REGISTRO] Fase 2: Intento de Transferencia con Quorum ---')
    console.log('[PROCESO] Recolectando firmas de Alice y Bob (Umbral 2-de-3 alcanzado)...')

    const successTx = await new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(multisigId), new Hbar(-0.1))
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(0.1))
      .freezeWith(client)
      .sign(aliceKey)

    // Inyectamos la segunda firma requerida
    await successTx.sign(bobKey)

    console.log('[PROCESO] Enviando transacción multirmada al consenso de la red...')
    const response = await successTx.execute(client)
    const receipt = await response.getReceipt(client)

    console.log(`\n[ÉXITO] Transferencia autorizada y ejecutada. Estado: ${receipt.status.toString()}`)
    console.log(`[REGISTRO] Ver auditoría en HashScan: ${getHashscanUrl(response)}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Este es el "Escrow" más sencillo y seguro del mundo. Al estar')
    console.log('integrado en la capa de red, no hay riesgo de fallos en el')
    console.log('código del contrato; es el propio consenso del Hashgraph el')
    console.log('que actúa como el árbitro insobornable de tu gobernanza.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo inesperado en el flujo de auditoría:', error.message)
    process.exitCode = 1
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
