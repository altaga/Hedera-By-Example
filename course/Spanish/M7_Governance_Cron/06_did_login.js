/**
 * ============================================================================
 * Lab 06: Login Criptográfico con DID
 * [CONCEPTO] Autenticación sin Contraseñas y Pruebas de Posesión
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Adiós a las Contraseñas: El flujo de login basado en DID sustituye las
 * credenciales tradicionales por un desafío criptográfico ("Challenge"). Al
 * firmar un nonce aleatorio proporcionado por el servidor con tu Llave
 * Privada, demuestras el control sobre tu identidad digital (DID) sin
 * transmitir información sensible por la red. El servidor simplemente
 * resuelve tu DID Document en Hedera, extrae tu Llave Pública y verifica la
 * firma, garantizando un acceso seguro, privado y soberano.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * La autenticación por desafío-respuesta con llaves DID de Hedera elimina las contraseñas: el usuario firma un nonce criptográfico generado por el servidor, verificando la identidad en consenso.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://github.com/hiero-ledger/hiero-did-sdk-js
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M7 Lab 05: Identidad Descentralizada (DID) sobre Hedera
 * - Siguiente: M7 Lab 07: DAO de Tesorería Autónoma con Webhooks (Gobernanza Reactiva)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Ejecuta antes: Lab 05 de M7 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M7_Governance_Cron/06_did_login.js
 * ============================================================================
 */

import { PrivateKey, PublicKey } from '@hiero-ledger/sdk'
import { KeysUtility } from '@hiero-did-sdk/core'
import { getClient, getState, waitForMirror, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Autenticación Criptográfica (DID-Login) ---\n')

  const { operatorKey } = getClient()
  const topicId = getState('DID_TOPIC_ID')

  if (!topicId) {
    console.error('[FALLO] No se encontró DID_TOPIC_ID en el estado local. Ejecuta Lab 05 primero.')
    process.exitCode = 1
    return
  }

  try {
    // --- FASE 1: RESOLUCIÓN DEL DID DESDE EL LEDGER ---
    console.log(`[PROCESO] Resolviendo DID Document para el Tema: ${topicId}...`)

    // Consulta al Mirror Node para obtener el estado actual de la identidad
    // El Mirror Node muestra el mensaje unos segundos después del consenso; esperamos.
    const mirrorUrl = `${getMirrorNodeBaseUrl()}/api/v1/topics/${topicId}/messages?limit=1&order=desc`
    const data = (await waitForMirror(async () => {
      const json = await (await fetch(mirrorUrl)).json()
      return json.messages?.length ? json : null
    })) || {}

    if (!data.messages || data.messages.length === 0) {
      throw new Error('No se encontró ningún documento DID anclado en este tema.')
    }

    // Decodificación del documento anclado
    const messageJson = Buffer.from(data.messages[0].message, 'base64').toString()
    const didDocument = JSON.parse(messageJson)

    console.log(`[ÉXITO] Identidad Resuelta para: ${didDocument.nickname}`)
    console.log(`[REGISTRO] Biografía Declarada: ${didDocument.bio}`)

    // --- FASE 2: GENERACIÓN DEL DESAFÍO (EL "CHALLENGE") ---
    const challenge = `CHALLENGE_HE_ES_${Math.random().toString(36).substring(7)}_${Date.now()}`
    console.log(`\n[INFO] Desafío del Servidor generado: ${challenge}`)

    // --- FASE 3: AUDITORÍA DE FIRMAS ---
    console.log('\n---  [REGISTRO] Ejecutando Pruebas de Verificación ---')
    const bytes = new TextEncoder().encode(challenge)

    // Recuperamos la llave pública del DID Document para la verificación
    const pubKeyStr = didDocument.verificationMethod[0].publicKeyMultibase
    const publicKey = pubKeyStr.startsWith('z')
      ? KeysUtility.fromMultibase(pubKeyStr).toPublicKey()
      : PublicKey.fromString(pubKeyStr)

    // A. PRUEBA DE FALLO: Firma con cuenta no autorizada
    console.log('[PROCESO] PRUEBA A: Intentando login con Cuenta No Autorizada...')
    const account1Key = PrivateKey.fromString(process.env.ACCOUNT_1_PRIVATE_KEY)
    const badSignature = account1Key.sign(bytes)

    if (publicKey.verify(bytes, badSignature)) {
      console.log('└─ [FALLO] Fallo de Seguridad: Una firma no autorizada fue aceptada.')
    } else {
      console.log('└─ [ÉXITO] Acceso Denegado: La firma no coincide con el dueño del DID.')
    }

    // B. PRUEBA DE ÉXITO: Firma con el titular del DID
    console.log('\n[PROCESO] PRUEBA B: Intentando login con el Dueño Autorizado (Operador)...')
    const operatorKeyObj = PrivateKey.fromString(operatorKey)
    const goodSignature = operatorKeyObj.sign(bytes)

    if (publicKey.verify(bytes, goodSignature)) {
      console.log('\n --- [ÉXITO] ¡AUTENTICACIÓN EXITOSA! ---')
      console.log(`[INFO] Sesión iniciada como: ${didDocument.nickname}`)
      console.log(`[REGISTRO]  ${didDocument.id}`)
      console.log('--------------------------------------------------')
    } else {
      console.log('\n   └─ [FALLO] Error Crítico: La firma legítima fue rechazada por el verificador.')
    }

    console.log('\n CONCEPTO CLAVE:')
    console.log('El login criptográfico elimina los puntos únicos de fallo')
    console.log('(como bases de datos de contraseñas filtradas). El riesgo se')
    console.log('traslada al borde (edge): el usuario es responsable de su')
    console.log('llave privada, y el servidor solo verifica la prueba matemática.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] El flujo de autenticación DID falló:', error.message)
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
