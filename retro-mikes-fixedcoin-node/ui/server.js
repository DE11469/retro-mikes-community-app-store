"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8080);
const RPC_HOST = process.env.RPC_HOST || "retro-mikes-fixedcoin-node_fixedcoin_1";
const RPC_PORT = Number(process.env.RPC_PORT || 24761);
const RPC_USER = process.env.RPC_USER || "fixrpc";
const RPC_PASSWORD = process.env.RPC_PASSWORD || "replace-with-strong-password";
const REFRESH_INTERVAL_SECONDS = Math.max(1, Number(process.env.REFRESH_INTERVAL_SECONDS || 5));
const EXPLORER_BASE_URL = process.env.EXPLORER_BASE_URL || "https://explorer.fixedcoin.org";
const SOLO_STRATUM_HOST = process.env.SOLO_STRATUM_HOST || "umbrel.local";
const SOLO_STRATUM_PORT = Number(process.env.SOLO_STRATUM_PORT || 3032);
const SOLO_MINER_PASSWORD = process.env.SOLO_MINER_PASSWORD || "x";
const SOLO_DEFAULT_WORKER = process.env.SOLO_DEFAULT_WORKER || "rig1";
const STATIC_ROOT = path.join(__dirname, "public");

const MIME_BY_EXT = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

function sendText(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function rpcAuthHeader() {
  const encoded = Buffer.from(`${RPC_USER}:${RPC_PASSWORD}`, "utf8").toString("base64");
  return `Basic ${encoded}`;
}

async function rpcCall(method, params = []) {
  const body = {
    jsonrpc: "1.0",
    id: method,
    method,
    params
  };

  const response = await fetch(`http://${RPC_HOST}:${RPC_PORT}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: rpcAuthHeader()
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    const message = payload.error?.message || JSON.stringify(payload.error);
    throw new Error(`${method}: ${message}`);
  }

  return payload.result;
}

function settledValue(result, fallback = null) {
  return result && result.status === "fulfilled" ? result.value : fallback;
}

function settledError(result) {
  if (!result || result.status !== "rejected") {
    return null;
  }

  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

function blockRewardFromSubsidy(subsidy) {
  if (typeof subsidy === "number" && Number.isFinite(subsidy)) {
    return subsidy;
  }

  if (!subsidy || typeof subsidy !== "object") {
    return null;
  }

  const preferred = ["miner", "mining", "subsidy", "blocksubsidy", "reward", "value"];
  for (const field of preferred) {
    const numeric = toNumber(subsidy[field]);
    if (numeric !== null) {
      return numeric;
    }
  }

  const values = Object.values(subsidy)
    .map((value) => toNumber(value))
    .filter((value) => value !== null);

  if (values.length === 0) {
    return null;
  }

  return values[0];
}

function walletLoaded(walletInfo, walletError) {
  if (walletInfo && typeof walletInfo === "object") {
    return true;
  }

  if (!walletError) {
    return false;
  }

  const text = walletError.toLowerCase();
  return !(text.includes("wallet") && text.includes("not") && text.includes("loaded"));
}

function readinessChecks({ healthy, peers, ibd, verificationProgressPct, walletIsLoaded }) {
  const syncReady =
    !ibd && (verificationProgressPct === null || verificationProgressPct >= 99.9);

  const checks = [
    {
      key: "rpc",
      label: "RPC reachable",
      ok: healthy,
      detail: healthy ? "Node responds to RPC calls." : "Fix RPC connectivity first."
    },
    {
      key: "peers",
      label: "At least 1 peer",
      ok: peers !== null && peers > 0,
      detail: peers !== null && peers > 0 ? `${peers} peers connected.` : "No network peers detected."
    },
    {
      key: "sync",
      label: "Node synced",
      ok: syncReady,
      detail: syncReady
        ? `Sync at ${verificationProgressPct === null ? "N/A" : `${verificationProgressPct.toFixed(3)}%`}.`
        : "Node still in initial sync."
    },
    {
      key: "wallet",
      label: "Wallet loaded",
      ok: walletIsLoaded,
      detail: walletIsLoaded ? "Wallet RPC available." : "Load or create a wallet before mining."
    }
  ];

  return {
    ready: checks.every((check) => check.ok),
    checks
  };
}

async function buildStatus() {
  const calls = await Promise.allSettled([
    rpcCall("getblockchaininfo"),
    rpcCall("getnetworkinfo"),
    rpcCall("getmininginfo"),
    rpcCall("getmempoolinfo"),
    rpcCall("getconnectioncount"),
    rpcCall("getblockcount"),
    rpcCall("getbestblockhash"),
    rpcCall("getdifficulty"),
    rpcCall("uptime"),
    rpcCall("getwalletinfo"),
    rpcCall("getblocksubsidy")
  ]);

  const blockchainInfo = settledValue(calls[0], {});
  const networkInfo = settledValue(calls[1], {});
  const miningInfo = settledValue(calls[2], {});
  const mempoolInfo = settledValue(calls[3], {});
  const connectionCount = settledValue(calls[4], null);
  const blockCount = settledValue(calls[5], null);
  const bestBlockHash = settledValue(calls[6], null);
  const difficulty = settledValue(calls[7], null);
  const uptime = settledValue(calls[8], null);
  const walletInfo = settledValue(calls[9], null);
  const blockSubsidy = settledValue(calls[10], null);

  const criticalError = settledError(calls[0]) || settledError(calls[1]);
  const walletError = settledError(calls[9]);

  const verificationProgressRatio = toNumber(blockchainInfo.verificationprogress);
  const verificationProgressPct =
    verificationProgressRatio === null ? null : verificationProgressRatio * 100;

  const peers = toNumber(connectionCount) ?? toNumber(networkInfo.connections);
  const ibd = Boolean(blockchainInfo.initialblockdownload);
  const walletIsLoaded = walletLoaded(walletInfo, walletError);
  const rewardPerBlock = blockRewardFromSubsidy(blockSubsidy);

  const soloReadiness = readinessChecks({
    healthy: criticalError === null,
    peers,
    ibd,
    verificationProgressPct,
    walletIsLoaded
  });

  return {
    generatedAt: new Date().toISOString(),
    refreshSeconds: REFRESH_INTERVAL_SECONDS,
    explorerBaseUrl: EXPLORER_BASE_URL,
    rpc: {
      host: RPC_HOST,
      port: RPC_PORT,
      user: RPC_USER,
      healthy: criticalError === null,
      error: criticalError
    },
    chain: {
      name: blockchainInfo.chain || "unknown",
      blocks: toNumber(blockchainInfo.blocks) ?? toNumber(blockCount),
      headers: toNumber(blockchainInfo.headers),
      bestBlockHash,
      initialBlockDownload: ibd,
      verificationProgressPct,
      difficulty: toNumber(difficulty) ?? toNumber(blockchainInfo.difficulty)
    },
    network: {
      peers,
      protocolVersion: toNumber(networkInfo.protocolversion),
      subversion: networkInfo.subversion || null,
      relayFee: toNumber(networkInfo.relayfee)
    },
    mining: {
      networkHashps: toNumber(miningInfo.networkhashps),
      pooledTx: toNumber(miningInfo.pooledtx)
    },
    mempool: {
      txCount: toNumber(mempoolInfo.size),
      bytes: toNumber(mempoolInfo.bytes),
      usage: toNumber(mempoolInfo.usage)
    },
    wallet: {
      loaded: walletIsLoaded,
      balance: walletInfo && typeof walletInfo === "object" ? toNumber(walletInfo.balance) : null,
      txCount: walletInfo && typeof walletInfo === "object" ? toNumber(walletInfo.txcount) : null,
      error: walletError
    },
    solo: {
      mode: "solo-via-miningcore-stratum",
      ready: soloReadiness.ready,
      checks: soloReadiness.checks,
      blockTimeSeconds: 600,
      coinbaseMaturityBlocks: 100,
      rewardPerBlock,
      defaults: {
        stratumHost: SOLO_STRATUM_HOST,
        stratumPort: SOLO_STRATUM_PORT,
        minerPassword: SOLO_MINER_PASSWORD,
        workerName: SOLO_DEFAULT_WORKER
      }
    },
    uptimeSeconds: toNumber(uptime),
    integration: {
      symbol: "FIX",
      miningcoreRpcPort: RPC_PORT,
      miningcoreRpcUser: RPC_USER,
      notes:
        "This UI is now solo-mining focused. Point your MiningCore FIX coin config at this node RPC, then direct your miners to the MiningCore FIX stratum endpoint."
    }
  };
}

function safeJoin(root, requestPath) {
  const normalized = path.normalize(requestPath).replace(/^([.][.][/\\])+/, "");
  return path.join(root, normalized);
}

function serveStatic(requestPath, response) {
  const pagePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = safeJoin(STATIC_ROOT, pagePath);

  if (!filePath.startsWith(STATIC_ROOT)) {
    sendText(response, 400, "Invalid path");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendText(response, 404, "Not found");
        return;
      }

      sendText(response, 500, "Failed to read static file");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_BY_EXT[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method !== "GET") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  if (requestUrl.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      rpcTarget: `${RPC_HOST}:${RPC_PORT}`,
      refreshSeconds: REFRESH_INTERVAL_SECONDS
    });
    return;
  }

  if (requestUrl.pathname === "/api/status") {
    try {
      const payload = await buildStatus();
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 502, {
        error: "Failed to query FixedCoin RPC",
        message: error instanceof Error ? error.message : String(error),
        generatedAt: new Date().toISOString(),
        rpcTarget: `${RPC_HOST}:${RPC_PORT}`
      });
    }
    return;
  }

  if (requestUrl.pathname === "/api/miningcore-hint") {
    sendJson(response, 200, {
      symbol: "FIX",
      rpcHostHint: RPC_HOST,
      rpcPort: RPC_PORT,
      rpcUser: RPC_USER,
      notes: "Set rpcpassword in MiningCore to the same value configured in this app's docker-compose.yml"
    });
    return;
  }

  serveStatic(requestUrl.pathname, response);
});

server.listen(PORT, () => {
  console.log(`FixedCoin UI listening on ${PORT}`);
});
