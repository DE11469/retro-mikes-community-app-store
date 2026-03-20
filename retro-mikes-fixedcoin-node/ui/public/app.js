const state = {
  refreshSeconds: 5,
  countdownSeconds: 5,
  explorerBaseUrl: "https://explorer.fixedcoin.org"
};

const summaryGrid = document.getElementById("summaryGrid");
const rpcTarget = document.getElementById("rpcTarget");
const lastUpdate = document.getElementById("lastUpdate");
const nextRefresh = document.getElementById("nextRefresh");
const errorText = document.getElementById("errorText");
const integrationGrid = document.getElementById("integrationGrid");
const integrationNote = document.getElementById("integrationNote");
const explorerLink = document.getElementById("explorerLink");
const jsonSnapshot = document.getElementById("jsonSnapshot");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "N/A";
  }

  return number.toLocaleString(undefined, {
    maximumFractionDigits: digits
  });
}

function fmtPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "N/A";
  }

  return `${number.toFixed(2)}%`;
}

function fmtHashrate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "N/A";
  }

  const units = ["H/s", "KH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s"];
  let scaled = number;
  let idx = 0;

  while (scaled >= 1000 && idx < units.length - 1) {
    scaled /= 1000;
    idx += 1;
  }

  return `${fmtNumber(scaled, scaled >= 100 ? 1 : 3)} ${units[idx]}`;
}

function fmtBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "N/A";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let scaled = number;
  let idx = 0;

  while (scaled >= 1024 && idx < units.length - 1) {
    scaled /= 1024;
    idx += 1;
  }

  return `${fmtNumber(scaled, scaled >= 100 ? 1 : 2)} ${units[idx]}`;
}

function fmtDuration(seconds) {
  const number = Number(seconds);
  if (!Number.isFinite(number)) {
    return "N/A";
  }

  const days = Math.floor(number / 86400);
  const hours = Math.floor((number % 86400) / 3600);
  const mins = Math.floor((number % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }

  return `${mins}m`;
}

function renderSummary(payload) {
  const cards = [
    {
      label: "Sync Progress",
      value: fmtPercent(payload?.chain?.verificationProgressPct)
    },
    {
      label: "Block Height",
      value: fmtNumber(payload?.chain?.blocks, 0)
    },
    {
      label: "Headers",
      value: fmtNumber(payload?.chain?.headers, 0)
    },
    {
      label: "IBD Mode",
      value: payload?.chain?.initialBlockDownload ? "Yes" : "No"
    },
    {
      label: "Peers",
      value: fmtNumber(payload?.network?.peers, 0)
    },
    {
      label: "Difficulty",
      value: fmtNumber(payload?.chain?.difficulty, 6)
    },
    {
      label: "Network Hashrate",
      value: fmtHashrate(payload?.mining?.networkHashps)
    },
    {
      label: "Mempool Tx",
      value: fmtNumber(payload?.mempool?.txCount, 0)
    },
    {
      label: "Mempool Size",
      value: fmtBytes(payload?.mempool?.bytes)
    },
    {
      label: "Node Uptime",
      value: fmtDuration(payload?.uptimeSeconds)
    }
  ];

  summaryGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <p class="metric-label">${escapeHtml(card.label)}</p>
          <p class="metric-value">${escapeHtml(card.value)}</p>
        </article>
      `
    )
    .join("");
}

function renderIntegration(payload) {
  const integration = payload?.integration || {};
  integrationNote.textContent = integration.notes ||
    "Use this node RPC endpoint in your MiningCore FIX coin config. When FIX pool is active, the MiningCore Live Dashboard includes FIX automatically.";

  const items = [
    { label: "Coin Symbol", value: integration.symbol || "FIX" },
    { label: "RPC Host", value: payload?.rpc?.host || "N/A" },
    { label: "RPC Port", value: String(integration.miningcoreRpcPort || payload?.rpc?.port || "N/A") },
    { label: "RPC User", value: integration.miningcoreRpcUser || payload?.rpc?.user || "N/A" },
    { label: "Explorer", value: payload?.explorerBaseUrl || state.explorerBaseUrl }
  ];

  integrationGrid.innerHTML = items
    .map(
      (item) => `
        <article class="integration-item">
          <p>${escapeHtml(item.label)}</p>
          <strong>${escapeHtml(item.value)}</strong>
        </article>
      `
    )
    .join("");

  const explorer = payload?.explorerBaseUrl || state.explorerBaseUrl;
  explorerLink.href = explorer;
}

function setError(message) {
  errorText.textContent = message || "";
}

function tickCountdown() {
  if (state.countdownSeconds <= 0) {
    nextRefresh.textContent = "updating...";
    return;
  }

  nextRefresh.textContent = `${state.countdownSeconds}s`;
  state.countdownSeconds -= 1;
}

async function fetchStatus() {
  try {
    const response = await fetch(`/api/status?ts=${Date.now()}`, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Unable to fetch node status");
    }

    state.refreshSeconds = Math.max(1, Number(payload.refreshSeconds) || 5);
    state.countdownSeconds = state.refreshSeconds;
    state.explorerBaseUrl = payload.explorerBaseUrl || state.explorerBaseUrl;

    rpcTarget.textContent = `${payload?.rpc?.host || "-"}:${payload?.rpc?.port || "-"}`;
    lastUpdate.textContent = payload.generatedAt ? new Date(payload.generatedAt).toLocaleString() : new Date().toLocaleString();

    renderSummary(payload);
    renderIntegration(payload);
    jsonSnapshot.textContent = JSON.stringify(payload, null, 2);
    setError(payload?.rpc?.healthy === false ? payload?.rpc?.error || "RPC error" : "");
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

async function pollForever() {
  await fetchStatus();
  window.setTimeout(pollForever, state.refreshSeconds * 1000);
}

window.setInterval(tickCountdown, 1000);
pollForever();
