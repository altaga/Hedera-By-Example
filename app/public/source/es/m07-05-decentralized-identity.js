/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Identidad Descentralizada (DID) sobre Hedera
 * [ CONCEPTO ] Soberanía Digital y Documentos DID Anclados
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Soberanía de Identidad: Un DID (Decentralized Identifier) es una URI que
 * resuelve a un documento de identidad sin depender de un proveedor central
 * (como Google o Facebook). Al usar Hedera como capa de resolución (vía HCS),
 * el titular de la identidad tiene el control total sobre sus llaves de
 * verificación y servicios. Esto permite presentar credenciales verificables
 * (VCs) y realizar autenticaciones criptográficas manteniendo la privacidad
 * selectiva, sentando las bases de la confianza en la Web3.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Publicar Identificadores Descentralizados W3C (DIDs) en HCS otorga identidades autosoberanas que no pueden ser revocadas ni alteradas por proveedores de identidad centralizados.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://github.com/hiero-ledger/hiero-did-sdk-js
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M7 Lab 04: Orquestación Desacoplada
 * - Actual:   M7 Lab 05: Identidad Descentralizada (DID)
 * - Siguiente: M7 Lab 06: Verificación de Login Criptográfico
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 05_decentralized_identity.js
 * ============================================================================
 */

import { PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { KeysUtility } from '@hiero-did-sdk/core'
import { getClient, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Identidad Descentralizada (DID) ---\n')

  const { client, operatorKey } = getClient()

  try {
    // 1. Crear un Tópico para actuar como Registro de DID
    console.log('[⚙️ PROCESO] Creando Tópico HCS para anclaje de Documento DID...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('Registro DID')
      .freezeWith(client)

    const topicRes = await topicTx.execute(client)
    const topicReceipt = await topicRes.getReceipt(client)
    const topicId = topicReceipt.topicId

    console.log(`\n[✅ ÉXITO] Tópico de Registro DID Creado: ${topicId.toString()}`)

    // 2. Construir un Documento DID W3C usando el estándar de @hiero-did-sdk
    // Usamos la llave del Operador para que el Lab 06 demuestre posesión en el login
    const didKey = PrivateKey.fromStringDer(operatorKey)

    // Extraer la clave pública en formato multibase usando la utilidad oficial del SDK
    const publicKeyMultibase = KeysUtility.fromPublicKey(didKey.publicKey).toMultibase()

    const did = `did:hedera:testnet:${topicId.toString()}`
    const keyId = `${did}#did-root-key`

    const didDocument = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: did,
      nickname: 'Satoshi_HBAR',
      bio: 'Arquitecto Soberano de Hedera y Pionero DID',
      verificationMethod: [{
        id: keyId,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase
      }],
      authentication: [keyId],
      assertionMethod: [keyId]
    }

    console.log('\n[📊 REGISTRO] Documento DID W3C Generado (formato @hiero-did-sdk):')
    console.log(JSON.stringify(didDocument, null, 2))

    // 3. Anclar el Documento DID a HCS
    console.log('\n[⚙️ PROCESO] Anclando Documento DID al ledger...')
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(didDocument))
      .execute(client)

    await submitTx.getReceipt(client)

    console.log('\n[✅ ÉXITO] Documento DID Anclado Exitosamente!')
    console.log(`[📊 REGISTRO] Registro: ${topicId.toString()}`)
    console.log(`[📊 REGISTRO] ID DID:   ${didDocument.id}`)

    // Guardar para el Paso 06 (Prueba de Inicio de Sesión)
    console.log('[ℹ️ INFO] Sincronizando state.json con ID de Tópico DID...')
    updateState('DID_TOPIC_ID', topicId.toString())

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Identidad Autosoberana: Este patrón permite una identidad verificable')
    console.log('y criptográficamente segura que no puede ser revocada por un tercero.')
    console.log('Hedera actúa como el directorio definitivo y neutral de la verdad.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Anclaje de DID Fallido:', error.message)
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
