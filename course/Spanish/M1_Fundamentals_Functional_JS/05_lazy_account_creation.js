/**
 * ============================================================================
 * Laboratorio 05: Creación Perezosa de Cuentas (Abstracción de Cuentas)
 * [ CONCEPTO ] Abstracción de Cuentas vía Alias ECDSA
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Tradicionalmente en Hedera, debes pagar una tarifa por adelantado para crear
 * una cuenta nueva para un usuario usando `AccountCreateTransaction`.
 * Con la Creación Perezosa de Cuentas (Lazy Account Creation), simplemente
 * transfieres HBAR a una dirección EVM cruda (un alias de clave pública ECDSA).
 * Hedera intercepta automáticamente la transferencia, crea la cuenta de Hedera
 * tras bambalinas, y deduce la tarifa de creación del monto transferido.
 * Esto es vital para integrar usuarios de Ethereum.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * HIP-32 permite un onboarding sin fricciones: puedes enviar fondos a una dirección EVM (0x...) no instanciada y los nodos crearán la cuenta hueca sobre la marcha, lista para enlazar la llave pública en su primera firma.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-32
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M1 Lab 04: Rotación de Claves
 * - Siguiente: M1 Lab 06: Staking Nativo
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 05_lazy_account_creation.js
 * ============================================================================
 */

import { PrivateKey, TransferTransaction, AccountId, Hbar, TransactionRecordQuery } from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Creación Perezosa de Cuentas ---\n')

  const { client } = getClient()

  try {
    // 1. Generar una clave privada ECDSA estándar compatible con Ethereum
    console.log('[⚙️ PROCESO] Generando nueva Clave Privada ECDSA inmaculada...')
    const lazyKey = PrivateKey.generateECDSA()

    // 2. Derivar la dirección EVM (el "Alias")
    const evmAddress = lazyKey.publicKey.toEvmAddress()
    console.log(`[📊 REGISTRO] Dirección EVM Cruda (Alias): 0x${evmAddress}`)

    // 3. Convertir la cadena de Dirección EVM a un objeto AccountId de Hedera
    const aliasAccountId = AccountId.fromString(`0.0.${evmAddress}`)

    // 4. Transferir HBAR al Alias para activar la auto-creación
    console.log('\n[⚙️ PROCESO] Transfiriendo 0.5 HBAR al Alias EVM para activar la auto-creación...')
    const tx = await new TransferTransaction()
      .addHbarTransfer(client.operatorAccountId, new Hbar(-0.5))
      .addHbarTransfer(aliasAccountId, new Hbar(0.5))
      .execute(client)

    // 5. Obtener el recibo y el registro hijo para revelar el ID de Cuenta recién creado
    await tx.getReceipt(client)
    console.log('[✅ ÉXITO] ¡Transferencia exitosa! La cuenta fue creada de forma perezosa.')

    // Obtener el registro de la transacción revela el ID de Cuenta de Hedera auto-creado
    const record = await new TransactionRecordQuery()
      .setTransactionId(tx.transactionId)
      .setIncludeChildren(true)
      .execute(client)

    const childRecord = record.children[0]
    if (childRecord && childRecord.receipt.accountId) {
      console.log(`\n[📊 REGISTRO] Hedera asignó el ID de Cuenta: ${childRecord.receipt.accountId.toString()}`)
    } else {
      console.log(`\n[ℹ️ INFO] Revisa Hashscan para el ID de Cuenta recién creado y mapeado a 0x${evmAddress}`)
    }

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Acabas de incorporar una billetera de Ethereum directamente a Hedera sin')
    console.log('pagar la tarifa de creación de cuenta por adelantado. La red manejó')
    console.log('automáticamente la creación de la cuenta durante la transferencia de HBAR.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Error de Ejecución:', error.message)
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
