/**
 * ============================================================================
 * Laboratorio 06: Staking Nativo (HIP-584)
 * [CONCEPTO] Delegación a Nodos de Consenso y Recompensas
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El sistema Proof-of-Stake de Hedera permite a las cuentas delegar (hacer staking)
 * de su balance de HBAR a un nodo de consenso (o a otra cuenta). El staking
 * contribuye directamente a la seguridad de la red y al peso del consenso.
 * A cambio, la red paga recompensas pasivas (hasta un APY definido por la red)
 * nativamente a la cuenta. Puedes configurar esto vía `AccountUpdateTransaction`.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El staking nativo de Hedera (HIP-584) no tiene bloqueos, slashing ni riesgo de contratos. Tus HBAR jamás abandonan tu billetera, pero recibes recompensas calculadas y distribuidas por los nodos de consenso.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-584
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M1 Lab 05: Creación Perezosa de Cuentas
 * - Siguiente: M1 Lab 07: Motor de Tarifas Simples HIP-1261
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 06_native_staking.js
 * ============================================================================
 */

import { AccountUpdateTransaction, AccountInfoQuery } from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Staking Nativo ---\n')

  const { client, operatorId } = getClient()

  try {
    // Delegaremos el balance de la cuenta operadora al Nodo 2
    const TARGET_NODE_ID = 2

    console.log(`[PROCESO] Actualizando Cuenta ${operatorId} para hacer staking al Nodo ${TARGET_NODE_ID}...`)

    // 1. Actualizar la cuenta para hacer staking al nodo y aceptar recompensas
    const tx = await new AccountUpdateTransaction()
      .setAccountId(operatorId)
      .setStakedNodeId(TARGET_NODE_ID)
      .setDeclineStakingReward(false) // Debe ser falso para ganar recompensas
      .execute(client)

    await tx.getReceipt(client)
    console.log('[ÉXITO] ¡La configuración de staking se actualizó exitosamente!')

    // 2. Verificar la configuración de staking consultando la información de la cuenta
    console.log('\n[PROCESO] Consultando Información de la Cuenta para verificar el estado de staking...')
    const info = await new AccountInfoQuery()
      .setAccountId(operatorId)
      .execute(client)

    console.log('\n[REGISTRO] Información de Staking:')
    console.log(`- Staking al ID de Nodo: ${info.stakingInfo.stakedNodeId}`)
    console.log(`- Staking al ID de Cuenta: ${info.stakingInfo.stakedAccountId || 'Ninguno'}`)
    console.log(`- ¿Rechazando Recompensas?: ${info.stakingInfo.declineStakingReward}`)
    console.log(`- Recompensas Pendientes (HBAR): ${info.stakingInfo.pendingReward.toTinybars().toNumber() / 100000000}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('El staking en Hedera no es custodiado y es completamente líquido. Tus fondos')
    console.log('nunca están bloqueados y puedes transferirlos en cualquier momento. Las recompensas')
    console.log('se activan automáticamente y se pagan cuando ocurre una transacción.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Error de Ejecución:', error.message)
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
