/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Rotación de Llaves
 * [CONCEPTO] Desacoplamiento de Identidad y Credencial
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
 * - https://docs.hedera.com/native/accounts/update
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M1 Lab 03: Criptografía y KMS
 * - Actual:   M1 Lab 04: Rotación de Llaves
 * - Siguiente: M2 Lab 01: Depreciación Sync
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 04_key_rotation.js
 * ============================================================================
 */

import { AccountId, AccountInfoQuery, AccountUpdateTransaction, PrivateKey } from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Rotación de Credenciales ---\n')

  const { client } = getClient()
  const targetId = process.env.ACCOUNT_1_ID
  const targetKey = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!targetId || !targetKey) {
    console.error('[FALLO] Faltan credenciales de ACCOUNT_1 en el archivo .env.')
    process.exitCode = 1
    return
  }

  try {
    const oldPrivateKey = PrivateKey.fromString(targetKey)

    // 2. Generar la NUEVA llave de reemplazo
    console.log(`[PROCESO] Generando nueva clave criptográfica para ${targetId}...`)
    const newPrivateKey = PrivateKey.generateECDSA()
    const newPublicKey = newPrivateKey.publicKey
    const newKeyStr = newPrivateKey.toStringDer()

    // 3. Preparar y Ejecutar la Transacción de Actualización
    console.log('[PROCESO] Construyendo AccountUpdateTransaction con Firma Dual...')
    const transaction = await new AccountUpdateTransaction()
      .setAccountId(AccountId.fromString(targetId))
      .setKey(newPublicKey)
      .freezeWith(client)

    // Se requiere firma doble: Llave antigua (autoridad) + Llave nueva (prueba de propiedad)
    console.log('[PROCESO] Firmando con llave ANTIGUA (Autoridad actual)...')
    await transaction.sign(oldPrivateKey)
    console.log('[PROCESO] Firmando con llave NUEVA (Prueba de posesión)...')
    await transaction.sign(newPrivateKey)

    const response = await transaction.execute(client)
    const receipt = await response.getReceipt(client)

    console.log(`\n[ÉXITO] Estado de Rotación en el Ledger: ${receipt.status.toString()}`)

    // 4. Verificar en la red que la cuenta ahora responde a la llave nueva
    const info = await new AccountInfoQuery().setAccountId(targetId).execute(client)
    if (info.key.toString() !== newPublicKey.toString()) {
      throw new Error('La red sigue reportando la llave anterior después de la rotación.')
    }
    console.log(`[ÉXITO] La red confirma la llave nueva: ${newPublicKey.toStringRaw().slice(0, 20)}...`)

    // 5. Rotar de vuelta para que ACCOUNT_1 siga coincidiendo con ACCOUNT_1_PRIVATE_KEY de tu .env.
    //    Aplica la misma regla de doble firma: llave actual (nueva) + llave entrante (original).
    //    En producción conservarías la llave nueva y la guardarías en tu gestor de secretos.
    console.log('[PROCESO] Rotando de vuelta a la llave original para poder repetir este lab...')
    const restoreTx = await new AccountUpdateTransaction()
      .setAccountId(AccountId.fromString(targetId))
      .setKey(oldPrivateKey.publicKey)
      .freezeWith(client)
    await restoreTx.sign(newPrivateKey)
    await restoreTx.sign(oldPrivateKey)
    const restoreReceipt = await (await restoreTx.execute(client)).getReceipt(client)
    console.log(`[ÉXITO] Llave original restaurada: ${restoreReceipt.status.toString()}`)
    console.log(`[REGISTRO] Llave temporal usada en la demo: ${newKeyStr.slice(0, 45)}...`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Al desacoplar la Identidad (0.0.X) de la Credencial (Key),')
    console.log('Hedera permite que las empresas mantengan sus direcciones')
    console.log('públicas permanentes mientras actualizan su seguridad de forma')
    console.log('periódica y transparente.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] La rotación de llaves falló:', error.message)
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
