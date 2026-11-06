/**
 * ============================================================================
 * Lab 01: Transferencias RWA con Permisos — Registro de Identidad + KYC de HTS (Conceptos ERC-3643)
 * [CONCEPTO] Restricciones de Transferencia Aplicadas por el Ledger para Activos Regulados
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Los activos regulados no pueden moverse sin permisos. ERC-3643 (T-REX) lo resuelve
 * en cadenas EVM consultando un Registro de Identidad on-chain en cada transferencia.
 * El Token Service nativo de Hedera ofrece un equivalente a nivel de ledger de la regla
 * central: un token creado con llave KYC solo puede moverse entre cuentas cuyo flag KYC
 * concedió el emisor. Este lab:
 * 1. Crea un token de seguridad HTS real con llaves KYC, freeze y wipe.
 * 2. Evalúa los claims del inversor (KYC, jurisdicción, acreditación) en un agente de
 *    cumplimiento del emisor y concede KYC on-chain solo a cuentas elegibles.
 * 3. Envía transferencias reales: el inversor elegible recibe tokens; las transferencias
 *    al inversor no verificado y al sancionado las RECHAZA LA RED
 *    (ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN), no JavaScript.
 * 4. Ancla cada decisión de cumplimiento en un topic de auditoría HCS.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * El KYC de HTS te da listas de permitidos aplicadas por consenso sin ningún contrato.
 * ERC-3643 completo (claims ONCHAINID, cumplimiento modular, recuperación, transferencias
 * forzadas) es lo que implementa con smart contracts el Asset Tokenization Studio (ATS)
 * de Hedera — este lab NO despliega ERC-3643 ni ATS; usa ATS para tokens de seguridad en producción.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/enable-kyc-account-flag
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/define-a-token
 * - https://github.com/hashgraph/asset-tokenization-studio
 * - https://erc3643.org/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 08: Liquidación entre Dos Partes (el Comercio como Facilitador)
 * - Siguiente: M11 Lab 02: Bonos por Tramos en HTS (Conceptos ERC-1400)
 *
 * [SECUENCIA]
 * Emisor -> Hedera: Crea el token de seguridad con llave KYC
 * Emisor -> Emisor: El agente de cumplimiento revisa los claims del inversor
 * Emisor -> Hedera: Concede KYC solo a inversores elegibles
 * Emisor -> Hedera: Transfiere a cada inversor
 * Nota Hedera: Las transferencias a cuentas sin KYC fallan en consenso
 * Emisor -> Hedera: Ancla las decisiones en HCS
 *
 * [SIMULADO]
 * Los claims de los inversores (país, acreditación) son datos de ejemplo locales y no se despliegan contratos ERC-3643/ATS. El token, las concesiones KYC, las transferencias aceptadas y rechazadas y la auditoría en HCS son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (crea 3 cuentas de inversor desechables, un token y un topic).
 * - Costo: ~16 ℏ (crear el token ~15 ℏ en testnet) + ~0.3 ℏ para cuentas desechables + comisiones.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/01_erc3643_identity_registry.js
 * ============================================================================
 */

import {
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenGrantKycTransaction,
  TokenSupplyType,
  TokenType,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { createLabAccount, getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

class Erc3643ComplianceEngine {
  constructor () {
    this.identityRegistry = new Map()
    this.sanctionedCountries = new Set(['PRK', 'IRN', 'SYR'])
    this.approvedJurisdictions = new Set(['USA', 'CHE', 'SGP', 'IND', 'GBR'])
  }

  registerInvestor (investorId, claims) {
    this.identityRegistry.set(investorId, {
      did: `did:hedera:testnet:${investorId}`,
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
  console.log('--- INICIO DE SESIÓN: Transferencias RWA con Permisos (Registro de Identidad + KYC de HTS) ---\n')
  const { client, operatorId } = getClient()

  try {
    const compliance = new Erc3643ComplianceEngine()
    const issuerKey = client.operatorPublicKey

    // 1. Cuentas de inversor reales
    console.log('[PROCESO] Paso 1: Creando 3 cuentas de inversor desechables...')
    const investors = {
      B: { ...(await createLabAccount(client, { hbar: 0.1, autoAssociations: 0 })), claims: { isKycVerified: true, countryCode: 'CHE', isAccredited: true } },
      C: { ...(await createLabAccount(client, { hbar: 0.1, autoAssociations: 0 })), claims: { isKycVerified: false, countryCode: 'IND', isAccredited: false } },
      D: { ...(await createLabAccount(client, { hbar: 0.1, autoAssociations: 0 })), claims: { isKycVerified: true, countryCode: 'PRK', isAccredited: false } }
    }
    compliance.registerInvestor(operatorId.toString(), { isKycVerified: true, countryCode: 'USA', isAccredited: true })
    for (const [name, inv] of Object.entries(investors)) {
      compliance.registerInvestor(inv.accountId.toString(), inv.claims)
      console.log(`[LOG] Inversor ${name} ${inv.accountId}: ${inv.claims.countryCode} | Claim KYC: ${inv.claims.isKycVerified} | Acreditado: ${inv.claims.isAccredited}`)
    }

    // 2. Token de seguridad real con llave KYC
    console.log('\n[PROCESO] Paso 2: Creando un token de seguridad HTS con permisos (llaves KYC + freeze + wipe)...')
    const tokenReceipt = await (await new TokenCreateTransaction()
      .setTokenName('HBE Permissioned Equity')
      .setTokenSymbol('HBEQ')
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(0)
      .setInitialSupply(100000)
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(100000)
      .setTreasuryAccountId(operatorId)
      .setAdminKey(issuerKey)
      .setKycKey(issuerKey)
      .setFreezeKey(issuerKey)
      .setWipeKey(issuerKey)
      .execute(client)).getReceipt(client)
    const tokenId = tokenReceipt.tokenId
    console.log(`[ÉXITO] Token ${tokenId} creado (el KYC de la tesorería es implícito)`)

    // Los inversores asocian el token (cada uno firma su propia asociación)
    for (const inv of Object.values(investors)) {
      const tx = await new TokenAssociateTransaction().setAccountId(inv.accountId).setTokenIds([tokenId]).freezeWith(client).sign(inv.privateKey)
      await (await tx.execute(client)).getReceipt(client)
    }

    // 3. El agente de cumplimiento decide; el KYC se concede on-chain solo a inversores elegibles
    console.log('\n[PROCESO] Paso 3: El agente de cumplimiento evalúa los claims y concede KYC on-chain...')
    const decisions = []
    for (const [name, inv] of Object.entries(investors)) {
      const check = compliance.canTransfer(operatorId.toString(), inv.accountId.toString(), 5000)
      if (check.allowed) {
        const grant = await new TokenGrantKycTransaction().setAccountId(inv.accountId).setTokenId(tokenId).execute(client)
        await grant.getReceipt(client)
        console.log(`[KYC CONCEDIDO] Inversor ${name} ${inv.accountId} — ${grant.transactionId}`)
      } else {
        console.log(`[KYC DENEGADO]  Inversor ${name} ${inv.accountId} — ${check.error}`)
      }
      decisions.push({ investor: inv.accountId.toString(), kyc: check.allowed, reason: check.error })
    }

    // 4. Transferencias reales: el ledger aplica el flag KYC
    console.log('\n[PROCESO] Paso 4: Enviando 5,000 unidades a cada inversor (la red aplica el KYC)...')
    const results = []
    for (const [name, inv] of Object.entries(investors)) {
      let status
      try {
        const res = await new TransferTransaction()
          .addTokenTransfer(tokenId, operatorId, -5000)
          .addTokenTransfer(tokenId, inv.accountId, 5000)
          .execute(client)
        status = (await res.getReceipt(client)).status.toString()
        console.log(`[ACEPTADA] -> ${name} ${inv.accountId}: ${status} | ${getHashscanUrl(res)}`)
      } catch (err) {
        status = err.status ? err.status.toString() : err.message
        console.log(`[RECHAZADA POR LA RED] -> ${name} ${inv.accountId}: ${status}`)
      }
      results.push({ investor: inv.accountId.toString(), status })
    }
    if (!results.some((r) => r.status === 'SUCCESS') || !results.some((r) => r.status.includes('KYC_NOT_GRANTED'))) {
      throw new Error('Se esperaba una transferencia aceptada y rechazos KYC de la red')
    }

    // 5. Anclar la traza de cumplimiento en HCS
    console.log('\n[PROCESO] Paso 5: Anclando las decisiones de cumplimiento en un topic de auditoría HCS...')
    const topicReceipt = await (await new TopicCreateTransaction().setTopicMemo('hbe:rwa-compliance-audit').execute(client)).getReceipt(client)
    const complianceTopicId = topicReceipt.topicId.toString()
    await (await new TopicMessageSubmitTransaction()
      .setTopicId(complianceTopicId)
      .setMessage(JSON.stringify({ type: 'rwa-compliance-audit', token: tokenId.toString(), decisions, results, timestamp: new Date().toISOString() }))
      .execute(client)).getReceipt(client)
    console.log(`[ÉXITO] Auditoría en el topic HCS ${complianceTopicId}`)

    updateState('ATS_COMPLIANCE_TOPIC_ID', complianceTopicId)
    updateState('RWA_PERMISSIONED_TOKEN_ID', tokenId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Las transferencias rechazadas las negó el consenso porque los destinatarios no tenían')
    console.log('KYC concedido para este token: cumplimiento aplicado por el ledger, no por el código de la app.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Falló el lab de transferencias con permisos:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLIDO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
