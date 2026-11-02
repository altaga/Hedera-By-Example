/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Generación de Billetera Local (ECDSA Offline)
 * [ CONCEPTO ] Identidad Soberana y Derivación de Alias
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
 * [ CÓMO EJECUTAR ]
 * node 01_generate_wallet.js
 * ============================================================================
 */

import { PrivateKey } from '@hiero-ledger/sdk'
import { updateEnv, loadEnv } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Generación de Identidad Soberana ---\n')

  try {
    // PASO 1: Generar la llave privada ECDSA.
    console.log('[⚙️ PROCESO] Generando par de llaves ECDSA (Estándar Web3)...')
    const privateKey = PrivateKey.generateECDSA()
    const publicKey = privateKey.publicKey

    // PASO 2: Derivar la dirección EVM desde la llave pública.
    console.log('[⚙️ PROCESO] Derivando dirección EVM determinista (EIP-55)...')
    const evmAddress = publicKey.toEvmAddress()

    console.log('\n[✅ ÉXITO] Nueva Billetera Generada de forma Offline.')
    console.log(`[📊 REGISTRO] Llave Privada (DER): ${privateKey.toStringDer()}`)
    console.log(`[📊 REGISTRO] Llave Pública (DER): ${publicKey.toStringDer()}`)
    console.log(`[📊 REGISTRO] Dirección EVM (Alias): 0x${evmAddress}`)

    // PASO 3: Persistir las llaves en el archivo .env, salvo que ya haya un operador:
    //    sobrescribir solo la llave dejaría OPERATOR_ID apuntando a una cuenta que
    //    esta llave nueva no controla, y todos los labs siguientes fallarían.
    loadEnv()
    if (process.env.OPERATOR_ID && process.env.OPERATOR_PRIVATE_KEY) {
      console.log(`\n[ℹ️ INFO] Ya hay un operador configurado (OPERATOR_ID=${process.env.OPERATOR_ID}).`)
      console.log('[ℹ️ INFO] La llave nueva NO se guardó, así que tus credenciales actuales siguen funcionando.')
      console.log('[ℹ️ INFO] Para usar esta llave como operador, quita OPERATOR_ID y OPERATOR_PRIVATE_KEY de .env y vuelve a correr este lab.')
    } else {
      console.log('\n[ℹ️ INFO] Sincronizando credenciales en el archivo .env...')
      updateEnv('OPERATOR_PRIVATE_KEY', privateKey.toStringDer())
      updateEnv('OPERATOR_EVM_ADDRESS', '0x' + evmAddress)
    }

    console.log('\n[ℹ️ INFO] ACCIÓN REQUERIDA: FINANCIA TU BILLETERA')
    console.log('-------------------------------------------------------')
    console.log('1. Ve al Faucet de Hedera: https://portal.hedera.com/faucet')
    console.log(`2. Pega tu Dirección EVM: 0x${evmAddress}`)
    console.log('3. Haz clic en \'Receive HBAR\'')
    console.log(`4. Revisa HashScan: https://hashscan.io/testnet/account/0x${evmAddress}`)
    console.log('5. Una vez veas tu Account ID (0.0.X), ejecuta el Lab 02.')
    console.log('-------------------------------------------------------')

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Soberanía de Identidad: Tu llave privada nunca debe tocar la red.')
    console.log('Al generarla localmente, garantizas que el ledger jamás la ve;')
    console.log('solo recibe las PRUEBAS CRIPTOGRÁFICAS (firmas) que tú produces.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Fallo en la generación de billetera:', error.message)
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
