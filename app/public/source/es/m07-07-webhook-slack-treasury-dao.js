/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Laboratorio 07: DAO de Tesorería Autónoma con Webhooks (Gobernanza Reactiva)
 * [ CONCEPTO ] Quórums de Umbral en Capa 1 y Orquestación Empresarial Dirigida por Eventos
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En las DAOs tradicionales de EVM (como OpenZeppelin Governor o Gnosis Safe), la
 * gobernanza multifirma requiere contratos inteligentes complejos, múltiples
 * transacciones con alto consumo de gas y bots "keepers" externos para llamar a
 * una función `execute()` después de que concluye la votación.
 *
 * Hedera erradica toda esa superficie de ataque mediante Programación Nativa en Capa 1:
 * 1. Las cuentas de tesorería usan llaves de umbral nativas `KeyList` (ej. 2 de 3).
 * 2. Las propuestas se registran como salas de espera vía `ScheduleCreateTransaction`.
 * 3. Webhooks reactivos notifican a los custodios distribuidos en sistemas empresariales.
 * 4. En el milisegundo exacto en que se ingresa la 2ª firma vía `ScheduleSignTransaction`,
 *    el gossip-about-gossip de Hedera ejecuta la transacción automáticamente en Capa 1.
 *    Sin bots intermediarios, sin subsidiadores de gas y sin riesgo de contratos.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las transacciones programadas en Hedera desacoplan "Propuesta", "Autorización" y
 * "Ejecución". Cualquier custodio o sistema puede proponer; los demás firman de forma
 * asíncrona desde cualquier parte del mundo. Cuando la condición de umbral se cumple
 * matemáticamente, los nodos de consenso liquidan el pago de manera atómica.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M7 Lab 06: Verificación de Login Criptográfico
 * - Siguiente: M7 Lab 08: Controlador de Gobernanza Timelock y Veto del Consejo de Seguridad
 *
 * [ SECUENCIA ]
 * Fideicomisario 1 -> Hedera: ScheduleCreate de pago (tesorería multifirma 2 de 3)
 * Monitor -> Hedera: Consultar el Mirror Node buscando propuestas pendientes
 * Monitor -> Fideicomisario 2: Webhook: propuesta esperando firma
 * Fideicomisario 2 -> Hedera: ScheduleSign
 * Hedera -> Tesorería: Umbral cumplido: el pago se ejecuta solo
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: ~2 ℏ (comisiones de red y las cuentas que crea).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M7_Governance_Cron/07_webhook_slack_treasury_dao.js
 * ============================================================================
 */

import {
  AccountId,
  PrivateKey,
  KeyList,
  AccountCreateTransaction,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  TransferTransaction,
  Hbar,
  Timestamp
} from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl, getHashscanUrl, sleep } from '../M99_Utilities/index.js'

/**
 * Simulación de Despacho de Webhooks Empresariales
 * (ej. Despacha eventos estructurados a Slack, Discord o un ERP corporativo)
 */
const dispatchGovernanceWebhook = (channel, eventPayload) => {
  console.log(`\n[🔔 WEBHOOK DESPACHADO -> ${channel}]`)
  console.log(JSON.stringify(eventPayload, null, 2))
}

/**
 * Recuperador Asíncrono de Balance en Mirror Node (compatible con CQRS)
 */
const getAccountHbarBalance = async (accountId) => {
  const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
  if (!res.ok) {
    throw new Error(`La consulta a Mirror Node para el balance de ${accountId} falló: ${res.statusText}`)
  }
  const data = await res.json()
  return data.balance.balance / 1e8
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: DAO de Tesorería Autónoma con Webhooks ---\n')
  const { client, operatorId, operatorKey } = getClient()

  try {
    // 1. Establecer Consejo de Gobernanza de 3 Custodios (Quórum 2 de 3)
    console.log('[⚙️ PROCESO] Paso 1: Configurando Consejo Multifirma con Quórum 2 de 3...')

    const trustee1Key = PrivateKey.fromStringDer(operatorKey) // Custodio 1 (Operador)
    const trustee2Key = PrivateKey.generateED25519() // Custodio 2 (Oficial Financiero)
    const trustee3Key = PrivateKey.generateED25519() // Custodio 3 (Auditor de Riesgo)

    const thresholdKeys = new KeyList([
      trustee1Key.publicKey,
      trustee2Key.publicKey,
      trustee3Key.publicKey
    ], 2) // Quórum: se requieren 2 firmas de 3

    // Designar Cuenta Receptora (Proveedor / Subvención)
    const recipientId = process.env.ACCOUNT_1_ID || '0.0.11226623'
    const initialRecipientBalance = await getAccountHbarBalance(recipientId)

    // Crear la Cuenta de Tesorería Multifirma de la DAO con 0.5 HBAR de Liquidez Inicial
    const treasuryCreateTx = await new AccountCreateTransaction()
      .setKey(thresholdKeys)
      .setInitialBalance(new Hbar(0.5))
      .execute(client)
    const treasuryReceipt = await treasuryCreateTx.getReceipt(client)
    const treasuryAccountId = treasuryReceipt.accountId.toString()

    console.log(`[✅ ÉXITO] Tesorería Multifirma Creada: ${treasuryAccountId} (Umbral 2 de 3)`)
    console.log('[📊 REGISTRO] Balance Inicial de Tesorería: 0.5 HBAR')
    console.log(`[📊 REGISTRO] Cuenta Proveedor / Receptora: ${recipientId} (Inicial: ${initialRecipientBalance} HBAR)`)

    // 2. Custodio 1 Propone Desembolso de Subvención vía ScheduleCreateTransaction
    console.log('\n[⚙️ PROCESO] Paso 2: Custodio 1 Inicia Propuesta de Pago Programado (0.1 HBAR)...')

    const payoutTransfer = new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(treasuryAccountId), new Hbar(-0.1))
      .addHbarTransfer(AccountId.fromString(recipientId), new Hbar(0.1))

    const expiryDate = new Date()
    expiryDate.setMinutes(expiryDate.getMinutes() + 30)

    const scheduleCreateTx = await new ScheduleCreateTransaction()
      .setScheduledTransaction(payoutTransfer)
      .setPayerAccountId(AccountId.fromString(operatorId))
      .setScheduleMemo('DAO-GOV-PROPOSAL-042: Pago de Subvencion a Desarrolladores')
      .setExpirationTime(Timestamp.fromDate(expiryDate))
      .setWaitForExpiry(false) // ¡Se ejecuta autónomamente tan pronto se alcanza el quórum!
      .freezeWith(client)
      .sign(trustee1Key) // Custodio 1 (Proponente) co-firma la propuesta al crearla

    const scheduleResponse = await scheduleCreateTx.execute(client)
    const scheduleReceipt = await scheduleResponse.getReceipt(client)
    const scheduleId = scheduleReceipt.scheduleId.toString()

    console.log(`[✅ ÉXITO] Propuesta Programada Registrada: ${scheduleId}`)
    console.log(`[📊 REGISTRO] HashScan de la Propuesta: ${getHashscanUrl(scheduleResponse)}`)

    // 3. Monitor Reactivo Basado en Eventos y Despacho de Webhook
    console.log('\n[⚙️ PROCESO] Paso 3: Monitor de Eventos detectando propuesta y despachando Webhook...')
    console.log('[ℹ️ INFORMACIÓN] Obteniendo estado de la propuesta desde Mirror Node (3 segundos)...')
    await sleep(3000)

    const mirrorScheduleUrl = `${getMirrorNodeBaseUrl()}/api/v1/schedules/${scheduleId}`
    const mirrorRes = await fetch(mirrorScheduleUrl)
    if (!mirrorRes.ok) {
      throw new Error(`La consulta a Mirror Node para el Schedule falló: ${mirrorRes.statusText}`)
    }

    const scheduleData = await mirrorRes.json()
    const collectedSignatures = scheduleData.signatures ? scheduleData.signatures.length : 1
    const isExecuted = scheduleData.executed_timestamp !== null

    console.log(`[📊 REGISTRO] Quórum Actual en Cadena: ${collectedSignatures}/2 firmas recolectadas.`)
    console.log(`[📊 REGISTRO] Estado de Ejecución: ${isExecuted ? 'EJECUTADA' : 'PENDIENTE_DE_APROBACION'}`)

    // Despachar webhook a los canales corporativos (Slack / ERP)
    dispatchGovernanceWebhook('#dao-alertas-tesoreria', {
      evento: 'PROPUESTA_TESORERIA_ESPERANDO_QUORUM',
      timestamp: new Date().toISOString(),
      scheduleId,
      tesoreria: treasuryAccountId,
      reglaGobernanza: 'Umbral 2 de 3',
      firmasRecolectadas: collectedSignatures,
      firmasRequeridas: 2,
      transferenciaPropuesta: {
        origen: treasuryAccountId,
        destino: recipientId,
        monto: '0.1 HBAR',
        proposito: 'Pago de Subvencion a Desarrolladores'
      },
      enlaceHashscan: `https://hashscan.io/testnet/schedule/${scheduleId}`
    })

    // 4. Custodio 2 Evalúa y Envía la Segunda Firma
    console.log('\n[⚙️ PROCESO] Paso 4: Custodio 2 (Oficial Financiero) revisa webhook y autoriza pago...')
    console.log('[ℹ️ INFORMACIÓN] Generando aprobación criptográfica vía ScheduleSignTransaction...')

    const signTx = await new ScheduleSignTransaction()
      .setScheduleId(scheduleId)
      .freezeWith(client)
      .sign(trustee2Key) // ¡Custodio 2 aporta la 2ª firma decisiva!

    const signResponse = await signTx.execute(client)
    const signReceipt = await signResponse.getReceipt(client)

    console.log(`[✅ ÉXITO] Firma del Custodio 2 Recibida: Estado ${signReceipt.status.toString()}!`)
    console.log(`[📊 REGISTRO] Tx de Firma en HashScan: ${getHashscanUrl(signResponse)}`)

    // 5. Verificar Ejecución Autónoma en Capa 1
    console.log('\n[⚙️ PROCESO] Paso 5: Verificando Ejecución Autónoma en Capa 1 de Consenso...')
    console.log('[ℹ️ INFORMACIÓN] Esperando asentamiento de balances en consenso (3 segundos)...')
    await sleep(3000)

    const treasuryBalance = await getAccountHbarBalance(treasuryAccountId)
    const recipientBalance = await getAccountHbarBalance(recipientId)

    console.log(`[📊 REGISTRO] Balance Actualizado de Tesorería: ${treasuryBalance} HBAR (se debitaron 0.1 HBAR)`)
    console.log(`[📊 REGISTRO] Balance Actualizado del Receptor: ${recipientBalance} HBAR (se acreditaron 0.1 HBAR)`)

    if (treasuryBalance > 0.45) {
      throw new Error('Los fondos de tesorería no fueron debitados: falló la ejecución del quórum')
    }

    console.log('[✅ ÉXITO] ¡Ejecución Autónoma de Quórum Confirmada! Pago liquidado con 0 gas de smart contracts.')

    // 6. Auditoría Final en Mirror Node
    const finalMirrorRes = await fetch(mirrorScheduleUrl)
    if (finalMirrorRes.ok) {
      const finalData = await finalMirrorRes.json()
      if (finalData.executed_timestamp) {
        console.log(`[📊 REGISTRO] Marca Temporal de Ejecución en Consenso: ${finalData.executed_timestamp}`)
      }
    }

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('La Programación Nativa en Hedera convierte el ledger en un motor de ejecución autónomo.')
    console.log('Al combinar KeyLists de umbral con `ScheduleSignTransaction`, las DAOs ejecutan')
    console.log('operaciones de tesorería a velocidades nativas de Capa 1 sin riesgos de Solidity.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('A diferencia de Ethereum donde alguien debe gastar gas para llamar a `execute()`,')
    console.log('los nodos de Hedera disparan la transacción programada automáticamente en la ronda de')
    console.log('consenso exacta donde la última firma alcanza el umbral.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en la DAO de Tesorería Autónoma:', error.message)
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
