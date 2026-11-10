/**
 * ============================================================================
 * Lab 10: Bóveda Cifrada Zero-Trust (Privacidad Corporativa en Consenso Público)
 * [CONCEPTO] Cifrado de Extremo a Extremo con Gzip, AES-KW + AES-256-GCM, guardado como archivo HCS-1
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Los registros públicos garantizan orden justo e inmutabilidad, pero los
 * datos en claro son visibles para cualquier operador de nodo o indexador de Mirror Node.
 * La arquitectura empresarial moderna exige "Consenso Zero-Trust": registros sensibles
 * (historiales médicos, pistas de auditoría financiera) deben ser
 * sellados criptográficamente antes de transmitirse a la Capa 1 de Hedera. Combinando:
 * 1. Compresión de Flujo (Gzip) para reducir los costos por byte en consenso.
 * 2. Cifrado Autenticado (AES-256-GCM) con IV de 96 bits y etiquetas GMAC de 128 bits.
 * 3. Cifrado de Sobre: la Llave de Cifrado de Datos (DEK) se envuelve con AES-KW (RFC 3394).
 * 4. El sobre sellado se inscribe como un archivo HCS-1 estándar (zstd, fragmentos {o, c}).
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
 * El reporte de auditoría son datos de ejemplo inventados (institución, clientes, nombres de políticas e IDs son ficticios), y la llave maestra (KEK) es una llave WebCrypto no extraíble de esta sesión en lugar de una llave de KMS. El envoltorio AES-KW, el cifrado AES-256-GCM, la inscripción HCS-1 y la prueba de manipulación son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M6_Mass_Storage_Hashinals/10_zero_trust_encrypted_vault.js
 * ============================================================================
 */

import { getClient, inscribeHcs1, readHcs1 } from '../M99_Utilities/index.js'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

/**
 * 1. Cifrado de Sobre (WebCrypto)
 * La DEK cifra el documento (AES-256-GCM); la KEK envuelve la DEK (AES-KW, RFC 3394).
 * La KEK es no extraíble: solo esta sesión puede desenvolver la DEK.
 */
const sealDocument = async (rawBuffer, kek) => {
  const subtle = globalThis.crypto.subtle
  // A. Comprimir con Gzip antes de cifrar (el texto cifrado no se comprime)
  const compressed = zlib.gzipSync(rawBuffer)
  // B. Llave de cifrado de datos (DEK) nueva y IV de 96 bits para este documento
  const dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const iv = crypto.randomBytes(12)
  // C. Cifrado autenticado: WebCrypto agrega la etiqueta GCM de 16 bytes al texto cifrado
  const sealed = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, dek, compressed))
  // D. Cifrado de sobre: envolver la DEK con la KEK (AES-KW)
  const wrappedDek = Buffer.from(await subtle.wrapKey('raw', dek, kek, { name: 'AES-KW' }))
  return {
    compressedSize: compressed.length,
    authTag: sealed.subarray(sealed.length - 16),
    envelope: {
      v: 'hbe-vault/1',
      alg: 'A256KW+A256GCM',
      fid: crypto.createHash('sha256').update(rawBuffer).digest('hex'), // SHA-256 del texto en claro
      dek: wrappedDek.toString('base64'),
      iv: iv.toString('base64'),
      ct: sealed.toString('base64') // texto cifrado + etiqueta GCM
    }
  }
}

/**
 * 2. Descifrado: desenvolver la DEK, descifrar y autenticar (un byte alterado falla aquí),
 * y luego comprobar el SHA-256 del texto en claro.
 */
const openDocument = async (envelope, kek) => {
  const subtle = globalThis.crypto.subtle
  const dek = await subtle.unwrapKey('raw', Buffer.from(envelope.dek, 'base64'), kek, { name: 'AES-KW' }, { name: 'AES-GCM' }, false, ['decrypt'])
  const compressed = Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64'), tagLength: 128 }, dek, Buffer.from(envelope.ct, 'base64')))
  const originalBuffer = zlib.gunzipSync(compressed)
  const verifiedFingerprint = crypto.createHash('sha256').update(originalBuffer).digest('hex')
  if (verifiedFingerprint !== envelope.fid) throw new Error('Falló la verificación de integridad: el hash del documento reconstruido no coincide')
  return { originalBuffer, verifiedFingerprint }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Bóveda Cifrada Corporativa Zero-Trust (HCS-1 + AES-GCM) ---\n')
  const { client } = getClient()

  try {
    // 1. Preparar el documento corporativo confidencial
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
    const vault = await sealDocument(rawBuffer, kek)
    console.log(`[REGISTRO] Tamaño Comprimido Gzip: ${vault.compressedSize} bytes (-${Math.round((1 - (vault.compressedSize / rawBuffer.length)) * 100)}% antes de cifrar)`)
    console.log(`[REGISTRO] Huella SHA-256 del Documento: 0x${vault.envelope.fid}`)
    console.log(`[REGISTRO] Etiqueta de Autenticidad GMAC: 0x${vault.authTag.toString('hex')}`)
    console.log(`[REGISTRO] DEK envuelta (AES-KW): ${vault.envelope.dek}`)

    // 2. Inscribir el sobre sellado como archivo HCS-1
    console.log('\n[PROCESO] Paso 2: Inscribiendo el sobre sellado como archivo HCS-1...')
    const vaultTopicId = await inscribeHcs1(client, Buffer.from(JSON.stringify(vault.envelope)), 'application/json', {
      onChunk: (done, total) => console.log(`[ÉXITO] Fragmento inscrito ${done}/${total}`)
    })
    console.log(`[ÉXITO] Archivo de la bóveda: hcs://1/${vaultTopicId}`)

    // 3. Leerlo de vuelta desde el Mirror Node (readHcs1 comprueba el SHA-256 del memo)
    console.log('\n[PROCESO] Paso 3: Reconstruyendo el archivo HCS-1 desde el Mirror Node...')
    const file = await readHcs1(vaultTopicId)
    const retrieved = JSON.parse(file.bytes.toString('utf-8'))
    console.log(`[VERIFY] El SHA-256 del archivo HCS-1 coincide con el memo del tópico (${file.chunks} fragmentos)`)
    console.log(`[VERIFY] El texto en claro nunca llegó al ledger: "${sensitiveAuditReport.sensitiveRecords[0].client}" ${file.bytes.toString('utf-8').includes(sensitiveAuditReport.sensitiveRecords[0].client) ? 'ENCONTRADO' : 'no aparece'} en el archivo on-chain`)

    // 4. Descifrar y verificar la integridad
    console.log('\n[PROCESO] Paso 4: Realizando Verificación Autenticada GMAC y Descifrado...')
    const reconstruction = await openDocument(retrieved, kek)
    const reconstructedDocument = JSON.parse(reconstruction.originalBuffer.toString('utf-8'))
    console.log(`[ÉXITO] ¡Integridad del Documento Verificada! Huella SHA-256: 0x${reconstruction.verifiedFingerprint}`)
    console.log(`[REGISTRO] ID de Bóveda Reconstruida: "${reconstructedDocument.vaultId}"`)
    console.log(`[REGISTRO] Clasificación: "${reconstructedDocument.classification}"`)
    console.log(`[REGISTRO] Registros de Auditoría Confidencial: ${reconstructedDocument.sensitiveRecords.length}`)

    // 5. Prueba de manipulación: invertir un byte del texto cifrado recuperado e intentar abrirlo
    console.log('\n[PROCESO] Paso 5: Prueba de manipulación (se invierte un byte del texto cifrado recuperado)...')
    try {
      const tampered = { ...retrieved }
      const bytes = Buffer.from(tampered.ct, 'base64')
      bytes[0] = bytes[0] ^ 0xff
      tampered.ct = bytes.toString('base64')
      await openDocument(tampered, kek)
      console.error('[FALLO] Violación de seguridad: ¡Se aceptó un texto cifrado alterado!')
      process.exitCode = 1
    } catch (tamperErr) {
      console.log(`[ÉXITO] Intento de alteración detectado y bloqueado por GMAC de AES-GCM: ${tamperErr.name}${tamperErr.message ? ` (${tamperErr.message})` : ''} — descifrado rechazado`)
    }

    console.log('\n CONCEPTO CLAVE:')
    console.log('Las Bóvedas Zero-Trust combinan el orden justo y las marcas de tiempo de Hedera con')
    console.log('cifrado de sobre. El ledger solo guarda texto cifrado en un archivo HCS-1 estándar;')
    console.log('la confidencialidad y el acceso quedan fuera de la cadena con quien tiene la llave maestra.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Nunca guardes datos corporativos en claro en un ledger público. Comprime antes de')
    console.log('cifrar (el texto cifrado no se comprime) y guarda la llave maestra en un almacén')
    console.log('que no pueda exportarla.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la Bóveda Zero-Trust:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de Ejecución:', error.message)
      process.exit(1)
    })
}
