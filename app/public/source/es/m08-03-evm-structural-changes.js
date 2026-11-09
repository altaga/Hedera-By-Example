/**
 * ============================================================================
 * Lab 03: Ciclo de Vida de Contratos y Renta de Almacenamiento
 * [CONCEPTO] Sostenibilidad Operativa y Gestión del Estado
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El Ledger Sostenible: A diferencia de otras redes donde el almacenamiento
 * de estado es perpetuo tras un solo pago de gas, Hedera aplica un modelo
 * de "Renta de Almacenamiento" (Auto-Renewal) para que la red no crezca sin
 * fin con código abandonado. Cada contrato tiene un periodo de renovación;
 * cuando la renta se active, si al vencimiento no hay fondos el contrato
 * expira. Hoy Hedera todavía no cobra esta renta.
 * Para aplicaciones en producción, este mecanismo garantiza que los recursos
 * de los nodos se utilicen de forma eficiente y responsable.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los contratos en la EVM de Hedera tienen un periodo de auto-renovación pensado para la renta de almacenamiento. Cuando la renta se active, mantener fondeada la cuenta de auto-renovación evitará que el contrato expire.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/evm/development/rent
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M8 Lab 02: El Entorno Híbrido (SDK Nativo + Ethers.js)
 * - Siguiente: M8 Lab 04: Contratos de Sistema (Precompiles Nativos)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 01 de M8 (este lab lee lo que guardó).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M8_Smart_Contracts_EVM/03_evm_structural_changes.js
 * ============================================================================
 */

import { PrivateKey, ContractUpdateTransaction } from '@hiero-ledger/sdk'
import { getClient, getState } from '../M99_Utilities/index.js'

/**
 * Envolvedor funcional para recargar el tiempo de vida de renovación del contrato.
 */
const extendContractLifespan = async (client, contractId, adminKey) => {
  console.log(`[PROCESO] Extendiendo periodo de Auto-Renovación por 30 días para: ${contractId}...`)
  const thirtyDaysInSeconds = 30 * 24 * 60 * 60

  const tx = await new ContractUpdateTransaction()
    .setContractId(contractId)
    .setAutoRenewPeriod(thirtyDaysInSeconds)
    .freezeWith(client)

  const signed = await tx.sign(adminKey)
  const result = await signed.execute(client)

  // Espera el consenso: el recibo dice si la red aceptó la transacción.
  return await result.getReceipt(client)
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Sostenibilidad de Contratos (HSCS) ---\n')

  const { client, operatorKey } = getClient()
  const contractId = getState('SC_STORAGE_ID')

  if (!contractId) {
    console.error('[FALLO] Falta SC_STORAGE_ID en el estado local. Ejecuta Lab 01 primero.')
    process.exitCode = 1
    return
  }

  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    const receipt = await extendContractLifespan(client, contractId, adminKey)

    console.log(`\n[ÉXITO] Periodo de auto-renovación actualizado. Estado: ${receipt.status.toString()}`)
    console.log('[INFO] El periodo de auto-renovación ha sido actualizado a 30 días.')
    console.log('[INFO] Cuando la renta se active, se cobrará del saldo del contrato o de su cuenta de auto-renovación. Hoy no se cobra nada.')

    console.log('\n CONCEPTO CLAVE:')
    console.log('La renta de almacenamiento es la herramienta de Hedera para evitar')
    console.log('la hinchazón del estado (state bloat). En producción, se suele')
    console.log('asignar un `autoRenewAccountId` (cuenta de tesorería) para asegurar')
    console.log('que los Smart Contracts críticos nunca entren en estado de gracia.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] La extensión de vida útil del contrato falló:', error.message)
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

export { extendContractLifespan }
