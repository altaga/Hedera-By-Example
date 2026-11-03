/**
 * @file faucet-claims.mjs
 * Atomic cross-instance claim lock for the Hedera by Example Faucet.
 * Direct architectural parity to Hedera for Dummies (HFD).
 *
 * Prevents double-spending when a learner double-clicks or multiple
 * requests hit the faucet before the Mirror Node finishes indexing the balance.
 *
 * Storage Backends:
 *   - Local/Standalone: Atomic filesystem lock (`flag: 'wx'`) with 5-minute TTL.
 *   - Cloud/Vercel: Atomic Vercel Blob create (`allowOverwrite: false`) with 5-minute TTL.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLAIMS_DIR = path.resolve(__dirname, '..', 'data', 'claims');
const CLAIM_TTL_MS = 5 * 60_000; // 5 minutes

function ensureClaimsDir() {
  if (!fs.existsSync(CLAIMS_DIR)) {
    try {
      fs.mkdirSync(CLAIMS_DIR, { recursive: true });
    } catch (_) {}
  }
}

function getClaimFilePath(address) {
  const safeAddress = address.toLowerCase().trim().replace(/[^a-f0-9x]/g, '');
  return path.join(CLAIMS_DIR, `${safeAddress}.json`);
}

/**
 * Checks if Vercel Blob storage is configured.
 * @returns {boolean}
 */
function isBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

/**
 * Attempts to claim an EVM address atomically.
 * Returns 'claimed' if lock acquired, or 'busy' if an active claim already exists.
 * @param {string} address
 * @returns {Promise<'claimed' | 'busy'>}
 */
export async function claimFaucetAddress(address) {
  if (!address) return 'busy';
  const addressKey = address.toLowerCase().trim();

  // 1. Cloud Vercel Blob Backend (if configured)
  if (isBlobConfigured()) {
    try {
      const { put, get } = await import('@vercel/blob');
      const blobPath = `faucet-claims/${addressKey}.json`;
      const body = JSON.stringify({ at: Date.now() });

      try {
        await put(blobPath, body, {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/json',
        });
        return 'claimed';
      } catch (err) {
        // Blob already exists - check TTL
        const existing = await get(blobPath, { access: 'private', useCache: false }).catch(() => null);
        if (!existing?.stream) return 'busy';
        const txt = await new Response(existing.stream).text();
        const data = JSON.parse(txt);
        const ageMs = Date.now() - Number(data?.at || 0);
        if (ageMs < CLAIM_TTL_MS) {
          return 'busy';
        }
        // Take over expired claim
        await put(blobPath, body, {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: 'application/json',
        });
        return 'claimed';
      }
    } catch (e) {
      console.warn('[FAUCET_CLAIMS] Blob check failed, falling back to disk:', e.message);
    }
  }

  // 2. Local Atomic Filesystem Backend
  ensureClaimsDir();
  const filePath = getClaimFilePath(addressKey);
  const claimData = JSON.stringify({ address: addressKey, at: Date.now() });

  try {
    // 'wx' flag ensures atomic creation; fails with EEXIST if file already exists
    fs.writeFileSync(filePath, claimData, { flag: 'wx' });
    return 'claimed';
  } catch (err) {
    if (err.code !== 'EEXIST') {
      console.warn('[FAUCET_CLAIMS] Error creating claim file:', err.message);
      return 'claimed'; // Fail-open to not block users on disk IO error
    }

    // File exists: inspect age
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const ageMs = Date.now() - Number(parsed?.at || 0);

      if (ageMs < CLAIM_TTL_MS) {
        return 'busy';
      }

      // Claim has expired (> 5 min): take it over
      fs.writeFileSync(filePath, claimData);
      return 'claimed';
    } catch {
      // Corrupt or unreadable file: overwrite
      fs.writeFileSync(filePath, claimData);
      return 'claimed';
    }
  }
}

/**
 * Releases a faucet claim after failure or cancellation.
 * @param {string} address
 * @returns {Promise<void>}
 */
export async function releaseFaucetClaim(address) {
  if (!address) return;
  const addressKey = address.toLowerCase().trim();

  // Cloud Vercel Blob release
  if (isBlobConfigured()) {
    try {
      const { del } = await import('@vercel/blob');
      await del(`faucet-claims/${addressKey}.json`).catch(() => {});
    } catch (_) {}
  }

  // Local filesystem release
  const filePath = getClaimFilePath(addressKey);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_) {}
}
