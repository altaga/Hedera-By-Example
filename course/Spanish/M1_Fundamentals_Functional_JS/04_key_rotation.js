/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Rotación de Llaves
 * [ CONCEPTO ] Desacoplamiento de Identidad y Credencial
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Resiliencia de Identidad: En Hedera, tu Account ID (Identidad) es
 * permanente, pero tu Private Key (Credencial) puede rotarse. Esto permite
 * responder a incidentes de seguridad sin perder la reputación o el historial
 * de la cuenta. Para ejecutar la rotación, se requiere "Firma Dual": la
 * llave antigua firma para probar autoridad actual, y la llave nueva firma
 * para probar la posesión futura. Esta es una característica nativa de
 * grado empresarial (ISO 27001).
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * En Ethereum, si tu llave privada se filtra, pierdes tu dirección para siempre. En Hedera, puedes ejecutar una AccountUpdateTransaction para rotar la llave manteniendo exactamente el mismo Account ID y balances.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/accounts/update-an-account
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M1 Lab 03: Criptografía y KMS
 * - Actual:   M1 Lab 04: Rotación de Llaves
 * - Siguiente: M2 Lab 01: Depreciación Sync
 *
 * [ CÓMO EJECUTAR ]
 * node 04_key_rotation.js
 * ============================================================================
 */

import { AccountId, AccountUpdateTransaction, PrivateKey } from '@hiero-ledger/sdk'
import { getClient, updateEnv } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Rotación de Credenciales ---\n')

  const { client } = getClient()
  const targetId = process.env.ACCOUNT_1_ID
  const targetKey = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!targetId || !targetKey) {
    console.error('[❌ FALLO] Faltan credenciales de ACCOUNT_1 en el archivo .env.')
    return
  }

  try {
    const oldPrivateKey = PrivateKey.fromString(targetKey)

    // 2. Generar la NUEVA llave de reemplazo
    console.log(`[⚙️ PROCESO] Generando nueva clave criptográfica para ${targetId}...`)
    const newPrivateKey = PrivateKey.generateECDSA()
    const newPublicKey = newPrivateKey.publicKey
    const newKeyStr = newPrivateKey.toStringDer()

    // 3. Preparar y Ejecutar la Transacción de Actualización
    console.log('[⚙️ PROCESO] Construyendo AccountUpdateTransaction con Firma Dual...')
    const transaction = await new AccountUpdateTransaction()
      .setAccountId(AccountId.fromString(targetId))
      .setKey(newPublicKey)
      .freezeWith(client)

    // Se requiere firma doble: Llave antigua (autoridad) + Llave nueva (prueba de propiedad)
    console.log('[⚙️ PROCESO] Firmando con llave ANTIGUA (Autoridad actual)...')
    await transaction.sign(oldPrivateKey)
    console.log('[⚙️ PROCESO] Firmando con llave NUEVA (Prueba de posesión)...')
    await transaction.sign(newPrivateKey)

    const response = await transaction.execute(client)
    const receipt = await response.getReceipt(client)

    console.log(`\n[✅ ÉXITO] Estado de Rotación en el Ledger: ${receipt.status.toString()}`)

    // 4. AUTO-SYNC: Actualizar el archivo .env
    console.log('[ℹ️ INFO] Sincronizando nuevas credenciales en el archivo .env...')
    updateEnv('ACCOUNT_1_PRIVATE_KEY', newKeyStr)
    updateEnv('ACCOUNT_1_EVM_ADDRESS', '0x' + newPublicKey.toEvmAddress())

    console.log('\n[📊 REGISTRO] Rotación completada exitosamente.')
    console.log(`[📊 REGISTRO] Nueva Llave Guardada: ${newKeyStr.substring(0, 45)}...`)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Al desacoplar la Identidad (0.0.X) de la Credencial (Key),')
    console.log('Hedera permite que las empresas mantengan sus direcciones')
    console.log('públicas permanentes mientras actualizan su seguridad de forma')
    console.log('periódica y transparente.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La rotación de llaves falló:', error.message)
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
