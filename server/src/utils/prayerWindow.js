const WEEKDAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function getFormatter(timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function getTimeParts(date, timeZone) {
  const parts = getFormatter(timeZone).formatToParts(date);
  const value = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      value[part.type] = part.value;
    }
  }

  return {
    weekdayName: value.weekday,
    day: Number(value.day),
    month: value.month,
    year: Number(value.year),
    hour: Number(value.hour),
    minute: Number(value.minute),
    second: Number(value.second),
  };
}

function getDateOnlyForSession(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parseDateOverride(dateText) {
  if (typeof dateText !== "string") {
    return null;
  }

  const trimmed = dateText.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }

  const weekdayName = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
  }).format(utcDate);

  const monthName = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "long",
  }).format(utcDate);

  return {
    isoDate: trimmed,
    weekdayName,
    weekdayLower: weekdayName.toLowerCase(),
    year,
    monthName,
    day,
  };
}

export function getPrayerSessionState(date, timeZone, options = {}) {
  const forceOpen = options.forceOpen === true;
  const override = forceOpen ? parseDateOverride(options.testSessionDate) : null;
  const parts = getTimeParts(date, timeZone);
  const weekdayLower = parts.weekdayName.toLowerCase();
  const weekdayIndex = WEEKDAYS[weekdayLower];

  const computedPrayerDay = weekdayIndex === WEEKDAYS.tuesday || weekdayIndex === WEEKDAYS.thursday;
  const isPrayerDay = forceOpen ? true : computedPrayerDay;
  const computedInWindow =
    computedPrayerDay &&
    parts.hour >= 21 &&
    (parts.hour < 22 || (parts.hour === 22 && parts.minute === 0 && parts.second === 0));
  const inWindow = forceOpen ? true : computedInWindow;

  const dateOnly = override ? override.isoDate : getDateOnlyForSession(date, timeZone);
  const sessionWeekdayLower = override ? override.weekdayLower : weekdayLower;
  const sessionWeekdayName = override ? override.weekdayName : parts.weekdayName;
  const sessionDay = override ? override.day : parts.day;
  const sessionMonth = override ? override.monthName : parts.month;
  const sessionYear = override ? override.year : parts.year;
  const sessionKey = `${sessionWeekdayLower}-${dateOnly}`;
  const sessionLabel = `${sessionWeekdayName} ${sessionDay} ${sessionMonth}, ${sessionYear}`;

  return {
    isPrayerDay,
    inWindow,
    testingMode: forceOpen,
    activeSessionDateOverride: override ? override.isoDate : null,
    weekdayName: parts.weekdayName,
    sessionKey,
    sessionLabel,
    dateOnly,
    serverTime: `${parts.weekdayName} ${parts.day} ${parts.month}, ${parts.year} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`,
  };
}
