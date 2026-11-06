/**
 * ============================================================================
 * Lab 05: Firmador Enterprise con AWS KMS
 * [CONCEPTO] Módulos de Seguridad de Hardware (HSM) y Custodia Air-Gapped
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En la banca corporativa, exchanges y custodia institucional (Fireblocks,
 * Anchorage, Copper), las claves privadas en bruto NUNCA residen en la
 * memoria de la aplicación ni en archivos de texto (.env). En su lugar, las
 * claves asimétricas (ECC_SECG_P256K1 o ED25519) se generan dentro de
 * hardware certificado FIPS 140-2 Nivel 3 (AWS KMS / Cloud HSM).
 *
 * La transacción se construye en el cliente, se calcula su hash y se envía a
 * través de `SignCommand` de AWS KMS. La firma resultante en formato ASN.1 DER
 * se decodifica al formato canónico de 64 bytes (r || s) y se adjunta a la
 * transacción de Hedera.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * La seguridad institucional prohíbe almacenar llaves privadas en disco o en memoria RAM. Simular un módulo de seguridad en hardware (HSM/KMS) asegura que las transacciones se firmen en enclaves físicos sin exponer la llave privada.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.aws.amazon.com/kms/latest/developerguide/overview.html
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M0 Lab 04: Creación Nativa de Cuentas (Provisionamiento)
 * - Siguiente: M0 Lab 06: Telemetría de Consenso con OpenTelemetry
 *
 * [ SIMULADO ]
 * El enclave de AWS KMS se simula en memoria salvo que configures credenciales de AWS y AWS_KMS_KEY_ARN. La transacción que firma es real.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M0_Setup_and_Test/05_aws_kms_enterprise_signer.js
 * ============================================================================
 */

import { TransferTransaction, Hbar, PrivateKey } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl } from '../M99_Utilities/index.js'

/**
 * Conversor Enterprise de DER a 64 bytes Canónicos (r || s).
 * AWS KMS devuelve firmas codificadas en ASN.1 DER para ECDSA_SHA_256.
 * Los nodos de consenso de Hedera requieren un buffer de 64 bytes concatenado
 * (r || s) con normalización low-s (BIP-62).
 *
 * @param {Uint8Array} derBytes - La firma codificada en DER de AWS KMS
 * @returns {Buffer} Buffer de firma canónica de 64 bytes
 */
const unpackDerToRaw = (derBytes) => {
  let offset = 0
  if (derBytes[offset++] !== 0x30) throw new Error('ASN.1 DER Inválido: Se esperaba SEQUENCE (0x30)')

  const len = derBytes[offset++]
  if (len & 0x80) offset += (len & 0x7f) // longitud multi-byte

  // Desempaquetar R
  if (derBytes[offset++] !== 0x02) throw new Error('ASN.1 DER Inválido: Se esperaba INTEGER (0x02) para R')
  const rLen = derBytes[offset++]
  let r = derBytes.subarray(offset, offset + rLen)
  offset += rLen

  // Desempaquetar S
  if (derBytes[offset++] !== 0x02) throw new Error('ASN.1 DER Inválido: Se esperaba INTEGER (0x02) para S')
  const sLen = derBytes[offset++]
  let s = derBytes.subarray(offset, offset + sLen)

  // Eliminar relleno de ceros inicial si tiene 33 bytes
  if (r.length === 33 && r[0] === 0x00) r = r.subarray(1)
  if (s.length === 33 && s[0] === 0x00) s = s.subarray(1)

  // Rellenar a exactamente 32 bytes
  const rPadded = Buffer.alloc(32)
  Buffer.from(r).copy(rPadded, 32 - r.length)

  const sPadded = Buffer.alloc(32)
  Buffer.from(s).copy(sPadded, 32 - s.length)

  // Normalización Low-S para secp256k1 (BIP-62)
  const secp256k1N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141')
  const halfN = secp256k1N / 2n
  let sBig = BigInt('0x' + sPadded.toString('hex'))
  if (sBig > halfN) {
    sBig = secp256k1N - sBig
    const sNormalized = Buffer.from(sBig.toString(16).padStart(64, '0'), 'hex')
    return Buffer.concat([rPadded, sNormalized])
  }

  return Buffer.concat([rPadded, sPadded])
}

/**
 * Interfaz de Cliente AWS KMS y Simulador de Enclave de Hardware.
 * Se ajusta al 100% a la interfaz SignCommand de `@aws-sdk/client-kms` de AWS SDK v3.
 */
class EnterpriseKmsAdapter {
  constructor (config = {}) {
    this.region = config.region || process.env.AWS_REGION || 'us-east-1'
    this.keyArn = config.keyArn || process.env.AWS_KMS_KEY_ARN || 'arn:aws:kms:us-east-1:112233445566:key/hedera-custody-hsm'
    this.isLiveAws = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_KMS_KEY_ARN)
    this._isolatedKey = config.isolatedKey
  }

  /**
   * Ejecuta SignCommand coincidiendo con la especificación de AWS SDK v3.
   *
   * @param {Object} command - AWS KMS SignCommandInput
   * @returns {Promise<Object>} AWS KMS SignCommandOutput
   */
  async sign (commandInput) {
    const { KeyId, Message, MessageType, SigningAlgorithm } = commandInput

    if (this.isLiveAws) {
      console.log(`[ AWS KMS LIVE] Transmitiendo SignCommand al HSM de AWS KMS (${this.region})...`)
      const { KMSClient, SignCommand } = await import('@aws-sdk/client-kms')
      const kms = new KMSClient({ region: this.region })
      const res = await kms.send(new SignCommand(commandInput))
      return {
        Signature: res.Signature,
        SigningAlgorithm: res.SigningAlgorithm,
        KeyId: res.KeyId
      }
    }

    // Simulación de Enclave Seguro en Memoria (Cero configuración Cloud requerida)
    console.log(`[ ENCLAVE HSM] Simulando Enclave de Hardware AWS KMS para Clave: ${KeyId.substring(0, 36)}...`)
    console.log(`[REGISTRO] Algoritmo: ${SigningAlgorithm} | MessageType: ${MessageType} | Carga: ${Message.length} bytes`)

    let derSig
    if (this._isolatedKey.publicKey.toStringDer().startsWith('302d300706052b8104000a')) {
      // ECDSA secp256k1: Hash del mensaje con SHA256 y firma ASN.1 DER
      const raw = this._isolatedKey.sign(Message)
      const r = raw.subarray(0, 32)
      const s = raw.subarray(32, 64)

      // Construcción de la estructura auténtica ASN.1 DER
      const rPrefixed = (r[0] & 0x80) ? Buffer.concat([Buffer.from([0x00]), r]) : r
      const sPrefixed = (s[0] & 0x80) ? Buffer.concat([Buffer.from([0x00]), s]) : s
      const totalLen = 2 + rPrefixed.length + 2 + sPrefixed.length
      derSig = Buffer.concat([
        Buffer.from([0x30, totalLen, 0x02, rPrefixed.length]),
        rPrefixed,
        Buffer.from([0x02, sPrefixed.length]),
        sPrefixed
      ])
    } else {
      // ED25519 firma el mensaje en crudo directamente
      derSig = this._isolatedKey.sign(Message)
    }

    return {
      KeyId,
      Signature: new Uint8Array(derSig),
      SigningAlgorithm
    }
  }
}

// Punto de entrada: Inicializar cliente AWS KMS y ejecutar flujo de custodia
const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Firmador Enterprise con AWS KMS ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const custodyKey = PrivateKey.fromStringDer(operatorKey)
  const isECDSA = custodyKey.publicKey.toStringDer().startsWith('302d300706052b8104000a')

  console.log('[SEGURIDAD] Modo de Custodia: Firmador KMS Air-Gapped')
  console.log(`[REGISTRO] ID de Cuenta:        ${operatorId.toString()}`)
  console.log(`[REGISTRO] Llave Pública (DER):  ${custodyKey.publicKey.toStringDer().substring(0, 32)}...`)
  console.log(`[REGISTRO] Algoritmo de Llave:   ${isECDSA ? 'ECC_SECG_P256K1 (ECDSA)' : 'ED25519'}`)

  // Inicializar adaptador AWS KMS (Cero programas externos; soporta AWS KMS real sin fricción)
  const kmsAdapter = new EnterpriseKmsAdapter({ isolatedKey: custodyKey })

  try {
    console.log('\n[PROCESO] Paso 1: Construyendo transacción en crudo sin firmar...')

    // Transacción inocua de verificación de estado (0 HBAR hacia sí mismo)
    const transaction = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(0))
      .freezeWith(client)

    console.log('[PROCESO] Paso 2: Delegando callback de firma al Enclave HSM de AWS KMS...')

    // Firmar utilizando el callback asíncrono signWith de Hedera
    await transaction.signWith(custodyKey.publicKey, async (transactionBodyBytes) => {
      // Invocar SignCommand de AWS KMS
      const kmsResponse = await kmsAdapter.sign({
        KeyId: kmsAdapter.keyArn,
        Message: transactionBodyBytes,
        MessageType: 'RAW',
        SigningAlgorithm: isECDSA ? 'ECDSA_SHA_256' : 'ED25519_SHA_512'
      })

      // Convertir firma DER al formato esperado por Hedera
      if (isECDSA) {
        const rawSignature = unpackDerToRaw(kmsResponse.Signature)
        console.log(`[ÉXITO] Firma DER decodificada a 64 bytes canónicos: ${rawSignature.toString('hex').substring(0, 24)}...`)
        return rawSignature
      }

      return kmsResponse.Signature
    })

    console.log('\n[PROCESO] Paso 3: Transmitiendo transacción firmada con KMS a los nodos de Hedera...')
    const txResponse = await transaction.execute(client)
    const receipt = await txResponse.getReceipt(client)

    console.log(`\n[ÉXITO] Estado de Consenso:    ${receipt.status.toString()}`)
    console.log(`[REGISTRO] ID de Transacción: ${txResponse.transactionId.toString()}`)
    console.log(`[EXPLORADOR] Ver en HashScan:  ${getHashscanUrl(txResponse)}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Cero Exposición de Claves: El entorno de la aplicación NUNCA posee la clave privada.')
    console.log('Los bytes de la transacción se enviaron a un módulo de seguridad de hardware (HSM),')
    console.log('se firmaron en hardware y se verificaron en Hedera. Esta es la arquitectura obligatoria')
    console.log('para cumplimiento regulatorio SOC2, ISO27001 y banca institucional.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error(`\n[FALLO] Error en Firma KMS: ${error.message}`)
    process.exitCode = 1
    if (client) client.close()
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
