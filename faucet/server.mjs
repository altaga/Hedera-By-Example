/**
 * @file server.mjs
 * High-performance standalone HTTP server for the Hedera by Example (HBE) Faucet.
 * Listens on PORT (default 3005) with CORS, JSON parsing, health monitoring,
 * and PostHog user count observability.
 */

import http from 'http';
import { disburseHbar, getFaucetHealth, NETWORK } from './src/faucet-service.mjs';
import {
  recordFaucetClaim,
  getFaucetUniqueUsersCount,
  HBE_EVENT_FAUCET_CLAIM,
  HBE_APP_TAG,
} from './src/faucet-analytics.mjs';

const PORT = parseInt(process.env.PORT || '3005', 10);

/**
 * Sends a structured JSON HTTP response.
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {object} data
 */
function sendJson(res, status, data) {
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  });
  res.end(payload);
}

/**
 * Parses JSON request body safely.
 * @param {http.IncomingMessage} req
 * @returns {Promise<any>}
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 64) {
        // 64 KB cap
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method ? req.method.toUpperCase() : 'GET';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  try {
    // 1. Health check endpoints
    if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/faucet/health')) {
      const health = await getFaucetHealth();
      const stats = await getFaucetUniqueUsersCount().catch(() => ({ count: 0 }));
      return sendJson(res, 200, {
        ...health,
        analytics: {
          app: HBE_APP_TAG,
          event: HBE_EVENT_FAUCET_CLAIM,
          uniqueUsersCount: stats.count,
        },
      });
    }

    // 2. Analytics stats endpoint
    if (method === 'GET' && (url.pathname === '/stats' || url.pathname === '/api/faucet/stats')) {
      const stats = await getFaucetUniqueUsersCount();
      return sendJson(res, 200, {
        app: HBE_APP_TAG,
        event: HBE_EVENT_FAUCET_CLAIM,
        uniqueUsers: stats.count,
        cached: stats.cached ?? false,
        error: stats.error || null,
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Welcome Drop / Disburse endpoints
    if (
      method === 'POST' &&
      (url.pathname === '/api/welcome-drop' ||
        url.pathname === '/api/faucet/disburse' ||
        url.pathname === '/api/faucet/claim')
    ) {
      const body = await parseBody(req);
      const { evmAddress, accountId, amount = 10, skipCooldown = false } = body;

      if (!evmAddress) {
        return sendJson(res, 400, {
          success: false,
          error: 'Missing required field: evmAddress',
        });
      }

      const result = await disburseHbar({
        evmAddress,
        amount: Number(amount) || 10,
        skipCooldown: Boolean(skipCooldown),
      });

      // Track metric in PostHog upon successful disbursement
      if (result.success) {
        recordFaucetClaim({
          evmAddress,
          accountId,
          amount: Number(amount) || 10,
          txHash: result.hash,
          network: NETWORK,
        }).catch((err) => {
          console.warn('[ANALYTICS] Background metric dispatch error:', err.message);
        });
      }

      const statusCode = result.success ? 200 : 400;
      return sendJson(res, statusCode, result);
    }

    // 4. Root API info
    if (method === 'GET' && url.pathname === '/') {
      return sendJson(res, 200, {
        name: 'Hedera by Example (HBE) Enterprise Faucet',
        network: NETWORK,
        analytics: {
          app: HBE_APP_TAG,
          event: HBE_EVENT_FAUCET_CLAIM,
        },
        endpoints: {
          'POST /api/welcome-drop': 'Disburse 10 HBAR to a learner wallet (1-per-wallet limit)',
          'POST /api/faucet/disburse': 'Disburse custom HBAR amount',
          'GET /api/faucet/health': 'Health, RPC rotation status and pool balances',
          'GET /api/faucet/stats': 'Count of unique users who claimed testnet funds (PostHog)',
        },
        documentation: 'https://github.com/hedera-dev/Hedera-By-Example',
        poweredBy: 'EffiSend',
      });
    }

    // 5. Not found
    return sendJson(res, 404, {
      success: false,
      error: `Not Found: ${method} ${url.pathname}`,
    });
  } catch (err) {
    console.error('[SERVER ERROR]', err);
    return sendJson(res, 500, {
      success: false,
      error: err.message || 'Internal Server Error',
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 HBE Faucet Server running on http://localhost:${PORT}`);
  console.log(`🌐 Hedera Network: ${NETWORK.toUpperCase()}`);
  console.log(`📊 PostHog App Tag: ${HBE_APP_TAG} (${HBE_EVENT_FAUCET_CLAIM})`);
  console.log(`⚡ Endpoints:`);
  console.log(`   - POST /api/welcome-drop`);
  console.log(`   - GET  /api/faucet/health`);
  console.log(`   - GET  /api/faucet/stats`);
  console.log(`======================================================\n`);
});

// Graceful termination
const shutdown = () => {
  console.log('Shutting down faucet server...');
  server.close(() => {
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
