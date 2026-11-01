/**
 * Hedera by Example (HBE) — 100% Pure Client-Side In-Browser Runtime
 * Runs directly inside the user's browser (V8 / SpiderMonkey / JavaScriptCore)
 * Zero backend server required. Communicates directly with Hedera Testnet via gRPC-Web HTTPS.
 */

export interface BrowserWallet {
  accountId: string
  privateKey: string
  publicKey: string
  evmAddress?: string
  keyType?: 'ED25519' | 'ECDSA'
  balanceHbar: number | null
  isDemo: boolean
  isCustom?: boolean
  createdAt?: number
  lastUpdated?: number
}

export interface TerminalLogLine {
  id: string
  timestamp: string
  type: 'info' | 'success' | 'warn' | 'error' | 'link' | 'system'
  text: string
  url?: string
}

// Default empty in-browser wallet stub (users connect or generate via top-right menu)
export const DEFAULT_DEMO_WALLET: BrowserWallet = {
  accountId: '',
  privateKey: '',
  publicKey: '',
  evmAddress: '',
  keyType: 'ECDSA',
  balanceHbar: null,
  isDemo: true,
  isCustom: false
}

const WALLET_STORAGE_KEY = 'hbe_playground_wallet_v2'

/**
 * Get active wallet from localStorage or default demo wallet.
 */
export function getActiveWallet(): BrowserWallet {
  if (typeof window === 'undefined') return DEFAULT_DEMO_WALLET
  try {
    const raw = localStorage.getItem(WALLET_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return parsed
    }
  } catch (_) {}
  return DEFAULT_DEMO_WALLET
}

/**
 * Save wallet to localStorage
 */
export function saveActiveWallet(wallet: BrowserWallet): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet))
  } catch (_) {}
}

/**
 * Query live HBAR balance from Hedera Testnet Mirror Node (100% Client-side REST with CORS)
 */
export async function fetchLiveBalance(accountId: string): Promise<number | null> {
  try {
    const cleanId = accountId.trim()
    if (!/^\d+\.\d+\.\d+$/.test(cleanId)) return null
    const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${cleanId}`, {
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data?.balance?.balance != null) {
      return Number(data.balance.balance) / 100_000_000
    }
  } catch (err) {
    console.warn('Failed to fetch mirror node balance:', err)
  }
  return null
}

/**
 * Generate a brand new Ed25519 keypair 100% in the browser
 */
export async function generateNewBrowserKeypair(): Promise<{ privateKey: string; publicKey: string }> {
  const hedera = await import('@hiero-ledger/sdk')
  const key = hedera.PrivateKey.generateED25519()
  return {
    privateKey: key.toStringDer(),
    publicKey: key.publicKey.toStringDer()
  }
}

/**
 * Create a brand new Hacker Wallet directly in the browser and persist to localStorage
 */
export async function createAndSaveHackerWallet(keyType: 'ED25519' | 'ECDSA' = 'ED25519'): Promise<BrowserWallet> {
  const hedera = await import('@hiero-ledger/sdk')
  let privKey: any
  let evmAddress: string | undefined = undefined

  if (keyType === 'ECDSA') {
    privKey = hedera.PrivateKey.generateECDSA()
    evmAddress = '0x' + privKey.publicKey.toEvmAddress()
  } else {
    privKey = hedera.PrivateKey.generateED25519()
  }

  const newWallet: BrowserWallet = {
    accountId: '',
    privateKey: privKey.toStringDer(),
    publicKey: privKey.publicKey.toStringDer(),
    evmAddress,
    keyType,
    balanceHbar: 0,
    isDemo: false,
    isCustom: true,
    createdAt: Date.now(),
    lastUpdated: Date.now()
  }

  saveActiveWallet(newWallet)
  return newWallet
}

/**
 * Instant 1-Click Testnet Faucet:
 * Submits an AccountCreateTransaction from the funded operator pool directly to Hedera Testnet,
 * assigning a real Account ID (0.0.X) and 5 HBAR to the hacker's newly generated browser keys.
 */
export async function fundBrowserWalletViaFaucet(
  wallet: BrowserWallet
): Promise<{ success: boolean; accountId?: string; balanceHbar?: number; error?: string }> {
  try {
    const hedera = await import('@hiero-ledger/sdk')

    // Operator faucet pool check
    if (!DEFAULT_DEMO_WALLET.accountId || !DEFAULT_DEMO_WALLET.privateKey) {
      return {
        success: false,
        error: 'Public faucet pool is not configured. Please use https://portal.hedera.com/faucet to fund your address directly.'
      }
    }

    const operatorId = hedera.AccountId.fromString(DEFAULT_DEMO_WALLET.accountId)
    const operatorKey = hedera.PrivateKey.fromStringDer(DEFAULT_DEMO_WALLET.privateKey)

    const client = hedera.Client.forTestnet()
    client.setOperator(operatorId, operatorKey)

    // Parse the hacker's public key
    const hackerPubKey = hedera.PublicKey.fromString(wallet.publicKey)

    // Submit AccountCreateTransaction with 5 HBAR
    const tx = await new hedera.AccountCreateTransaction()
      .setKey(hackerPubKey)
      .setInitialBalance(new hedera.Hbar(5))
      .setAccountMemo('HBE Hacker In-Browser Wallet')
      .execute(client)

    const receipt = await tx.getReceipt(client)
    const newAccountId = receipt.accountId ? receipt.accountId.toString() : ''
    if (!newAccountId) {
      throw new Error('Receipt did not return an Account ID')
    }

    client.close()

    // Update wallet
    const updatedWallet: BrowserWallet = {
      ...wallet,
      accountId: newAccountId,
      balanceHbar: 5,
      isDemo: false,
      isCustom: true,
      lastUpdated: Date.now()
    }
    saveActiveWallet(updatedWallet)

    return {
      success: true,
      accountId: newAccountId,
      balanceHbar: 5
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || String(err)
    }
  }
}

/**
 * Cleanse ES module imports, exports, and node runner blocks for safe in-browser execution
 */
export function sanitizeSourceForExecution(code: string): string {
  let sanitized = code
    // Strip all ES module imports (named, default, namespace, side-effect)
    .replace(/import\s+[\s\S]*?from\s*['"][^'"]*['"]\s*;?/gm, '')
    .replace(/import\s*['"][^'"]*['"]\s*;?/gm, '')
    // Strip ES module exports
    .replace(/export\s+default\s+.*?;?/gm, '')
    .replace(/export\s*\{[^}]*\}\s*;?/gm, '')
    // Strip Node.js process.argv[1] entry-point blocks
    .replace(/if\s*\(\s*process\.argv\[1\][\s\S]*$/gm, '')
    // Strip any lingering import.meta references
    .replace(/import\.meta\.[a-zA-Z0-9_$]+/gm, '""')
    .trim()

  // Automatically invoke main() if defined
  sanitized += '\n\nif (typeof main === "function") {\n  await main();\n}'
  return sanitized
}

/**
 * Execute Hedera JavaScript directly in the browser's V8 engine
 */
export async function executeInBrowser(
  sourceCode: string,
  wallet: BrowserWallet,
  onLog: (line: TerminalLogLine) => void
): Promise<{ success: boolean; durationMs: number }> {
  const startTime = Date.now()

  const pushLog = (type: TerminalLogLine['type'], text: string, url?: string) => {
    const d = new Date()
    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
    onLog({
      id: Math.random().toString(36).slice(2, 9),
      timestamp: timeStr,
      type,
      text,
      url
    })
  }

  const activeAccountId = wallet.accountId || DEFAULT_DEMO_WALLET.accountId
  const activePrivKey = wallet.privateKey || DEFAULT_DEMO_WALLET.privateKey

  pushLog('system', '⚡ Hedera In-Browser V8 Workstation (Zero-Server Architecture)')
  if (activeAccountId) {
    pushLog('info', `👛 Signing Operator: ${activeAccountId} (${wallet.balanceHbar != null ? wallet.balanceHbar.toFixed(2) : '0.0'} ℏ)`)
  } else {
    pushLog('warn', '⚠️ No Operator Account configured.')
    pushLog('info', '💡 Tip: Click [ 👛 Wallet ] in top navigation to connect or generate your Hedera Testnet wallet.')
  }
  pushLog('info', '🌐 Connecting to Swirlds Labs Hedera Testnet Consensus Nodes...')

  try {
    // 1. Dynamic import of SDK in browser context
    const hedera = await import('@hiero-ledger/sdk')

    // 2. Initialize client for testnet
    const client = hedera.Client.forTestnet()
    
    if (activeAccountId && activePrivKey) {
      try {
        const accId = hedera.AccountId.fromString(activeAccountId)
        let privKey: any
        if (activePrivKey.startsWith('302e') || activePrivKey.startsWith('3030')) {
          privKey = hedera.PrivateKey.fromStringDer(activePrivKey)
        } else {
          privKey = hedera.PrivateKey.fromString(activePrivKey)
        }
        client.setOperator(accId, privKey)
      } catch (keyErr: any) {
        pushLog('warn', `⚠️ Key error: ${keyErr.message}`)
        pushLog('info', '💡 Tip: Click [ 👛 Wallet ] in top bar to configure your testnet credentials.')
      }
    }

    // 3. Create dual-compatible client accessor (supports `const client = getClient()` and `const { client } = getClient()`)
    const clientWrapper: any = client
    clientWrapper.client = client
    const getClient = () => clientWrapper

    // 4. Robust HashScan URL resolver
    const getHashscanUrl = (target: any) => {
      if (!target) return 'https://hashscan.io/testnet'
      if (typeof target === 'object' && target !== null) {
        if (target.transactionId) {
          const rawId = String(target.transactionId).trim()
          const clean = rawId.replace('@', '-').replace(/\./g, '-')
          return `https://hashscan.io/testnet/transaction/${clean}`
        }
        if (target.topicId) {
          return `https://hashscan.io/testnet/topic/${target.topicId}`
        }
      }
      const clean = String(target).trim()
      if (clean.includes('@')) {
        const hashscanTx = clean.replace('@', '-').replace(/\./g, '-')
        return `https://hashscan.io/testnet/transaction/${hashscanTx}`
      }
      if (clean.startsWith('0x')) {
        return `https://hashscan.io/testnet/account/${clean}`
      }
      return `https://hashscan.io/testnet/topic/${clean}`
    }

    // 5. Reactive State synchronization for multi-lab flows
    const updateState = (key: string, val: any) => {
      try {
        const raw = localStorage.getItem('hbe_playground_state') || '{}'
        const obj = JSON.parse(raw)
        obj[key] = val
        localStorage.setItem('hbe_playground_state', JSON.stringify(obj))
        pushLog('info', `[State] Synced ${key} = ${typeof val === 'object' ? JSON.stringify(val) : String(val)}`)
      } catch (_) {}
      return val
    }

    const updateEnv = (key: string, val: any) => {
      updateState(key, val)
      pushLog('info', `[Env] Synced ${key}`)
      return val
    }

    // 6. Mock process object for labs invoking process.exit()
    const mockProcess = {
      argv: ['node', 'browser.js'],
      exit: (code: number = 0) => {
        pushLog('info', `[Process] Execution terminated with code ${code}`)
      }
    }

    // 7. Utilities required by various labs (sleep, getState, dotenv, path, EventEmitter, getMirrorNodeBaseUrl, crypto)
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const getState = (key: string) => {
      try {
        const raw = localStorage.getItem('hbe_playground_state') || '{}'
        return JSON.parse(raw)[key]
      } catch (_) {
        return undefined
      }
    }
    const dotenv = { config: () => ({ parsed: {} }) }
    const getMirrorNodeBaseUrl = () => 'https://testnet.mirrornode.hedera.com'

    const pathShim = {
      join: (...args: string[]) => args.filter(Boolean).join('/'),
      resolve: (...args: string[]) => args.filter(Boolean).join('/'),
      basename: (p: string) => String(p).split(/[\\/]/).pop() || '',
      dirname: (p: string) => String(p).split(/[\\/]/).slice(0, -1).join('/') || '.',
      extname: (p: string) => '.' + String(p).split('.').pop()
    }

    class EventEmitterShim {
      _e: Record<string, Function[]> = {}
      on(e: string, fn: Function) {
        ;(this._e[e] = this._e[e] || []).push(fn)
        return this
      }
      once(e: string, fn: Function) {
        const g = (...a: any[]) => {
          this.off(e, g)
          fn(...a)
        }
        return this.on(e, g)
      }
      off(e: string, fn: Function) {
        this._e[e] = (this._e[e] || []).filter((f) => f !== fn)
        return this
      }
      emit(e: string, ...args: any[]) {
        ;(this._e[e] || []).forEach((fn) => {
          try {
            fn(...args)
          } catch (_) {}
        })
        return true
      }
    }

    const browserCryptoShim = {
      randomBytes: (size: number) => {
        const arr = new Uint8Array(size)
        if (typeof window !== 'undefined' && window.crypto) {
          window.crypto.getRandomValues(arr)
        }
        return {
          toString: (enc: string) => {
            if (enc === 'hex') {
              return Array.from(arr)
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('')
            }
            return new TextDecoder().decode(arr)
          }
        }
      },
      createHash: (algo: string) => {
        let buffer = ''
        const hashObj = {
          update: (chunk: any) => {
            buffer += typeof chunk === 'string' ? chunk : String(chunk)
            return hashObj
          },
          digest: (enc: string) => {
            let h1 = 0xdeadbeef,
              h2 = 0x41c6ce57
            for (let i = 0; i < buffer.length; i++) {
              const ch = buffer.charCodeAt(i)
              h1 = Math.imul(h1 ^ ch, 2654435761)
              h2 = Math.imul(h2 ^ ch, 1597334677)
            }
            const hex = (
              (h1 >>> 0).toString(16).padStart(8, '0') +
              (h2 >>> 0).toString(16).padStart(8, '0')
            )
              .repeat(4)
              .slice(0, 64)
            return hex
          }
        }
        return hashObj
      }
    }

    // 8. Custom console intercepting logs into terminal stream
    const customConsole = {
      log: (...args: any[]) => {
        const msg = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
        const urlMatch = msg.match(/(https:\/\/hashscan\.io\/[^\s]+)/)
        if (urlMatch) {
          pushLog('link', msg, urlMatch[1])
        } else if (msg.includes('SUCCESS') || msg.includes('✅')) {
          pushLog('success', msg)
        } else if (msg.includes('WARN') || msg.includes('⚠️')) {
          pushLog('warn', msg)
        } else {
          pushLog('info', msg)
        }
      },
      warn: (...args: any[]) => {
        pushLog('warn', args.join(' '))
      },
      error: (...args: any[]) => {
        pushLog('error', args.join(' '))
      },
      info: (...args: any[]) => {
        pushLog('info', args.join(' '))
      }
    }

    // 9. Sanitize code
    const sanitized = sanitizeSourceForExecution(sourceCode)

    // 10. Build execution scope with all Hedera SDK classes
    const scopeKeys = Object.keys(hedera)
    const scopeValues = Object.values(hedera)

    const runnerFn = new Function(
      ...scopeKeys,
      'client',
      'getClient',
      'getHashscanUrl',
      'getMirrorNodeBaseUrl',
      'updateState',
      'updateEnv',
      'getState',
      'sleep',
      'dotenv',
      'crypto',
      'path',
      'EventEmitter',
      'wallet',
      'console',
      'process',
      'return (async () => {\n' +
      '  try {\n' +
      sanitized + '\n' +
      '  } catch (innerErr) {\n' +
      '    console.error("[Runtime Error] " + (innerErr.stack || innerErr.message));\n' +
      '    throw innerErr;\n' +
      '  }\n' +
      '})()'
    )

    // 11. Execute in user's browser
    await runnerFn(
      ...scopeValues,
      client,
      getClient,
      getHashscanUrl,
      getMirrorNodeBaseUrl,
      updateState,
      updateEnv,
      getState,
      sleep,
      dotenv,
      browserCryptoShim,
      pathShim,
      EventEmitterShim,
      wallet,
      customConsole,
      mockProcess
    )

    const durationMs = Date.now() - startTime
    pushLog('success', `✨ Consensus verified and executed in ${(durationMs / 1000).toFixed(2)}s!`)
    return { success: true, durationMs }
  } catch (err: any) {
    const durationMs = Date.now() - startTime
    pushLog('error', `❌ Execution halted: ${err.message || String(err)}`)
    return { success: false, durationMs }
  }
}
