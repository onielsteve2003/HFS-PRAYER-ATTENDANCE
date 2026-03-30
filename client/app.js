const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
const DEVICE_TOKEN_KEY = "hfs_device_token";

const attendanceForm = document.getElementById("attendance-form");
const nameInput = document.getElementById("name");
const statusBanner = document.getElementById("status-banner");
const historyEl = document.getElementById("history");
const serverTimeEl = document.getElementById("server-time");
const pageSizeSelect = document.getElementById("page-size");
const prevPageButton = document.getElementById("prev-page");
const nextPageButton = document.getElementById("next-page");
const historySummaryEl = document.getElementById("history-summary");

let historyGroups = [];
let currentPage = 1;

function createDeviceToken() {
  const source = `${crypto.randomUUID()}-${Date.now()}-${navigator.userAgent}`;
  return btoa(unescape(encodeURIComponent(source))).slice(0, 128);
}

function getDeviceToken() {
  let token = localStorage.getItem(DEVICE_TOKEN_KEY);

  if (!token) {
    token = createDeviceToken();
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }

  return token;
}

function setBanner(message, type = "warn") {
  statusBanner.className = `status-banner ${type}`;
  statusBanner.textContent = message;
}

function setFormEnabled(enabled) {
  nameInput.disabled = !enabled;
  attendanceForm.querySelector("button").disabled = !enabled;
}

function getPageSizeValue() {
  const selected = pageSizeSelect.value;
  if (selected === "all") {
    return Math.max(historyGroups.length, 1);
  }

  return Number(selected);
}

function getTotalPages() {
  const pageSize = getPageSizeValue();
  return Math.max(1, Math.ceil(historyGroups.length / pageSize));
}

function renderHistory() {
  if (!Array.isArray(historyGroups) || historyGroups.length === 0) {
    historyEl.innerHTML = '<p class="empty">No attendance records yet.</p>';
    historySummaryEl.textContent = "No records";
    prevPageButton.disabled = true;
    nextPageButton.disabled = true;
    return;
  }

  const totalPages = getTotalPages();
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  const pageSize = getPageSizeValue();
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const visibleGroups = historyGroups.slice(start, end);

  historySummaryEl.textContent = `Page ${currentPage} of ${totalPages} (${historyGroups.length} days)`;
  prevPageButton.disabled = currentPage === 1;
  nextPageButton.disabled = currentPage === totalPages;

  historyEl.innerHTML = visibleGroups
    .map((group) => {
      const names = group.attendees
        .map((name) => `<li>${escapeHtml(name)}</li>`)
        .join("");

      return `<article class="history-item"><h3>${escapeHtml(group.sessionLabel)}</h3><ol>${names}</ol></article>`;
    })
    .join("");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function loadHistory() {
  const res = await fetch(`${API_BASE}/attendance`);
  if (!res.ok) {
    throw new Error("Could not load attendance history.");
  }

  historyGroups = await res.json();
  renderHistory();
}

async function loadStatus() {
  const token = getDeviceToken();
  const res = await fetch(`${API_BASE}/status?deviceToken=${encodeURIComponent(token)}`);

  if (!res.ok) {
    throw new Error("Could not load session status.");
  }

  return res.json();
}

function applyStatus(state) {
  serverTimeEl.textContent = `Server time: ${state.serverTime}`;

  if (state.testingMode && !state.alreadySubmitted) {
    setBanner(`Testing mode is ON. Attendance is temporarily open for ${state.sessionLabel}.`, "ok");
    setFormEnabled(true);
    return;
  }

  if (!state.isPrayerDay || !state.inWindow) {
    setBanner("Attendance is open only Tuesdays and Thursdays from 9:00pm to 10:00pm.", "warn");
    setFormEnabled(false);
    return;
  }

  if (state.alreadySubmitted) {
    setBanner("You already submitted attendance for this session.", "ok");
    setFormEnabled(false);
    return;
  }

  setBanner(`Attendance is open for ${state.sessionLabel}.`, "ok");
  setFormEnabled(true);
}

attendanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = getDeviceToken();
  const name = nameInput.value.trim();

  if (!name) {
    setBanner("Please enter your name.", "warn");
    return;
  }

  setFormEnabled(false);

  try {
    const res = await fetch(`${API_BASE}/attendance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, deviceToken: token }),
    });

    const payload = await res.json();

    if (!res.ok) {
      setBanner(payload.message || "Could not submit attendance.", "warn");
      const status = await loadStatus();
      applyStatus(status);
      await loadHistory();
      return;
    }

    setBanner(payload.message, "ok");
    nameInput.value = "";
    setFormEnabled(false);
    await loadHistory();
  } catch (error) {
    setBanner(error.message || "Unexpected error.", "warn");
    setFormEnabled(true);
  }
});

pageSizeSelect.addEventListener("change", () => {
  currentPage = 1;
  renderHistory();
});

prevPageButton.addEventListener("click", () => {
  if (currentPage > 1) {
    currentPage -= 1;
    renderHistory();
  }
});

nextPageButton.addEventListener("click", () => {
  const totalPages = getTotalPages();
  if (currentPage < totalPages) {
    currentPage += 1;
    renderHistory();
  }
});

async function init() {
  try {
    const status = await loadStatus();
    applyStatus(status);
    await loadHistory();
  } catch (error) {
    setBanner(error.message || "Initialization failed.", "warn");
  }
}

init();
