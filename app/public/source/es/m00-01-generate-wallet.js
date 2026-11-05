/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Generación de billetera local (ECDSA sin conexión)
 * [CONCEPTO] Identidad Soberana y Derivación de Alias
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Soberanía de Identidad: Tu llave privada nunca debe tocar la red. Al
 * generarla localmente (offline), garantizas que el ledger jamás la ve; solo
 * recibe las PRUEBAS CRIPTOGRÁFICAS (firmas) que tú produces. Hedera es
 * compatible con Ethereum (EIP-55), lo que te permite derivar una dirección
 * EVM (0x...) directamente de tu llave pública antes de que la cuenta
 * exista siquiera en la red.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Jamás generes llaves de producción en herramientas web online ni entornos sin cifrar. Generar localmente tu par ECDSA te permite calcular la dirección EVM determinista (0x...) antes de fondear la cuenta o enviar transacciones a L1.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/keys
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: Inicio del Curso
 * - Actual:   M0 Lab 01: Generación de Billetera
 * - Siguiente: M0 Lab 02: Consulta de Saldo
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: ninguna. Este lab corre por completo en tu máquina (sin llamadas a la red).
 *
 * [ CÓMO EJECUTAR ]
 * node 01_generate_wallet.js
 * ============================================================================
 */

import { PrivateKey } from '@hiero-ledger/sdk'
import { updateEnv, loadEnv } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Generación de Identidad Soberana ---\n')

  // 1. Generar una llave privada ECDSA aleatoria. La dirección EVM que se deriva es determinista.
  console.log('[PROCESO] Generando par de llaves ECDSA (Estándar Web3)...')
  const privateKey = PrivateKey.generateECDSA()
  const publicKey = privateKey.publicKey

  // 2. Derivar la dirección EVM desde la llave pública.
  const evmAddress = publicKey.toEvmAddress()

  console.log('\n[ÉXITO] Nueva billetera generada de forma local.')
  console.log(`[REGISTRO] Llave Privada (DER): ${privateKey.toStringDer()}`)
  console.log(`[REGISTRO] Llave Pública (DER): ${publicKey.toStringDer()}`)
  console.log(`[REGISTRO] Dirección EVM (Alias): 0x${evmAddress}`)

  // 3. Guardar la llave como operador solo si todavía no hay uno:
  //    sobrescribir solo la llave dejaría OPERATOR_ID apuntando a una cuenta que
  //    esta llave nueva no controla, y todos los labs siguientes fallarían.
  loadEnv()
  const inBrowser = typeof window !== 'undefined'
  if (process.env.OPERATOR_ID && process.env.OPERATOR_PRIVATE_KEY) {
    console.log(`\n[INFO] Ya hay un operador configurado (OPERATOR_ID=${process.env.OPERATOR_ID}).`)
    console.log('[INFO] La llave nueva NO se guardó, así que tus credenciales actuales siguen funcionando.')
    if (inBrowser) {
      console.log('[INFO] En este navegador ese operador es la billetera seleccionada arriba. No se escribió ningún archivo .env.')
    } else {
      console.log('[INFO] Para usar esta llave como operador, quita OPERATOR_ID y OPERATOR_PRIVATE_KEY de .env y vuelve a correr este lab.')
    }
  } else {
    console.log(inBrowser
      ? '\n[INFO] Aún no hay un operador en este navegador. Usa «Crear billetera» en el encabezado para fondear una. Las líneas de abajo son para correr este archivo en Node.js.'
      : '\n[INFO] Sincronizando credenciales en el archivo .env...')
    if (!inBrowser) {
      updateEnv('OPERATOR_PRIVATE_KEY', privateKey.toStringDer())
      updateEnv('OPERATOR_EVM_ADDRESS', '0x' + evmAddress)
    }
    console.log('\n[INFO] ACCIÓN REQUERIDA: FINANCIA TU BILLETERA')
    console.log('-------------------------------------------------------')
    console.log('1. Ve al Faucet de Hedera: https://portal.hedera.com/faucet')
    console.log(`2. Pega tu Dirección EVM: 0x${evmAddress}`)
    console.log('3. Haz clic en \'Receive HBAR\'')
    console.log(`4. Revisa HashScan: https://hashscan.io/testnet/account/0x${evmAddress}`)
    console.log('5. Una vez veas tu Account ID (0.0.X), ejecuta el Lab 02.')
    console.log('-------------------------------------------------------')
  }

  console.log('\n CONCEPTO CLAVE:')
  console.log('Soberanía de Identidad: Tu llave privada nunca debe tocar la red.')
  console.log('Al generarla localmente, garantizas que el ledger jamás la ve;')
  console.log('solo recibe las PRUEBAS CRIPTOGRÁFICAS (firmas) que tú produces.')

  console.log('\n--- SESIÓN COMPLETADA ---')
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
