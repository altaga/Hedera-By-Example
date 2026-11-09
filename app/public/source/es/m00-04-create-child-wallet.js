/**
 * ============================================================================
 * Lab 04: Creación Nativa de Cuentas (Provisionamiento)
 * [CONCEPTO] Idempotencia y Orquestación del Entorno
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Independencia de la Tesorería: Usar cuentas secundarias permite observar
 * las tarifas en acción: por ejemplo, las comisiones personalizadas de un
 * token nunca se cobran a su tesorería ni a sus cobradores de comisiones. Este script es
 * "Idempotente": detecta si las cuentas ya están configuradas en el .env
 * para evitar duplicidad y desperdicio de HBAR, asegurando que tu entorno
 * esté listo para pruebas de transferencias complejas.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * En despliegues empresariales, jamás uses tu cuenta principal de tesorería para probar contratos o tareas diarias. Crear cuentas hijas aisladas protege los fondos maestros y asigna cuotas de asociación dedicadas.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/native/accounts/create
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M0 Lab 03: Habilitar Auto-Asociaciones Ilimitadas
 * - Siguiente: M0 Lab 05: Firmador Enterprise con AWS KMS
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M0_Setup_and_Test/04_create_child_wallet.js
 * ============================================================================
 */

import { AccountCreateTransaction, Hbar, PrivateKey } from '@hiero-ledger/sdk'
import { getClient, updateEnv } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Provisionamiento Programático del Entorno ---\n')

  const { client } = getClient()

  // Función interna para provisionar una cuenta específica si no existe
  const provisionAccount = async (accountName) => {
    const existingId = process.env[`${accountName}_ID`]

    if (existingId) {
      console.log(`[ÉXITO] ${accountName} ya configurada: ${existingId}.`)
      return
    }

    console.log(`[PROCESO] Creando identidad para ${accountName}...`)
    // Genera una llave localmente: la llave privada nunca sale de este proceso.
    const newPrivateKey = PrivateKey.generateECDSA()
    const newPublicKey = newPrivateKey.publicKey

    // Crea una cuenta: su llave la controla; el saldo inicial lo pone quien paga.
    const tx = new AccountCreateTransaction()
      .setKeyWithoutAlias(newPublicKey)
      .setInitialBalance(Hbar.from(1)) // Saldo inicial para operaciones de prueba
      .setMaxAutomaticTokenAssociations(-1)
      .freezeWith(client)

    const response = await tx.execute(client)
    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const receipt = await response.getReceipt(client)
    const newAccountId = receipt.accountId.toString()
    const evmAddress = '0x' + newPublicKey.toEvmAddress()

    console.log(`[INFO] Sincronizando ${accountName} en el archivo .env...`)
    updateEnv(`${accountName}_ID`, newAccountId)
    updateEnv(`${accountName}_EVM_ADDRESS`, evmAddress)
    updateEnv(`${accountName}_PRIVATE_KEY`, newPrivateKey.toStringDer())

    console.log(`\n[ÉXITO] ${accountName} Creada Exitosamente: ${newAccountId}`)
  }

  try {
    // Intentar provisionar ambas cuentas requeridas para el curso
    await provisionAccount('ACCOUNT_1')
    await provisionAccount('ACCOUNT_2')

    console.log('\n CONCEPTO CLAVE:')
    console.log('Ahora tienes tres cuentas: Operador (Tesorería), Cuenta 1 y Cuenta 2.')
    console.log('Este entorno multicuenta es fundamental para probar atomismo,')
    console.log('tarifas de transferencia y gobernanza en los próximos módulos.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] El provisionamiento del entorno falló:', error.message)
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
