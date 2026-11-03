import { Client, PrivateKey, AccountCreateTransaction, Hbar } from '@hiero-ledger/sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const opId = process.env.OPERATOR_ID;
const opKeyStr = process.env.OPERATOR_KEY;

if (!opId || !opKeyStr) {
  console.error('OPERATOR_ID or OPERATOR_KEY missing');
  process.exit(1);
}

const client = Client.forTestnet();
const opKey = PrivateKey.fromStringDer(opKeyStr);
client.setOperator(opId, opKey);

console.log('Generating new ECDSA key for HBE Operator...');
const newKey = PrivateKey.generateECDSA();
const evmAddress = '0x' + newKey.publicKey.toEvmAddress();

console.log('Submitting AccountCreateTransaction on Hedera Testnet...');
const tx = await new AccountCreateTransaction()
  .setKey(newKey.publicKey)
  .setInitialBalance(new Hbar(5))
  .setMaxAutomaticTokenAssociations(100)
  .setAccountMemo('HBE Master Operator Treasury')
  .execute(client);

const receipt = await tx.getReceipt(client);
const newAccountId = receipt.accountId.toString();

console.log('\n======================================================');
console.log('🎉 NEW HBE OPERATOR ACCOUNT CREATED ON HEDERA TESTNET');
console.log('======================================================');
console.log('ACCOUNT_ID:      ', newAccountId);
console.log('EVM_ADDRESS:     ', evmAddress);
console.log('PRIVATE_KEY_DER: ', newKey.toStringDer());
console.log('PRIVATE_KEY_RAW: ', newKey.toStringRaw());
console.log('PUBLIC_KEY_DER:  ', newKey.publicKey.toStringDer());
console.log('======================================================\n');

client.close();
