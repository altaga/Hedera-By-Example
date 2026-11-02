/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Tópicos Monetizados Generadores de Ingresos en HBAR y HTS (HIP-991)
 * [ CONCEPTO ] Monetización de Consenso Sin Permisos ni Contratos Inteligentes
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Antes de la HIP-991, monetizar un tópico de HCS exigía desarrollar contratos
 * inteligentes o pasarelas de pago centralizadas. Con la HIP-991, los operadores
 * de tópicos pueden adjuntar una comisión fija (`CustomFixedFee` en HBAR o cualquier
 * token fungible de HTS) directamente a un tópico público vía `.addCustomFee(fee)`.
 * Cada vez que un usuario externo o agente de IA publica un mensaje en el tópico,
 * la capa de consenso cobra automáticamente la comisión y la deposita en la cuenta
 * recaudadora (`feeCollectorAccountId`), ¡mientras las llaves en `feeExemptKeys` publican gratis!
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * La HIP-991 transforma cada tópico de HCS en un motor nativo de facturación SaaS
 * sin necesidad de contratos. Para proteger al emisor de aumentos bruscos de tarifa,
 * el remitente especifica un `CustomFeeLimit` como techo máximo autorizado.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M5 Lab 05: Registro HCS-6
 * - Siguiente: M5 Lab 07: Ingesta Masiva de Lotes con Árboles Merkle en HCS
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M5_Hedera_Consensus_Service/06_hip991_paid_topics.js
 * ============================================================================
 */

import {
  AccountCreateTransaction,
  Client,
  CustomFeeLimit,
  CustomFixedFee,
  Hbar,
  MirrorNodeTokenBalanceQuery,
  PrivateKey,
  TokenCreateTransaction,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { getClient, sleep, updateState, createClient, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Tópicos Monetizados HIP-991 ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Crear un Token de Pago HTS ("AI Compute Credit" - AICR)
    console.log('[⚙️ PROCESO] Paso 1: Minteando Token de Utilidad HTS [AICR] para Monetizar el Tópico...')
    const paymentTokenId = await reuseToken('REUSE_M5_06_TOKEN', async () => {
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('AI Compute Credit')
        .setTokenSymbol('AICR')
        .setDecimals(0)
        .setInitialSupply(100000)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(adminKey)
        .freezeWith(client)

      const tokenRes = await (await tokenTx.sign(adminKey)).execute(client)
      return (await tokenRes.getReceipt(client)).tokenId
    })
    console.log(`[✅ ÉXITO] Token de Pago HTS Creado: ${paymentTokenId.toString()} (AICR)`)

    // 2. Crear una Cuenta de Agente Consumidor y fondearla con HBAR + 500 AICR
    console.log('\n[⚙️ PROCESO] Paso 2: Aprovisionando Agente Consumidor Externo de IA...')
    const consumerKey = PrivateKey.generateED25519()
    const consumerRes = await new AccountCreateTransaction()
      .setKeyWithoutAlias(consumerKey.publicKey)
      .setInitialBalance(new Hbar(0.5))
      .setMaxAutomaticTokenAssociations(5)
      .execute(client)
    const consumerId = (await consumerRes.getReceipt(client)).accountId

    const fundRes = await new TransferTransaction()
      .addTokenTransfer(paymentTokenId, operatorId, -500)
      .addTokenTransfer(paymentTokenId, consumerId, 500)
      .execute(client)
    await fundRes.getReceipt(client)
    console.log(`[🤖 CONSUMIDOR] Cuenta del Agente: ${consumerId.toString()} (Fondeada con 500 AICR)`)

    // 3. Crear un Tópico HCS Monetizado HIP-991 (Tarifa: 25 AICR por mensaje)
    console.log('\n[⚙️ PROCESO] Paso 3: Desplegando Tópico HCS Monetizado HIP-991 (Tarifa: 25 AICR / mensaje)...')
    const topicCustomFee = new CustomFixedFee()
      .setAmount(25)
      .setDenominatingTokenId(paymentTokenId)
      .setFeeCollectorAccountId(operatorId)

    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HIP-991:PAID:AI:ORACLE:FEED')
      .setAdminKey(adminKey.publicKey)
      .setFeeScheduleKey(adminKey.publicKey)
      .addFeeExemptKey(adminKey.publicKey) // ¡El operador está exento de pagar peaje!
      .addCustomFee(topicCustomFee)
      .freezeWith(client)

    const topicRes = await (await topicTx.sign(adminKey)).execute(client)
    const topicId = (await topicRes.getReceipt(client)).topicId
    console.log(`[✅ ÉXITO] Tópico Monetizado HIP-991 Desplegado: ${topicId.toString()}`)
    console.log(`[📊 REGISTRO] Peaje Configurado: 25 AICR por mensaje ➔ Recaudador (${operatorId.toString()})`)

    // 4. El Agente Consumidor Envía un Mensaje Autorizando con `CustomFeeLimit`
    console.log('\n[⚙️ PROCESO] Paso 4: Agente Consumidor enviando consulta al Tópico Monetizado...')
    const consumerClient = createClient()
    consumerClient.setOperator(consumerId, consumerKey)

    const maxAllowedFee = new CustomFeeLimit()
      .setAccountId(consumerId)
      .setFees([
        new CustomFixedFee()
          .setAmount(50) // Dispuesto a pagar hasta 50 AICR
          .setDenominatingTokenId(paymentTokenId)
      ])

    const paidSubmitRes = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify({
        agent: consumerId.toString(),
        action: 'QUERY_ALPHA_SIGNAL',
        pair: 'HBAR/USD'
      }))
      .addCustomFeeLimit(maxAllowedFee)
      .execute(consumerClient)

    const paidSubmitReceipt = await paidSubmitRes.getReceipt(consumerClient)
    consumerClient.close()
    console.log(`[✅ ÉXITO] ¡Mensaje Pagado Aceptado en Secuencia #${paidSubmitReceipt.topicSequenceNumber}!`)

    // 5. Verificar el Cobro Automático del Token vía Mirror Node
    await sleep(3500)
    const consumerBalAfter = await new MirrorNodeTokenBalanceQuery()
      .setAccountId(consumerId)
      .setTokenId(paymentTokenId)
      .execute(client)
    console.log(`\n[📊 AUDITORÍA] Balance AICR del Consumidor: ${consumerBalAfter.balance.toString()} AICR (¡25 AICR Recaudados Automáticamente!)`)

    updateState('HIP991_PAID_TOPIC_ID', topicId.toString())
    updateState('HIP991_PAYMENT_TOKEN_ID', paymentTokenId.toString())
    updateState('HIP991_CONSUMER_FINAL_BAL', consumerBalAfter.balance.toString())

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('La HIP-991 convierte cualquier tópico de HCS en una fuente de ingresos sin permisos')
    console.log('denominada en HBAR o cualquier token de HTS (como USDC o créditos de IA), mientras que')
    console.log('`addFeeExemptKey` permite que tu propio servidor publique respuestas gratis.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Adjunta siempre un `CustomFeeLimit` al publicar en tópicos HIP-991 de terceros.')
    console.log('Actúa como un techo de protección para que el administrador no pueda subir el peaje sorpresivamente.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en Tópico Monetizado HIP-991:', error.message)
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
