/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Registro de Identidad ERC-3643 y Reglas de Transferencia
 * [ CONCEPTO ] Restricciones de Transferencia en RWAs Permisionados
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El Filtro Regulatorio: Los activos institucionales no pueden transferirse libremente.
 * El estándar ERC-3643 (implementado en el Asset Tokenization Studio de Hedera)
 * vincula cada transferencia de tokens con una consulta al Registro de Identidad.
 * Si el receptor carece de KYC verificado, pertenece a una jurisdicción sancionada
 * o supera el límite permitido, la transferencia se rechaza antes de alcanzar
 * finalidad de consenso.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los tokens ERC-20 comunes incumplen las normativas porque cualquiera puede transferir a cualquiera. ERC-3643 (T-REX) garantiza que las transferencias solo ocurran entre inversionistas calificados con ONCHAINID verificado.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://erc3643.org/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M10 Lab 07: Pasarela Proxy de Streaming de IA
 * - Actual:   M11 Lab 01: Registro de Identidad ERC-3643
 * - Siguiente: M11 Lab 02: Bonos de Deuda ERC-1400
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/01_erc3643_identity_registry.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

class Erc3643ComplianceEngine {
  constructor () {
    this.identityRegistry = new Map()
    this.sanctionedCountries = new Set(['PRK', 'IRN', 'SYR'])
    this.approvedJurisdictions = new Set(['USA', 'CHE', 'SGP', 'IND', 'GBR'])
  }

  registerInvestor (investorId, claims) {
    this.identityRegistry.set(investorId, {
      did: `did:hedera:testnet:${investorId};onchainid`,
      isKycVerified: claims.isKycVerified || false,
      countryCode: claims.countryCode || 'UNKNOWN',
      isAccredited: claims.isAccredited || false,
      registeredAt: Date.now()
    })
  }

  canTransfer (senderId, recipientId, amount) {
    const sender = this.identityRegistry.get(senderId)
    const recipient = this.identityRegistry.get(recipientId)

    if (!sender || !sender.isKycVerified) {
      return { allowed: false, error: 'COMPLIANCE_ERR_SENDER_NOT_KYC_VERIFIED' }
    }

    if (!recipient) {
      return { allowed: false, error: 'COMPLIANCE_ERR_RECIPIENT_NOT_REGISTERED' }
    }

    if (!recipient.isKycVerified) {
      return { allowed: false, error: 'COMPLIANCE_ERR_RECIPIENT_KYC_MISSING' }
    }

    if (this.sanctionedCountries.has(recipient.countryCode)) {
      return { allowed: false, error: `COMPLIANCE_ERR_SANCTIONED_JURISDICTION_${recipient.countryCode}` }
    }

    if (!this.approvedJurisdictions.has(recipient.countryCode)) {
      return { allowed: false, error: `COMPLIANCE_ERR_UNAPPROVED_JURISDICTION_${recipient.countryCode}` }
    }

    if (!recipient.isAccredited && amount > 10000) {
      return { allowed: false, error: 'COMPLIANCE_ERR_RETAIL_INVESTOR_CAP_EXCEEDED' }
    }

    return { allowed: true, error: null }
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Registro de Identidad ERC-3643 y Reglas de Cumplimiento ---\n')
  const { client, operatorId, network } = getClient()

  try {
    const compliance = new Erc3643ComplianceEngine()

    // 1. Registrar Inversores en el Registro de Identidad On-Chain
    console.log('[⚙️ PROCESO] Registrando Inversores Institucionales y Minoristas en el Registro...')

    const investorA = operatorId.toString()
    const investorB = '0.0.700101'
    const investorC = '0.0.700102'
    const investorD = '0.0.700103'

    compliance.registerInvestor(investorA, { isKycVerified: true, countryCode: 'USA', isAccredited: true })
    compliance.registerInvestor(investorB, { isKycVerified: true, countryCode: 'CHE', isAccredited: true })
    compliance.registerInvestor(investorC, { isKycVerified: false, countryCode: 'IND', isAccredited: false }) // Sin KYC
    compliance.registerInvestor(investorD, { isKycVerified: true, countryCode: 'PRK', isAccredited: false }) // País Sancionado

    console.log(`[📊 REGISTRO] Inversor A (${investorA}): USA | KYC: OK | Acreditado: SÍ`)
    console.log(`[📊 REGISTRO] Inversor B (${investorB}): CHE | KYC: OK | Acreditado: SÍ`)
    console.log(`[📊 REGISTRO] Inversor C (${investorC}): IND | KYC: NO | Acreditado: NO`)
    console.log(`[📊 REGISTRO] Inversor D (${investorD}): PRK | KYC: OK | Acreditado: NO\n`)

    // 2. Evaluar Escenarios de Transferencia
    console.log('--- VALIDANDO TRANSFERENCIA 1: Inversor A -> Inversor B ($50,000 Equity) ---')
    const t1 = compliance.canTransfer(investorA, investorB, 50000)
    console.log(`[RESULTADO] Permitida: ${t1.allowed} | Motivo: Cumplimiento Institucional Satisfecho`)

    console.log('\n--- VALIDANDO TRANSFERENCIA 2: Inversor A -> Inversor C (Minorista sin KYC) ---')
    const t2 = compliance.canTransfer(investorA, investorC, 5000)
    console.log(`[RESULTADO] Permitida: ${t2.allowed} | Código de Rechazo: ${t2.error}`)

    console.log('\n--- VALIDANDO TRANSFERENCIA 3: Inversor A -> Inversor D (Jurisdicción Sancionada) ---')
    const t3 = compliance.canTransfer(investorA, investorD, 1000)
    console.log(`[RESULTADO] Permitida: ${t3.allowed} | Código de Rechazo: ${t3.error}`)

    // 3. Anclar Eventos a HCS para Auditoría Regulatoria
    console.log('\n[⚙️ PROCESO] Anclando Evento de Verificación ERC-3643 a HCS...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('erc3643:compliance_registry_v1')
      .freezeWith(client)
    const topicResponse = await topicTx.execute(client)
    const topicReceipt = await topicResponse.getReceipt(client)
    const complianceTopicId = topicReceipt.topicId.toString()

    const complianceAudit = JSON.stringify({
      standard: 'ERC-3643',
      action: 'TRANSFER_VALIDATION',
      sender: investorA,
      recipient: investorB,
      amount: 50000,
      status: 'APPROVED',
      timestamp: Date.now()
    })

    const msgTx = await new TopicMessageSubmitTransaction()
      .setTopicId(complianceTopicId)
      .setMessage(complianceAudit)
      .freezeWith(client)
    await msgTx.execute(client)

    console.log(`[✅ ÉXITO] Evento de Auditoría Registrado en Tópico HCS: ${complianceTopicId}`)
    updateState('ATS_COMPLIANCE_TOPIC_ID', complianceTopicId)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('ERC-3643 convierte el cumplimiento normativo en una garantía criptográfica on-chain.')
    console.log('El contrato del token jamás procesa una transferencia ilícita, blindando al emisor')
    console.log('frente a penalidades y contingencias de entes reguladores.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Fallo en la validación ERC-3643:', error.message)
    process.exit(1)
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
