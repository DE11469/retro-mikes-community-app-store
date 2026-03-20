const EXCLUDED_NODES_KEY = "rm-miningcore-excluded-nodes-v1";

const state = {
  nodes: [],
  refreshSeconds: 5,
  countdownSeconds: 5,
  apiBaseUrl: "",
  excludedNodeIds: new Set(loadExcludedNodeIds())
};

const summaryCards = document.getElementById("summaryCards");
const nodeSelector = document.getElementById("nodeSelector");
const nodesGrid = document.getElementById("nodesGrid");
const visibleCount = document.getElementById("visibleCount");
const apiBaseUrl = document.getElementById("apiBaseUrl");
const lastUpdate = document.getElementById("lastUpdate");
const nextRefresh = document.getElementById("nextRefresh");
const errorText = document.getElementById("errorText");
const includeAllBtn = document.getElementById("includeAllBtn");
const excludeAllBtn = document.getElementById("excludeAllBtn");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function loadExcludedNodeIds() {
  try {
    const raw = localStorage.getItem(EXCLUDED_NODES_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value) => typeof value === "string" && value.trim());
  } catch (error) {
    return [];
  }
}

function persistExcludedNodeIds() {
  localStorage.setItem(EXCLUDED_NODES_KEY, JSON.stringify([...state.excludedNodeIds]));
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }

  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits
  });
}

function formatHashrate(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }

  const units = ["H/s", "KH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s"];
  let scaled = Number(value);
  let unitIndex = 0;

  while (scaled >= 1000 && unitIndex < units.length - 1) {
    scaled /= 1000;
    unitIndex += 1;
  }

  const digits = scaled >= 100 ? 1 : scaled >= 10 ? 2 : 3;
  return `${formatNumber(scaled, digits)} ${units[unitIndex]}`;
}

function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }

  return Number(value).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }

  return `${Number(value).toFixed(2)}%`;
}

function getVisibleNodes() {
  return state.nodes.filter((node) => !state.excludedNodeIds.has(node.id));
}

function cleanExcludedNodes() {
  const activeNodeIds = new Set(state.nodes.map((node) => node.id));
  state.excludedNodeIds = new Set(
    [...state.excludedNodeIds].filter((nodeId) => activeNodeIds.has(nodeId))
  );
  persistExcludedNodeIds();
}

function summarizeRewards(nodes) {
  const rewardTotals = {};

  for (const node of nodes) {
    const symbol = node.symbol || node.rewardUnit || "COIN";
    const reward = Number(node.totalReward);

    if (!Number.isFinite(reward)) {
      continue;
    }

    rewardTotals[symbol] = (rewardTotals[symbol] || 0) + reward;
  }

  const entries = Object.entries(rewardTotals);

  if (entries.length === 0) {
    return "N/A";
  }

  return entries
    .map(([symbol, reward]) => `${formatNumber(reward, 8)} ${symbol}`)
    .join(" | ");
}

function average(values) {
  const valid = values.filter((value) => value !== null && Number.isFinite(Number(value)));
  if (valid.length === 0) {
    return null;
  }

  return valid.reduce((sum, value) => sum + Number(value), 0) / valid.length;
}

function renderSummary() {
  const visibleNodes = getVisibleNodes();

  const blocksFound = visibleNodes.reduce((sum, node) => sum + (Number(node.blocksFound) || 0), 0);
  const combinedHashrate = visibleNodes
    .map((node) => Number(node.networkHashrate))
    .filter((value) => Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);

  const averageDifficulty = average(visibleNodes.map((node) => node.networkDifficulty));
  const averageConfirmation = average(
    visibleNodes.map((node) => node.immatureToMatureConfirmationPct)
  );
  const blocksPerDay = visibleNodes
    .map((node) => Number(node.possibleBlocksPerDay))
    .filter((value) => Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);

  const cards = [
    {
      label: "Visible Nodes",
      value: `${visibleNodes.length}/${state.nodes.length}`
    },
    {
      label: "Network Hashrate",
      value: visibleNodes.length > 0 ? formatHashrate(combinedHashrate) : "N/A"
    },
    {
      label: "Avg Network Difficulty",
      value: formatNumber(averageDifficulty, 2)
    },
    {
      label: "Blocks Found (Solo)",
      value: formatNumber(blocksFound, 0)
    },
    {
      label: "Possible Blocks/Day",
      value: formatNumber(blocksPerDay, 2)
    },
    {
      label: "Reward From Found Blocks",
      value: summarizeRewards(visibleNodes)
    },
    {
      label: "Immature to Mature",
      value: formatPercent(averageConfirmation)
    }
  ];

  summaryCards.innerHTML = cards
    .map(
      (card) => `
        <article class="card">
          <p class="metric-label">${escapeHtml(card.label)}</p>
          <p class="metric-value">${escapeHtml(card.value)}</p>
        </article>
      `
    )
    .join("");
}

function renderNodeSelector() {
  const nodes = [...state.nodes].sort((left, right) => {
    const leftKey = `${left.symbol || ""}-${left.id || ""}`;
    const rightKey = `${right.symbol || ""}-${right.id || ""}`;
    return leftKey.localeCompare(rightKey);
  });

  if (nodes.length === 0) {
    nodeSelector.innerHTML = `<div class="empty-state">No nodes returned from MiningCore yet.</div>`;
    return;
  }

  nodeSelector.innerHTML = nodes
    .map((node) => {
      const excluded = state.excludedNodeIds.has(node.id);
      const toggleClass = excluded ? "disabled" : "enabled";
      const toggleLabel = excluded ? "+ Include" : "- Exclude";

      return `
        <article class="node-select-item">
          <div>
            <strong>${escapeHtml(node.name)} ${escapeHtml(node.symbol ? `(${node.symbol})` : "")}</strong>
            <span>${escapeHtml(node.id)}</span>
          </div>
          <button class="node-toggle ${toggleClass}" data-node-id="${escapeHtml(node.id)}" type="button">
            ${escapeHtml(toggleLabel)}
          </button>
        </article>
      `;
    })
    .join("");
}

function renderNodes() {
  const visibleNodes = getVisibleNodes();
  visibleCount.textContent = `${visibleNodes.length} of ${state.nodes.length} nodes visible`;

  if (visibleNodes.length === 0) {
    nodesGrid.innerHTML = `<div class="empty-state">All nodes are currently excluded. Use + Include to show one again.</div>`;
    return;
  }

  nodesGrid.innerHTML = visibleNodes
    .map((node) => {
      const confirmation = node.immatureToMatureConfirmationPct;
      const confirmationWidth = Number.isFinite(Number(confirmation))
        ? Math.max(0, Math.min(100, Number(confirmation)))
        : 0;

      const rewardUnit = node.symbol || node.rewardUnit || "COIN";

      return `
        <article class="node-card">
          <header>
            <h3>${escapeHtml(node.name)} ${escapeHtml(node.symbol ? `(${node.symbol})` : "")}</h3>
            <p class="node-id">${escapeHtml(node.id)}</p>
          </header>

          <div class="node-metrics">
            <div class="node-row"><span>Network Hashrate</span><strong>${escapeHtml(formatHashrate(node.networkHashrate))}</strong></div>
            <div class="node-row"><span>Network Difficulty</span><strong>${escapeHtml(formatNumber(node.networkDifficulty, 4))}</strong></div>
            <div class="node-row"><span>Current Price (USD)</span><strong>${escapeHtml(formatUsd(node.priceUsd))}</strong></div>
            <div class="node-row"><span>Possible Blocks/Day</span><strong>${escapeHtml(formatNumber(node.possibleBlocksPerDay, 4))}</strong></div>
            <div class="node-row"><span>Blocks Found (Solo)</span><strong>${escapeHtml(formatNumber(node.blocksFound, 0))}</strong></div>
            <div class="node-row"><span>Reward From Found Blocks</span><strong>${escapeHtml(`${formatNumber(node.totalReward, 8)} ${rewardUnit}`)}</strong></div>
            <div class="node-row"><span>Pending / Immature</span><strong>${escapeHtml(formatNumber(node.pendingBlocks, 0))}</strong></div>
            <div class="node-row"><span>Mature</span><strong>${escapeHtml(formatNumber(node.matureBlocks, 0))}</strong></div>
          </div>

          <div class="progress-wrap">
            <div class="node-row">
              <span>Immature to Mature Confirmation</span>
              <strong>${escapeHtml(formatPercent(confirmation))}</strong>
            </div>
            <div class="progress-bar" aria-hidden="true">
              <div class="progress-fill" style="width: ${confirmationWidth}%;"></div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDashboard() {
  apiBaseUrl.textContent = state.apiBaseUrl || "Not configured";
  renderSummary();
  renderNodeSelector();
  renderNodes();
}

function setError(message) {
  errorText.textContent = message || "";
}

function updateCountdown() {
  if (state.countdownSeconds <= 0) {
    nextRefresh.textContent = "updating...";
    return;
  }

  nextRefresh.textContent = `${state.countdownSeconds}s`;
  state.countdownSeconds -= 1;
}

async function fetchMetrics() {
  try {
    const response = await fetch(`/api/metrics?ts=${Date.now()}`, {
      cache: "no-store"
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Failed to read live metrics");
    }

    state.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    state.refreshSeconds = Math.max(1, Number(payload.refreshSeconds) || 5);
    state.apiBaseUrl = payload.miningcoreApiBaseUrl || "";
    state.countdownSeconds = state.refreshSeconds;

    cleanExcludedNodes();
    renderDashboard();

    const ts = payload.generatedAt ? new Date(payload.generatedAt) : new Date();
    lastUpdate.textContent = ts.toLocaleString();
    setError("");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setError(message);
  }
}

async function pollForever() {
  await fetchMetrics();
  window.setTimeout(pollForever, state.refreshSeconds * 1000);
}

nodeSelector.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const nodeId = target.dataset.nodeId;
  if (!nodeId) {
    return;
  }

  if (state.excludedNodeIds.has(nodeId)) {
    state.excludedNodeIds.delete(nodeId);
  } else {
    state.excludedNodeIds.add(nodeId);
  }

  persistExcludedNodeIds();
  renderDashboard();
});

includeAllBtn.addEventListener("click", () => {
  state.excludedNodeIds.clear();
  persistExcludedNodeIds();
  renderDashboard();
});

excludeAllBtn.addEventListener("click", () => {
  state.excludedNodeIds = new Set(state.nodes.map((node) => node.id));
  persistExcludedNodeIds();
  renderDashboard();
});

window.setInterval(updateCountdown, 1000);
pollForever();
