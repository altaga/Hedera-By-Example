/**
 * ============================================================================
 * Lab 01: Gobernanza con Multi-firma (KeyList y Thresholds)
 * [CONCEPTO] Política Criptográfica Pura y Umbrales de Seguridad
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Gobernanza Nativa: Hedera permite distribuir la autoridad de una cuenta
 * entre múltiples firmantes a nivel de protocolo con `KeyList`. Al definir
 * un "Umbral" (Threshold) de M-de-N, garantizas que ninguna entidad pueda
 * actuar unilateralmente. Esto elimina la necesidad de Smart Contracts de
 * custodia (como Gnosis Safe) para la mayoría de los casos de uso,
 * reduciendo costos y eliminando riesgos de vulnerabilidad en el código, ya
 * que la verificación es realizada directamente por los nodos de consenso.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las KeyLists multifirma en Hedera operan de forma nativa en la capa de consenso sin smart contracts: configurar umbrales M-de-N previene que la pérdida de una llave comprometa la tesorería corporativa.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/keys-and-signatures#key-lists
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M6 Lab 10: Bóveda Cifrada Zero-Trust
 * - Actual:   M7 Lab 01: Umbrales Multifirma
 * - Siguiente: M7 Lab 02: Ejecución de Transferencia Multisig
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~1 ℏ (comisiones de red y las cuentas que crea).
 *
 * [ CÓMO EJECUTAR ]
 * node 01_multisig_keylist.js
 * ============================================================================
 */

import { PrivateKey, KeyList, AccountCreateTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, updateState, getHashscanUrl } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Gobernanza Distribuida (Multisig) ---\n')

  const { client } = getClient()

  try {
    console.log('[PROCESO] Generando 3 llaves Ed25519 independientes para la gobernanza...')
    const aliceKey = PrivateKey.generateED25519()
    const bobKey = PrivateKey.generateED25519()
    const charlieKey = PrivateKey.generateED25519()

    // 1. Crear la KeyList con Umbral (Threshold)
    const thresholdList = new KeyList()
    thresholdList.push(aliceKey.publicKey)
    thresholdList.push(bobKey.publicKey)
    thresholdList.push(charlieKey.publicKey)
    thresholdList.setThreshold(2) // Definimos que 2 de 3 firmas son requeridas para autorizar.

    console.log('[ÉXITO] Política de Umbral definida: se requieren 2 de 3 firmas.')
    console.log(`[REGISTRO] Huella Criptográfica (KeyList): ${thresholdList.toString().slice(0, 32)}...`)

    // 2. Desplegar la cuenta Multi-firma
    console.log('\n[PROCESO] Desplegando Cuenta Institucional con control multifirma...')
    const transaction = await new AccountCreateTransaction()
      .setKeyWithoutAlias(thresholdList)
      .setInitialBalance(new Hbar(0.5)) // Fondos iniciales para la tesorería corporativa
      .execute(client)

    const receipt = await transaction.getReceipt(client)
    const multisigAccountId = receipt.accountId.toString()

    console.log(`\n[ÉXITO] Cuenta Corporativa Creada: ${multisigAccountId}`)
    console.log(`[REGISTRO] Ver en HashScan: ${getHashscanUrl(transaction)}`)

    // 3. Persistir datos para el laboratorio de ejecución
    updateState('MULTISIG_ACCOUNT_ID', multisigAccountId)
    updateState('MULTISIG_KEY_ALICE', aliceKey.toString())
    updateState('MULTISIG_KEY_BOB', bobKey.toString())
    updateState('MULTISIG_KEY_CHARLIE', charlieKey.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Gobernanza sin Gas: Debido a que la verificación ocurre en la')
    console.log('fase de validación de firma de los nodos, no hay código que')
    console.log('auditar ni riesgo de exploits de contratos inteligentes. Es')
    console.log('seguridad nativa de grado institucional.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] El despliegue de la gobernanza multifirma falló:', error.message)
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
