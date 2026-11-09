/**
 * ============================================================================
 * Lab 01: Telemetría DePIN MQTTS de Alta Velocidad y Firma Hardware (Marcapasos)
 * [CONCEPTO] Ingesta IoT de Misión Crítica y Agrupamiento en Consenso
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * DePIN (Redes de Infraestructura Física Descentralizada) conecta hardware físico
 * con libros mayores distribuidos. En el sector de salud de misión crítica (marcapasos
 * cardíacos, bombas de insulina), la telemetría debe transmitirse a alta frecuencia con
 * autenticidad criptográfica Zero-Trust. Al firmar la telemetría en el Secure Enclave
 * del dispositivo (Ed25519) y transmitirla por MQTTS (TLS 1.3), una pasarela de ingesta
 * agrupa los cuadros rutinarios en una raíz Merkle para HCS, despachando de forma
 * inmediata alertas agudas de arritmia al Consenso de Hedera en cuestión de segundos.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * La publicación directa en la cadena de cada latido individual (50-100 Hz) saturaría
 * el ancho de banda y el almacenamiento. La mejor práctica DePIN utiliza agregación
 * en el borde (edge batching): agrupa miles de lecturas normales en una sola Raíz Merkle
 * criptográfica en HCS ($0.0001 USD), pero dispara mensajes de consenso inmediatos fuera
 * de banda cuando se violan umbrales críticos de seguridad biológica.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 10: Servidor MCP de Hedera con un Guardián de Políticas Propio
 * - Siguiente: M15 Lab 02: Telemetría DePIN Ligera de Cadena de Frío (API Key + HMAC-SHA256)
 *
 * [ REFERENCIAS OFICIALES ]
 * - Servicio de Consenso de Hedera: https://docs.hedera.com/native/consensus
 * - Estándares de Temas HCS HIP-10: https://hips.hedera.com/hip/hip-10
 * - Validación de Módulos Criptográficos NIST SP 800-140C (Almacenes Hardware Ed25519)
 *
 * [ SIMULADO ]
 * El marcapasos y su flujo MQTTS son emulados. Las firmas del dispositivo, el lote de Merkle y los mensajes en HCS son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M15_DePIN_and_Future_Crypto/01_depin_mqtts_pacemaker_telemetry.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import crypto from 'node:crypto'
import { getClient, updateState, getHashscanUrl, show } from '../M99_Utilities/index.js'

/**
 * Dispositivo de Hardware Médico Emulado: Marcapasos Cardíaco Implantable (PM-8821)
 * Equipado con un Secure Enclave que alberga un par de claves Ed25519 aislado.
 */
class PacemakerHardwareDevice {
  constructor (deviceId = 'URN:IOT:MEDTECH:PACEMAKER:PM-8821') {
    this.deviceId = deviceId
    // Genera un par de claves criptográficas Ed25519 simulando hardware aislado
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    this.privateKey = privateKey
    this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })
  }

  /**
   * Genera un marco de telemetría cardíaca firmado por hardware.
   * @param {boolean} forceArrhythmia - Si se debe simular un evento de taquicardia aguda.
   */
  generateTelemetryFrame (forceArrhythmia = false) {
    const bpm = forceArrhythmia
      ? Math.floor(165 + Math.random() * 35)
      : Math.floor(65 + Math.random() * 12)

    const payload = {
      deviceId: this.deviceId,
      timestamp: Date.now(),
      metrics: {
        bpm,
        pacingImpedanceOhms: 520 + Math.floor(Math.random() * 15),
        batteryMillivolts: 2985,
        event: forceArrhythmia ? 'VENTRICULAR_TACHYCARDIA_ALERT' : 'NORMAL_SINUS_RHYTHM'
      }
    }

    const payloadBuffer = Buffer.from(JSON.stringify(payload))
    // Firma por hardware en el microcontrolador del payload de telemetría
    const signature = crypto.sign(null, payloadBuffer, this.privateKey)

    return {
      payload,
      signatureHex: signature.toString('hex'),
      publicKeyPem: this.publicKeyPem
    }
  }
}

/**
 * Calcula una raíz Merkle estándar de 2 niveles a partir de un arreglo de hashes.
 */
function computeMerkleRoot (hashes) {
  if (hashes.length === 0) return crypto.createHash('sha256').update('EMPTY').digest('hex')
  let currentLevel = [...hashes]

  while (currentLevel.length > 1) {
    const nextLevel = []
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left
      const combined = crypto.createHash('sha256').update(left + right).digest('hex')
      nextLevel.push(combined)
    }
    currentLevel = nextLevel
  }
  return currentLevel[0]
}

async function main () {
  console.log('====================================================================')
  console.log('DEPIN LAB 01: TELEMETRÍA CRÍTICA MQTTS DE ALTA VELOCIDAD (MARCAPASOS)')
  console.log('====================================================================\n')

  const { client, operatorId, network } = getClient()

  try {
    console.log(`[OPERADOR] Autenticado como ${operatorId} en Hedera ${network.toUpperCase()}`)

    // 1. Crear Tópico HCS para Telemetría Médica
    console.log('\n[1/5] Creando Tópico HCS Dedicado para Telemetría MedTech...')
    const topicCreateTx = await new TopicCreateTransaction()
      .setTopicMemo('DePIN MedTech Telemetry & Pacemaker Alert Feed')
      .execute(client)

    const topicReceipt = await topicCreateTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[ TÓPICO CREADO] ID: ${topicId}`)
    console.log(`[EXPLORADOR] https://hashscan.io/${network}/topic/${topicId}`)

    // 2. Inicializar Hardware Emulado del Marcapasos
    console.log('\n[2/5] Inicializando Dispositivo Marcapasos (Almacén de Claves Ed25519)...')
    const device = new PacemakerHardwareDevice()
    console.log(`[ ID DISPOSITIVO] ${device.deviceId}`)
    console.log('[ LLAVE DEL DISPOSITIVO] Par de llaves Ed25519 generado en software (emulando el elemento seguro del dispositivo).')

    // 3. Emular Flujo de Telemetría MQTTS de Alta Frecuencia
    console.log('\n[3/5] Transmitiendo Marcos de Telemetría MQTTS de Alta Velocidad...')
    const routineBatch = []
    let emergencyAlertFrame = null
    const bpmSeries = []

    for (let frameIndex = 1; frameIndex <= 8; frameIndex++) {
      // Simular el marco 6 como una arritmia cardíaca crítica
      const isCritical = frameIndex === 6
      const frame = device.generateTelemetryFrame(isCritical)

      // Verificación Zero-Trust de la pasarela de la firma de hardware
      const payloadBuf = Buffer.from(JSON.stringify(frame.payload))
      const isValid = crypto.verify(
        null,
        payloadBuf,
        frame.publicKeyPem,
        Buffer.from(frame.signatureHex, 'hex')
      )

      if (!isValid) {
        throw new Error(`Fallo en la verificación de firma por hardware para el cuadro #${frameIndex}`)
      }

      const frameHash = crypto.createHash('sha256').update(payloadBuf).digest('hex')
      bpmSeries.push({ x: frameIndex, y: frame.payload.metrics.bpm, ...(isCritical ? { status: 'critical', label: `${frame.payload.metrics.bpm} BPM` } : {}) })
      show.chart({ id: 'bpm', type: 'line', title: 'Ritmo cardiaco por trama de telemetría', unit: 'BPM', xLabel: 'Trama', yLabel: 'BPM', points: bpmSeries, threshold: { value: 120, label: 'taquicardia > 120' } })

      if (isCritical) {
        console.log(`[CUADRO #${frameIndex}] PARO/TAQUICARDIA CRÍTICA: ${frame.payload.metrics.bpm} BPM | Firma Hardware: Verificada `)
        emergencyAlertFrame = frame
      } else {
        console.log(`[CUADRO #${frameIndex}] Latido Normal: ${frame.payload.metrics.bpm} BPM | Hash: ${frameHash.substring(0, 16)}... | Firma: `)
        routineBatch.push(frameHash)
      }
    }

    // 4. Anclar Telemetría Normal como Lote Merkle en HCS
    console.log('\n[4/5] Anclando Lote Merkle Agrupado al Consenso de Hedera...')
    const merkleRoot = computeMerkleRoot(routineBatch)
    show.merkle({ title: 'Lote de Merkle de las tramas normales', leafCount: routineBatch.length, root: merkleRoot })
    const batchMessage = {
      p: 'depin-telemetry-v1',
      op: 'merkle_batch',
      deviceId: device.deviceId,
      sampleCount: routineBatch.length,
      merkleRoot,
      windowMs: 8000,
      timestamp: Date.now()
    }

    const batchSubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(batchMessage))
      .execute(client)

    const batchReceipt = await batchSubmitTx.getReceipt(client)
    console.log(`[ LOTE ANCLADO] Raíz Merkle: ${merkleRoot}`)
    console.log(`[CONSENSO] Secuencia #${batchReceipt.topicSequenceNumber} en HCS`)
    console.log(`[EXPLORADOR] ${getHashscanUrl(batchSubmitTx.transactionId.toString())}`)

    // 5. Envío Inmediato de Alerta Crítica Fuera de Banda al Consenso
    console.log('\n[5/5] Enviando Alerta Crítica de Marcapasos de Alta Prioridad a HCS...')
    const emergencyMessage = {
      p: 'depin-telemetry-v1',
      op: 'critical_emergency_alert',
      deviceId: emergencyAlertFrame.payload.deviceId,
      event: emergencyAlertFrame.payload.metrics.event,
      bpm: emergencyAlertFrame.payload.metrics.bpm,
      hardwareSignature: emergencyAlertFrame.signatureHex,
      timestamp: emergencyAlertFrame.payload.timestamp
    }

    const emergencySubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(emergencyMessage))
      .execute(client)

    const emergencyReceipt = await emergencySubmitTx.getReceipt(client)
    console.log(`[ EMERGENCIA NOTARIZADA] Secuencia #${emergencyReceipt.topicSequenceNumber} verificada en Consenso!`)
    console.log(`[EXPLORADOR] ${getHashscanUrl(emergencySubmitTx.transactionId.toString())}`)

    // Persistir Estado
    updateState('DEPIN_PACEMAKER_TOPIC_ID', topicId)
    updateState('DEPIN_PACEMAKER_DEVICE_ID', device.deviceId)
    updateState('DEPIN_PACEMAKER_MERKLE_ROOT', merkleRoot)

    console.log('\n CONCEPTO CLAVE:')
    console.log('DePIN combina criptografía de hardware IoT con el alto rendimiento de consenso de Hedera.')
    console.log('Las operaciones normales se agrupan fuera de la cadena para minimizar costos, mientras')
    console.log('que las alertas críticas logran ordenamiento inmutable de consenso en cuestión de segundos.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Nunca publiques lecturas individuales de sensores si puedes agruparlas mediante pruebas Merkle.')
    console.log('Diseña siempre disyuntores dirigidos por eventos que prioricen las alertas de seguridad vital.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en la Ejecución de DePIN Marcapasos:', error.message)
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
