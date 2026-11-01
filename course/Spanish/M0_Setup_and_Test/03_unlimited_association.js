/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Habilitar Auto-Asociaciones Ilimitadas
 * [ CONCEPTO ] Optimización de UX y Escudo Anti-Spam
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El Valor Mágico: Hedera protege las cuentas contra el "spam de tokens"
 * mediante el requisito de "Asociación" (opt-in explícito). Sin embargo,
 * el valor `-1` en `setMaxAutomaticTokenAssociations()` es la bandera
 * mágica para habilitar asociaciones ILIMITADAS. En una dApp de producción,
 * ofrecer esta opción mejora drásticamente la experiencia de usuario (UX)
 * al eliminar la fricción de aprobar manualmente cada nuevo activo entrante.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Configurar max_automatic_token_associations en -1 en tu billetera de desarrollo previene fallos en airdrops, intercambios DEX y pagos multi-activo al permitir que la red auto-asocie nuevos tokens de inmediato.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-23
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M0 Lab 02: Consulta de Saldo
 * - Actual:   M0 Lab 03: Asociación Ilimitada
 * - Siguiente: M0 Lab 04: Creación de Billetera Hija
 *
 * [ CÓMO EJECUTAR ]
 * node 03_unlimited_association.js
 * ============================================================================
 */

import {
  AccountUpdateTransaction
} from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Configuración de Recepción Automática ---\n')

  const { client, operatorId: opId } = getClient()

  try {
    console.log(`[ℹ️ INFO] Cuenta Objetivo: ${opId}`)

    // Preparar la Transacción de Actualización
    console.log('[⚙️ PROCESO] Construyendo AccountUpdateTransaction...')

    // setMaxAutomaticTokenAssociations(-1) habilita la auto-asociación "Ilimitada"
    const transaction = await new AccountUpdateTransaction()
      .setAccountId(opId)
      .setMaxAutomaticTokenAssociations(-1)
      .freezeWith(client)

    // Firmar y Ejecutar
    console.log('[⚙️ PROCESO] Firmando transacción con la llave del operador...')
    const response = await transaction.execute(client)

    console.log('[ℹ️ INFO] Esperando confirmación de la red...')
    const receipt = await response.getReceipt(client)

    console.log('\n[✅ ÉXITO] Auto-Asociaciones Ilimitadas Activas.')
    console.log(`[📊 REGISTRO] Estado Final: ${receipt.status.toString()}`)
    console.log('\n[ℹ️ INFO] Tu billetera ahora puede recibir cualquier token (FT o NFT) automáticamente.')

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('El valor `-1` habilitado permite que cualquier activo sea recibido')
    console.log('sin intervencion manual. En entornos DeFi o Gaming, esto es crucial')
    console.log('para reducir la fricción en el intercambio de activos digitales.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La actualización de cuenta falló:', error.message)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ FALLO] Error de Ejecución:', error.message)
    process.exit(1)
  })
}
