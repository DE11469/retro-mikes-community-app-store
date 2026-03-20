const SOLO_PREFS_KEY = "fix-solo-mining-prefs-v1";
const HASHRATE_FACTORS = {
  "H/s": 1,
  "KH/s": 1e3,
  "MH/s": 1e6,
  "GH/s": 1e9,
  "TH/s": 1e12,
  "PH/s": 1e15
};

const state = {
  refreshSeconds: 5,
  countdownSeconds: 5,
  explorerBaseUrl: "https://explorer.fixedcoin.org",
  latestPayload: null,
  soloPrefs: loadSoloPrefs()
};

const summaryGrid = document.getElementById("summaryGrid");
const rpcTarget = document.getElementById("rpcTarget");
const lastUpdate = document.getElementById("lastUpdate");
const nextRefresh = document.getElementById("nextRefresh");
const errorText = document.getElementById("errorText");
const soloReadyBadge = document.getElementById("soloReadyBadge");
const readinessList = document.getElementById("readinessList");
const soloQuickStats = document.getElementById("soloQuickStats");
const integrationGrid = document.getElementById("integrationGrid");
const integrationNote = document.getElementById("integrationNote");
const explorerLink = document.getElementById("explorerLink");
const jsonSnapshot = document.getElementById("jsonSnapshot");
const payoutAddressInput = document.getElementById("payoutAddressInput");
const workerNameInput = document.getElementById("workerNameInput");
const stratumHostInput = document.getElementById("stratumHostInput");
const stratumPortInput = document.getElementById("stratumPortInput");
const minerPasswordInput = document.getElementById("minerPasswordInput");
const minerHashrateInput = document.getElementById("minerHashrateInput");
const hashrateUnitSelect = document.getElementById("hashrateUnitSelect");
const stratumUrlOutput = document.getElementById("stratumUrlOutput");
const minerUsernameOutput = document.getElementById("minerUsernameOutput");
const minerPasswordOutput = document.getElementById("minerPasswordOutput");

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

function fmtPercent(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "N/A";
  }

  return `${number.toFixed(digits)}%`;
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
  if (!Number.isFinite(number) || number <= 0) {
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

function defaultSoloPrefs() {
  return {
    payoutAddress: "",
    workerName: "",
    stratumHost: "",
    stratumPort: "",
    minerPassword: "",
    minerHashrate: "",
    hashrateUnit: "TH/s"
  };
}

function loadSoloPrefs() {
  try {
    const raw = localStorage.getItem(SOLO_PREFS_KEY);
    if (!raw) {
      return defaultSoloPrefs();
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return defaultSoloPrefs();
    }

    return {
      ...defaultSoloPrefs(),
      ...parsed
    };
  } catch (error) {
    return defaultSoloPrefs();
  }
}

function persistSoloPrefs() {
  localStorage.setItem(SOLO_PREFS_KEY, JSON.stringify(state.soloPrefs));
}

function syncPrefsFromInputs() {
  state.soloPrefs = {
    payoutAddress: payoutAddressInput.value.trim(),
    workerName: workerNameInput.value.trim(),
    stratumHost: stratumHostInput.value.trim(),
    stratumPort: stratumPortInput.value.trim(),
    minerPassword: minerPasswordInput.value.trim(),
    minerHashrate: minerHashrateInput.value.trim(),
    hashrateUnit: hashrateUnitSelect.value
  };

  persistSoloPrefs();
}

function applyPrefsToInputs() {
  payoutAddressInput.value = state.soloPrefs.payoutAddress || "";
  workerNameInput.value = state.soloPrefs.workerName || "";
  stratumHostInput.value = state.soloPrefs.stratumHost || "";
  stratumPortInput.value = state.soloPrefs.stratumPort || "";
  minerPasswordInput.value = state.soloPrefs.minerPassword || "";
  minerHashrateInput.value = state.soloPrefs.minerHashrate || "";

  const unit = state.soloPrefs.hashrateUnit || "TH/s";
  if ([...hashrateUnitSelect.options].some((option) => option.value === unit)) {
    hashrateUnitSelect.value = unit;
  }
}

function hydrateMissingSoloDefaults(payload) {
  const defaults = payload?.solo?.defaults || {};
  let changed = false;

  if (!state.soloPrefs.workerName && defaults.workerName) {
    state.soloPrefs.workerName = defaults.workerName;
    changed = true;
  }

  if (!state.soloPrefs.stratumHost && defaults.stratumHost) {
    state.soloPrefs.stratumHost = defaults.stratumHost;
    changed = true;
  }

  if (!state.soloPrefs.stratumPort && defaults.stratumPort) {
    state.soloPrefs.stratumPort = String(defaults.stratumPort);
    changed = true;
  }

  if (!state.soloPrefs.minerPassword && defaults.minerPassword) {
    state.soloPrefs.minerPassword = defaults.minerPassword;
    changed = true;
  }

  if (changed) {
    persistSoloPrefs();
    applyPrefsToInputs();
  }
}

function sanitizeWorkerName(workerName) {
  const cleaned = (workerName || "rig1").replace(/\s+/g, "-");
  return cleaned || "rig1";
}

function toHashratePerSecond(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  const factor = HASHRATE_FACTORS[unit] || 1;
  return number * factor;
}

function setSoloBadge(ready) {
  soloReadyBadge.classList.remove("good", "warning", "bad");

  if (ready === true) {
    soloReadyBadge.classList.add("good");
    soloReadyBadge.textContent = "Ready";
    return;
  }

  if (ready === false) {
    soloReadyBadge.classList.add("bad");
    soloReadyBadge.textContent = "Not Ready";
    return;
  }

  soloReadyBadge.classList.add("warning");
  soloReadyBadge.textContent = "Checking...";
}

function renderSummary(payload) {
  const cards = [
    {
      label: "Solo Mode",
      value: payload?.solo?.mode === "solo-via-miningcore-stratum" ? "Via MiningCore Stratum" : "N/A"
    },
    {
      label: "Sync Progress",
      value: fmtPercent(payload?.chain?.verificationProgressPct, 3)
    },
    {
      label: "Block Height",
      value: fmtNumber(payload?.chain?.blocks, 0)
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
      label: "Reward / Block",
      value: Number.isFinite(Number(payload?.solo?.rewardPerBlock))
        ? `${fmtNumber(payload.solo.rewardPerBlock, 8)} FIX`
        : "N/A"
    },
    {
      label: "Maturity",
      value: Number.isFinite(Number(payload?.solo?.coinbaseMaturityBlocks))
        ? `${fmtNumber(payload.solo.coinbaseMaturityBlocks, 0)} blocks`
        : "N/A"
    },
    {
      label: "Mempool Tx",
      value: fmtNumber(payload?.mempool?.txCount, 0)
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

function renderReadiness(payload) {
  const checks = Array.isArray(payload?.solo?.checks) ? payload.solo.checks : [];
  setSoloBadge(payload?.solo?.ready);

  if (checks.length === 0) {
    readinessList.innerHTML = "<li class=\"readiness-item\"><div class=\"readiness-dot\"></div><div><strong>No checks available</strong><span>Waiting for node data.</span></div></li>";
    return;
  }

  readinessList.innerHTML = checks
    .map((check) => {
      const ok = Boolean(check.ok);
      return `
        <li class="readiness-item">
          <div class="readiness-dot ${ok ? "good" : "bad"}"></div>
          <div>
            <strong>${escapeHtml(check.label || check.key || "Check")}</strong>
            <span>${escapeHtml(check.detail || "")}</span>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderSoloConfig(payload) {
  hydrateMissingSoloDefaults(payload);

  const worker = sanitizeWorkerName(state.soloPrefs.workerName || payload?.solo?.defaults?.workerName || "rig1");
  const stratumHost = state.soloPrefs.stratumHost || payload?.solo?.defaults?.stratumHost || "umbrel.local";
  const stratumPort = state.soloPrefs.stratumPort || String(payload?.solo?.defaults?.stratumPort || 3032);
  const payoutAddress = state.soloPrefs.payoutAddress || "YOUR_FIX_ADDRESS";
  const minerPassword = state.soloPrefs.minerPassword || payload?.solo?.defaults?.minerPassword || "x";

  const minerUsername = `${payoutAddress}.${worker}`;
  const stratumUrl = `stratum+tcp://${stratumHost}:${stratumPort}`;

  stratumUrlOutput.textContent = stratumUrl;
  minerUsernameOutput.textContent = minerUsername;
  minerPasswordOutput.textContent = minerPassword;

  const yourHashrateHps = toHashratePerSecond(state.soloPrefs.minerHashrate, state.soloPrefs.hashrateUnit);
  const networkHashps = Number(payload?.mining?.networkHashps);
  const blockTimeSeconds = Number(payload?.solo?.blockTimeSeconds);
  const rewardPerBlock = Number(payload?.solo?.rewardPerBlock);

  const networkBlocksPerDay = Number.isFinite(blockTimeSeconds) && blockTimeSeconds > 0 ? 86400 / blockTimeSeconds : null;

  const sharePct =
    Number.isFinite(networkHashps) && networkHashps > 0 && Number.isFinite(yourHashrateHps)
      ? (yourHashrateHps / networkHashps) * 100
      : null;

  const expectedBlocksPerDay =
    Number.isFinite(networkHashps) && networkHashps > 0 && Number.isFinite(yourHashrateHps) && Number.isFinite(networkBlocksPerDay)
      ? (yourHashrateHps / networkHashps) * networkBlocksPerDay
      : null;

  const expectedTimePerBlockSeconds =
    Number.isFinite(expectedBlocksPerDay) && expectedBlocksPerDay > 0 ? 86400 / expectedBlocksPerDay : null;

  const expectedFixPerDay =
    Number.isFinite(expectedBlocksPerDay) && Number.isFinite(rewardPerBlock)
      ? expectedBlocksPerDay * rewardPerBlock
      : null;

  const statCards = [
    {
      label: "Your Hashrate",
      value: Number.isFinite(yourHashrateHps)
        ? `${fmtNumber(state.soloPrefs.minerHashrate, 3)} ${state.soloPrefs.hashrateUnit}`
        : "Set hashrate"
    },
    {
      label: "Network Share",
      value: fmtPercent(sharePct, sharePct !== null && sharePct < 0.01 ? 6 : 4)
    },
    {
      label: "Expected Blocks / Day",
      value: fmtNumber(expectedBlocksPerDay, 8)
    },
    {
      label: "Expected Time / Block",
      value: fmtDuration(expectedTimePerBlockSeconds)
    },
    {
      label: "Expected FIX / Day",
      value: Number.isFinite(expectedFixPerDay) ? `${fmtNumber(expectedFixPerDay, 8)} FIX` : "N/A"
    },
    {
      label: "Mempool Size",
      value: fmtBytes(payload?.mempool?.bytes)
    }
  ];

  soloQuickStats.innerHTML = statCards
    .map(
      (item) => `
        <article class="integration-item">
          <p>${escapeHtml(item.label)}</p>
          <strong>${escapeHtml(item.value)}</strong>
        </article>
      `
    )
    .join("");
}

function renderIntegration(payload) {
  const integration = payload?.integration || {};

  integrationNote.textContent = integration.notes ||
    "Use this node RPC endpoint in MiningCore FIX coin config, then mine to your FIX address through your solo pool stratum endpoint.";

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

  explorerLink.href = payload?.explorerBaseUrl || state.explorerBaseUrl;
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

function rerenderSoloOnly() {
  syncPrefsFromInputs();
  if (state.latestPayload) {
    renderSoloConfig(state.latestPayload);
  }
}

async function fetchStatus() {
  try {
    const response = await fetch(`/api/status?ts=${Date.now()}`, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Unable to fetch node status");
    }

    state.latestPayload = payload;
    state.refreshSeconds = Math.max(1, Number(payload.refreshSeconds) || 5);
    state.countdownSeconds = state.refreshSeconds;
    state.explorerBaseUrl = payload.explorerBaseUrl || state.explorerBaseUrl;

    rpcTarget.textContent = `${payload?.rpc?.host || "-"}:${payload?.rpc?.port || "-"}`;
    lastUpdate.textContent = payload.generatedAt ? new Date(payload.generatedAt).toLocaleString() : new Date().toLocaleString();

    renderSummary(payload);
    renderReadiness(payload);
    renderSoloConfig(payload);
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

[payoutAddressInput, workerNameInput, stratumHostInput, stratumPortInput, minerPasswordInput, minerHashrateInput]
  .forEach((input) => input.addEventListener("input", rerenderSoloOnly));

hashrateUnitSelect.addEventListener("change", rerenderSoloOnly);

applyPrefsToInputs();
window.setInterval(tickCountdown, 1000);
pollForever();
