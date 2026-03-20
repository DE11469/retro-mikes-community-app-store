"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8080);
const MININGCORE_API_BASE_URL = (process.env.MININGCORE_API_BASE_URL || "").replace(/\/+$/, "");
const REFRESH_INTERVAL_SECONDS = Math.max(1, Number(process.env.REFRESH_INTERVAL_SECONDS || 5));
const BLOCK_PAGE_SIZE = Math.max(10, Number(process.env.BLOCK_PAGE_SIZE || 200));
const PRICE_VS_CURRENCY = (process.env.PRICE_VS_CURRENCY || "usd").toLowerCase();
const CACHE_TTL_MS = Math.max(1000, REFRESH_INTERVAL_SECONDS * 1000 - 500);
const STATIC_ROOT = path.join(__dirname, "public");

const DEFAULT_COINGECKO_ID_BY_SYMBOL = {
  BTC: "bitcoin",
  BCH: "bitcoin-cash",
  BSV: "bitcoin-cash-sv",
  LTC: "litecoin",
  DOGE: "dogecoin",
  DGB: "digibyte",
  DASH: "dash",
  RVN: "ravencoin",
  ETC: "ethereum-classic",
  ETH: "ethereum",
  XMR: "monero",
  ZEC: "zcash",
  KAS: "kaspa",
  NEXA: "nexa",
  FLUX: "zelcash",
  FCH: "fractal-bitcoin",
  BELLS: "bellscoin",
  PEP: "pepecoin-network",
  PEPN: "pepenet",
  PYI: "pyrin"
};

const COINGECKO_ID_BY_SYMBOL = {
  ...DEFAULT_COINGECKO_ID_BY_SYMBOL,
  ...parseSymbolMap(process.env.COINGECKO_SYMBOL_MAP || "")
};

const MIME_BY_EXT = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const cache = {
  timestamp: 0,
  payload: null
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
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

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

function safeJoin(root, targetPath) {
  const normalized = path.normalize(targetPath).replace(/^([.][.][/\\])+/, "");
  return path.join(root, normalized);
}

function getNestedValue(source, dottedPath) {
  const parts = dottedPath.split(".");
  let current = source;

  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return null;
    }
    current = current[part];
  }

  return current;
}

function pickFirstNumeric(source, candidatePaths) {
  for (const candidatePath of candidatePaths) {
    const value = getNestedValue(source, candidatePath);
    const numeric = toNumber(value);
    if (numeric !== null) {
      return numeric;
    }
  }

  return null;
}

function pickFirstString(source, candidatePaths) {
  for (const candidatePath of candidatePaths) {
    const value = getNestedValue(source, candidatePath);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function normalizeSymbol(rawSymbol) {
  if (!rawSymbol) {
    return "";
  }

  return String(rawSymbol).trim().toUpperCase();
}

function parseSymbolMap(rawMap) {
  const parsed = {};
  if (typeof rawMap !== "string" || !rawMap.trim()) {
    return parsed;
  }

  const entries = rawMap.split(",");

  for (const entry of entries) {
    const [rawSymbol, rawCoinGeckoId] = entry.split("=");
    const symbol = normalizeSymbol(rawSymbol || "");
    const coinGeckoId = String(rawCoinGeckoId || "").trim().toLowerCase();

    if (!symbol || !coinGeckoId) {
      continue;
    }

    parsed[symbol] = coinGeckoId;
  }

  return parsed;
}

function extractArray(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }

  if (!rawValue || typeof rawValue !== "object") {
    return [];
  }

  const listFields = ["results", "items", "blocks", "data"];
  for (const field of listFields) {
    if (Array.isArray(rawValue[field])) {
      return rawValue[field];
    }
  }

  return [];
}

function normalizePools(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.map((pool, index) => {
      if (!pool || typeof pool !== "object") {
        return { id: `pool-${index}` };
      }

      if (pool.id || pool.poolId || pool.name) {
        return pool;
      }

      const symbol = pickFirstString(pool, ["coin.symbol", "symbol"]);
      return { ...pool, id: symbol || `pool-${index}` };
    });
  }

  if (!rawValue || typeof rawValue !== "object") {
    return [];
  }

  if (Array.isArray(rawValue.pools)) {
    return normalizePools(rawValue.pools);
  }

  const entries = Object.entries(rawValue);
  if (entries.length === 0) {
    return [];
  }

  return entries
    .filter(([, value]) => value && typeof value === "object")
    .map(([key, value]) => {
      if (value.id || value.poolId || value.name) {
        return value;
      }

      return { ...value, id: key };
    });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  return response.json();
}

async function fetchPools() {
  if (!MININGCORE_API_BASE_URL) {
    throw new Error("MININGCORE_API_BASE_URL is not configured.");
  }

  const endpoint = `${MININGCORE_API_BASE_URL}/api/pools`;
  const rawPools = await fetchJson(endpoint);
  return normalizePools(rawPools);
}

async function fetchPoolBlocks(poolId) {
  const encodedId = encodeURIComponent(poolId);

  const endpoints = [
    `${MININGCORE_API_BASE_URL}/api/pools/${encodedId}/blocks?page=0&pageSize=${BLOCK_PAGE_SIZE}`,
    `${MININGCORE_API_BASE_URL}/api/pools/${encodedId}/blocks`,
    `${MININGCORE_API_BASE_URL}/api/blocks?page=0&pageSize=${BLOCK_PAGE_SIZE}&poolId=${encodedId}`
  ];

  for (const endpoint of endpoints) {
    try {
      const rawResponse = await fetchJson(endpoint);
      const items = extractArray(rawResponse);
      if (items.length >= 0) {
        return items;
      }
    } catch (error) {
      // Try the next endpoint variant.
    }
  }

  return [];
}

function statusFromBlock(block) {
  const raw = block.status || block.state || block.category || block.type || "";
  return String(raw).toLowerCase().trim();
}

function isOrphanStatus(status) {
  return status === "orphaned" || status === "orphan" || status === "kicked";
}

function isImmatureStatus(status) {
  return status === "pending" || status === "immature" || status === "processing" || status === "new";
}

function isMatureStatus(status) {
  return status === "confirmed" || status === "mature" || status === "unlocked" || status === "paid";
}

function rewardFromBlock(block) {
  return (
    pickFirstNumeric(block, [
      "reward",
      "amount",
      "value",
      "minerReward",
      "totalReward",
      "blockReward"
    ]) || 0
  );
}

function confirmationPctFromBlock(block) {
  const direct = pickFirstNumeric(block, [
    "confirmationProgress",
    "confirmationPercent",
    "confirmation_percentage",
    "progress",
    "maturityProgress"
  ]);

  if (direct !== null) {
    if (direct <= 1) {
      return clamp(direct * 100, 0, 100);
    }

    return clamp(direct, 0, 100);
  }

  const confirmations = pickFirstNumeric(block, ["confirmations", "confirmationCount", "confirmationsCount"]);
  const required = pickFirstNumeric(block, [
    "requiredConfirmations",
    "maturityConfirmations",
    "confirmationsRequired"
  ]);

  if (confirmations !== null && required && required > 0) {
    return clamp((confirmations / required) * 100, 0, 100);
  }

  return null;
}

function coinGeckoIdForSymbol(symbol) {
  return COINGECKO_ID_BY_SYMBOL[symbol] || null;
}

async function fetchUsdPrices(symbols) {
  const result = {};
  const ids = [];
  const idBySymbol = {};

  for (const symbol of symbols) {
    const coinGeckoId = coinGeckoIdForSymbol(symbol);
    if (!coinGeckoId) {
      continue;
    }

    idBySymbol[symbol] = coinGeckoId;
    ids.push(coinGeckoId);
  }

  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) {
    return result;
  }

  const endpoint = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(uniqueIds.join(","))}&vs_currencies=${encodeURIComponent(PRICE_VS_CURRENCY)}`;

  try {
    const rawPrices = await fetchJson(endpoint);
    for (const [symbol, coinGeckoId] of Object.entries(idBySymbol)) {
      const value = rawPrices?.[coinGeckoId]?.[PRICE_VS_CURRENCY];
      const numeric = toNumber(value);
      if (numeric !== null) {
        result[symbol] = numeric;
      }
    }
  } catch (error) {
    // Keep API robust even if the price provider is temporarily unavailable.
  }

  return result;
}

function rewardsBySymbol(nodes) {
  const totals = {};

  for (const node of nodes) {
    if (!node.symbol || !Number.isFinite(node.totalReward)) {
      continue;
    }

    if (!(node.symbol in totals)) {
      totals[node.symbol] = 0;
    }

    totals[node.symbol] += node.totalReward;
  }

  return Object.entries(totals).map(([symbol, reward]) => ({ symbol, reward }));
}

function normalizePoolId(pool, index) {
  const rawId = pool.id || pool.poolId || pool.name || pickFirstString(pool, ["coin.symbol", "symbol"]);
  if (typeof rawId === "string" && rawId.trim()) {
    return rawId.trim();
  }

  return `pool-${index}`;
}

function buildNodeMetrics(pool, blocks, priceBySymbol, index) {
  const id = normalizePoolId(pool, index);
  const symbol = normalizeSymbol(
    pickFirstString(pool, ["coin.symbol", "template.symbol", "symbol", "coin.type", "coinName"])
  );

  const name =
    pickFirstString(pool, ["coin.name", "coinName", "template.name", "name"]) ||
    (symbol ? `${symbol} Node` : id);

  const networkHashrate = pickFirstNumeric(pool, [
    "networkStats.networkHashrate",
    "poolStats.networkHashrate",
    "networkHashrate",
    "coinStats.networkHashrate",
    "stats.networkHashrate"
  ]);

  const networkDifficulty = pickFirstNumeric(pool, [
    "networkStats.networkDifficulty",
    "poolStats.networkDifficulty",
    "networkDifficulty",
    "networkStats.difficulty",
    "coinStats.networkDifficulty",
    "stats.networkDifficulty"
  ]);

  const blockTimeSeconds = pickFirstNumeric(pool, [
    "networkStats.blockTime",
    "coin.blockTime",
    "coinStats.blockTime",
    "poolStats.networkBlockTime",
    "stats.blockTime"
  ]);

  const possibleBlocksPerDay =
    blockTimeSeconds !== null && blockTimeSeconds > 0 ? 86400 / blockTimeSeconds : null;

  const foundBlocks = [];
  let immatureBlocks = 0;
  let matureBlocks = 0;
  let pendingBlocks = 0;
  let totalReward = 0;
  const confirmationProgresses = [];

  for (const block of blocks) {
    const status = statusFromBlock(block);
    if (isOrphanStatus(status)) {
      continue;
    }

    foundBlocks.push(block);
    totalReward += rewardFromBlock(block);

    if (isImmatureStatus(status)) {
      immatureBlocks += 1;
      pendingBlocks += 1;
    }

    if (isMatureStatus(status)) {
      matureBlocks += 1;
    }

    const confirmationPct = confirmationPctFromBlock(block);
    if (confirmationPct !== null && isImmatureStatus(status)) {
      confirmationProgresses.push(confirmationPct);
    }
  }

  let immatureToMatureConfirmationPct = null;

  if (confirmationProgresses.length > 0) {
    const total = confirmationProgresses.reduce((sum, value) => sum + value, 0);
    immatureToMatureConfirmationPct = total / confirmationProgresses.length;
  } else if (immatureBlocks === 0 && matureBlocks > 0) {
    immatureToMatureConfirmationPct = 100;
  }

  return {
    id,
    symbol,
    name,
    networkHashrate,
    networkDifficulty,
    blockTimeSeconds,
    possibleBlocksPerDay,
    blocksFound: foundBlocks.length,
    totalReward,
    rewardUnit: symbol || "coin",
    immatureBlocks,
    matureBlocks,
    pendingBlocks,
    immatureToMatureConfirmationPct,
    priceUsd: symbol ? priceBySymbol[symbol] ?? null : null,
    source: {
      poolEndpoint: `${MININGCORE_API_BASE_URL}/api/pools/${encodeURIComponent(id)}`,
      blocksEndpoint: `${MININGCORE_API_BASE_URL}/api/pools/${encodeURIComponent(id)}/blocks`
    }
  };
}

async function buildMetricsPayload() {
  const pools = await fetchPools();
  const poolIds = pools.map((pool, index) => normalizePoolId(pool, index));

  const blockFetchResults = await Promise.allSettled(
    poolIds.map((poolId) => fetchPoolBlocks(poolId))
  );

  const symbols = pools
    .map((pool) => normalizeSymbol(pickFirstString(pool, ["coin.symbol", "template.symbol", "symbol", "coin.type"])))
    .filter(Boolean);

  const priceBySymbol = await fetchUsdPrices(symbols);

  const nodes = pools.map((pool, index) => {
    const blockFetch = blockFetchResults[index];
    const blocks = blockFetch && blockFetch.status === "fulfilled" ? blockFetch.value : [];
    return buildNodeMetrics(pool, blocks, priceBySymbol, index);
  });

  const confirmationValues = nodes
    .map((node) => node.immatureToMatureConfirmationPct)
    .filter((value) => value !== null);

  const averageConfirmationPct =
    confirmationValues.length > 0
      ? confirmationValues.reduce((sum, value) => sum + value, 0) / confirmationValues.length
      : null;

  const totals = {
    nodeCount: nodes.length,
    totalBlocksFound: nodes.reduce((sum, node) => sum + node.blocksFound, 0),
    combinedNetworkHashrate: nodes
      .map((node) => node.networkHashrate)
      .filter((value) => value !== null)
      .reduce((sum, value) => sum + value, 0),
    averageConfirmationPct,
    rewardsBySymbol: rewardsBySymbol(nodes)
  };

  return {
    generatedAt: new Date().toISOString(),
    refreshSeconds: REFRESH_INTERVAL_SECONDS,
    miningcoreApiBaseUrl: MININGCORE_API_BASE_URL,
    priceSource: "CoinGecko",
    vsCurrency: PRICE_VS_CURRENCY,
    totals,
    nodes
  };
}

async function getMetricsPayload() {
  const now = Date.now();

  if (cache.payload && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.payload;
  }

  const payload = await buildMetricsPayload();
  cache.timestamp = now;
  cache.payload = payload;

  return payload;
}

function serveStatic(requestPath, response) {
  const requestedPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = safeJoin(STATIC_ROOT, requestedPath);

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

      sendText(response, 500, "Failed to load file");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_BY_EXT[ext] || "application/octet-stream",
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
      miningcoreConfigured: Boolean(MININGCORE_API_BASE_URL)
    });
    return;
  }

  if (requestUrl.pathname === "/api/metrics") {
    try {
      const payload = await getMetricsPayload();
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 502, {
        error: "Failed to fetch live metrics",
        message: error instanceof Error ? error.message : String(error),
        miningcoreApiBaseUrl: MININGCORE_API_BASE_URL,
        generatedAt: new Date().toISOString()
      });
    }
    return;
  }

  serveStatic(requestUrl.pathname, response);
});

server.listen(PORT, () => {
  console.log(`MiningCore dashboard listening on ${PORT}`);
});
