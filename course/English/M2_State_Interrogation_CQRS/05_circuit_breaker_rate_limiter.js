/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Enterprise Resilience — Circuit Breaker & Rate Limiter
 * [CONCEPT] High-Availability Mirror Node Failover & Fault-Tolerant CQRS
 * ============================================================================
 * [ KEY CONCEPT ]
 * In production enterprise architectures, public Mirror Node REST endpoints
 * enforce strict rate limits (HTTP 429 Too Many Requests) and can experience
 * transient latency spikes. If your application blindly retries every failed
 * request, it creates a "thundering herd" that exhausts network sockets and crashes.
 *
 * The Circuit Breaker pattern solves this with a three-state resilience engine:
 * 1. CLOSED: Normal operation. Requests flow to the Mirror Node, updating local cache.
 * 2. OPEN: If failure/rate-limit threshold is exceeded (e.g., 3 consecutive 429s/timeouts),
 *    the circuit trips OPEN. Outgoing requests are halted immediately, serving
 *    stale-while-revalidate cached state to protect both client and ledger.
 * 3. HALF-OPEN: After a cooling window, a single "canary" probe tests network health.
 *    If successful, the breaker resets to CLOSED; if it fails, it trips back to OPEN.
 * *
 * [ LEARNABLE MOMENT ]
 * If a remote infrastructure endpoint suffers degradation, an automated Circuit Breaker trips into OPEN state, diverting traffic to backup nodes or cached replicas and preventing application cascade failures.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/reference/rest-api
 *
 * [ LEARNING PATH ]
 * - Previous: M2 Lab 04: Real-Time Event Sourcing Reactor
 * - Next:     M2 Lab 06: Real-Time WebSocket Event Bus
 *
 * [SIMULATED]
 * The HTTP 429 responses are injected on purpose to trip the circuit breaker. The fallback Mirror Node query is real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M2_State_Interrogation_CQRS/05_circuit_breaker_rate_limiter.js
 * ============================================================================
 */

import { performance } from 'perf_hooks'
import { getClient, getMirrorNodeBaseUrl, updateState } from '../M99_Utilities/index.js'

/**
 * Enterprise Circuit Breaker & Resilient Cache Engine.
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

    // 1. Evaluate State Machine Transitions
    if (this.state === 'OPEN') {
      if (now >= this.nextAttempt) {
        this.state = 'HALF_OPEN'
        console.log('\n[ CIRCUIT HALF-OPEN] Cooldown window expired. Dispatching canary health probe...')
      } else {
        const cached = this.cache.get(cacheKey)
        const duration = Number((performance.now() - startTime).toFixed(3))
        this.telemetry.push({
          key: cacheKey,
          state: 'OPEN',
          action: 'SERVED_FROM_CACHE',
          durationMs: duration,
          note: 'Blocked by breaker to protect upstream Mirror Node'
        })
        return { data: cached?.data, fromCache: true, stale: true, breakerState: 'OPEN' }
      }
    }

    // 2. Attempt Remote Request
    try {
      const data = await fetchAction()

      // Request Succeeded
      this.cache.set(cacheKey, { data, timestamp: now })
      this.failureCount = 0
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED'
        console.log('[ CIRCUIT CLOSED] Canary health probe succeeded! Breaker reset to normal operation.')
      }

      const duration = Number((performance.now() - startTime).toFixed(3))
      this.telemetry.push({
        key: cacheKey,
        state: this.state,
        action: 'FETCHED_REMOTE',
        durationMs: duration,
        note: 'Live consensus state query OK'
      })

      return { data, fromCache: false, breakerState: this.state }
    } catch (error) {
      this.failureCount++
      const duration = Number((performance.now() - startTime).toFixed(3))

      if (this.failureCount >= this.failureThreshold || this.state === 'HALF_OPEN') {
        this.state = 'OPEN'
        this.nextAttempt = Date.now() + this.cooldownMs
        console.log(`\n[ CIRCUIT TRIPPED TO OPEN] Threshold reached (${this.failureCount} errors). Tripping breaker for ${this.cooldownMs}ms.`)
      }

      const cached = this.cache.get(cacheKey)
      this.telemetry.push({
        key: cacheKey,
        state: this.state,
        action: 'FALLBACK_TO_CACHE',
        durationMs: duration,
        note: `Error: ${error.message} -> Falling back to cached state`
      })

      if (cached) {
        return { data: cached.data, fromCache: true, stale: true, breakerState: this.state }
      }
      throw error
    }
  }

  printTelemetry () {
    console.log('\n---  CIRCUIT BREAKER RESILIENCE AUDIT LOG ---')
    console.table(this.telemetry.map((t, idx) => ({
      Req: idx + 1,
      State: t.state,
      Action: t.action,
      'Latency (ms)': `${t.durationMs} ms`,
      Notes: t.note
    })))
  }
}

const main = async () => {
  console.log('--- SESSION START: Circuit Breaker & Resilient Mirror Node Gateway ---\n')

  const { client, operatorId } = getClient()
  const mirrorBase = getMirrorNodeBaseUrl()
  const targetAccount = operatorId.toString()

  const breaker = new MirrorNodeCircuitBreaker({
    failureThreshold: 2,
    cooldownMs: 2000
  })

  try {
    console.log('[PROCESS] Step 1: Performing baseline healthy state interrogation...')

    // Baseline request to warm up cache
    const res1 = await breaker.execute(`account:${targetAccount}`, async () => {
      // Read from the Mirror Node REST API: free, but a few seconds behind consensus.
      const res = await fetch(`${mirrorBase}/api/v1/accounts/${targetAccount}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    })

    console.log(`[SUCCESS] Initial Live Query: Account ${res1.data.account} Balance: ${(res1.data.balance.balance / 1e8).toFixed(4)} ℏ (Breaker: ${res1.breakerState})`)

    console.log('\n[PROCESS] Step 2: Simulating upstream Mirror Node rate-limiting (HTTP 429 storm)...')

    // Simulate 3 rapid requests where the network responds with HTTP 429
    for (let i = 1; i <= 3; i++) {
      console.log(`[ TRAFFIC BURST] Dispatching Request #${i}...`)
      const burstRes = await breaker.execute(`account:${targetAccount}`, async () => {
        // Intentionally simulate transient 429 / upstream overload
        throw new Error('HTTP 429: Too Many Requests (Mirror Node Rate Limit)')
      })

      console.log(`[ RESILIENCE ACTIVE] Result: Returned cached balance ${(burstRes.data.balance.balance / 1e8).toFixed(4)} ℏ (From Cache: ${burstRes.fromCache}, Breaker: ${burstRes.breakerState})`)
    }

    console.log('\n[PROCESS] Step 3: Waiting for circuit cooldown window (2,000ms)...')
    await new Promise(r => setTimeout(r, 2200))

    console.log('[PROCESS] Step 4: Dispatching post-cooldown canary request to resume normal operation...')
    const recoveryRes = await breaker.execute(`account:${targetAccount}`, async () => {
      const res = await fetch(`${mirrorBase}/api/v1/accounts/${targetAccount}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    })

    console.log(`[ RECOVERY COMPLETE] Account ${recoveryRes.data.account} Balance: ${(recoveryRes.data.balance.balance / 1e8).toFixed(4)} ℏ (Breaker: ${recoveryRes.breakerState})`)

    // Print resilience telemetry
    breaker.printTelemetry()

    updateState('CIRCUIT_BREAKER_STATE', breaker.state)
    updateState('CIRCUIT_BREAKER_FAILURES_BLOCKED', 3)

    console.log('\n KEY CONCEPT:')
    console.log('Zero Downtime CQRS: By coupling in-memory caching with a Circuit Breaker,')
    console.log('your dApp remains responsive during upstream rate-limits or outages,')
    console.log('serving verifiable cached state without crashing end-user experiences.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error(`\n[FAILED] Circuit Breaker Gateway Error: ${error.message}`)
    process.exitCode = 1
    if (client) client.close()
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
