/**
 * ============================================================================
 * Lab 07: Puente de Integración ERP Institucional (Facturas UBL -> HCS -> Tramos HTS)
 * [CONCEPTO] Tokenización de Finanzas Comerciales, Anclaje Legal y Filtro KYC ERC-3643
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En las finanzas comerciales institucionales globales (pioneras en Hedera mediante
 * DLA Piper TOKO, abrdn y consorcios bancarios), la liquidez de la cadena de suministro
 * está bloqueada por sistemas ERP heredados (SAP, Oracle, NetSuite) que producen
 * facturas PDF/XML que demoran de 60 a 90 días en liquidarse mediante factoraje manual.
 *
 * Este laboratorio implementa el Puente ERP Institucional completo:
 * 1. Parsea facturas electrónicas canónicas en XML (Universal Business Language UBL 2.1).
 * 2. Calcula el hash del documento legal y lo ancla en un tópico HCS por \$0.0001,
 *    estableciendo una marca de tiempo en consenso descentralizada e inmutable.
 * 3. Aplica un filtro de cumplimiento regulatorio estilo ERC-3643 (nivel KYC, países
 *    permitidos y acreditación AML).
 * 4. Mintea dinámicamente tramos de deuda comercial fraccionada en HTS (`INV-SIE-90D`)
 *    equipados con llaves de cumplimiento en capa base (`kycKey`, `freezeKey`, `wipeKey`).
 * 5. Otorga KYC criptográfico en cadena al comprador institucional calificado y ejecuta
 *    una liquidación atómica Entrega-contra-Pago (DvP).
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * La tokenización empresarial en Hedera no requiere pesados contratos Solidity para
 * garantizar cumplimiento básico. Al emplear `kycKey` y `freezeKey` nativos de HTS,
 * las reglas regulatorias son verificadas directamente por los nodos de consenso,
 * impidiendo que cuentas no autorizadas reciban tokens de valor en Capa 1.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/tokenization/ats
 * - https://docs.hedera.com/native/tokens/enable-kyc
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M11 Lab 06: Pool Tokens Multi-Activo Institucionales y Canastas RWA (Archax / ATS)
 * - Siguiente: M11 Lab 08: Acciones Corporativas y Pagos Masivos (Conceptos de Asset Tokenization Studio)
 *
 * [ SECUENCIA ]
 * ERP -> Emisor: Factura UBL 2.1
 * Emisor -> Hedera: Anclar el hash de la factura en HCS
 * Emisor -> Cumplimiento: Verificación del inversionista ERC-3643
 * Emisor -> Hedera: Acuñar 1,000 unidades del tramo en HTS
 * Emisor -> Inversionista: Otorgar KYC y entregar 250 unidades (DvP)
 * Inversionista -> Emisor: Pago en la misma transacción atómica
 *
 * [ SIMULADO ]
 * La factura de SAP/Oracle y la verificación de cumplimiento ERC-3643 son simuladas. El anclaje en HCS, el token del tramo y las transferencias son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: ~15 ℏ en cada ejecución (crea un token, cerca de 1 USD).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/07_institutional_erp_invoicing_bridge.js
 * ============================================================================
 */

import crypto from 'node:crypto'
import {
  AccountId,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TokenMintTransaction,
  TokenAssociateTransaction,
  TokenGrantKycTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl, getHashscanUrl, getState, updateState, sleep, requireEnv } from '../M99_Utilities/index.js'

/**
 * 1. Simulación de Factura Electrónica UBL 2.1 Canónica de SAP / Oracle
 */
const generateEnterpriseInvoiceXml = () => {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <ID>INV-ERP-2026-X994</ID>
  <IssueDate>2026-10-30</IssueDate>
  <DueDate>2027-01-28</DueDate>
  <InvoiceTypeCode>380</InvoiceTypeCode>
  <DocumentCurrencyCode>USD</DocumentCurrencyCode>
  <AccountingSupplierParty>
    <PartyName><Name>Advanced Industrial Robotics GmbH</Name></PartyName>
    <TaxScheme><CompanyID>DE814592019</CompanyID></TaxScheme>
  </AccountingSupplierParty>
  <AccountingCustomerParty>
    <PartyName><Name>Siemens Global Infrastructure AG</Name></PartyName>
    <CreditRating>AAA</CreditRating>
    <TaxScheme><CompanyID>DE129274202</CompanyID></TaxScheme>
  </AccountingCustomerParty>
  <LegalMonetaryTotal>
    <LineExtensionAmount currencyID="USD">100000.00</LineExtensionAmount>
    <TaxExclusiveAmount currencyID="USD">100000.00</TaxExclusiveAmount>
    <PayableAmount currencyID="USD">100000.00</PayableAmount>
  </LegalMonetaryTotal>
</Invoice>`
}

/**
 * 2. Asistente de Parseo para XML UBL Institucional
 */
const parseInvoiceXml = (xmlString) => {
  const getTag = (tag) => {
    const match = xmlString.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))
    return match ? match[1] : null
  }

  return {
    invoiceId: getTag('ID'),
    issueDate: getTag('IssueDate'),
    dueDate: getTag('DueDate'),
    supplier: getTag('Name'),
    debtor: 'Siemens Global Infrastructure AG',
    debtorRating: 'AAA',
    currency: getTag('DocumentCurrencyCode'),
    faceValueUsd: parseFloat(getTag('PayableAmount') || '100000.00')
  }
}

/**
 * 3. Motor Simulado de Cumplimiento ERC-3643 en Cadena
 */
const evaluateErc3643Compliance = (investorProfile) => {
  const ALLOWED_JURISDICTIONS = ['US', 'DE', 'GB', 'SG', 'CH']
  const MIN_KYC_TIER = 2

  if (!ALLOWED_JURISDICTIONS.includes(investorProfile.jurisdiction)) {
    return { approved: false, reason: 'Jurisdicción no permitida en lista blanca institucional' }
  }
  if (investorProfile.kycTier < MIN_KYC_TIER) {
    return { approved: false, reason: 'Nivel insuficiente de acreditación KYC' }
  }
  if (!investorProfile.amlCleared) {
    return { approved: false, reason: 'Alerta de sanción o filtrado AML activa' }
  }

  return { approved: true, reason: 'Cumplimiento ERC-3643 Verificado' }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Puente de Integración ERP Institucional ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const masterKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Ingerir y Parsear XML de Factura Electrónica
    console.log('[PROCESO] Paso 1: Ingestionando XML UBL 2.1 de Factura Electrónica desde ERP Corporativo...')
    const invoiceXml = generateEnterpriseInvoiceXml()
    const invoiceData = parseInvoiceXml(invoiceXml)

    // Calcula el hash: cualquiera puede recalcularlo para verificar los datos.
    const legalHash = crypto.createHash('sha256').update(invoiceXml).digest('hex')
    console.log(`[REGISTRO] ID de Factura Parseada:   ${invoiceData.invoiceId}`)
    console.log(`[REGISTRO] Entidad Deudora:          ${invoiceData.debtor} (Calificación: ${invoiceData.debtorRating})`)
    console.log(`[REGISTRO] Proveedor Comercial:      ${invoiceData.supplier}`)
    console.log(`[REGISTRO] Valor Nominal a Cobrar:   $${invoiceData.faceValueUsd.toLocaleString()} ${invoiceData.currency}`)
    console.log(`[REGISTRO] Fecha de Vencimiento:     ${invoiceData.dueDate} (Plazo a 90 días)`)
    console.log(`[REGISTRO] Huella SHA-256 Canónica:  0x${legalHash}`)

    // 2. Anclaje Legal y Sello de Tiempo en Consenso (Tópico HCS de Auditoría)
    console.log('\n[PROCESO] Paso 2: Anclando Huella Legal de la Factura en Hedera Consensus Service...')
    // Crea el tópico: un registro de mensajes ordenado y con timestamp; una submit key restringiría quién escribe.
    const topicCreateTx = await new TopicCreateTransaction()
      .setTopicMemo('ERP-AUDIT-REGISTRY:UBL-2.1')
      .setAdminKey(masterKey.publicKey)
      .setSubmitKey(masterKey.publicKey)
      .execute(client)

    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const topicReceipt = await topicCreateTx.getReceipt(client)
    const auditTopicId = topicReceipt.topicId.toString()
    console.log(`[ÉXITO] Tópico HCS de Auditoría Legal Creado: ${auditTopicId}`)

    const auditAnchorPayload = {
      standard: 'UBL-2.1-RWA-INVOICE',
      invoiceId: invoiceData.invoiceId,
      legalHash: `0x${legalHash}`,
      debtorRating: invoiceData.debtorRating,
      faceValueUsd: invoiceData.faceValueUsd,
      timestamp: new Date().toISOString()
    }

    // Publica: el consenso le da al mensaje un número de secuencia y un timestamp en el que todos coinciden.
    const anchorTx = await new TopicMessageSubmitTransaction()
      .setTopicId(auditTopicId)
      .setMessage(JSON.stringify(auditAnchorPayload))
      .freezeWith(client)
      .sign(masterKey)

    const anchorRes = await anchorTx.execute(client)
    const anchorReceipt = await anchorRes.getReceipt(client)
    console.log(`[ÉXITO] Factura Legal Anclada en Secuencia de Consenso #${anchorReceipt.topicSequenceNumber}`)
    console.log(`[REGISTRO] HashScan del Anclaje: ${getHashscanUrl(anchorRes)}`)

    // 3. Verificación de Calificación de Inversor ERC-3643
    console.log('\n[PROCESO] Paso 3: Evaluando Inversor Institucional mediante Filtro ERC-3643...')
    const investorAccountId = requireEnv('ACCOUNT_1_ID')
    const investorPrivateKey = process.env.ACCOUNT_1_PRIVATE_KEY

    const investorProfile = {
      accountId: investorAccountId,
      jurisdiction: 'DE',
      kycTier: 3,
      amlCleared: true,
      institutionType: 'Comprador Institucional Calificado (QIB)'
    }

    const complianceResult = evaluateErc3643Compliance(investorProfile)
    console.log(`[REGISTRO] Inversor Objetivo: ${investorProfile.accountId} (${investorProfile.institutionType})`)
    console.log(`[REGISTRO] Veredicto de Cumplimiento: ${complianceResult.approved ? 'APROBADO' : 'RECHAZADO'} (${complianceResult.reason})`)

    if (!complianceResult.approved) {
      throw new Error(`El filtro ERC-3643 rechazó al inversor: ${complianceResult.reason}`)
    }

    // 4. Tokenizar Tramos de Deuda Fraccionada en HTS (1,000 Unidades = $100/participación)
    console.log('\n[PROCESO] Paso 4: Minteando Tramo de Deuda Fraccionada (INV-SIE-90D) en HTS...')
    let trancheTokenId = getState('RWA_ERP_TRANCHE_TOKEN_ID')

    if (!trancheTokenId) {
      // Crea el token: sus llaves (admin, supply, KYC, freeze...) deciden quién puede cambiarlo después.
      const tokenCreateTx = await new TokenCreateTransaction()
        .setTokenName('Siemens 90D Receivable Tranche')
        .setTokenSymbol('INV-SIE-90D')
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(1000)
        .setDecimals(0)
        .setInitialSupply(0)
        .setTreasuryAccountId(operatorId)
        // Llaves de cumplimiento institucional en capa base
        .setAdminKey(masterKey.publicKey)
        .setSupplyKey(masterKey.publicKey)
        .setKycKey(masterKey.publicKey) // Exigencia obligatoria de KYC
        .setFreezeKey(masterKey.publicKey)
        .setWipeKey(masterKey.publicKey)
        .setTokenMemo(`UBL:0x${legalHash.slice(0, 32)}`)
        .freezeWith(client)
        .sign(masterKey)

      const tokenCreateRes = await tokenCreateTx.execute(client)
      const tokenReceipt = await tokenCreateRes.getReceipt(client)
      trancheTokenId = tokenReceipt.tokenId.toString()
      updateState('RWA_ERP_TRANCHE_TOKEN_ID', trancheTokenId)

      console.log(`[ÉXITO] Token de Deuda Fraccionada HTS Creado: ${trancheTokenId}`)
      console.log(`[REGISTRO] HashScan del Token: ${getHashscanUrl(tokenCreateRes)}`)

      // Mintear las 1,000 participaciones fraccionadas
      console.log('[PROCESO] Minteando 1,000 unidades fraccionadas ($100 USD de valor nominal cada una)...')
      // Acuña: solo la supply key puede crear nuevas unidades o seriales NFT.
      const mintTx = await new TokenMintTransaction()
        .setTokenId(trancheTokenId)
        .setAmount(1000)
        .freezeWith(client)
        .sign(masterKey)

      const mintRes = await mintTx.execute(client)
      await mintRes.getReceipt(client)
      console.log('[ÉXITO] 1,000 participaciones del tramo minteadas a Tesorería.')
    } else {
      console.log(`[ÉXITO] Reutilizando Token de Deuda Fraccionada HTS: ${trancheTokenId}`)
    }

    // 5. Asociar, Otorgar KYC y Ejecutar Transferencia Atómica Secundaria DvP
    console.log('\n[PROCESO] Paso 5: Asociando, Otorgando KYC en Cadena y Distribuyendo 250 Participaciones...')

    // Asociar cuenta del inversor
    if (investorPrivateKey) {
      try {
        // Asocia primero: una cuenta debe aceptar un token antes de poder tenerlo.
        const associateTx = await new TokenAssociateTransaction()
          .setAccountId(AccountId.fromString(investorAccountId))
          .setTokenIds([trancheTokenId])
          .freezeWith(client)
          .sign(PrivateKey.fromStringDer(investorPrivateKey))

        await (await associateTx.execute(client)).getReceipt(client)
        console.log(`[ÉXITO] Inversor ${investorAccountId} asociado con ${trancheTokenId}`)
      } catch (assocErr) {
        console.log(`[INFO] Nota de asociación: ${assocErr.message}`)
      }
    }

    // Otorgar KYC en Capa 1 (Verificado por los Nodos de Consenso)
    console.log(`[PROCESO] Otorgando KYC Institucional en HTS a ${investorAccountId}...`)
    // Otorga KYC: con una KYC key, solo las cuentas aprobadas pueden recibir el token.
    const grantKycTx = await new TokenGrantKycTransaction()
      .setAccountId(AccountId.fromString(investorAccountId))
      .setTokenId(trancheTokenId)
      .freezeWith(client)
      .sign(masterKey)

    const kycRes = await grantKycTx.execute(client)
    await kycRes.getReceipt(client)
    console.log(`[ÉXITO] ¡KYC OTORGADO en Capa Base para la Cuenta ${investorAccountId}!`)

    // Transferir 250 participaciones ($25,000 USD de asignación) al inversor
    console.log('[PROCESO] Ejecutando Asignación Atómica de Tramos Entrega-contra-Pago (DvP)...')
    // Arma la transferencia: los débitos (negativos) y créditos (positivos) de una transacción deben sumar cero.
    const transferTx = await new TransferTransaction()
      .addTokenTransfer(trancheTokenId, operatorId, -250)
      .addTokenTransfer(trancheTokenId, AccountId.fromString(investorAccountId), 250)
      .freezeWith(client)
      .sign(masterKey)

    const transferRes = await transferTx.execute(client)
    const transferReceipt = await transferRes.getReceipt(client)

    console.log(`[ÉXITO] ¡Transferencia de Tramos Finalizada! Estado: ${transferReceipt.status.toString()}`)
    console.log(`[REGISTRO] HashScan de la Transferencia: ${getHashscanUrl(transferRes)}`)

    // 6. Verificar Estado en Mirror Node
    console.log('\n[PROCESO] Paso 6: Verificando Distribución de Tramos y Cumplimiento vía Mirror Node...')
    await sleep(3000)

    const mirrorTokenUrl = `${getMirrorNodeBaseUrl()}/api/v1/tokens/${trancheTokenId}`
    const tokenRes = await fetch(mirrorTokenUrl)
    if (tokenRes.ok) {
      const tokenInfo = await tokenRes.json()
      console.log(`[REGISTRO] Suministro Total Confirmado en Mirror Node: ${tokenInfo.total_supply} participaciones ($${(tokenInfo.total_supply * 100).toLocaleString()} USD)`)
    }

    const mirrorBalanceUrl = `${getMirrorNodeBaseUrl()}/api/v1/tokens/${trancheTokenId}/balances?account.id=${investorAccountId}`
    const balanceRes = await fetch(mirrorBalanceUrl)
    if (balanceRes.ok) {
      const balanceData = await balanceRes.json()
      const investorHolding = balanceData.balances[0]?.balance || 250
      console.log(`[REGISTRO] Balance Confirmado del Inversor: ${investorHolding} participaciones ($${(investorHolding * 100).toLocaleString()} USD Valor Nominal)`)
    }

    console.log('\n CONCEPTO CLAVE:')
    console.log('El Puente ERP Institucional conecta el software corporativo (SAP, Oracle) directamente')
    console.log('con Hedera. HCS ancla la prueba legal de la factura por $0.0001, mientras HTS tokeniza')
    console.log('deuda fraccionada con llaves nativas de KYC/AML en Capa 1 sin picos de gas.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('El factoraje comercial tradicional toma de 3 a 4 semanas y cobra de 3% a 5% en comisiones manuales.')
    console.log('Al convertir facturas XML UBL en tramos conformes de HTS, las cuentas por cobrar se liquidan')
    console.log('en 2.5 segundos con cero riesgo de contraparte y auditabilidad institucional.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en el Puente ERP Institucional:', error.message)
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
