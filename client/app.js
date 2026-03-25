const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
const DEVICE_TOKEN_KEY = "hfs_device_token";

const attendanceForm = document.getElementById("attendance-form");
const nameInput = document.getElementById("name");
const statusBanner = document.getElementById("status-banner");
const historyEl = document.getElementById("history");
const serverTimeEl = document.getElementById("server-time");

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

function renderHistory(groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    historyEl.innerHTML = '<p class="empty">No attendance records yet.</p>';
    return;
  }

  historyEl.innerHTML = groups
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

  const data = await res.json();
  renderHistory(data);
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
