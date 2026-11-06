/**
 * ============================================================================
 * Lab 02: Verificación manual de cuenta
 * [CONCEPTO] Sincronización de Identidad On-Chain
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
 * Este lab lee el saldo en el Mirror Node, y esa lectura es gratis. Pedir el mismo saldo a un nodo de consenso sí cobraría comisión y contaría contra el límite de tasa, así que las apps en producción dejan las lecturas en el Mirror Node.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/mirror-nodes
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M0 Lab 01: Generación de Billetera
 * - Actual:   M0 Lab 02: Consulta de Saldo
 * - Siguiente: M0 Lab 03: Asociación Ilimitada
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 02_check_balance.js
 * ============================================================================
 */

import {
  MirrorNodeAccountBalanceQuery
} from '@hiero-ledger/sdk'
import { updateEnv, loadEnv, createClient, waitForMirror, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

// --- CONFIGURACIÓN MANUAL ---
// Pega aquí el Account ID (0.0.X) que encontraste en HashScan.
// Si dejas el marcador, se usará OPERATOR_ID del archivo .env.
const MANUAL_ACCOUNT_ID = '0.0.XXXXXX'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Sincronización de Identidad On-Chain ---\n')

  // Este lab corre antes de que exista OPERATOR_ID, así que no puede usar getClient() (que lo exige).
  loadEnv()
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY
  const evmAddress = process.env.OPERATOR_EVM_ADDRESS

  if (!operatorKey) {
    console.error('[FALLO] Falta OPERATOR_PRIVATE_KEY en el archivo .env. Ejecuta el Lab 01 primero.')
    process.exit(1)
  }

  // Account ID: la constante de arriba, luego OPERATOR_ID del .env y, si no, la
  // cuenta que el faucet creó para OPERATOR_EVM_ADDRESS (consultada en el Mirror Node).
  const isValidId = (id) => /^\d+\.\d+\.\d+$/.test(id || '')
  let accountId = isValidId(MANUAL_ACCOUNT_ID) ? MANUAL_ACCOUNT_ID : process.env.OPERATOR_ID
  if (!isValidId(accountId) && evmAddress) {
    console.log(`[PROCESO] Buscando la cuenta creada para ${evmAddress}...`)
    accountId = await waitForMirror(async () => {
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${evmAddress}`)
      return res.ok ? (await res.json()).account : null
    }, { timeoutMs: 10_000 })
  }

  if (!isValidId(accountId)) {
    console.log(`[INFO] Verificando Cuenta: ${evmAddress}`)
    console.log(`[REGISTRO] HashScan: https://hashscan.io/testnet/account/${evmAddress}`)
    console.error('\n[FALLO] MANUAL_ACCOUNT_ID no está definido y falta OPERATOR_ID en el archivo .env.')
    process.exitCode = 1
    console.error('Pega el ID 0.0.X en la constante MANUAL_ACCOUNT_ID al inicio de este archivo.')
    process.exit(1)
  }

  const client = createClient(accountId, operatorKey)

  try {
    const inputId = accountId
    console.log(`[PROCESO] Consultando saldo para la cuenta ${inputId} en el Testnet...`)

    const query = new MirrorNodeAccountBalanceQuery()
      .setAccountId(inputId)

    const balance = await query.execute(client)

    console.log('\n[ÉXITO] Conexión a la red exitosa.')
    console.log(`[REGISTRO] Account ID: ${inputId}`)
    console.log(`[REGISTRO] Saldo Actual: ${balance.hbars.toString()}`)

    // Recordar el ID verificado para los labs que siguen (.env en Node, estado del navegador aquí).
    const inBrowser = typeof window !== 'undefined'
    console.log(inBrowser
      ? '\n[INFO] Guardando OPERATOR_ID para los labs que siguen (este navegador no escribe un archivo .env)...'
      : '\n[INFO] Sincronizando OPERATOR_ID en el archivo .env...')
    updateEnv('OPERATOR_ID', inputId)
    console.log(inBrowser ? '[ÉXITO] OPERATOR_ID guardado para los labs siguientes.' : '[ÉXITO] OPERATOR_ID guardado en .env.')

    console.log('\n CONCEPTO CLAVE:')
    console.log('El objeto `Client` es tu portal al ledger. Al llamar a')
    console.log('`setOperator()`, estableces QUIÉN paga y QUIÉN firma cada operación')
    console.log('posterior. Esto garantiza que tus futuras transacciones sean')
    console.log('procesadas y pagadas correctamente por tu cuenta principal.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] La verificación de saldo falló:', error.message)
    process.exit(1)
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
