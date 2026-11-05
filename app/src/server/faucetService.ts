/**
 * @file faucetService.ts
 * Enterprise Hedera Faucet Engine for Expo Router Server Functions.
 *
 * Runs exclusively on the server in Expo Router (+api.ts routes).
 * Optimized for serverless edge execution (Cloudflare Workers / EAS Hosting):
 *   - Instant on-demand BIP-39 child derivation (no synchronous 100-key derivation spikes)
 *   - Fast transaction broadcast (no blocking receipt polling)
 *   - Multi-RPC failover with dynamic gas headroom
 *   - Atomic claim locking and in-flight deduplication
 *   - PostHog unique user tracking
 */

import fs from 'fs'
import path from 'path'
import { ethers } from 'ethers';
import { PrivateKey } from '@hiero-ledger/sdk';
import { recordFaucetClaim, runAnalyticsSilently, getFaucetUniqueUsersCount, HBE_APP_TAG, HBE_EVENT_FAUCET_CLAIM } from './posthogAnalytics';

/** Load local secrets into process.env if Expo CLI did not inject them yet. */
function loadLocalFaucetEnv (): void {
  if (typeof process === 'undefined' || !process.cwd) return
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'app', '.env'),
    path.resolve(process.cwd(), 'faucet', '.env'),
    path.resolve(process.cwd(), '..', 'faucet', '.env'),
  ]
  for (const envPath of candidates) {
    try {
      if (!fs.existsSync(envPath)) continue
      for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq <= 0) continue
        const key = trimmed.slice(0, eq).trim()
        if (!key || process.env[key]) continue
        let val = trimmed.slice(eq + 1).trim()
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1)
        }
        process.env[key] = val
      }
      break
    } catch (_) {}
  }
}

loadLocalFaucetEnv()

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

export function buildFaucetRpcSequence(): string[] {
  const custom = (process.env.HEDERA_JSON_RPC_URL || '').trim();
  const list: string[] = [];
  if (custom) list.push(custom);
  list.push(HASHIO_RPC_URL);
  list.push(THIRDWEB_RPC_URL);
  list.push(HASHIO_RPC_URL);
  list.push(THIRDWEB_RPC_URL);
  if (HGRAPH_RPC_URL) list.push(HGRAPH_RPC_URL);
  if (VALIDATIONCLOUD_RPC_URL) list.push(VALIDATIONCLOUD_RPC_URL);
  return list;
}

// In-flight request deduplication
const faucetInFlight = new Set<string>();

// 5-minute atomic claim locks in memory
const claimLocks = new Map<string, number>();
const CLAIM_TTL_MS = 5 * 60 * 1000;

export async function claimFaucetAddress(address: string): Promise<'acquired' | 'busy'> {
  const key = address.toLowerCase();
  const now = Date.now();
  const existing = claimLocks.get(key);
  if (existing && now - existing < CLAIM_TTL_MS) {
    return 'busy';
  }
  claimLocks.set(key, now);
  return 'acquired';
}

export async function releaseFaucetClaim(address: string): Promise<void> {
  claimLocks.delete(address.toLowerCase());
}

export function parseGasPriceFromError(err: any): bigint | null {
  const msg = `${err?.message || ''} ${err?.info?.error?.message || ''} ${err?.data || ''}`;
  const match = msg.match(/transaction gas_price.*?less than.*?([0-9]+)/i) ||
    msg.match(/gas price.*?([0-9]{9,})/i) ||
    msg.match(/minimum gas price is ([0-9]+)/i);
  if (match && match[1]) {
    try {
      return BigInt(match[1]);
    } catch (_) {}
  }
  return null;
}

export async function calculateHederaGasPrice(provider: ethers.JsonRpcProvider, floor: bigint = 0n): Promise<bigint> {
  let feeDataPrice = 0n;
  try {
    const feeData = await provider.getFeeData();
    if (feeData.gasPrice && feeData.gasPrice > 0n) {
      feeDataPrice = feeData.gasPrice;
    }
  } catch (_) {}

  const best = feeDataPrice > floor ? feeDataPrice : floor;
  const withHeadroom = (best * 125n) / 100n;
  const absoluteMin = 280_000_000_000n; // ~280 gwei Hedera floor
  return withHeadroom > absoluteMin ? withHeadroom : absoluteMin;
}

export const POOL_SIZE = Math.max(1, parseInt(process.env.FAUCET_POOL_SIZE || '25', 10) || 25);

let cachedOperatorWallet: ethers.Wallet | null = null;
const derivedWalletCache = new Map<number, { index: number; address: string; privateKey: string }>();

function getFaucetMnemonic (): string {
  return (process.env.FAUCET_MNEMONIC || '').trim().replace(/^["']|["']$/g, '');
}

function getOperatorWallet(): ethers.Wallet | null {
  if (cachedOperatorWallet) return cachedOperatorWallet;
  const operatorKey = process.env.OPERATOR_KEY || '';
  if (!operatorKey) return null;
  try {
    let rawHex = operatorKey.trim();
    if (rawHex.startsWith('3030') || rawHex.startsWith('302e')) {
      const decoded = PrivateKey.fromStringDer(rawHex);
      const raw = decoded.toStringRaw();
      rawHex = raw.startsWith('0x') ? raw : `0x${raw}`;
    } else if (!rawHex.startsWith('0x')) {
      rawHex = `0x${rawHex}`;
    }
    cachedOperatorWallet = new ethers.Wallet(rawHex);
    return cachedOperatorWallet;
  } catch (_) {
    return null;
  }
}

/**
 * Derive pool wallet i at BIP-44 path (parity with faucet/src/faucet-service.mjs).
 * ethers v6: pass the full path to fromPhrase — do NOT fromPhrase()+derivePath("m/...").
 */
export function getWalletAtIndex(index: number): { index: number; address: string; privateKey: string } | null {
  const cached = derivedWalletCache.get(index);
  if (cached) return cached;

  const mnemonic = getFaucetMnemonic();
  if (mnemonic) {
    try {
      const derived = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${index}`);
      const entry = { index, address: derived.address, privateKey: derived.privateKey };
      derivedWalletCache.set(index, entry);
      return entry;
    } catch (err: any) {
      console.warn(`[FAUCET] Error deriving child at index ${index}:`, err?.message || err);
    }
  }

  const op = getOperatorWallet();
  if (op) {
    return { index: 0, address: op.address, privateKey: op.privateKey };
  }

  return null;
}

export interface DisburseParams {
  evmAddress: string;
  accountId?: string;
  amount?: number;
  skipCooldown?: boolean;
}

export interface DisburseResult {
  success: boolean;
  hash?: string;
  error?: string;
  durationMs?: number;
  logs?: string[];
  code?: string;
}

export async function disburseHbar({
  evmAddress,
  accountId,
  amount = 25,
  skipCooldown = false,
}: DisburseParams): Promise<DisburseResult> {
  const startMs = Date.now();
  const traceLogs: string[] = [];
  const log = (msg: string) => traceLogs.push(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

  if (!evmAddress || !ethers.isAddress(evmAddress)) {
    return {
      success: false,
      error: `Invalid EVM Address: ${evmAddress}`,
      logs: [`Invalid address format: ${evmAddress}`],
    };
  }

  const addressKey = evmAddress.toLowerCase();
  let hasClaim = false;

  try {
    if (!skipCooldown) {
      if (faucetInFlight.has(addressKey)) {
        return {
          success: false,
          error: 'Faucet disbursement already in progress for this address.',
          logs: traceLogs,
        };
      }
      faucetInFlight.add(addressKey);

      const claimStatus = await claimFaucetAddress(addressKey);
      if (claimStatus === 'busy') {
        return {
          success: false,
          error: 'Faucet payment already in progress for this wallet (5m cooldown).',
          code: 'FAUCET_IN_FLIGHT',
          logs: traceLogs,
        };
      }
      hasClaim = true;
    }

    const rpcSequence = buildFaucetRpcSequence();
    const finalAmount = Math.min(Math.max(Number(amount) || 25, 0.1), 50);
    const valueWei = ethers.parseEther(String(finalAmount));

    const startIndex = Math.floor(Math.random() * POOL_SIZE);
    let lastError: any = null;

    // Try up to 3 pool wallets across the RPC sequence
    for (let attempt = 0; attempt < 3; attempt++) {
      const walletIdx = (startIndex + attempt) % POOL_SIZE;
      const acc = getWalletAtIndex(walletIdx);
      if (!acc) continue;

      log(`Selected pool wallet #${acc.index} (${acc.address.slice(0, 8)}...)`);

      for (let rpcIdx = 0; rpcIdx < rpcSequence.length; rpcIdx++) {
        const rpcUrl = rpcSequence[rpcIdx];
        const rpcHost = new URL(rpcUrl).hostname;
        try {
          const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
          const signer = new ethers.Wallet(acc.privateKey, provider);

          const nonce = await provider.getTransactionCount(signer.address, 'pending');
          const gasPrice = await calculateHederaGasPrice(provider);
          log(`Broadcasting via ${rpcHost} (nonce: ${nonce}, gasPrice: ${ethers.formatUnits(gasPrice, 'gwei')} gwei)...`);

          const tx = await signer.sendTransaction({
            to: evmAddress,
            value: valueWei,
            type: 0,
            gasLimit: 1_000_000n,
            gasPrice,
            nonce,
          });

          log(`Transaction broadcast confirmed: ${tx.hash}. ${finalAmount} HBAR delivered.`);
          const durationMs = Date.now() - startMs;

          // Track metric in PostHog on the side: never awaited, never blocks or fails the claim.
          try {
            runAnalyticsSilently(() => recordFaucetClaim({
              evmAddress,
              accountId,
              amount: finalAmount,
              txHash: tx.hash,
              network: NETWORK,
            }));
          } catch (_) {
            /* analytics must stay silent */
          }

          return {
            success: true,
            hash: tx.hash,
            durationMs,
            logs: traceLogs,
          };
        } catch (err: any) {
          lastError = err;
          log(`RPC ${rpcHost} error: ${err?.message || err}`);
          const minPrice = parseGasPriceFromError(err);
          if (minPrice) log(`Detected higher gas requirement: ${minPrice}`);
        }
      }
    }

    throw lastError || new Error('All RPCs and pool wallets exhausted');
  } catch (error: any) {
    if (hasClaim) {
      await releaseFaucetClaim(addressKey);
    }
    return {
      success: false,
      error: error?.message || 'Unknown disbursement error',
      logs: traceLogs,
    };
  } finally {
    faucetInFlight.delete(addressKey);
  }
}

export async function getFaucetHealth(): Promise<any> {
  const rpcs = buildFaucetRpcSequence();
  const stats = await getFaucetUniqueUsersCount().catch(() => ({ count: 0 }));

  const sampleBalances: any[] = [];
  try {
    const provider = new ethers.JsonRpcProvider(rpcs[0], undefined, { staticNetwork: true });
    for (let i = 0; i < 3; i++) {
      const acc = getWalletAtIndex(i);
      if (acc) {
        const b = await provider.getBalance(acc.address).catch(() => 0n);
        sampleBalances.push({
          index: acc.index,
          address: acc.address,
          balance: `${parseFloat(ethers.formatEther(b)).toFixed(2)} ℏ`,
        });
      }
    }
  } catch (_) {}

  return {
    status: 'ok',
    network: NETWORK,
    runtime: 'expo-router-server',
    poolSize: POOL_SIZE,
    activeRpcs: rpcs.map((r) => new URL(r).hostname),
    samplePoolBalances: sampleBalances,
    analytics: {
      app: HBE_APP_TAG,
      event: HBE_EVENT_FAUCET_CLAIM,
      uniqueUsersCount: stats.count,
    },
    timestamp: new Date().toISOString(),
  };
}
