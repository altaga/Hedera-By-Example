/**
 * @file recover-faucets-action.mjs
 * Automated Faucet Recovery Runner for CI/CD and GitHub Actions.
 * Incorporates latest resilient multi-RPC rotation, idempotent signed-raw broadcasts,
 * receipt polling, and gas price estimation directly from Hedera for Dummies (HFD).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { PrivateKey } from '@hiero-ledger/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load local env if present
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Map ACTION_* variables or standard variables
const OPERATOR_ID = process.env.ACTION_OPERATOR_ID || process.env.OPERATOR_ID;
const OPERATOR_KEY = process.env.ACTION_OPERATOR_KEY || process.env.OPERATOR_KEY;
// Strip surrounding quotes/whitespace (same cleanup the app applies), so a quoted secret still works.
const FAUCET_MNEMONIC = (process.env.ACTION_FAUCET_MNEMONIC || process.env.FAUCET_MNEMONIC || '').trim().replace(/^["']|["']$/g, '');
const NETWORK = process.env.ACTION_HEDERA_NETWORK || process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet';
const CHAIN_ID = NETWORK === 'mainnet' ? 295 : 296;

const RPC_URLS = [
  NETWORK === 'mainnet' ? 'https://mainnet.hashio.io/api' : 'https://testnet.hashio.io/api',
  `https://${CHAIN_ID}.rpc.thirdweb.com`,
];

const RPC_REQUEST_TIMEOUT_MS = 15000;
const RPC_ROUNDS = 2;
const RPC_BACKOFF_MS = 1000;
const RECEIPT_WAIT_MS = 90000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rpcProviders = RPC_URLS.map((url) => {
  const req = new ethers.FetchRequest(url);
  req.timeout = RPC_REQUEST_TIMEOUT_MS;
  return new ethers.JsonRpcProvider(req, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
});
let rpcCursor = 0;

function isTransientRpcError(e) {
  const code = e && e.code;
  if (['SERVER_ERROR', 'TIMEOUT', 'NETWORK_ERROR'].includes(code)) return true;
  return /\b(429|502|503|504)\b|bad gateway|gateway time|unavailable|timeout|timed out|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|rate limit|too many requests/i.test(
    String((e && e.message) || e)
  );
}

async function withRpc(fn) {
  let lastErr;
  const attempts = rpcProviders.length * RPC_ROUNDS;
  for (let n = 0; n < attempts; n++) {
    const idx = rpcCursor % rpcProviders.length;
    try {
      return await fn(rpcProviders[idx]);
    } catch (e) {
      if (!isTransientRpcError(e)) throw e;
      lastErr = e;
      rpcCursor++;
      console.log(
        `      ⚠️ RPC ${new URL(RPC_URLS[idx]).hostname} failed (${String(e.code || e.message).slice(0, 80)}); switching to ${new URL(RPC_URLS[rpcCursor % rpcProviders.length]).hostname}`
      );
      await sleep(RPC_BACKOFF_MS * (1 + Math.floor(n / rpcProviders.length)));
    }
  }
  throw lastErr;
}

const resilientProvider = {
  getBalance: (a) => withRpc((p) => p.getBalance(a)),
  getTransactionCount: (a, tag) => withRpc((p) => p.getTransactionCount(a, tag)),
  send: (m, params) => withRpc((p) => p.send(m, params)),
  getBlock: (t) => withRpc((p) => p.getBlock(t)),
};

async function sendSignedAndWait(raw) {
  const hash = ethers.keccak256(raw);
  try {
    await withRpc((p) => p.broadcastTransaction(raw));
  } catch (e) {
    if (!/already (known|exist|submitted|imported)|duplicate|nonce too low|ALREADY_EXISTS/i.test(String(e.message || e))) {
      throw e;
    }
  }
  const deadline = Date.now() + RECEIPT_WAIT_MS;
  while (Date.now() < deadline) {
    const receipt = await withRpc((p) => p.getTransactionReceipt(hash));
    if (receipt) {
      if (receipt.status !== 1) throw new Error(`Transaction ${hash} reverted`);
      return hash;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for receipt of ${hash} (RPC timeout)`);
}

async function hederaGasPrice(floor = 0n) {
  let best = floor;
  for (let read = 0; read < 3; read++) {
    try {
      const [gp, block] = await Promise.all([
        resilientProvider.send('eth_gasPrice', []),
        resilientProvider.getBlock('latest'),
      ]);
      for (const v of [BigInt(gp), block?.baseFeePerGas ?? 0n]) {
        if (v > best) best = v;
      }
    } catch (_) {}
    if (read < 2) await sleep(400);
  }
  if (best === 0n) best = 20000000000n; // fallback 20 gwei
  return (best * 125n) / 100n;
}

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    minAmount: 100,
    numberFaucets: parseInt(process.env.FAUCET_POOL_SIZE || '25', 10) || 25,
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--min=')) opts.minAmount = parseFloat(arg.slice('--min='.length));
    else if (arg.startsWith('--count=')) opts.numberFaucets = parseInt(arg.slice('--count='.length), 10);
  }
  return opts;
}

function nowIso() {
  return new Date().toISOString().replace(/\..+/, '').replace('T', ' ');
}

function writeLog(lines) {
  const logsDir = path.resolve(__dirname, '..', 'logs');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
  } catch (_) {}
  const date = new Date().toISOString().slice(0, 10);
  const logPath = path.join(logsDir, `recover-faucet-${date}.log`);
  const header = `\n========== ${nowIso()} (run ${process.env.GITHUB_RUN_ID || 'local'}) ==========\n`;
  fs.appendFileSync(logPath, header + lines.join('\n') + '\n');
  return logPath;
}

async function main() {
  const opts = parseArgs(process.argv);
  const startedAtMs = Date.now();
  const startedAt = nowIso();
  const logLines = [];

  const captureLog = (msg) => {
    const line = `[${nowIso()}] ${msg}`;
    console.log(line);
    logLines.push(line);
  };

  captureLog(`=== Hedera Faucet Recovery Engine (Latest HFD Resilience) ===`);
  captureLog(`Network:      ${NETWORK.toUpperCase()}`);
  captureLog(`Chain ID:     ${CHAIN_ID}`);
  captureLog(`Operator ID:  ${OPERATOR_ID || '(not provided)'}`);
  captureLog(`Target/Wallet:${opts.minAmount} ℏ`);
  captureLog(`Pool Wallets: ${opts.numberFaucets}`);
  captureLog(`Dry Run:      ${opts.dryRun}`);

  if (!OPERATOR_KEY) {
    captureLog(`[FATAL] Missing required environment variable: OPERATOR_KEY (or ACTION_OPERATOR_KEY)`);
    writeLog(logLines);
    process.exit(2);
  }
  if (!FAUCET_MNEMONIC) {
    captureLog(`[FATAL] Missing required environment variable: FAUCET_MNEMONIC (or ACTION_FAUCET_MNEMONIC)`);
    writeLog(logLines);
    process.exit(2);
  }

  let rawOpKey;
  try {
    const decoded = PrivateKey.fromStringDer(OPERATOR_KEY);
    rawOpKey = decoded.toStringRaw().startsWith('0x')
      ? decoded.toStringRaw()
      : `0x${decoded.toStringRaw()}`;
  } catch {
    rawOpKey = OPERATOR_KEY.startsWith('0x') ? OPERATOR_KEY : `0x${OPERATOR_KEY}`;
  }

  const operatorWallet = new ethers.Wallet(rawOpKey);
  captureLog(`Operator EVM: ${operatorWallet.address}`);

  let operatorBalStart = 0;
  try {
    const bal = await resilientProvider.getBalance(operatorWallet.address);
    operatorBalStart = parseFloat(ethers.formatUnits(bal, 18));
    captureLog(`Operator Balance: ${operatorBalStart.toFixed(2)} ℏ\n`);
  } catch (e) {
    captureLog(`Could not fetch operator balance: ${e.message}\n`);
  }

  let funded = 0;
  let skipped = 0;
  let failed = 0;
  let totalHbarSpent = 0;
  const maxRetriesPerWallet = 3;

  // Wallet #0 is the treasury; the user pool is indices 1..N.
  for (let i = 1; i <= opts.numberFaucets; i++) {
    const derivationPath = `m/44'/60'/0'/0/${i}`;
    const derivedWallet = ethers.HDNodeWallet.fromPhrase(FAUCET_MNEMONIC, undefined, derivationPath);
    const target = derivedWallet.address;

    let balance = 0n;
    try {
      balance = await resilientProvider.getBalance(target);
    } catch (e) {
      captureLog(`[#${i}/${opts.numberFaucets}] Warning: failed to fetch balance for ${target}: ${e.message}`);
    }

    const targetWei = ethers.parseUnits(opts.minAmount.toString(), 18);
    const topUpWei = targetWei > balance ? targetWei - balance : 0n;
    const currentHbar = parseFloat(ethers.formatUnits(balance, 18));
    const topUpHbar = parseFloat(ethers.formatUnits(topUpWei, 18));

    if (topUpWei === 0n) {
      captureLog(`[#${i}/${opts.numberFaucets}] SKIP: ${target.slice(0, 10)}... has ${currentHbar.toFixed(2)} ℏ (>= ${opts.minAmount} ℏ)`);
      skipped++;
      continue;
    }

    if (opts.dryRun) {
      captureLog(`[#${i}/${opts.numberFaucets}] DRY-RUN: ${target.slice(0, 10)}... has ${currentHbar.toFixed(2)} ℏ — would send ${topUpHbar.toFixed(2)} ℏ`);
      skipped++;
      continue;
    }

    captureLog(`[#${i}/${opts.numberFaucets}] FUNDING: ${target.slice(0, 10)}... has ${currentHbar.toFixed(2)} ℏ — sending ${topUpHbar.toFixed(2)} ℏ`);

    let attempts = 0;
    let success = false;

    while (attempts < maxRetriesPerWallet && !success) {
      attempts++;
      try {
        const nonce = await resilientProvider.getTransactionCount(operatorWallet.address, 'pending');
        const gasPrice = await hederaGasPrice();

        const raw = await operatorWallet.signTransaction({
          type: 0,
          chainId: CHAIN_ID,
          to: target,
          value: topUpWei,
          gasLimit: 1_000_000,
          gasPrice,
          nonce,
        });

        const txHash = await sendSignedAndWait(raw);
        captureLog(`      ✅ Success! Hash: ${txHash}`);
        totalHbarSpent += topUpHbar;
        funded++;
        success = true;
        await sleep(1500);
      } catch (err) {
        captureLog(`      ⚠️ Attempt ${attempts}/${maxRetriesPerWallet} failed: ${err.message}`);
        await sleep(3000);
      }
    }

    if (!success) {
      captureLog(`      ❌ Giving up on ${target} after ${maxRetriesPerWallet} attempts.`);
      failed++;
    }
  }

  const durationSec = ((Date.now() - startedAtMs) / 1000).toFixed(1);
  captureLog(`\n================ Summary ================`);
  captureLog(`Funded:      ${funded}`);
  captureLog(`Skipped:     ${skipped}`);
  captureLog(`Failed:      ${failed}`);
  captureLog(`Total Spent: ${totalHbarSpent.toFixed(2)} ℏ`);
  captureLog(`Duration:    ${durationSec}s`);
  captureLog(`=========================================\n`);

  const logPath = writeLog(logLines);

  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### 💧 Hedera Faucet Pool Recovery Report\n\n` +
          `- **Started**: ${startedAt}\n` +
          `- **Network**: \`${NETWORK.toUpperCase()}\`\n` +
          `- **Operator**: \`${OPERATOR_ID || operatorWallet.address}\`\n` +
          `- **Target per Wallet**: \`${opts.minAmount} ℏ\`\n` +
          `- **Wallets Funded**: **${funded}**\n` +
          `- **Wallets Skipped (Healthy)**: **${skipped}**\n` +
          `- **Wallets Failed**: **${failed}**\n` +
          `- **Total HBAR Disbursed**: **${totalHbarSpent.toFixed(2)} ℏ**\n` +
          `- **Duration**: \`${durationSec}s\`\n` +
          `- **Dry-Run**: \`${opts.dryRun}\`\n` +
          `- **Log File**: \`${logPath}\`\n`
      );
    } catch (_) {}
  }

  if (failed > 0) {
    console.error(`::error::Recovery finished with failures (failed=${failed}, funded=${funded}). See log.`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
