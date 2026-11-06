/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Metodología de Puntuación de Confianza de IA HCS-25
 * [CONCEPTO] Puntuaciones de Confianza Deterministas y Explicables para Agentes de IA
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * HCS-25 (Hashgraph Online, Borrador v1.0) define CÓMO calcular una AI Trust Score,
 * no dónde guardarla:
 * 1. Los trust adapters convierten señales en componentes en [0,100], cada uno con un
 *    estado (ok | missing | timeout | error | stale). Missing/timeout/error -> 0; stale se
 *    multiplica por m_stale.
 * 2. Total del adapter = media de sus componentes.
 * 3. Los modos de contribución deciden el denominador: `universal` y `scoped` siempre cuentan
 *    si aplican (sin salida -> defaultComponentKey = 0); `conditional` cuenta solo si produjo
 *    componentes. Peso 0 = solo informativo.
 * 4. trustScores.total = round2( Σ w·total / Σ w ), más trustScoreUpdatedAt y
 *    trustScoreConfigVersion.
 * Este lab implementa ese algoritmo, lo verifica contra los dos vectores de prueba de la
 * spec (57.5 y 63.33), puntúa un agente y publica el resultado explicable en HCS.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Una puntuación solo es comparable con otra del mismo trustScoreConfigVersion.
 * Publicar el desglose y la versión de configuración la hace reproducible por cualquiera.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-25
 * - https://hol.org/docs/standards/hcs-14
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 01: Puntos Auditables HCS-20
 * - Siguiente: M14 Lab 03: Registro de Habilidades de Agentes HCS-26
 *
 * [SIMULADO]
 * Los valores de las señales del agente son datos de ejemplo. HCS-25 no define un formato de almacenamiento, así que el formato del registro en HCS (y las firmas de evaluadores) son elección de este lab. El algoritmo y la publicación en HCS son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/02_hcs25_ai_trust_score.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import { TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

const round2 = (x) => Math.round(x * 100) / 100
const clamp = (x) => Math.min(100, Math.max(0, x))

/**
 * Puntuación compuesta HCS-25. `adapters`: [{ adapterId, weight=1, contributionMode='conditional',
 * applicable=true, defaultComponentKey, components: { key: { value, status } } }]
 */
const computeTrustScore = (adapters, { mStale = 1, configVersion = 1 } = {}) => {
  const breakdown = {}
  let num = 0
  let den = 0
  for (const a of adapters) {
    const weight = a.weight ?? 1
    const mode = a.contributionMode ?? 'conditional'
    if (a.applicable === false || weight === 0) continue
    const comps = {}
    for (const [key, c] of Object.entries(a.components || {})) {
      if (['missing', 'timeout', 'error'].includes(c.status) && c.nonScorableWhenUnavailable) continue
      comps[key] = c.status === 'ok' ? clamp(c.value) : c.status === 'stale' ? clamp(c.value * mStale) : 0
    }
    let keys = Object.keys(comps)
    if (!keys.length) {
      if (mode === 'conditional') continue
      comps[a.defaultComponentKey || `${a.adapterId}.score`] = 0
      keys = Object.keys(comps)
    }
    const total = round2(keys.reduce((s, k) => s + comps[k], 0) / keys.length)
    Object.assign(breakdown, comps)
    breakdown[`${a.adapterId}.total`] = total
    num += total * weight
    den += weight
  }
  return {
    trustScores: { total: den ? round2(num / den) : 0, ...breakdown },
    trustScoreUpdatedAt: new Date().toISOString(),
    trustScoreConfigVersion: configVersion
  }
}

// Vectores de prueba de la spec (HCS-25 "Test Vectors")
const vectorAdapters = (reputationMode, reputationMissing) => [
  { adapterId: 'availability', weight: 1, contributionMode: 'scoped', components: { 'availability.uptime': { value: 90, status: 'ok' } } },
  { adapterId: 'simple_evals', weight: 2, contributionMode: 'scoped', components: { 'simple_evals.math': { value: 100, status: 'ok' }, 'simple_evals.science': { value: 0, status: 'missing' } } },
  { adapterId: 'reputation', weight: 1, contributionMode: reputationMode, components: reputationMissing ? {} : { 'reputation.stars': { value: 40, status: 'ok' } } }
]

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Metodología de Puntuación de Confianza de IA HCS-25 ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Conformidad con los vectores de prueba de la spec
    console.log('[PROCESO] Paso 1: Verificando la implementación contra los vectores de prueba de HCS-25...')
    const tv1 = computeTrustScore(vectorAdapters('scoped', false)).trustScores.total
    const tv2 = computeTrustScore(vectorAdapters('conditional', true)).trustScores.total
    console.log(`[VERIFICACIÓN] Vector 1 (scoped, se penaliza lo faltante): ${tv1} (esperado 57.5) -> ${tv1 === 57.5 ? 'PASS' : 'FAIL'}`)
    console.log(`[VERIFICACIÓN] Vector 2 (conditional, lo escaso se ignora):  ${tv2} (esperado 63.33) -> ${tv2 === 63.33 ? 'PASS' : 'FAIL'}`)
    if (tv1 !== 57.5 || tv2 !== 63.33) throw new Error('Fallaron los vectores de prueba de HCS-25')

    // 2. Puntuar un agente (señales de ejemplo)
    console.log('\n[PROCESO] Paso 2: Puntuando un agente a partir de un snapshot de señales...')
    const subject = { uaid: `hedera:testnet:${operatorId}`, registry: 'hashgraph-online', protocol: 'hcs-10' }
    const result = computeTrustScore([
      { adapterId: 'availability', weight: 1, contributionMode: 'universal', components: { 'availability.uptime': { value: 99.4, status: 'ok' }, 'availability.latency': { value: 87, status: 'stale' } } },
      { adapterId: 'simple-math', weight: 0.5, contributionMode: 'scoped', components: { 'simple-math.score': { value: 96, status: 'ok' } } },
      { adapterId: 'x402', weight: 1, contributionMode: 'scoped', components: { 'x402.volume': { value: 0, status: 'timeout' } } },
      { adapterId: 'oss-popularity', weight: 0.7, contributionMode: 'conditional', components: {} },
      { adapterId: 'erc8004-feedback', weight: 1, contributionMode: 'scoped', applicable: false }
    ], { mStale: 0.8, configVersion: 3 })
    for (const [k, v] of Object.entries(result.trustScores)) console.log(`[LOG] ${k.padEnd(24)} ${v}`)

    // 3. Los evaluadores firman el registro (elección del lab; HCS-25 deja abierto el transporte/almacenamiento)
    const record = { p: 'hcs-25', subject, ...result }
    const digest = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(record)))
    const evaluators = [ethers.Wallet.createRandom(), ethers.Wallet.createRandom()]
    const endorsements = evaluators.map(w => ({ evaluator: w.address, signature: w.signingKey.sign(digest).serialized }))
    const valid = endorsements.filter(e => ethers.recoverAddress(digest, e.signature) === e.evaluator).length
    console.log(`\n[VERIFICACIÓN] Firmas de evaluadores válidas: ${valid}/${endorsements.length}`)

    // 4. Publicar en HCS
    console.log('\n[PROCESO] Paso 4: Publicando el registro explicable de la puntuación en HCS...')
    const topicId = (await (await new TopicCreateTransaction().setTopicMemo('hbe:hcs-25-trust-scores').execute(client)).getReceipt(client)).topicId
    const res = await new TopicMessageSubmitTransaction().setTopicId(topicId)
      .setMessage(JSON.stringify({ ...record, digest, endorsements })).execute(client)
    const receipt = await res.getReceipt(client)
    console.log(`[ÉXITO] Topic ${topicId} sec #${receipt.topicSequenceNumber} — ${getHashscanUrl(res)}`)

    updateState('HCS25_TOPIC_ID', topicId.toString())
    updateState('HCS25_COMPOSITE_SCORE', result.trustScores.total)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Mismo snapshot + misma versión de configuración = misma puntuación, con un desglose que cualquiera puede verificar.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Falló la ejecución de HCS-25:', error.message)
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
