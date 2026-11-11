/**
 * @file faucet-service.mjs
 * Enterprise Hedera Faucet Service engine.
 * Handles round-robin pool rotation, multi-RPC failover, nonce collision retries,
 * deduplication, and on-chain Mirror Node validations.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { PrivateKey } from '@hiero-ledger/sdk';
import {
  classifyFaucetError,
  faucetRetryDecision,
  MAX_NONCE_RETRIES_PER_WALLET,
  applyNewWalletAction,
} from './faucet-pool.mjs';
import { claimFaucetAddress, releaseFaucetClaim } from './faucet-claims.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment configuration
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

export const NETWORK = process.env.NEXT_PUBLIC_HEDERA_NETWORK || process.env.NETWORK || 'testnet';

export const MIRROR_NODE_URL =
  NETWORK === 'mainnet'
    ? 'https://mainnet-public.mirrornode.hedera.com/api/v1'
    : 'https://testnet.mirrornode.hedera.com/api/v1';

export const HASHIO_RPC_URL =
  NETWORK === 'mainnet' ? 'https://mainnet.hashio.io/api' : 'https://testnet.hashio.io/api';

export const THIRDWEB_RPC_URL =
  NETWORK === 'mainnet' ? 'https://295.rpc.thirdweb.com' : 'https://296.rpc.thirdweb.com';

const VALIDATIONCLOUD_API_KEY = (process.env.VALIDATIONCLOUD_API_KEY || '').trim();
const HGRAPH_API_KEY = (process.env.HGRAPH_API_KEY || '').trim();

export const VALIDATIONCLOUD_RPC_URL = VALIDATIONCLOUD_API_KEY
  ? `https://${NETWORK === 'mainnet' ? 'mainnet' : 'testnet'}.hedera.validationcloud.io/v1/${VALIDATIONCLOUD_API_KEY}`
  : null;

export const HGRAPH_RPC_URL = HGRAPH_API_KEY
  ? `https://${NETWORK === 'mainnet' ? 'mainnet' : 'testnet'}.hedera.api.hgraph.io/rpc`
  : null;

/**
 * Calculates resilient Hedera gas price with 125% headroom and floor protection.
 * Prevents Hashio -32009 underpriced transaction rejections.
 * @param {ethers.JsonRpcProvider} provider
 * @param {bigint} [floor=0n]
 * @returns {Promise<bigint>}
 */
export async function hederaGasPrice(provider, floor = 0n) {
  let best = floor;
  for (let read = 0; read < 2; read++) {
    try {
      const [gp, block] = await Promise.all([
        provider.send('eth_gasPrice', []),
        provider.getBlock('latest'),
      ]);
      for (const v of [BigInt(gp), block?.baseFeePerGas ?? 0n]) {
        if (v > best) best = v;
      }
    } catch (_) {}
    if (read < 1) await new Promise((r) => setTimeout(r, 250));
  }
  if (best === 0n) best = 20000000000n; // fallback 20 gwei
  return (best * 125n) / 100n;
}

/**
 * Extracts minimum gas price from relay error response if reported.
 * Example: "Gas price '218' is below configured minimum gas price '1140000000000'"
 * @param {unknown} error
 * @returns {bigint}
 */
export function minGasPriceFromError(error) {
  const m = String(error?.message || error).match(/minimum gas price '(\d+)'/i);
  return m ? BigInt(m[1]) : 0n;
}

/**
 * Builds the prioritized multi-RPC sequence with fallbacks.
 * @returns {string[]}
 */
export function buildFaucetRpcSequence() {
  const sequence = [
    HASHIO_RPC_URL,
    THIRDWEB_RPC_URL,
    HASHIO_RPC_URL,
    THIRDWEB_RPC_URL,
  ];
  if (HGRAPH_RPC_URL) sequence.push(HGRAPH_RPC_URL);
  if (VALIDATIONCLOUD_RPC_URL) sequence.push(VALIDATIONCLOUD_RPC_URL);
  if (HGRAPH_RPC_URL) sequence.push(HGRAPH_RPC_URL);
  if (VALIDATIONCLOUD_RPC_URL) sequence.push(VALIDATIONCLOUD_RPC_URL);
  return sequence;
}

/**
 * Creates an ethers JsonRpcProvider with optional authentication headers.
 * @param {string} rpcUrl
 * @returns {ethers.JsonRpcProvider}
 */
export function createJsonRpcProvider(rpcUrl) {
  if (rpcUrl && rpcUrl.includes('hgraph.io') && HGRAPH_API_KEY) {
    const req = new ethers.FetchRequest(rpcUrl);
    req.setHeader('Authorization', `Bearer ${HGRAPH_API_KEY}`);
    return new ethers.JsonRpcProvider(req);
  }
  return new ethers.JsonRpcProvider(rpcUrl);
}

let cachedFaucetAccounts = null;

/**
 * Loads the faucet pool accounts from disk or derives them deterministically.
 * @returns {Promise<Array<{ index: number, address: string, privateKey: string, accountId?: string }>>}
 */
export async function getFaucetAccounts() {
  if (cachedFaucetAccounts && cachedFaucetAccounts.length > 0) {
    return cachedFaucetAccounts;
  }

  // 1. Try local faucet-accounts.json
  const accountsPath = path.resolve(__dirname, '..', 'faucet-accounts.json');
  if (fs.existsSync(accountsPath)) {
    try {
      const raw = fs.readFileSync(accountsPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedFaucetAccounts = parsed;
        return cachedFaucetAccounts;
      }
    } catch (e) {
      console.warn('[FAUCET_POOL] Failed to read faucet-accounts.json:', e.message);
    }
  }

  // 2. Derive on the fly from FAUCET_MNEMONIC
  const mnemonic = process.env.FAUCET_MNEMONIC;
  if (mnemonic) {
    try {
      const pool = [];
      const poolSize = Math.max(1, parseInt(process.env.FAUCET_POOL_SIZE || '25', 10) || 25);
      for (let i = 0; i < poolSize; i++) {
        const derived = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${i}`);
        pool.push({
          index: i,
          address: derived.address,
          privateKey: derived.privateKey,
        });
      }
      cachedFaucetAccounts = pool;
      return cachedFaucetAccounts;
    } catch (e) {
      console.warn('[FAUCET_POOL] Failed to derive accounts from mnemonic:', e.message);
    }
  }

  return [];
}

/**
 * Checks if an EVM address already has positive balance on Hedera Testnet Mirror Node.
 * @param {string} evmAddress
 * @returns {Promise<boolean>}
 */
export async function isAlreadyFunded(evmAddress) {
  try {
    const res = await fetch(`${MIRROR_NODE_URL}/accounts/${evmAddress}`);
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.balance?.balance && data.balance.balance > 0);
  } catch {
    return false;
  }
}

/**
 * Retrieves Hedera Account ID from Mirror Node for an EVM address or Public Key.
 * @param {string} evmAddress
 * @returns {Promise<string | null>}
 */
export async function getAccountIdFromMirror(evmAddress) {
  try {
    const res = await fetch(`${MIRROR_NODE_URL}/accounts/${evmAddress}`);
    if (res.ok) {
      const data = await res.json();
      return data.account ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** In-flight address lock to prevent concurrent double-spend/re-entrancy */
const faucetInFlight = new Set();

/**
 * Disburses HBAR to a learner wallet with enterprise failover.
 * @param {object} params
 * @param {string} params.evmAddress
 * @param {number} [params.amount=10]
 * @param {boolean} [params.skipCooldown=false]
 * @returns {Promise<{ success: boolean, hash?: string, error?: string, logs: string[] }>}
 */
export async function disburseHbar({
  evmAddress,
  amount = 25,
  skipCooldown = false,
}) {
  const addressKey = (evmAddress || '').toLowerCase().trim();
  const traceLogs = [];
  const startMs = Date.now();

  const logTrace = (msg, isWarn = false) => {
    const entry = `[${new Date().toISOString()}] ${msg}`;
    traceLogs.push(entry);
    if (isWarn) console.warn(entry);
    else console.log(entry);
  };

  if (!ethers.isAddress(addressKey)) {
    return {
      success: false,
      error: `Invalid EVM Address: ${evmAddress}`,
      logs: [`Invalid address format: ${evmAddress}`],
    };
  }

  let hasClaim = false;

  try {
    if (!skipCooldown) {
      if (await isAlreadyFunded(addressKey)) {
        logTrace(`[CHECK] Address ${addressKey} is already funded on Testnet Mirror Node.`);
        return {
          success: false,
          error: 'Account is already funded on Hedera Testnet.',
          cooldown: true,
          logs: traceLogs,
        };
      }

      if (faucetInFlight.has(addressKey)) {
        logTrace(`[CONCURRENCY] Faucet request already in progress for ${addressKey}.`);
        return {
          success: false,
          error: 'Faucet request is already in progress for this address.',
          cooldown: true,
          logs: traceLogs,
        };
      }
      faucetInFlight.add(addressKey);

      // Multi-instance / persistent claim lock
      const claimStatus = await claimFaucetAddress(addressKey);
      if (claimStatus === 'busy') {
        logTrace(`[CLAIM LOCK] Address ${addressKey} is busy with an existing claim.`);
        return {
          success: false,
          error: 'Faucet payment already in progress for this wallet.',
          code: 'FAUCET_IN_FLIGHT',
          cooldown: true,
          logs: traceLogs,
        };
      }
      hasClaim = true;
    }

    const faucetAccounts = await getFaucetAccounts();
    const poolLen = faucetAccounts.length;
    const finalAmount = Math.min(Math.max(parseFloat(String(amount)) || 25, 0.1), 50);

    const rpcSequence = buildFaucetRpcSequence();
    const maxRpcAttempts = rpcSequence.length;

    let wallet = null;
    let tx = null;
    let rpcIndex = 0;
    let nonceRetriesOnWallet = 0;
    let gasFloor = 0n;
    let walletsTried = 1;
    let currentIndex = poolLen > 0 ? Math.floor(Math.random() * poolLen) : 0;

    logTrace(`[START] Disbursement of ${finalAmount} ℏ to ${addressKey} (Pool Size: ${poolLen})`);

    while (rpcIndex < maxRpcAttempts) {
      const rpcUrl = rpcSequence[rpcIndex];
      const provider = createJsonRpcProvider(rpcUrl);
      const rpcHost = new URL(rpcUrl).hostname;

      try {
        const poolAccount = poolLen > 0 ? faucetAccounts[currentIndex] : null;

        if (poolAccount && poolAccount.privateKey) {
          wallet = new ethers.Wallet(poolAccount.privateKey, provider);
          logTrace(`[POOL] Attempt ${rpcIndex + 1}/${maxRpcAttempts}: Wallet #${currentIndex} (${wallet.address.slice(0, 8)}...) via ${rpcHost}`);
        } else {
          // Fallback to Operator Treasury
          const operatorKey = process.env.OPERATOR_KEY;
          if (!operatorKey) {
            throw new Error('Operator credentials missing from environment.');
          }
          let rawHexKey;
          try {
            const decoded = PrivateKey.fromStringDer(operatorKey);
            rawHexKey = decoded.toStringRaw().startsWith('0x')
              ? decoded.toStringRaw()
              : `0x${decoded.toStringRaw()}`;
          } catch {
            rawHexKey = operatorKey.startsWith('0x') ? operatorKey : `0x${operatorKey}`;
          }
          wallet = new ethers.Wallet(rawHexKey, provider);
          logTrace(`[TREASURY FALLBACK] Attempt ${rpcIndex + 1}/${maxRpcAttempts}: Operator treasury (${wallet.address.slice(0, 8)}...) via ${rpcHost}`);
        }

        const nonce = await provider.getTransactionCount(wallet.address, 'pending');
        const gasPrice = await hederaGasPrice(provider, gasFloor);

        tx = await wallet.sendTransaction({
          type: 0,
          to: addressKey,
          value: ethers.parseUnits(finalAmount.toString(), 18),
          gasLimit: 1_000_000,
          gasPrice,
          nonce,
        });

        logTrace(`[BROADCAST] Success on ${rpcHost}! Tx Hash: ${tx.hash}`);
        break;
      } catch (err) {
        const reportedMin = minGasPriceFromError(err);
        if (reportedMin > gasFloor) {
          gasFloor = reportedMin;
          logTrace(`[RETRY] Relay reported minimum gas price of ${reportedMin}; retrying with floor on same wallet...`, true);
          continue;
        }

        const kind = classifyFaucetError(err);
        logTrace(`[ERROR] Attempt ${rpcIndex + 1} failed: ${kind.toUpperCase()} - ${err.message}`, true);

        const decision = faucetRetryDecision({
          kind,
          nonceRetriesOnWallet,
          walletsTried,
          poolSize: poolLen,
          maxAttempts: maxRpcAttempts,
          attempt: rpcIndex,
        });

        if (decision.action === 'retry_same_wallet') {
          nonceRetriesOnWallet = decision.nextNonceRetries;
          const jitter = Math.floor(Math.random() * 400 + 150);
          logTrace(`[RETRY] Nonce conflict on wallet #${currentIndex}. Jitter delay ${jitter}ms (attempt ${nonceRetriesOnWallet}/${MAX_NONCE_RETRIES_PER_WALLET})...`, true);
          await new Promise((r) => setTimeout(r, jitter));
          continue;
        }

        if (decision.action === 'next_wallet') {
          if (poolLen > 0) {
            currentIndex = applyNewWalletAction('next_wallet', currentIndex, poolLen);
            walletsTried += 1;
            nonceRetriesOnWallet = 0;
            logTrace(`[SWITCH] Switching to next pool wallet #${currentIndex}...`, true);
            await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 300 + 100)));
            continue;
          }
        }

        if (decision.action === 'next_rpc_same_wallet') {
          rpcIndex += 1;
          logTrace(`[RPC FAILOVER] Switching to next RPC provider (Slot ${rpcIndex})...`, true);
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        // Default: advance RPC and try next available wallet
        rpcIndex += 1;
        if (poolLen > 1) {
          currentIndex = (currentIndex + 1) % poolLen;
          walletsTried += 1;
          nonceRetriesOnWallet = 0;
        }
      }
    }

    if (!tx) {
      throw new Error(`Faucet exhausted all ${maxRpcAttempts} attempts without broadcasting a transaction.`);
    }

    const durationMs = Date.now() - startMs;
    logTrace(`[COMPLETE] Disbursed in ${durationMs}ms: ${tx.hash}`);

    return {
      success: true,
      hash: tx.hash,
      durationMs,
      logs: traceLogs,
    };
  } catch (error) {
    if (hasClaim) {
      await releaseFaucetClaim(addressKey);
    }
    const durationMs = Date.now() - startMs;
    logTrace(`[FATAL] Faucet disbursement failed after ${durationMs}ms: ${error.message}`, true);
    return {
      success: false,
      error: error.message || 'Unknown disbursement error',
      logs: traceLogs,
    };
  } finally {
    if (addressKey) {
      faucetInFlight.delete(addressKey);
    }
  }
}

/**
 * Health summary of the faucet pool and connectivity.
 * @returns {Promise<object>}
 */
export async function getFaucetHealth() {
  const accounts = await getFaucetAccounts();
  const rpcSequence = buildFaucetRpcSequence();
  const provider = createJsonRpcProvider(rpcSequence[0]);

  let operatorBalance = null;
  let poolSampleBalances = [];

  try {
    const operatorKey = process.env.OPERATOR_KEY;
    if (operatorKey) {
      let rawHexKey;
      try {
        const decoded = PrivateKey.fromStringDer(operatorKey);
        rawHexKey = decoded.toStringRaw().startsWith('0x')
          ? decoded.toStringRaw()
          : `0x${decoded.toStringRaw()}`;
      } catch {
        rawHexKey = operatorKey.startsWith('0x') ? operatorKey : `0x${operatorKey}`;
      }
      const opWallet = new ethers.Wallet(rawHexKey, provider);
      const bal = await provider.getBalance(opWallet.address);
      operatorBalance = `${parseFloat(ethers.formatUnits(bal, 18)).toFixed(2)} ℏ`;
    }
  } catch (e) {
    operatorBalance = `Error: ${e.message}`;
  }

  // Sample check first 3 accounts
  for (let i = 0; i < Math.min(accounts.length, 3); i++) {
    try {
      const bal = await provider.getBalance(accounts[i].address);
      poolSampleBalances.push({
        index: i,
        address: accounts[i].address,
        balance: `${parseFloat(ethers.formatUnits(bal, 18)).toFixed(2)} ℏ`,
      });
    } catch (e) {
      poolSampleBalances.push({
        index: i,
        address: accounts[i].address,
        error: e.message,
      });
    }
  }

  return {
    status: 'ok',
    network: NETWORK,
    poolSize: accounts.length,
    activeRpcs: rpcSequence.map((r) => new URL(r).hostname),
    operatorId: process.env.OPERATOR_ID || 'not-configured',
    operatorBalance,
    samplePoolBalances: poolSampleBalances,
    timestamp: new Date().toISOString(),
  };
}
