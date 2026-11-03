/**
 * @file recover-faucets.mjs
 * Health-check & balance monitor for all 100 faucet pool accounts.
 * Reports low-balance accounts and calculates total pool liquidity.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const NETWORK = process.env.NEXT_PUBLIC_HEDERA_NETWORK || 'testnet';
const RPC_URL = NETWORK === 'mainnet' ? 'https://mainnet.hashio.io/api' : 'https://testnet.hashio.io/api';

async function main() {
  const accountsPath = path.resolve(__dirname, '..', 'faucet-accounts.json');
  if (!fs.existsSync(accountsPath)) {
    console.error(`❌ faucet-accounts.json not found at ${accountsPath}. Run setup first.`);
    process.exit(1);
  }

  const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log(`\n======================================================`);
  console.log(`🔍 Hedera Faucet Pool Liquidity Audit`);
  console.log(`🌐 Network: ${NETWORK.toUpperCase()}`);
  console.log(`👥 Pool Size: ${accounts.length} wallets`);
  console.log(`======================================================\n`);

  let totalPoolBalance = 0;
  const lowAccounts = [];
  const healthyAccounts = [];

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    try {
      const balWei = await provider.getBalance(acc.address);
      const balHbar = parseFloat(ethers.formatUnits(balWei, 18));
      totalPoolBalance += balHbar;

      if (balHbar < 20) {
        lowAccounts.push({ index: i, address: acc.address, balance: balHbar });
      } else {
        healthyAccounts.push({ index: i, address: acc.address, balance: balHbar });
      }

      process.stdout.write(`\rAudited ${i + 1}/${accounts.length} accounts... (Current Total: ${totalPoolBalance.toFixed(2)} ℏ)`);
    } catch (e) {
      console.warn(`\n[#${i}] Error reading ${acc.address}: ${e.message}`);
    }
  }

  console.log(`\n\n------------------ Audit Results ------------------`);
  console.log(`Total Pool Liquidity:  ${totalPoolBalance.toFixed(2)} ℏ`);
  console.log(`Average per Wallet:    ${(totalPoolBalance / accounts.length).toFixed(2)} ℏ`);
  console.log(`Healthy Wallets (>=20ℏ): ${healthyAccounts.length}/${accounts.length}`);
  console.log(`Low Wallets (<20ℏ):      ${lowAccounts.length}/${accounts.length}`);

  if (lowAccounts.length > 0) {
    console.log(`\n⚠️  Wallets requiring top-up:`);
    lowAccounts.slice(0, 10).forEach((a) => {
      console.log(`   #${a.index}: ${a.address} -> ${a.balance.toFixed(2)} ℏ`);
    });
    if (lowAccounts.length > 10) {
      console.log(`   ... and ${lowAccounts.length - 10} more.`);
    }
  } else {
    console.log(`\n✅ All faucet accounts are healthy and ready to serve.`);
  }
  console.log(`----------------------------------------------------\n`);
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
