/**
 * ============================================================================
 * Lab 10: Bóveda Cifrada Zero-Trust (Privacidad Corporativa en Consenso Público)
 * [CONCEPTO] Fragmentación Cifrada de Extremo a Extremo con Gzip, AES-256-GCM y HCS-1
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Los registros públicos garantizan orden justo e inmutabilidad, pero los
 * datos en claro son visibles para cualquier operador de nodo o indexador de Mirror Node.
 * La arquitectura empresarial moderna exige "Consenso Zero-Trust": registros sensibles
 * (historiales médicos, pistas de auditoría financiera) deben ser
 * sellados criptográficamente antes de transmitirse a la Capa 1 de Hedera. Combinando:
 * 1. Compresión de Flujo (Gzip) para reducir los costos por byte en consenso.
 * 2. Cifrado Autenticado (AES-256-GCM) con IV de 96 bits y etiquetas GMAC de 128 bits.
 * 3. Cifrado de Sobre (Envelope Encryption) aislando la Llave de Cifrado de Datos (DEK).
 * 4. Fragmentación JSON al estilo HCS-1 en secuencias de consenso.
 *
 * El ledger conserva el orden y las marcas de tiempo; la confidencialidad dura mientras las llaves
 * estén a salvo. Los datos cifrados igual quedan en el ledger para siempre, así que los datos
 * personales que quizá haya que borrar (por ejemplo, por GDPR) no deben ir on-chain ni cifrados.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los Hashinals y HCS no se limitan a imágenes públicas o JSON abierto. Con AES-GCM,
 * el ledger solo guarda texto cifrado. Cualquiera puede leer los mensajes desde un
 * Mirror Node, pero sin la llave de sobre no puede descifrarlos, y cualquier intento de alteración invalida el código de autenticación GMAC de 128 bits.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-1/
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M6 Lab 09: Smart Hashinals HCS-7 (Estado EVM + Inscripciones Dinámicas WASM)
 * - Siguiente: M7 Lab 01: Gobernanza con Multi-firma (KeyList y Thresholds)
 *
 * [ SIMULADO ]
 * El reporte de auditoría son datos de ejemplo inventados (institución, clientes, nombres de políticas e IDs son ficticios), y la llave maestra (KEK) es una llave WebCrypto no extraíble de esta sesión en lugar de una llave de KMS. El envoltorio AES-KW, el cifrado AES-256-GCM, los mensajes HCS y la prueba de manipulación son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M6_Mass_Storage_Hashinals/10_zero_trust_encrypted_vault.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl, getHashscanUrl, sleep } from '../M99_Utilities/index.js'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

/**
 * 1. Motor de Cifrado de Sobre y Fragmentación (WebCrypto)
 * La DEK cifra el documento (AES-256-GCM); la KEK envuelve la DEK (AES-KW, RFC 3394).
 * La KEK es no extraíble: solo esta sesión puede desenvolver la DEK.
 */
const encryptAndShardVaultPayload = async (rawBuffer, kek) => {
  const subtle = globalThis.crypto.subtle
  // A. Comprimir con Gzip para reducir el tamaño del mensaje on-chain
  const compressed = zlib.gzipSync(rawBuffer)

  // B. Llave de cifrado de datos (DEK) nueva y IV de 96 bits para este documento
  const dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const iv = crypto.randomBytes(12)

  // C. Cifrado autenticado: WebCrypto agrega la etiqueta GCM de 16 bytes al texto cifrado
  const sealed = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, dek, compressed))
  const encryptedPayload = sealed.subarray(0, sealed.length - 16)
  const authTag = sealed.subarray(sealed.length - 16)

  // D. Cifrado de sobre: envolver la DEK con la KEK (AES-KW)
  const wrappedDek = Buffer.from(await subtle.wrapKey('raw', dek, kek, { name: 'AES-KW' }))

  // E. Huella SHA-256 del documento original
  const documentFingerprint = crypto.createHash('sha256').update(rawBuffer).digest('hex')

  // F. Fragmentar el texto cifrado en partes al estilo HCS-1 (250 caracteres base64 cada una)
  const cipherBase64 = encryptedPayload.toString('base64')
  const CHUNK_SIZE = 250
  const rawChunks = []
  for (let i = 0; i < cipherBase64.length; i += CHUNK_SIZE) {
    rawChunks.push(cipherBase64.slice(i, i + CHUNK_SIZE))
  }

  const shards = rawChunks.map((chunk, index) => ({
    h: 'hcs-1-vault',
    v: '1.1.0',
    fid: documentFingerprint,
    env: {
      alg: 'A256KW+A256GCM',
      dek: wrappedDek.toString('base64'),
      iv: iv.toString('base64'),
      tag: authTag.toString('base64')
    },
    i: index,
    t: rawChunks.length,
    d: chunk
  }))

  return {
    documentFingerprint,
    compressedSize: compressed.length,
    encryptedSize: encryptedPayload.length,
    authTag,
    shards
  }
}

/**
 * 2. Motor de Ensamblaje y Descifrado sin Confianza en Terceros
 */
const reassembleAndDecryptVault = async (shards, kek) => {
  const subtle = globalThis.crypto.subtle
  if (!shards || shards.length === 0) {
    throw new Error('No hay fragmentos para reensamblar')
  }

  const sorted = [...shards].sort((a, b) => a.i - b.i)
  if (sorted.length !== sorted[0].t) {
    throw new Error(`Conjunto de fragmentos incompleto: llegaron ${sorted.length} de ${sorted[0].t}`)
  }

  const header = sorted[0]
  const cipherBuffer = Buffer.from(sorted.map(s => s.d).join(''), 'base64')
  const iv = Buffer.from(header.env.iv, 'base64')
  const authTag = Buffer.from(header.env.tag, 'base64')

  // Desenvolver la DEK con la KEK, luego descifrar y autenticar (un byte alterado falla aquí)
  const dek = await subtle.unwrapKey('raw', Buffer.from(header.env.dek, 'base64'), kek, { name: 'AES-KW' }, { name: 'AES-GCM' }, false, ['decrypt'])
  const decompressed = Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, dek, Buffer.concat([cipherBuffer, authTag])))

  const originalBuffer = zlib.gunzipSync(decompressed)
  const verifiedFingerprint = crypto.createHash('sha256').update(originalBuffer).digest('hex')

  if (verifiedFingerprint !== header.fid) {
    throw new Error('Falló la verificación de integridad: el hash del documento reconstruido no coincide')
  }

  return {
    originalBuffer,
    verifiedFingerprint
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Bóveda Cifrada Corporativa Zero-Trust (HCS-1 + AES-GCM) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const submitKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Preparar Documento Corporativo Confidencial
    const sensitiveAuditReport = {
      vaultId: 'VAULT-CORP-SEC-2026-X9',
      classification: 'RESTRINGIDO / ESTRICTAMENTE CONFIDENCIAL',
      timestamp: new Date().toISOString(),
      institution: 'Demo Custody Co. (ficticia)',
      compliance: {
        policy: 'demo-policy-v1',
        auditorId: 'demo-auditor-01'
      },
      sensitiveRecords: [
        { client: 'Tesorería Global Acme', vaultBalanceHbar: 15000000, kycTier: 3, riskScore: 0.02 },
        { client: 'Reservas Soberanas Apex', vaultBalanceHbar: 48000000, kycTier: 4, riskScore: 0.001 },
        { client: 'Pasarela de Liquidación Nexus', vaultBalanceHbar: 9200000, kycTier: 3, riskScore: 0.05 }
      ],
      legalHashRoot: crypto.randomBytes(32).toString('hex')
    }

    const rawBuffer = Buffer.from(JSON.stringify(sensitiveAuditReport, null, 2), 'utf-8')
    console.log('[PROCESO] Paso 1: Cifrando Documento Empresarial bajo Arquitectura Zero-Trust...')
    console.log(`[REGISTRO] Tamaño en Claro: ${rawBuffer.length} bytes`)

    // Llave maestra (KEK): llave AES-KW no extraíble guardada por WebCrypto, nunca un texto en el código
    const kek = await globalThis.crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, false, ['wrapKey', 'unwrapKey'])
    const vault = await encryptAndShardVaultPayload(rawBuffer, kek)

    console.log(`[REGISTRO] Tamaño Comprimido Gzip: ${vault.compressedSize} bytes (-${Math.round((1 - (vault.compressedSize / rawBuffer.length)) * 100)}% reducción en red)`)
    console.log(`[REGISTRO] Tamaño Cifrado AES-256-GCM: ${vault.encryptedSize} bytes`)
    console.log(`[REGISTRO] Huella SHA-256 del Documento: 0x${vault.documentFingerprint}`)
    console.log(`[REGISTRO] Etiqueta de Autenticidad GMAC: 0x${vault.authTag.toString('hex')}`)
    console.log(`[REGISTRO] Fragmentos HCS-1 Generados: ${vault.shards.length} shards`)

    // 2. Crear Tópico de Bóveda Confidencial en Hedera
    console.log('\n[PROCESO] Paso 2: Aprovisionando Tópico Dedicado de Bóveda en Hedera Consensus Service...')
    const topicCreateTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-1-ENCRYPTED-VAULT:v1.0.0')
      .setSubmitKey(submitKey.publicKey)
      .setAutoRenewAccountId(operatorId)
      .execute(client)

    const topicReceipt = await topicCreateTx.getReceipt(client)
    const vaultTopicId = topicReceipt.topicId.toString()
    console.log(`[ÉXITO] Tópico HCS de Bóveda Aprovisionado: ${vaultTopicId}`)
    console.log(`[REGISTRO] Transacción de Creación en HashScan: ${getHashscanUrl(topicCreateTx)}`)

    // 3. Inscribir Fragmentos Cifrados en el Flujo de Consenso
    console.log('\n[PROCESO] Paso 3: Inscribiendo Fragmentos Cifrados en el Flujo de Consenso...')
    const sequenceNumbers = []

    for (const shard of vault.shards) {
      const payloadString = JSON.stringify(shard)
      const submitTx = await new TopicMessageSubmitTransaction()
        .setTopicId(vaultTopicId)
        .setMessage(payloadString)
        .freezeWith(client)
        .sign(submitKey)

      const submitRes = await submitTx.execute(client)
      const receipt = await submitRes.getReceipt(client)
      sequenceNumbers.push(receipt.topicSequenceNumber.toNumber())
      console.log(`[ÉXITO] Fragmento Inscrito [${shard.i + 1}/${shard.t}] en Secuencia de Consenso #${receipt.topicSequenceNumber}`)
    }

    // 4. Recuperación en Mirror Node y Reensamblaje Inalterable Zero-Trust
    console.log('\n[PROCESO] Paso 4: Interrogando Mirror Node para Reensamblar Flujo de la Bóveda...')
    console.log('[INFO] Esperando ingestión en Mirror Node (4 segundos)...')
    await sleep(4000)

    const mirrorUrl = `${getMirrorNodeBaseUrl()}/api/v1/topics/${vaultTopicId}/messages?order=asc`
    const mirrorRes = await fetch(mirrorUrl)
    if (!mirrorRes.ok) {
      throw new Error(`La consulta a Mirror Node falló con estado: ${mirrorRes.status}`)
    }

    const mirrorData = await mirrorRes.json()
    console.log(`[REGISTRO] Mirror Node devolvió ${mirrorData.messages.length} mensajes para el tópico ${vaultTopicId}`)

    const retrievedShards = mirrorData.messages
      .map(msg => {
        try {
          const decoded = Buffer.from(msg.message, 'base64').toString('utf-8')
          return JSON.parse(decoded)
        } catch {
          return null
        }
      })
      .filter(parsed => parsed && parsed.h === 'hcs-1-vault' && parsed.fid === vault.documentFingerprint)

    console.log(`[ÉXITO] Se procesaron y validaron exitosamente ${retrievedShards.length} fragmentos desde registros de consenso`)

    // 5. Descifrar y Verificar Integridad
    console.log('\n[PROCESO] Paso 5: Realizando Verificación Autenticada GMAC y Descifrado...')
    const reconstruction = await reassembleAndDecryptVault(retrievedShards, kek)
    const reconstructedDocument = JSON.parse(reconstruction.originalBuffer.toString('utf-8'))

    console.log(`[ÉXITO] ¡Integridad del Documento Verificada! Huella SHA-256: 0x${reconstruction.verifiedFingerprint}`)
    console.log(`[REGISTRO] ID de Bóveda Reconstruida: "${reconstructedDocument.vaultId}"`)
    console.log(`[REGISTRO] Clasificación: "${reconstructedDocument.classification}"`)
    console.log(`[REGISTRO] Registros de Auditoría Confidencial: ${reconstructedDocument.sensitiveRecords.length}`)
    console.log(`[REGISTRO] Balance Total en HBAR en Bóvedas Auditadas: ${reconstructedDocument.sensitiveRecords.reduce((acc, r) => acc + r.vaultBalanceHbar, 0).toLocaleString()} HBAR`)

    // 6. Demostrar Defensa Criptográfica Inalterable Zero-Trust
    console.log('\n[PROCESO] Paso 6: Probando Detección de Alteraciones Zero-Trust (Simulación de Ataque)...')
    try {
      const tamperedShards = JSON.parse(JSON.stringify(retrievedShards))
      // Un atacante altera 1 byte del texto cifrado en un Mirror Node no autenticado
      const tamperedBytes = Buffer.from(tamperedShards[0].d, 'base64')
      tamperedBytes[0] = tamperedBytes[0] ^ 0xff // Invertir bits
      tamperedShards[0].d = tamperedBytes.toString('base64')

      await reassembleAndDecryptVault(tamperedShards, kek)
      console.error('[FALLO] Violación de seguridad: ¡Se aceptó un texto cifrado alterado!')
      process.exitCode = 1
    } catch (tamperErr) {
      console.log(`[ÉXITO] Intento de alteración detectado y bloqueado por GMAC de AES-GCM: "${tamperErr.message}"`)
    }

    console.log('\n CONCEPTO CLAVE:')
    console.log('Las Bóvedas Zero-Trust combinan el orden justo y sellos de tiempo de Hedera L1 con')
    console.log('cifrado de sobre AES-256-GCM. La red asegura la prueba y el orden, mientras que')
    console.log('la confidencialidad y el acceso residen estrictamente fuera de la cadena en los custodios.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Nunca almacenes datos corporativos en claro en un libro contable público. Al aplicar')
    console.log('Gzip antes de la fragmentación AES-GCM, minimizas costos de consenso en HCS garantizando')
    console.log('que los fragmentos en la red aparezcan como entropía seudoaleatoria uniforme ante observadores.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en la Bóveda Zero-Trust:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
