/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Verificación y Activación de Cuenta
 * [ CONCEPTO ] Sincronización de Identidad On-Chain
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El Portal al Ledger: El objeto `Client` es tu portal al ledger. Al llamar a
 * `setOperator()`, estableces QUIÉN paga y QUIÉN firma cada operación. Esta
 * verificación cierra la brecha entre tu alias offline (0x...) y tu
 * identidad activa en la red (0.0.X). Al ejecutar una `AccountBalanceQuery`,
 * realizas tu primera "Consensus Query", garantizando que el dato que
 * recibes refleja el estado DEFINITIVO e inmutable de la red.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Consultar nodos de consenso directamente consume comisiones en HBAR y genera límites de tasa. Las dApps en producción deben usar siempre la REST API de Mirror Node para lecturas: son gratuitas, escalables y devuelven el historial completo.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/mirror-nodes
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M0 Lab 01: Generación de Billetera
 * - Actual:   M0 Lab 02: Consulta de Saldo
 * - Siguiente: M0 Lab 03: Asociación Ilimitada
 *
 * [ CÓMO EJECUTAR ]
 * node 02_check_balance.js
 * ============================================================================
 */

import {
  MirrorNodeAccountBalanceQuery
} from '@hiero-ledger/sdk'
import { getClient, updateEnv } from '../M99_Utilities/index.js'

// --- CONFIGURACIÓN MANUAL ---
// Pega aquí el Account ID (0.0.X) que encontraste en HashScan.
// Si dejas el marcador, se usará OPERATOR_ID del archivo .env.
const MANUAL_ACCOUNT_ID = '0.0.XXXXXX'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Sincronización de Identidad On-Chain ---\n')

  const { client } = getClient()
  const evmAddress = process.env.OPERATOR_EVM_ADDRESS

  if (!evmAddress) {
    console.error('[❌ FALLO] Falta OPERATOR_EVM_ADDRESS en el archivo .env. Ejecuta el Lab 01 primero.')
    process.exit(1)
  }

  // Si no se reemplazó el marcador, usa OPERATOR_ID del archivo .env.
  const isValidId = (id) => /^\d+\.\d+\.\d+$/.test(id || '')
  const accountId = isValidId(MANUAL_ACCOUNT_ID) ? MANUAL_ACCOUNT_ID : process.env.OPERATOR_ID

  if (!isValidId(accountId)) {
    console.log(`[ℹ️ INFO] Verificando Cuenta: ${evmAddress}`)
    console.log(`[📊 REGISTRO] HashScan: https://hashscan.io/testnet/account/${evmAddress}`)
    console.error('\n[❌ FALLO] MANUAL_ACCOUNT_ID no está definido y falta OPERATOR_ID en el archivo .env.')
    console.error('Pega el ID 0.0.X en la constante MANUAL_ACCOUNT_ID al inicio de este archivo.')
    process.exit(1)
  }

  try {
    const inputId = accountId
    console.log(`[⚙️ PROCESO] Consultando saldo para la cuenta ${inputId} en el Testnet...`)

    const query = new MirrorNodeAccountBalanceQuery()
      .setAccountId(inputId)

    const balance = await query.execute(client)

    console.log('\n[✅ ÉXITO] Conexión a la red exitosa.')
    console.log(`[📊 REGISTRO] Account ID: ${inputId}`)
    console.log(`[📊 REGISTRO] Saldo Actual: ${balance.hbars.toString()}`)

    // Actualizar el .env con el ID verificado
    console.log('\n[ℹ️ INFO] Sincronizando OPERATOR_ID en el archivo .env...')
    updateEnv('OPERATOR_ID', inputId)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('El objeto `Client` es tu portal al ledger. Al llamar a')
    console.log('`setOperator()`, estableces QUIÉN paga y QUIÉN firma cada operación')
    console.log('posterior. Esto garantiza que tus futuras transacciones sean')
    console.log('procesadas y pagadas correctamente por tu cuenta principal.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La verificación de saldo falló:', error.message)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ FALLO] Error Fatal:', error.message)
    process.exit(1)
  })
}
