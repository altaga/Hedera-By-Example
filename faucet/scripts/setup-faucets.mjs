/**
 * @file setup-faucets.mjs
 * Generates and funds 100 round-robin faucet accounts from FAUCET_MNEMONIC
 * using the Master Operator Treasury.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { PrivateKey } from '@hiero-ledger/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const NETWORK = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet';
const RPC_URL = NETWORK === 'mainnet' ? 'https://mainnet.hashio.io/api' : 'https://testnet.hashio.io/api';
const MIRROR_NODE_URL = NETWORK === 'mainnet'
  ? 'https://mainnet-public.mirrornode.hedera.com/api/v1'
  : 'https://testnet.mirrornode.hedera.com/api/v1';

const FAUCET_MNEMONIC = (process.env.FAUCET_MNEMONIC || '').trim().replace(/^["']|["']$/g, '');
const OPERATOR_KEY = process.env.OPERATOR_KEY;

if (!FAUCET_MNEMONIC) {
  console.error('❌ FAUCET_MNEMONIC is not defined in faucet/.env');
  process.exit(1);
}
if (!OPERATOR_KEY) {
  console.error('❌ OPERATOR_KEY is not defined in faucet/.env');
  process.exit(1);
}

const POOL_SIZE = parseInt(process.env.FAUCET_POOL_SIZE || '25', 10);
const TARGET_HBAR = parseFloat(process.env.TARGET_HBAR_PER_WALLET || '100');
const MAX_RETRIES = 3;

async function queryAccountId(publicKeyRaw) {
  try {
    const res = await fetch(`${MIRROR_NODE_URL}/accounts?account.publickey=${publicKeyRaw}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.accounts?.[0]?.account || null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`\n======================================================`);
  console.log(`🛠️  Hedera Faucet Pool Generator & Top-Up`);
  console.log(`🌐 Network: ${NETWORK.toUpperCase()}`);
  console.log(`👥 Target Pool Size: ${POOL_SIZE} wallets`);
  console.log(`🎯 Target Balance: ${TARGET_HBAR} ℏ per wallet`);
  console.log(`======================================================\n`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  let rawOpKey;
  try {
    const decoded = PrivateKey.fromStringDer(OPERATOR_KEY);
    rawOpKey = decoded.toStringRaw().startsWith('0x') ? decoded.toStringRaw() : `0x${decoded.toStringRaw()}`;
  } catch {
    rawOpKey = OPERATOR_KEY.startsWith('0x') ? OPERATOR_KEY : `0x${OPERATOR_KEY}`;
  }

  const opWallet = new ethers.Wallet(rawOpKey, provider);
  const opBal = await provider.getBalance(opWallet.address);
  console.log(`Operator Address: ${opWallet.address}`);
  console.log(`Operator Balance: ${parseFloat(ethers.formatUnits(opBal, 18)).toFixed(2)} ℏ\n`);

  const accounts = [];
  let fundedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let totalSpentHbar = 0;

  for (let i = 0; i < POOL_SIZE; i++) {
    const pathDerivation = `m/44'/60'/0'/0/${i}`;
    const derived = ethers.HDNodeWallet.fromPhrase(FAUCET_MNEMONIC, undefined, pathDerivation);

    accounts.push({
      index: i,
      address: derived.address,
      privateKey: derived.privateKey,
    });

    let balance = 0n;
    try {
      balance = await provider.getBalance(derived.address);
    } catch (e) {
      console.warn(`[${i + 1}/${POOL_SIZE}] Could not fetch balance for ${derived.address}: ${e.message}`);
    }

    const currentHbar = parseFloat(ethers.formatUnits(balance, 18));
    if (currentHbar >= TARGET_HBAR) {
      console.log(`[${i + 1}/${POOL_SIZE}] ✅ ${derived.address.slice(0, 10)}... has ${currentHbar.toFixed(2)} ℏ (>= ${TARGET_HBAR} ℏ) - Skip`);
      skippedCount++;
      continue;
    }

    const topUpHbar = TARGET_HBAR - currentHbar;
    const topUpWei = ethers.parseUnits(topUpHbar.toFixed(4), 18);

    console.log(`[${i + 1}/${POOL_SIZE}] ⚡ Funding ${derived.address.slice(0, 10)}... (+${topUpHbar.toFixed(2)} ℏ)`);

    let attempts = 0;
    let success = false;

    while (attempts < MAX_RETRIES && !success) {
      attempts++;
      try {
        const nonce = await provider.getTransactionCount(opWallet.address, 'pending');
        const tx = await opWallet.sendTransaction({
          to: derived.address,
          value: topUpWei,
          gasLimit: 1_000_000,
          nonce,
        });
        await tx.wait(1);
        console.log(`      🎉 Tx confirmed: ${tx.hash}`);
        totalSpentHbar += topUpHbar;
        fundedCount++;
        success = true;
        await new Promise((r) => setTimeout(r, 1500));
      } catch (err) {
        console.warn(`      ⚠️ Attempt ${attempts}/${MAX_RETRIES} failed: ${err.message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    if (!success) {
      console.error(`      ❌ Failed to fund wallet #${i} after ${MAX_RETRIES} attempts.`);
      failedCount++;
    }
  }

  // Save pool accounts to faucet-accounts.json
  const outPath = path.resolve(__dirname, '..', 'faucet-accounts.json');
  fs.writeFileSync(outPath, JSON.stringify(accounts, null, 2));
  console.log(`\n💾 Saved ${accounts.length} accounts to ${outPath}`);

  console.log(`\n------------------ Summary ------------------`);
  console.log(`Funded:  ${fundedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Failed:  ${failedCount}`);
  console.log(`Total HBAR Disbursed: ${totalSpentHbar.toFixed(2)} ℏ`);
  console.log(`---------------------------------------------\n`);
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
