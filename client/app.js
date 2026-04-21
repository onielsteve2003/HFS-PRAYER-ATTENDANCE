const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
const DEVICE_TOKEN_KEY = "hfs_device_token";

const statusBanner = document.getElementById("status-banner");
const serverTimeEl = document.getElementById("server-time");
const checkinSection = document.getElementById("checkin-section");
const memberSearchInput = document.getElementById("member-search");
const memberListEl = document.getElementById("member-list");
const toggleAddMemberBtn = document.getElementById("toggle-add-member");
const addMemberFormEl = document.getElementById("add-member-form");
const newMemberNameInput = document.getElementById("new-member-name");
const addMemberBtn = document.getElementById("add-member-btn");
const yearSelect = document.getElementById("year-select");
const monthSelect = document.getElementById("month-select");
const historySearchInput = document.getElementById("history-search");
const statusFilterSelect = document.getElementById("status-filter");
const statusDateFilterSelect = document.getElementById("status-date-filter");
const historyEl = document.getElementById("history");
const consistencyEl = document.getElementById("consistency");

let currentStatus = null;
let members = [];
let historyData = {
  sessions: [],
  availableYears: [],
  availableMonths: {},
};

const NAME_ALIAS_MAP = new Map([
  ["ipst hedioha justin chinedu", "PST IHEDIOHA JUSTIN CHINEDU"],
  ["nduuwerem tochukwu godwin", "NDUNWEREM TOCHUKWU GODWIN"],
  ["nnaemeka possible ungwuanyi", "Nnaemeka possible ugwuanyi"],
  ["ogochukwu arji", "Ogochukwu Peace"],
  ["olunlade arafat", "Olunlade Nifemi"],
]);

function toLooseNameKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCanonicalDisplayName(name) {
  const cleaned = String(name).replace(/\s+/g, " ").trim();
  const alias = NAME_ALIAS_MAP.get(toLooseNameKey(cleaned));
  return alias || cleaned;
}

function buildNameKey(name) {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

function getIdentityTokens(name) {
  const removableTitles = new Set([
    "rev",
    "pst",
    "pastor",
    "ipst",
    "mr",
    "mrs",
    "miss",
    "dr",
    "bro",
    "sis",
  ]);

  return [...new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => token.length > 1)
      .filter((token) => !removableTitles.has(token))
  )].sort();
}

function isSameIdentityTokens(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) {
    return false;
  }

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      overlap += 1;
    }
  }

  if (overlap < 2) {
    return false;
  }

  return overlap === Math.min(setA.size, setB.size);
}

function buildIdentityGroups(items, getName) {
  const groups = [];

  for (const item of items) {
    const name = getCanonicalDisplayName(getName(item));
    const tokens = getIdentityTokens(name);
    const tokenKey = tokens.join(" ");

    let group = groups.find((candidate) => isSameIdentityTokens(tokens, candidate.tokens));
    if (!group) {
      group = {
        id: tokenKey || buildNameKey(name),
        tokens,
        displayName: name,
        items: [],
      };
      groups.push(group);
    } else {
      if (tokens.length > group.tokens.length || name.length > group.displayName.length) {
        group.tokens = tokens;
        group.displayName = name;
        group.id = tokenKey || group.id;
      }
    }

    group.items.push(item);
  }

  return groups;
}

function isTakenByAnyKey(tokens, takenKeys) {
  if (!tokens.length || !Array.isArray(takenKeys)) {
    return false;
  }

  return takenKeys.some((takenKey) => {
    const takenTokens = String(takenKey).split(" ").filter(Boolean);
    return isSameIdentityTokens(tokens, takenTokens);
  });
}

function formatShortPrayerDateLabel(dateOnly) {
  const date = new Date(`${dateOnly}T00:00:00`);
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  const day = date.getDate();
  const month = date.getMonth() + 1;
  return `${weekday} ${day}/${month}`;
}

function getPrayerDatesForMonth(year, month) {
  const result = [];
  const daysInMonth = new Date(year, month, 0).getDate();

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month - 1, day);
    const weekday = date.getDay();
    if (weekday === 2 || weekday === 4) {
      const dateOnly = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      result.push(dateOnly);
    }
  }

  return result;
}

function hasCurrentPrayerDayClosed(status) {
  if (!status?.isPrayerDay) {
    return false;
  }

  const match = /(\d{2}):(\d{2}):(\d{2})$/.exec(status.serverTime || "");
  if (!match) {
    return false;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);

  return hour > 22 || (hour === 22 && (minute > 0 || second > 0));
}

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

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function setBanner(message, type = "warn") {
  statusBanner.className = `status-banner ${type}`;
  statusBanner.innerHTML = message;
}

async function fetchStatus() {
  const token = getDeviceToken();
  const res = await fetch(`${API_BASE}/status?deviceToken=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error("Could not load session status.");
  return res.json();
}

async function fetchMembers() {
  const res = await fetch(`${API_BASE}/members`);
  if (!res.ok) throw new Error("Could not load members.");
  return res.json();
}

async function markPresent(name) {
  const token = getDeviceToken();
  const res = await fetch(`${API_BASE}/attendance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, deviceToken: token }),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.message || "Could not submit attendance.");
  return payload;
}

async function fetchAttendance(params = {}) {
  const query = new URLSearchParams();
  if (params.year) query.set("year", params.year);
  if (params.month) query.set("month", params.month);
  if (params.search) query.set("search", params.search);
  if (params.status && params.status !== "all") query.set("status", params.status);

  const res = await fetch(`${API_BASE}/attendance?${query}`);
  if (!res.ok) throw new Error("Could not load attendance history.");
  return res.json();
}

function renderCheckin() {
  if (!currentStatus) return;

  const isOpen = currentStatus.isPrayerDay && currentStatus.inWindow;
  const isTestOpen = currentStatus.testingMode;

  if (currentStatus.alreadySubmitted) {
    checkinSection.style.display = "none";
    setBanner(
      `<span class="icon-present">✓</span> You're marked present as <strong>${escapeHtml(currentStatus.submittedName)}</strong> for ${escapeHtml(currentStatus.sessionLabel)}.`,
      "ok"
    );
    return;
  }

  if (!isOpen && !isTestOpen) {
    checkinSection.style.display = "none";
    setBanner(
      "Attendance is open only on Tuesdays and Thursdays from 9:00 PM to 10:00 PM.",
      "warn"
    );
    return;
  }

  checkinSection.style.display = "block";

  if (isTestOpen && !isOpen) {
    setBanner(
      `Testing mode is ON. Attendance is open for <strong>${escapeHtml(currentStatus.sessionLabel)}</strong>. Select your name below.`,
      "ok"
    );
  } else {
    setBanner(
      `Attendance is open for <strong>${escapeHtml(currentStatus.sessionLabel)}</strong>. Select your name below.`,
      "ok"
    );
  }

  renderMemberList();
}

function renderMemberList() {
  const searchTerm = memberSearchInput.value.trim().toLowerCase();
  const takenNameKeys = currentStatus?.presentNameKeys || [];
  const memberGroups = buildIdentityGroups(members, (member) => member.name);
  const filtered = memberGroups.filter((group) => {
    const isTaken = isTakenByAnyKey(group.tokens, takenNameKeys);
    return !isTaken && group.displayName.toLowerCase().includes(searchTerm);
  });

  if (filtered.length === 0) {
    memberListEl.innerHTML = searchTerm
      ? '<p class="empty">No matching members found. Add yourself below.</p>'
      : '<p class="empty">No members yet. Be the first to add your name!</p>';
    return;
  }

  memberListEl.innerHTML = "";

  for (const memberGroup of filtered) {
    const member = memberGroup.items[0];
    const div = document.createElement("div");
    div.className = "member-item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "member-name";
    nameSpan.textContent = memberGroup.displayName;

    const btn = document.createElement("button");
    btn.className = "btn-present";
    btn.type = "button";
    btn.textContent = "Mark Present";

    btn.addEventListener("click", async () => {
      try {
        btn.disabled = true;
        btn.textContent = "Marking...";
        await markPresent(memberGroup.displayName);
        currentStatus = {
          ...currentStatus,
          alreadySubmitted: true,
          submittedName: memberGroup.displayName,
        };
        renderCheckin();
        currentStatus = await fetchStatus();
        renderCheckin();
        loadHistory();
      } catch (error) {
        setBanner(escapeHtml(error.message), "warn");
        btn.disabled = false;
        btn.textContent = "Mark Present";
      }
    });

    div.appendChild(nameSpan);
    div.appendChild(btn);
    memberListEl.appendChild(div);
  }
}

memberSearchInput.addEventListener("input", () => {
  renderMemberList();
});

toggleAddMemberBtn.addEventListener("click", () => {
  const isVisible = addMemberFormEl.classList.contains("visible");
  addMemberFormEl.classList.toggle("visible", !isVisible);
  toggleAddMemberBtn.textContent = isVisible ? "+ Add New Member" : "Cancel";
});

addMemberBtn.addEventListener("click", async () => {
  const name = newMemberNameInput.value.trim();
  if (!name) {
    setBanner("Please enter your name.", "warn");
    return;
  }
  if (name.length < 2 || name.length > 60) {
    setBanner("Name must be between 2 and 60 characters.", "warn");
    return;
  }

  try {
    addMemberBtn.disabled = true;
    addMemberBtn.textContent = "Adding...";
    await markPresent(name);
    newMemberNameInput.value = "";
    addMemberFormEl.classList.remove("visible");
    toggleAddMemberBtn.textContent = "+ Add New Member";
    members = await fetchMembers();
    currentStatus = {
      ...currentStatus,
      alreadySubmitted: true,
      submittedName: name,
    };
    renderCheckin();
    currentStatus = await fetchStatus();
    renderCheckin();
    loadHistory();
  } catch (error) {
    setBanner(escapeHtml(error.message), "warn");
    addMemberBtn.disabled = false;
    addMemberBtn.textContent = "Add & Mark Present";
  }
});

function populateFilters() {
  const { availableYears, availableMonths } = historyData;
  const prevYear = yearSelect.value;
  const prevMonth = monthSelect.value;

  if (availableYears.length === 0) {
    yearSelect.innerHTML = '<option value="">No data</option>';
    monthSelect.innerHTML = '<option value="">No data</option>';
    return;
  }

  yearSelect.innerHTML = availableYears
    .map((y) => `<option value="${y}">${y}</option>`)
    .join("");

  if (prevYear && availableYears.includes(parseInt(prevYear, 10))) {
    yearSelect.value = prevYear;
  }

  updateMonthOptions();

  if (prevMonth) {
    const yr = yearSelect.value;
    const months = availableMonths[yr] || [];
    if (prevMonth === "all" || months.some((m) => m.month === parseInt(prevMonth, 10))) {
      monthSelect.value = prevMonth;
    }
  } else {
    const firstMonth = availableMonths[yearSelect.value]?.[0];
    if (firstMonth) {
      monthSelect.value = String(firstMonth.month);
    }
  }
}

function updateMonthOptions() {
  const year = yearSelect.value;
  const months = historyData.availableMonths[year] || [];

  if (months.length === 0) {
    monthSelect.innerHTML = '<option value="">No data</option>';
    return;
  }

  monthSelect.innerHTML = [
    '<option value="all">All months</option>',
    ...months.map((m) => `<option value="${m.month}">${m.name}</option>`),
  ].join("");
}

function updateStatusDateFilterOptions(registerDates) {
  const previousValue = statusDateFilterSelect.value;

  const options = [
    '<option value="">Select date or choose All dates</option>',
    '<option value="all">All dates</option>',
    ...registerDates.map((dateOnly) => {
      const label = formatShortPrayerDateLabel(dateOnly);
      return `<option value="${dateOnly}">${escapeHtml(label)}</option>`;
    }),
  ];

  statusDateFilterSelect.innerHTML = options.join("");

  if (previousValue && registerDates.includes(previousValue)) {
    statusDateFilterSelect.value = previousValue;
  } else if (previousValue === "all") {
    statusDateFilterSelect.value = "all";
  } else {
    statusDateFilterSelect.value = "";
  }

  statusDateFilterSelect.disabled = statusFilterSelect.value === "all";
}

function renderHistory() {
  const { sessions } = historyData;
  const searchTerm = historySearchInput.value.trim().toLowerCase();
  const statusFilter = statusFilterSelect.value;

  if (sessions.length === 0) {
    historyEl.innerHTML = '<p class="empty">No attendance records found.</p>';
    consistencyEl.innerHTML = "";
    return;
  }

  const selectedYear = parseInt(yearSelect.value, 10);
  const selectedMonth = monthSelect.value;
  let registerDates = [];

  if (Number.isInteger(selectedYear) && /^\d+$/.test(selectedMonth)) {
    registerDates = getPrayerDatesForMonth(selectedYear, parseInt(selectedMonth, 10));
  } else {
    registerDates = [...new Set(sessions.map((item) => item.dateOnly))].sort((a, b) => a.localeCompare(b));
  }

  if (registerDates.length === 0) {
    historyEl.innerHTML = '<p class="empty">No Tuesday/Thursday dates found for this selection.</p>';
    consistencyEl.innerHTML = "";
    updateStatusDateFilterOptions([]);
    return;
  }

  updateStatusDateFilterOptions(registerDates);
  const selectedStatusDate = statusDateFilterSelect.value;

  if (statusFilter !== "all" && !selectedStatusDate) {
    historyEl.innerHTML = '<p class="empty">Select a date or choose All dates to view Present/Absent records.</p>';
    consistencyEl.innerHTML = "";
    return;
  }

  const visibleDates =
    statusFilter !== "all" && selectedStatusDate !== "all" && registerDates.includes(selectedStatusDate)
      ? [selectedStatusDate]
      : registerDates;

  const sessionsByDate = new Map();
  for (const session of sessions) {
    if (!sessionsByDate.has(session.dateOnly)) {
      sessionsByDate.set(session.dateOnly, []);
    }
    sessionsByDate.get(session.dateOnly).push(...session.attendees);
  }

  const identitySourceItems = [
    ...members.map((member) => ({ type: "member", name: member.name })),
    ...[...sessionsByDate.values()].flat().map((attendee) => ({ type: "attendee", name: attendee.name })),
  ];
  const identityGroups = buildIdentityGroups(identitySourceItems, (item) => item.name);

  const todayDateOnly = currentStatus?.dateOnly || null;
  const includeTodayInConsistency = hasCurrentPrayerDayClosed(currentStatus);
  const consistencyDates = registerDates.filter((dateOnly) => {
    if (!todayDateOnly) {
      return true;
    }

    if (dateOnly < todayDateOnly) {
      return true;
    }

    if (dateOnly > todayDateOnly) {
      return false;
    }

    // For current prayer day, include it only after attendance closes.
    if (currentStatus?.isPrayerDay) {
      return includeTodayInConsistency;
    }

    return true;
  });
  const consistencyTotalDays = consistencyDates.length;

  const rowModels = identityGroups.map((group) => {
    const marksByDate = {};
    for (const dateOnly of registerDates) {
      const attendees = sessionsByDate.get(dateOnly) || [];
      const matches = attendees.filter((item) =>
        isSameIdentityTokens(getIdentityTokens(item.name), group.tokens)
      );
      if (matches.some((item) => item.status === "present")) {
        marksByDate[dateOnly] = "present";
      } else if (matches.some((item) => item.status === "absent")) {
        marksByDate[dateOnly] = "absent";
      } else if (todayDateOnly && dateOnly < todayDateOnly) {
        marksByDate[dateOnly] = "absent";
      } else {
        marksByDate[dateOnly] = null;
      }
    }

    const presentCount = consistencyDates.reduce(
      (sum, dateOnly) => sum + (marksByDate[dateOnly] === "present" ? 1 : 0),
      0
    );
    const totalDays = consistencyTotalDays;

    return {
      nameKey: group.id,
      displayName: group.displayName,
      marksByDate,
      presentCount,
      totalDays,
    };
  });

  let filteredRows = rowModels;

  if (searchTerm) {
    filteredRows = filteredRows.filter((row) => row.displayName.toLowerCase().includes(searchTerm));
  }

  if (statusFilter !== "all") {
    if (selectedStatusDate !== "all" && registerDates.includes(selectedStatusDate)) {
      filteredRows = filteredRows.filter(
        (row) => row.marksByDate[selectedStatusDate] === statusFilter
      );
    } else {
      filteredRows = filteredRows.filter((row) =>
        registerDates.some((dateOnly) => row.marksByDate[dateOnly] === statusFilter)
      );
    }
  }

  if (filteredRows.length === 0) {
    historyEl.innerHTML = '<p class="empty">No matching records for the selected filters.</p>';
    consistencyEl.innerHTML = "";
    return;
  }

  const headerColumns = visibleDates
    .map((dateOnly) => {
      const shortLabel = formatShortPrayerDateLabel(dateOnly);
      return `<th><div>${escapeHtml(shortLabel)}</div><span class="date-chip">${escapeHtml(dateOnly)}</span></th>`;
    })
    .join("");

  const bodyRows = filteredRows
    .map((row) => {
      const markCells = visibleDates
        .map((dateOnly) => {
          const status = row.marksByDate[dateOnly];
          if (!status) {
            return '<td class="empty-cell">-</td>';
          }

          return status === "present"
            ? '<td class="present"><span class="icon-present">✓</span></td>'
            : '<td class="absent"><span class="icon-absent">✗</span></td>';
        })
        .join("");

      return `<tr><td class="name-col">${escapeHtml(row.displayName)}</td>${markCells}</tr>`;
    })
    .join("");

  const isAbsentSingleDateView =
    statusFilter === "absent" && selectedStatusDate !== "all" && visibleDates.length === 1;

  const totalsByDate = visibleDates.map((dateOnly) =>
    filteredRows.reduce((sum, row) => {
      if (isAbsentSingleDateView) {
        return sum + (row.marksByDate[dateOnly] === "absent" ? 1 : 0);
      }

      return sum + (row.marksByDate[dateOnly] === "present" ? 1 : 0);
    }, 0)
  );

  const totalsLabel = isAbsentSingleDateView ? "Total Absent" : "Total Present";

  const footerCells = totalsByDate.map((value) => `<td class="total-cell">${value}</td>`).join("");

  historyEl.innerHTML = `
    <div class="register-wrap">
      <table class="register-table">
        <thead>
          <tr>
            <th class="name-col">Name</th>
            ${headerColumns}
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
        <tfoot>
          <tr>
            <th class="name-col total-label">${totalsLabel}</th>
            ${footerCells}
          </tr>
        </tfoot>
      </table>
    </div>`;

  const rankedConsistency = [...filteredRows]
    .sort((a, b) => {
      // Primary ranking: highest attendance count.
      if (a.presentCount !== b.presentCount) {
        return b.presentCount - a.presentCount;
      }

      // Secondary ranking: higher attendance rate.
      const ratioA = a.totalDays === 0 ? 0 : a.presentCount / a.totalDays;
      const ratioB = b.totalDays === 0 ? 0 : b.presentCount / b.totalDays;
      if (ratioA !== ratioB) {
        return ratioB - ratioA;
      }

      return a.displayName.localeCompare(b.displayName);
    })
    .slice(0, 30)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

  const columnHeight = 10;
  const consistencyColumns = Math.max(1, Math.ceil(rankedConsistency.length / columnHeight));
  const consistencyGridOrder = [];

  for (let row = 0; row < columnHeight; row += 1) {
    for (let col = 0; col < consistencyColumns; col += 1) {
      const index = col * columnHeight + row;
      if (index < rankedConsistency.length) {
        consistencyGridOrder.push(rankedConsistency[index]);
      }
    }
  }

  const consistencyItems = consistencyGridOrder
    .map(
      (row) =>
        `<li><span class="consistency-rank">${row.rank}.</span> <strong>${escapeHtml(row.displayName)}</strong> - ${row.presentCount}/${row.totalDays}</li>`
    )
    .join("");

  consistencyEl.innerHTML = `
    <section class="consistency-card">
      <h3>Consistency Check</h3>
      <div class="consistency-grid-wrap">
        <ul class="consistency-list" style="--consistency-columns:${consistencyColumns};">${consistencyItems}</ul>
      </div>
    </section>`;
}

async function loadHistory() {
  try {
    const year = yearSelect.value;
    const month = monthSelect.value;

    historyData = await fetchAttendance({
      year,
      month,
    });

    populateFilters();
    renderHistory();
  } catch (error) {
    historyEl.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

yearSelect.addEventListener("change", () => {
  updateMonthOptions();
  loadHistory();
});

monthSelect.addEventListener("change", () => {
  loadHistory();
});

let historySearchTimeout;
historySearchInput.addEventListener("input", () => {
  clearTimeout(historySearchTimeout);
  historySearchTimeout = setTimeout(() => loadHistory(), 300);
});

statusFilterSelect.addEventListener("change", () => {
  statusDateFilterSelect.disabled = statusFilterSelect.value === "all";
  if (statusFilterSelect.value === "all") {
    statusDateFilterSelect.value = "all";
  } else {
    statusDateFilterSelect.value = "";
  }
  loadHistory();
});

statusDateFilterSelect.addEventListener("change", () => {
  loadHistory();
});

async function init() {
  try {
    serverTimeEl.textContent = "Loading...";

    const [status, memberList, attendance] = await Promise.all([
      fetchStatus(),
      fetchMembers(),
      fetchAttendance(),
    ]);

    currentStatus = status;
    members = memberList;
    historyData = attendance;

    serverTimeEl.textContent = `Server time: ${status.serverTime}`;

    renderCheckin();
    populateFilters();
    await loadHistory();
  } catch (error) {
    setBanner(escapeHtml(error.message) || "Initialization failed.", "warn");
  }
}

setInterval(async () => {
  try {
    currentStatus = await fetchStatus();
    serverTimeEl.textContent = `Server time: ${currentStatus.serverTime}`;
    renderCheckin();
  } catch (_) {}
}, 30000);

setInterval(async () => {
  try {
    await loadHistory();
  } catch (_) {}
}, 60000);

init();
