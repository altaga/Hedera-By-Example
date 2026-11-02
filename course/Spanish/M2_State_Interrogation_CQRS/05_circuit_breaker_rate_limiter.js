/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Resiliencia Enterprise — Circuit Breaker y Limitador de Tasa
 * [ CONCEPTO ] Conmutación por Error en Mirror Node y CQRS Tolerante a Fallos
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En arquitecturas empresariales de producción, los endpoints REST públicos
 * del Mirror Node aplican límites de tasa estrictos (HTTP 429 Too Many Requests)
 * y pueden experimentar picos de latencia transitorios. Si la aplicación
 * reintenta a ciegas cada petición fallida, provoca una "estampida atronadora"
 * (thundering herd) que agota los sockets de red y colapsa los servicios.
 *
 * El patrón Circuit Breaker resuelve esto mediante un motor de tres estados:
 * 1. CLOSED: Operación normal. Las peticiones fluyen al Mirror Node y actualizan la caché.
 * 2. OPEN: Si se supera el umbral de fallos (ej. 3 errores 429 consecutivos), el circuito
 *    se ABRE. Las peticiones salientes se detienen inmediatamente, sirviendo datos en
 *    caché (stale-while-revalidate) para proteger tanto al cliente como al ledger.
 * 3. HALF-OPEN: Tras una ventana de enfriamiento, una sonda "canario" prueba la red.
 *    Si tiene éxito, el circuito vuelve a CLOSED; si falla, se abre nuevamente.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Si un endpoint de infraestructura se degrada, un Circuit Breaker automatizado cambia a estado ABIERTO, redirigiendo el tráfico a nodos de respaldo o réplicas en caché y evitando caídas en cascada.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/tutorials/more-tutorials/how-to-use-mirror-node-rest-apis
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M2 Lab 04: Reactor de Event Sourcing en Tiempo Real
 * - Siguiente: M2 Lab 06: Bus de Eventos WebSocket en Tiempo Real
 *
 * [ SIMULADO ]
 * Las respuestas HTTP 429 se inyectan a propósito para activar el circuit breaker. La consulta de respaldo al Mirror Node es real.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M2_State_Interrogation_CQRS/05_circuit_breaker_rate_limiter.js
 * ============================================================================
 */

import { performance } from 'perf_hooks'
import { getClient, getMirrorNodeBaseUrl, updateState } from '../M99_Utilities/index.js'

/**
 * Motor de Circuit Breaker y Caché Resiliente Enterprise.
 */
class MirrorNodeCircuitBreaker {
  constructor (options = {}) {
    this.failureThreshold = options.failureThreshold || 3
    this.cooldownMs = options.cooldownMs || 1500
    this.state = 'CLOSED' // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0
    this.nextAttempt = Date.now()
    this.cache = new Map()
    this.telemetry = []
  }

  async execute (cacheKey, fetchAction) {
    const now = Date.now()
    const startTime = performance.now()

    // 1. Evaluar Transiciones de la Máquina de Estados
    if (this.state === 'OPEN') {
      if (now >= this.nextAttempt) {
        this.state = 'HALF_OPEN'
        console.log('\n[🟡 CIRCUITO HALF-OPEN] Ventana de enfriamiento cumplida. Despachando sonda canario...')
      } else {
        const cached = this.cache.get(cacheKey)
        const duration = Number((performance.now() - startTime).toFixed(3))
        this.telemetry.push({
          key: cacheKey,
          state: 'OPEN',
          action: 'SERVED_FROM_CACHE',
          durationMs: duration,
          note: 'Bloqueado por el disyuntor para proteger el Mirror Node upstream'
        })
        return { data: cached?.data, fromCache: true, stale: true, breakerState: 'OPEN' }
      }
    }

    // 2. Intentar Petición Remota
    try {
      const data = await fetchAction()

      // Petición Exitosa
      this.cache.set(cacheKey, { data, timestamp: now })
      this.failureCount = 0
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED'
        console.log('[🟢 CIRCUITO CLOSED] ¡Sonda canario exitosa! Disyuntor restablecido a operación normal.')
      }

      const duration = Number((performance.now() - startTime).toFixed(3))
      this.telemetry.push({
        key: cacheKey,
        state: this.state,
        action: 'FETCHED_REMOTE',
        durationMs: duration,
        note: 'Consulta remota de estado de consenso OK'
      })

      return { data, fromCache: false, breakerState: this.state }
    } catch (error) {
      this.failureCount++
      const duration = Number((performance.now() - startTime).toFixed(3))

      if (this.failureCount >= this.failureThreshold || this.state === 'HALF_OPEN') {
        this.state = 'OPEN'
        this.nextAttempt = Date.now() + this.cooldownMs
        console.log(`\n[🔴 CIRCUITO ABIERTO - OPEN] Umbral alcanzado (${this.failureCount} fallos). Disyuntor abierto por ${this.cooldownMs}ms.`)
      }

      const cached = this.cache.get(cacheKey)
      this.telemetry.push({
        key: cacheKey,
        state: this.state,
        action: 'FALLBACK_TO_CACHE',
        durationMs: duration,
        note: `Error: ${error.message} -> Conmutando a estado en caché`
      })

      if (cached) {
        return { data: cached.data, fromCache: true, stale: true, breakerState: this.state }
      }
      throw error
    }
  }

  printTelemetry () {
    console.log('\n--- 📊 REGISTRO DE AUDITORÍA DE RESILIENCIA DEL DISYUNTOR ---')
    console.table(this.telemetry.map((t, idx) => ({
      Petición: idx + 1,
      Estado: t.state,
      Acción: t.action,
      'Latencia (ms)': `${t.durationMs} ms`,
      Notas: t.note
    })))
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Circuit Breaker y Pasarela Resiliente de Mirror Node ---\n')

  const { client, operatorId } = getClient()
  const mirrorBase = getMirrorNodeBaseUrl()
  const targetAccount = operatorId.toString()

  const breaker = new MirrorNodeCircuitBreaker({
    failureThreshold: 2,
    cooldownMs: 2000
  })

  try {
    console.log('[⚙️ PROCESO] Paso 1: Realizando interrogación base en estado saludable...')

    // Petición inicial para calentar la caché
    const res1 = await breaker.execute(`account:${targetAccount}`, async () => {
      const res = await fetch(`${mirrorBase}/api/v1/accounts/${targetAccount}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    })

    console.log(`[✅ ÉXITO] Consulta Remota Inicial: Cuenta ${res1.data.account} Saldo: ${(res1.data.balance.balance / 1e8).toFixed(4)} ℏ (Disyuntor: ${res1.breakerState})`)

    console.log('\n[⚙️ PROCESO] Paso 2: Simulando tormenta de límites de tasa en Mirror Node (HTTP 429)...')

    // Simular 3 peticiones rápidas donde el Mirror Node responde con HTTP 429
    for (let i = 1; i <= 3; i++) {
      console.log(`[⚡ RÁFAGA DE TRÁFICO] Despachando Petición #${i}...`)
      const burstRes = await breaker.execute(`account:${targetAccount}`, async () => {
        // Simular intencionalmente un 429 transitorio / sobrecarga
        throw new Error('HTTP 429: Too Many Requests (Mirror Node Rate Limit)')
      })

      console.log(`[🛡️ RESILIENCIA ACTIVA] Resultado: Saldo entregado desde caché ${(burstRes.data.balance.balance / 1e8).toFixed(4)} ℏ (Desde Caché: ${burstRes.fromCache}, Disyuntor: ${burstRes.breakerState})`)
    }

    console.log('\n[⚙️ PROCESO] Paso 3: Esperando ventana de enfriamiento del circuito (2,000ms)...')
    await new Promise(r => setTimeout(r, 2200))

    console.log('[⚙️ PROCESO] Paso 4: Despachando sonda canario para restablecer la operación normal...')
    const recoveryRes = await breaker.execute(`account:${targetAccount}`, async () => {
      const res = await fetch(`${mirrorBase}/api/v1/accounts/${targetAccount}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    })

    console.log(`[✅ RECUPERACIÓN COMPLETA] Cuenta ${recoveryRes.data.account} Saldo: ${(recoveryRes.data.balance.balance / 1e8).toFixed(4)} ℏ (Disyuntor: ${recoveryRes.breakerState})`)

    // Imprimir telemetría de resiliencia
    breaker.printTelemetry()

    updateState('CIRCUIT_BREAKER_STATE', breaker.state)
    updateState('CIRCUIT_BREAKER_FAILURES_BLOCKED', 3)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('CQRS con Cero Caídas: Al acoplar caché en memoria con un Circuit Breaker,')
    console.log('tu dApp se mantiene disponible durante límites de tasa o caídas de red,')
    console.log('entregando datos verificados sin degradar la experiencia del usuario final.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error(`\n[❌ ERROR] Falló el Gateway con Circuit Breaker: ${error.message}`)
    process.exitCode = 1
    if (client) client.close()
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
