/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Laboratorio 02: Telemetría DePIN Ligera de Cadena de Frío (API Key + HMAC-SHA256)
 * [ CONCEPTO ] Monitoreo Logístico de Bajo Consumo y Penalización Automática de SLA
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Los dispositivos IoT de bajo consumo (rastreadores celulares de activos, contenedores
 * de productos biológicos en cadena de frío, sondas ambientales) no pueden mantener
 * sockets TLS continuos debido a estrictos presupuestos de batería. En su lugar,
 * despiertan de un sueño profundo (deep sleep), emiten una solicitud HTTP REST con una
 * API Key precompartida y una firma HMAC-SHA256 sobre el cuerpo del mensaje, y vuelven
 * a dormir. Una pasarela de ingesta empresarial autentica la firma HMAC y audita
 * continuamente los Acuerdos de Nivel de Servicio (SLA) contra Hedera Consensus Service.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las firmas criptográficas en encabezados HTTP (`X-HMAC-SHA256`) previenen ataques de
 * intermediario (Man-in-the-Middle) y ataques de repetición sin requerir pesados
 * handshakes TLS ni complejas autoridades de certificación en microcontroladores con
 * recursos limitados (ESP32 / Nordic nRF9160). Cuando se detecta un incumplimiento de SLA
 * (temperatura de vacuna superior a +8°C), anclar el evento directamente a HCS
 * proporciona prueba legal indiscutible para aseguradoras y penalizaciones automáticas.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M15 Lab 01: Telemetría DePIN MQTTS de Alta Velocidad y Firma Hardware
 * - Siguiente: M15 Lab 03: Solver de Liquidación DeFi Basado en Intenciones (ERC-7683)
 *
 * [ REFERENCIAS OFICIALES ]
 * - Descripción General de Hedera Consensus Service: https://docs.hedera.com/hedera/services/consensus-service
 * - RFC 2104: HMAC: Hashing con Clave para Autenticación de Mensajes
 * - Reporte Técnico OMS 961: Monitoreo de Temperatura y Humedad en Cadenas de Frío
 *
 * [ SIMULADO ]
 * El rastreador IoT y sus solicitudes HTTP son emulados. Las verificaciones HMAC y los registros en HCS son reales.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M15_DePIN_and_Future_Crypto/02_depin_lightweight_cold_chain_api_key.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import crypto from 'node:crypto'
import { getClient, updateState, getHashscanUrl, show } from '../M99_Utilities/index.js'

/**
 * Dispositivo Rastreador IoT Emulado de Bajo Consumo (Contenedor de Vacunas)
 */
class ColdChainSensorDevice {
  constructor (deviceId, apiKey, sharedHmacSecret) {
    this.deviceId = deviceId
    this.apiKey = apiKey
    this.sharedHmacSecret = sharedHmacSecret
  }

  /**
   * Simula un paquete de telemetría HTTP POST con encabezados de autenticación HMAC-SHA256.
   */
  createTelemetryRequest (temperatureCelsius, humidityPct, locationGeo) {
    const body = {
      deviceId: this.deviceId,
      timestamp: Date.now(),
      metrics: {
        temperatureCelsius,
        humidityPct,
        batteryPercent: 94
      },
      location: locationGeo
    }

    const bodyString = JSON.stringify(body)
    // Calcula la firma HMAC-SHA256 utilizando el secreto compartido
    const hmacSignature = crypto
      .createHmac('sha256', this.sharedHmacSecret)
      .update(bodyString)
      .digest('hex')

    return {
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': this.deviceId,
        'X-API-Key': this.apiKey,
        'X-HMAC-Signature': hmacSignature
      },
      rawBody: bodyString,
      parsedBody: body
    }
  }
}

/**
 * Pasarela de Ingesta y Verificador de SLA Logístico
 */
class LogisticsSLAGateway {
  constructor (validDevices, tempMinC = 2.0, tempMaxC = 8.0) {
    this.validDevices = validDevices // Mapa: deviceId -> { apiKey, sharedHmacSecret }
    this.tempMinC = tempMinC
    this.tempMaxC = tempMaxC
  }

  /**
   * Valida la API Key, verifica la firma HMAC-SHA256 e inspecciona el cumplimiento del SLA.
   */
  processPacket (request) {
    const { 'X-Device-Id': deviceId, 'X-API-Key': apiKey, 'X-HMAC-Signature': signature } = request.headers
    const record = this.validDevices[deviceId]

    if (!record || record.apiKey !== apiKey) {
      return { status: 401, error: 'No autorizado: ID de Dispositivo o API Key inválidos' }
    }

    // Verificar HMAC-SHA256
    const expectedSig = crypto
      .createHmac('sha256', record.sharedHmacSecret)
      .update(request.rawBody)
      .digest('hex')

    if (expectedSig !== signature) {
      return { status: 403, error: 'Prohibido: Discrepancia en la firma HMAC / payload alterado' }
    }

    const { temperatureCelsius } = request.parsedBody.metrics
    const isSlaBreached = temperatureCelsius < this.tempMinC || temperatureCelsius > this.tempMaxC

    return {
      status: 200,
      deviceId,
      temperatureCelsius,
      isSlaBreached,
      slaThresholds: { min: this.tempMinC, max: this.tempMaxC },
      timestamp: request.parsedBody.timestamp
    }
  }
}

async function main () {
  console.log('====================================================================')
  console.log('❄️ DEPIN LAB 02: TELEMETRÍA LIGERA DE CADENA DE FRÍO Y PENALIZACIÓN SLA')
  console.log('====================================================================\n')

  const { client, operatorId, network } = getClient()

  try {
    console.log(`[📡 OPERADOR] Autenticado como ${operatorId} en Hedera ${network.toUpperCase()}`)

    // 1. Crear Tópico HCS para Monitoreo de SLA de Cadena de Frío
    console.log('\n[1/5] Creando Tópico HCS Dedicado para SLA Logístico...')
    const topicCreateTx = await new TopicCreateTransaction()
      .setTopicMemo('DePIN Cold-Chain Vaccine SLA & Temperature Audit Trail')
      .execute(client)

    const topicReceipt = await topicCreateTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[✅ TÓPICO CREADO] ID: ${topicId}`)
    console.log(`[🔗 EXPLORADOR] https://hashscan.io/${network}/topic/${topicId}`)

    // 2. Configurar Credenciales de Dispositivo Zero-Trust y Pasarela
    console.log('\n[2/5] Configurando Credenciales de Dispositivo Zero-Trust y Pasarela...')
    const deviceId = 'URN:IOT:LOGISTICS:COLDCHAIN:BOX-882'
    const apiKey = 'hcs_live_sec_' + crypto.randomBytes(16).toString('hex')
    const sharedHmacSecret = crypto.randomBytes(32).toString('hex')

    const device = new ColdChainSensorDevice(deviceId, apiKey, sharedHmacSecret)
    const gateway = new LogisticsSLAGateway({
      [deviceId]: { apiKey, sharedHmacSecret }
    }, 2.0, 8.0)

    console.log(`[📦 SENSOR] ID de Dispositivo Asignado: ${deviceId}`)
    console.log(`[🔑 API KEY] ${apiKey.substring(0, 20)}...`)
    console.log(`[🔒 SECRETO HMAC] ${sharedHmacSecret.substring(0, 16)}...`)
    console.log('[📋 OBJETIVO SLA] Rango de Almacenamiento Seguro: +2.0°C a +8.0°C')

    // 3. Emular Ciclo de Vida: 3 Lecturas Conformes + 1 Excursión Crítica
    console.log('\n[3/5] Emulando Despertar del Sensor y Envíos de Telemetría...')
    const readings = [
      { temp: 4.2, hum: 55, geo: 'Puerto Central Mumbai (18.9388° N, 72.8354° E)' },
      { temp: 4.8, hum: 56, geo: 'Corredor de Tránsito NH-48 (19.0760° N, 72.8777° E)' },
      { temp: 5.6, hum: 58, geo: 'Centro de Distribución Regional (19.2183° N, 72.9781° E)' },
      { temp: 14.8, hum: 78, geo: 'Almacén Local - CORTE ELÉCTRICO EN COMPRESOR (19.2403° N, 73.1305° E)' }
    ]

    let slaBreachEvent = null
    const tempSeries = []

    for (let i = 0; i < readings.length; i++) {
      const r = readings[i]
      const request = device.createTelemetryRequest(r.temp, r.hum, r.geo)
      const evaluation = gateway.processPacket(request)
      tempSeries.push({ x: i + 1, y: r.temp, ...(evaluation.isSlaBreached ? { status: 'critical', label: `${r.temp} °C` } : {}) })
      show.chart({ id: 'temp', type: 'line', title: 'Temperatura del contenedor de vacunas', unit: '°C', xLabel: 'Reporte', yLabel: '°C', points: tempSeries, threshold: { value: 8, label: 'máximo SLA +8 °C' } })

      if (evaluation.status !== 200) {
        throw new Error(`La pasarela rechazó el paquete #${i + 1}: ${evaluation.error}`)
      }

      if (evaluation.isSlaBreached) {
        console.log(`   🚨 [REPORTE #${i + 1}] Temp: ${r.temp}°C | ¡INFRACCIÓN DE SLA! (Límites: +2°C a +8°C) | Ubicación: ${r.geo}`)
        slaBreachEvent = { ...evaluation, geo: r.geo }
      } else {
        console.log(`   ❄️ [REPORTE #${i + 1}] Temp: ${r.temp}°C | SLA Conforme ✅ | HMAC: Verificado | Ubicación: ${r.geo}`)
      }
    }

    // 4. Notarizar Punto de Control Periódico Conforme en HCS
    console.log('\n[4/5] Notarizando Intervalo de Tránsito Conforme al Consenso HCS...')
    const compliantAuditMessage = {
      p: 'depin-coldchain-v1',
      op: 'periodic_sla_audit',
      deviceId,
      compliantSamples: 3,
      avgTemperatureC: 4.86,
      slaStatus: 'COMPLIANT',
      timestamp: Date.now()
    }

    const auditSubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(compliantAuditMessage))
      .execute(client)

    const auditReceipt = await auditSubmitTx.getReceipt(client)
    console.log(`[✅ AUDITORÍA ANCLADA] Secuencia #${auditReceipt.topicSequenceNumber} en HCS`)
    console.log(`[🔗 EXPLORADOR] ${getHashscanUrl(auditSubmitTx.transactionId.toString())}`)

    // 5. Notarizar Evento Inmutable de Infracción de SLA y Aviso de Penalización
    console.log('\n[5/5] Notarizando Infracción de SLA y Penalización de Fianza a HCS...')
    const breachAuditMessage = {
      p: 'depin-coldchain-v1',
      op: 'sla_breach_slashing_notice',
      deviceId,
      temperatureCelsius: slaBreachEvent.temperatureCelsius,
      allowedRange: slaBreachEvent.slaThresholds,
      location: slaBreachEvent.geo,
      action: 'FREEZE_CARRIER_PAYOUT_AND_SLASH_DEPOSIT',
      penaltyUnits: '1,500_USDC_BOND_FORFEIT',
      timestamp: slaBreachEvent.timestamp
    }

    const breachSubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(breachAuditMessage))
      .execute(client)

    const breachReceipt = await breachSubmitTx.getReceipt(client)
    console.log(`[🚨 INFRACCIÓN ANCLADA] Secuencia #${breachReceipt.topicSequenceNumber} en HCS!`)
    console.log(`[🔗 EXPLORADOR] ${getHashscanUrl(breachSubmitTx.transactionId.toString())}`)

    // Persistir Estado
    updateState('DEPIN_COLDCHAIN_TOPIC_ID', topicId)
    updateState('DEPIN_COLDCHAIN_DEVICE_ID', deviceId)
    updateState('DEPIN_COLDCHAIN_BREACH_TEMP', `${slaBreachEvent.temperatureCelsius}°C`)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Los nodos IoT de bajo consumo ahorran energía con HTTP ligero y firmas HMAC-SHA256.')
    console.log('Cuando una pasarela empresarial detecta una ruptura de SLA, anclar el evento a HCS')
    console.log('proporciona evidencia verificable que automatiza la confiscación de depósitos y fianza.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Autentica siempre tanto la identidad del dispositivo (API Key) como la integridad del dato (HMAC).')
    console.log('Un mensaje firmado previene ataques de retransmisión y demuestra la cadena de custodia física.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en la Ejecución de DePIN Cadena de Frío:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
