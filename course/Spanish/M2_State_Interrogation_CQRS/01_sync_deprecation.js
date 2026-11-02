/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Depreciación de Consultas Sincrónicas
 * [ CONCEPTO ] Arquitectura CQRS (Command Query Responsibility Segregation)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Evolución del Protocolo: Hedera ha migrado hacia un patrón CQRS estricto. Los
 * "Commands" (Mutaciones de estado) van a los Nodos de Consenso y pagan
 * tarifas, mientras que las "Queries" (Lecturas de estado) van a los
 * Mirror Nodes de forma gratuita. A partir de @hiero-ledger/sdk v2.90+,
 * `AccountBalanceQuery` lanza un error de depreciación exigiendo el uso de
 * `MirrorNodeAccountBalanceQuery` o el REST API del Mirror Node.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * No uses consultas síncronas a nodos de consenso para leer estados en producción. Adoptar el patrón CQRS desacopla las transacciones de escritura en consenso de las lecturas gratuitas y veloces en Mirror Nodes.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/mirror-nodes
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M1 Lab 04: Rotación de Llaves
 * - Actual:   M2 Lab 01: Depreciación Sync
 * - Siguiente: M2 Lab 02: Consulta REST Segura
 *
 * [ CÓMO EJECUTAR ]
 * node 01_sync_deprecation.js
 * ============================================================================
 */

import { AccountBalanceQuery, MirrorNodeAccountBalanceQuery, AccountId } from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

/**
 * PATRÓN LEGACY vs REEMPLAZO CQRS:
 * Demuestra cómo el SDK bloquea la consulta sincrónica en consenso y redirige al Mirror Node.
 */
const legacyBalanceQuery = async (client, accountIdStr) => {
  console.log('\n⚠️  [ℹ️ INFO] Intentando Patrón Legacy: AccountBalanceQuery en Consenso...')

  try {
    const query = new AccountBalanceQuery()
      .setAccountId(AccountId.fromString(accountIdStr))
    const balance = await query.execute(client)
    return balance.hbars
  } catch (deprecatedError) {
    console.log(`[✅ CQRS APLICADO] El SDK bloqueó la consulta legacy: "${deprecatedError.message}"`)
    console.log('[⚙️ PROCESO] Ejecutando reemplazo oficial MirrorNodeAccountBalanceQuery...')
    const mirrorBalance = await new MirrorNodeAccountBalanceQuery()
      .setAccountId(AccountId.fromString(accountIdStr))
      .execute(client)
    return mirrorBalance.hbars
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Consultas Sincrónicas ---\n')

  const { client, operatorId } = getClient()

  try {
    console.log(`[⚙️ PROCESO] Realizando consulta de saldo para ${operatorId}...`)
    const hbars = await legacyBalanceQuery(client, operatorId)

    console.log(`\n[✅ ÉXITO] Saldo Obtenido: ${hbars.toString()}`)
    console.log(`[📊 REGISTRO] Saldo: ${hbars.toTinybars().toString()} tinybars`)

    console.log('\n[ℹ️ INFO] Siguiente objetivo: Migrar a consultas REST gratuitas.')

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('La arquitectura asíncrona permite que los Mirror Nodes sirvan')
    console.log('datos de lectura sin costo, liberando a los nodos de consenso')
    console.log('para procesar miles de transacciones por segundo (TPS).')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La consulta sincrónica falló:', error.message)
    process.exitCode = 1
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

export { legacyBalanceQuery }
