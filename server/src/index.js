import crypto from "crypto";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import { Attendance } from "./models/Attendance.js";
import { Member } from "./models/Member.js";
import { ClosedSession } from "./models/ClosedSession.js";
import { getPrayerSessionState, getTimeParts, getDateOnlyForSession } from "./utils/prayerWindow.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const mongoUri = process.env.MONGODB_URI;
const timeZone = process.env.TIMEZONE || "Africa/Lagos";
const deviceHashSalt = process.env.DEVICE_HASH_SALT || "dev-salt-change-me";
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
const attendanceForceOpen = process.env.ATTENDANCE_FORCE_OPEN === "true";
const attendanceNoPersist = process.env.ATTENDANCE_NO_PERSIST === "true";

// In-memory test-only storage. Cleared on server restart.
const testSessionEntries = new Map();
const testSessionDevices = new Map();
const testSessionDeviceToName = new Map();
const testMembers = new Map();
const testSessionMeta = new Map();
let isMongoConnected = false;

if (!mongoUri && !attendanceNoPersist) {
  throw new Error("MONGODB_URI is required in environment variables.");
}

function normalizeOrigin(origin) {
  if (typeof origin !== "string") {
    return "";
  }

  return origin.trim().replace(/\/+$/, "");
}

const allowedOrigins = allowedOrigin
  .split(",")
  .map((item) => normalizeOrigin(item))
  .filter(Boolean);

const allowAllOrigins = allowedOrigins.includes("*");

app.use(
  cors({
    origin: (requestOrigin, callback) => {
      if (!requestOrigin || allowAllOrigins) {
        callback(null, true);
        return;
      }

      const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
      const isAllowed = allowedOrigins.includes(normalizedRequestOrigin);

      callback(isAllowed ? null : new Error("Origin not allowed by CORS"), isAllowed);
    },
  })
);
app.use(express.json());

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildNameKey(name) {
  return normalizeName(name)
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

function getNameTokens(name) {
  return [...new Set(normalizeName(name).split(" ").filter(Boolean))];
}

function isLikelySamePersonName(nameA, nameB) {
  const tokensA = getNameTokens(nameA);
  const tokensB = getNameTokens(nameB);

  if (tokensA.length < 2 || tokensB.length < 2) {
    return false;
  }

  const [smaller, bigger] =
    tokensA.length <= tokensB.length ? [tokensA, new Set(tokensB)] : [tokensB, new Set(tokensA)];

  return smaller.every((token) => bigger.has(token));
}

function hashDeviceToken(deviceToken) {
  return crypto.createHash("sha256").update(`${deviceToken}:${deviceHashSalt}`).digest("hex");
}

function getOrCreateSet(store, key) {
  if (!store.has(key)) {
    store.set(key, new Set());
  }
  return store.get(key);
}

function getOrCreateMap(store, key) {
  if (!store.has(key)) {
    store.set(key, new Map());
  }
  return store.get(key);
}

async function closePastSessions() {
  if (attendanceNoPersist) {
    return;
  }

  const now = new Date();
  const currentDateOnly = getDateOnlyForSession(now, timeZone);
  const currentParts = getTimeParts(now, timeZone);

  const closedKeys = new Set(await ClosedSession.distinct("sessionKey"));
  const openSessionKeys = await Attendance.distinct("sessionKey", { status: "present" });
  const unclosedKeys = openSessionKeys.filter((k) => !closedKeys.has(k));

  for (const sessionKey of unclosedKeys) {
    const dateMatch = sessionKey.match(/(\d{4}-\d{2}-\d{2})$/);
    if (!dateMatch) continue;
    const dateOnly = dateMatch[1];

    const isPast =
      dateOnly < currentDateOnly ||
      (dateOnly === currentDateOnly && currentParts.hour >= 22);
    if (!isPast) continue;

    const sampleRecord = await Attendance.findOne({ sessionKey }).lean();
    if (!sampleRecord) continue;

    const sessionEndDate = new Date(dateOnly + "T23:59:59.999Z");
    const members = await Member.find({ createdAt: { $lte: sessionEndDate } }).lean();
    const presentNames = new Set(
      await Attendance.distinct("normalizedName", { sessionKey, status: "present" })
    );

    const absentRecords = members
      .filter((m) => !presentNames.has(m.normalizedName))
      .map((m) => ({
        sessionKey,
        sessionLabel: sampleRecord.sessionLabel,
        dateOnly,
        name: m.name,
        normalizedName: m.normalizedName,
        deviceHash: null,
        status: "absent",
      }));

    if (absentRecords.length > 0) {
      await Attendance.insertMany(absentRecords, { ordered: false }).catch(() => {});
    }

    await ClosedSession.create({ sessionKey }).catch(() => {});
  }
}

app.get("/api/status", async (req, res) => {
  const state = getPrayerSessionState(new Date(), timeZone, {
    forceOpen: attendanceForceOpen,
  });
  const deviceToken = req.query.deviceToken;

  let alreadySubmitted = false;
  let submittedName = null;
  let presentNameKeys = [];

  if (attendanceNoPersist) {
    presentNameKeys = [...getOrCreateSet(testSessionEntries, state.sessionKey)];
  } else {
    const currentRows = await Attendance.find(
      {
        sessionKey: state.sessionKey,
        status: "present",
      },
      {
        normalizedNameKey: 1,
        name: 1,
        _id: 0,
      }
    ).lean();

    presentNameKeys = [...new Set(currentRows.map((row) => row.normalizedNameKey || buildNameKey(row.name)))];
  }

  if (typeof deviceToken === "string" && deviceToken.length >= 10) {
    const deviceHash = hashDeviceToken(deviceToken);
    if (attendanceNoPersist) {
      const deviceToName = getOrCreateMap(testSessionDeviceToName, state.sessionKey);
      submittedName = deviceToName.get(deviceHash) ?? null;
      alreadySubmitted = Boolean(submittedName);
    } else {
      const existing = await Attendance.findOne({
        sessionKey: state.sessionKey,
        deviceHash,
        status: "present",
      }).lean();
      if (existing) {
        alreadySubmitted = true;
        submittedName = existing.name;
      }
    }
  }

  res.json({
    ...state,
    alreadySubmitted,
    submittedName,
    presentNameKeys,
    nonPersistentMode: attendanceNoPersist,
  });
});

app.get("/api/members", async (req, res, next) => {
  try {
    const dbMembers = isMongoConnected
      ? await Member.find({}, { name: 1, normalizedName: 1, nameKey: 1, _id: 0 })
          .sort({ name: 1 })
          .lean()
      : [];

    const byNormalizedName = new Map(
      dbMembers.map((item) => [
        item.normalizedName,
        { name: item.name, normalizedName: item.normalizedName, nameKey: item.nameKey || buildNameKey(item.name) },
      ])
    );

    if (attendanceNoPersist) {
      for (const [normalizedName, value] of testMembers.entries()) {
        byNormalizedName.set(normalizedName, {
          name: value.name,
          normalizedName,
          nameKey: value.nameKey,
        });
      }
    }

    const members = [...byNormalizedName.values()].sort((a, b) => a.name.localeCompare(b.name));
    res.json(members);
  } catch (error) {
    next(error);
  }
});

app.post("/api/attendance", async (req, res, next) => {
  try {
    const { name, deviceToken } = req.body ?? {};

    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ message: "Please enter your name." });
      return;
    }

    const cleanedName = name.trim().replace(/\s+/g, " ");

    if (cleanedName.length < 2 || cleanedName.length > 60) {
      res.status(400).json({ message: "Name must be between 2 and 60 characters." });
      return;
    }

    if (typeof deviceToken !== "string" || deviceToken.length < 10) {
      res.status(400).json({ message: "Invalid device token." });
      return;
    }

    const state = getPrayerSessionState(new Date(), timeZone, {
      forceOpen: attendanceForceOpen,
    });

    if (!state.isPrayerDay || !state.inWindow) {
      res.status(403).json({
        message: "Attendance is only open on Tuesdays and Thursdays from 9:00pm to 10:00pm.",
      });
      return;
    }

    const deviceHash = hashDeviceToken(deviceToken);
    const normalized = normalizeName(cleanedName);
    const nameKey = buildNameKey(cleanedName);

    const dbMembersForConflictCheck = isMongoConnected
      ? await Member.find({}, { name: 1, normalizedName: 1, nameKey: 1, _id: 0 }).lean()
      : [];

    const candidateMembersMap = new Map(
      dbMembersForConflictCheck.map((item) => [item.normalizedName, item])
    );

    for (const [normalizedName, value] of testMembers.entries()) {
      candidateMembersMap.set(normalizedName, {
        name: value.name,
        normalizedName,
        nameKey: value.nameKey,
      });
    }

    const candidateMembers = [...candidateMembersMap.values()];

    const existingMemberByConflict = candidateMembers.find((member) => {
      if (!member?.name) {
        return false;
      }

      const sameExactNormalized = normalizeName(member.name) === normalized;
      if (sameExactNormalized) {
        return false;
      }

      if (member.nameKey === nameKey) {
        return true;
      }

      return isLikelySamePersonName(cleanedName, member.name);
    });

    if (existingMemberByConflict) {
      res.status(409).json({
        message: `Name already exists as \"${existingMemberByConflict.name}\". Please select it from the list or search for your name.`,
      });
      return;
    }

    if (attendanceNoPersist) {
      const usedNames = getOrCreateSet(testSessionEntries, state.sessionKey);
      const usedDevices = getOrCreateSet(testSessionDevices, state.sessionKey);
      const deviceToName = getOrCreateMap(testSessionDeviceToName, state.sessionKey);
      const conflictingMarkedName = [...deviceToName.values()].find((markedName) =>
        isLikelySamePersonName(cleanedName, markedName)
      );

      if (usedDevices.has(deviceHash) || usedNames.has(nameKey) || conflictingMarkedName) {
        res.status(409).json({
          message: "This device or name has already been used for this prayer session.",
        });
        return;
      }

      usedNames.add(nameKey);
      usedDevices.add(deviceHash);
      deviceToName.set(deviceHash, cleanedName);
      testMembers.set(normalized, { name: cleanedName, nameKey });
      testSessionMeta.set(state.sessionKey, {
        sessionLabel: state.sessionLabel,
        dateOnly: state.dateOnly,
      });

      res.status(201).json({
        message: "Test attendance recorded (not saved to database).",
        sessionLabel: state.sessionLabel,
      });
      return;
    }

    await Member.updateOne(
      { normalizedName: normalized },
      { $setOnInsert: { name: cleanedName, normalizedName: normalized, nameKey } },
      { upsert: true }
    );

    const sessionPresentRows = await Attendance.find(
      { sessionKey: state.sessionKey, status: "present" },
      { name: 1, normalizedNameKey: 1, _id: 0 }
    ).lean();

    const hasSessionNameConflict = sessionPresentRows.some((row) => {
      if ((row.normalizedNameKey || buildNameKey(row.name)) === nameKey) {
        return true;
      }

      return isLikelySamePersonName(cleanedName, row.name);
    });

    if (hasSessionNameConflict) {
      res.status(409).json({
        message: "This name (or its combination) has already been used for this prayer session.",
      });
      return;
    }

    await Attendance.create({
      sessionKey: state.sessionKey,
      sessionLabel: state.sessionLabel,
      dateOnly: state.dateOnly,
      name: cleanedName,
      normalizedName: normalized,
      normalizedNameKey: nameKey,
      deviceHash,
      status: "present",
    });

    res.status(201).json({
      message: "Attendance recorded successfully.",
      sessionLabel: state.sessionLabel,
    });
  } catch (error) {
    if (error?.code === 11000) {
      res.status(409).json({
        message: "This device or name has already been used for this prayer session.",
      });
      return;
    }

    next(error);
  }
});

app.get("/api/attendance", async (req, res, next) => {
  try {
    if (attendanceNoPersist) {
      const search = (req.query.search || "").trim().toLowerCase();
      const statusFilter = req.query.status || "all";
      const year = req.query.year ? parseInt(req.query.year) : null;
      const monthQuery =
        typeof req.query.month === "string" ? req.query.month.trim().toLowerCase() : "";
      const monthNumber = monthQuery && monthQuery !== "all" ? parseInt(monthQuery) : null;

      let sessions = [];

      for (const [sessionKey, deviceToName] of testSessionDeviceToName.entries()) {
        const meta = testSessionMeta.get(sessionKey);
        const dateOnly = meta?.dateOnly ?? null;
        const sessionLabel = meta?.sessionLabel ?? sessionKey;

        if (!dateOnly) {
          continue;
        }

        if (year && !dateOnly.startsWith(`${year}-`)) {
          continue;
        }

        if (year && Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
          const monthStr = String(monthNumber).padStart(2, "0");
          if (!dateOnly.startsWith(`${year}-${monthStr}`)) {
            continue;
          }
        }

        let attendees = [...deviceToName.values()].map((name) => ({ name, status: "present" }));

        if (search) {
          attendees = attendees.filter((item) => item.name.toLowerCase().includes(search));
        }

        if (statusFilter === "absent") {
          attendees = [];
        }

        if (attendees.length === 0) {
          continue;
        }

        attendees.sort((a, b) => a.name.localeCompare(b.name));
        sessions.push({
          sessionKey,
          sessionLabel,
          dateOnly,
          attendees,
        });
      }

      sessions.sort((a, b) => b.dateOnly.localeCompare(a.dateOnly));

      const yearsSet = new Set();
      const monthsByYear = {};
      const monthNames = [
        "",
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];

      for (const session of sessions) {
        const [y, m] = session.dateOnly.split("-");
        const yr = parseInt(y);
        const mo = parseInt(m);
        yearsSet.add(yr);
        if (!monthsByYear[yr]) {
          monthsByYear[yr] = new Set();
        }
        monthsByYear[yr].add(mo);
      }

      const availableYears = [...yearsSet].sort((a, b) => b - a);
      const availableMonths = {};
      for (const yr of availableYears) {
        availableMonths[yr] = [...monthsByYear[yr]]
          .sort((a, b) => b - a)
          .map((m) => ({ month: m, name: monthNames[m] }));
      }

      res.json({
        sessions,
        total: sessions.length,
        availableYears,
        availableMonths,
      });
      return;
    }

    await closePastSessions();

    const search = (req.query.search || "").trim();
    const statusFilter = req.query.status || "all";
    const year = req.query.year ? parseInt(req.query.year) : null;
    const monthQuery =
      typeof req.query.month === "string" ? req.query.month.trim().toLowerCase() : "";
    const monthNumber =
      monthQuery && monthQuery !== "all" ? parseInt(monthQuery) : null;

    const matchStage = {};

    if (year && Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
      const monthStr = String(monthNumber).padStart(2, "0");
      matchStage.dateOnly = { $regex: `^${year}-${monthStr}` };
    } else if (year) {
      matchStage.dateOnly = { $regex: `^${year}-` };
    }

    if (search) {
      matchStage.normalizedName = {
        $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    }

    if (statusFilter !== "all") {
      matchStage.status = statusFilter;
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: "$sessionKey",
          sessionLabel: { $first: "$sessionLabel" },
          dateOnly: { $first: "$dateOnly" },
          attendees: {
            $push: { name: "$name", status: "$status" },
          },
        },
      },
      { $sort: { dateOnly: -1 } },
    ];

    const groupedSessions = await Attendance.aggregate(pipeline);
    const sessions = groupedSessions.map((s) => ({
      sessionKey: s._id,
      sessionLabel: s.sessionLabel,
      dateOnly: s.dateOnly,
      attendees: s.attendees.sort((a, b) => {
        if (a.status !== b.status) return a.status === "present" ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    }));

    const allDates = await Attendance.distinct("dateOnly");
    const yearsSet = new Set();
    const monthsByYear = {};
    const monthNames = [
      "",
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    for (const d of allDates) {
      if (!d) continue;
      const [y, m] = d.split("-");
      const yr = parseInt(y);
      const mo = parseInt(m);
      yearsSet.add(yr);
      if (!monthsByYear[yr]) monthsByYear[yr] = new Set();
      monthsByYear[yr].add(mo);
    }

    const availableYears = [...yearsSet].sort((a, b) => b - a);
    const availableMonths = {};
    for (const yr of availableYears) {
      availableMonths[yr] = [...monthsByYear[yr]]
        .sort((a, b) => b - a)
        .map((m) => ({ month: m, name: monthNames[m] }));
    }

    res.json({
      sessions,
      total: sessions.length,
      availableYears,
      availableMonths,
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ message: "Unexpected server error." });
});

async function migrate() {
  await Attendance.updateMany(
    { status: { $exists: false } },
    { $set: { status: "present" } }
  );

  const recordsWithoutDate = await Attendance.find(
    { dateOnly: { $exists: false } },
    { sessionKey: 1 }
  ).lean();

  for (const record of recordsWithoutDate) {
    const dateMatch = record.sessionKey.match(/(\d{4}-\d{2}-\d{2})$/);
    if (dateMatch) {
      await Attendance.updateOne(
        { _id: record._id },
        { $set: { dateOnly: dateMatch[1] } }
      );
    }
  }

  const existingNames = await Attendance.aggregate([
    { $match: { status: "present" } },
    {
      $group: {
        _id: "$normalizedName",
        name: { $first: "$name" },
      },
    },
  ]);

  for (const entry of existingNames) {
    const nameKey = buildNameKey(entry.name);
    await Member.updateOne(
      { normalizedName: entry._id },
      { $setOnInsert: { name: entry.name, normalizedName: entry._id, nameKey } },
      { upsert: true }
    );
  }

  const membersWithoutNameKey = await Member.find(
    {
      $or: [{ nameKey: { $exists: false } }, { nameKey: "" }],
    },
    { _id: 1, name: 1 }
  ).lean();

  for (const member of membersWithoutNameKey) {
    await Member.updateOne(
      { _id: member._id },
      { $set: { nameKey: buildNameKey(member.name) } }
    );
  }

  const attendanceWithoutNameKey = await Attendance.find(
    {
      $or: [{ normalizedNameKey: { $exists: false } }, { normalizedNameKey: "" }],
    },
    { _id: 1, name: 1 }
  ).lean();

  for (const row of attendanceWithoutNameKey) {
    await Attendance.updateOne(
      { _id: row._id },
      { $set: { normalizedNameKey: buildNameKey(row.name) } }
    );
  }

  await Attendance.syncIndexes();
  await Member.syncIndexes();
}

async function start() {
  if (attendanceNoPersist) {
    if (mongoUri) {
      try {
        await mongoose.connect(mongoUri);
        isMongoConnected = true;
      } catch (error) {
        console.warn("MongoDB read connection unavailable in no-persist mode. Using in-memory members only.");
        console.warn(error?.message || error);
      }
    }
  } else {
    await mongoose.connect(mongoUri);
    isMongoConnected = true;
    await migrate();
  }

  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Timezone: ${timeZone}`);
    if (attendanceForceOpen) {
      console.log("ATTENDANCE_FORCE_OPEN is enabled. Time restrictions are bypassed for testing.");
    }
    if (attendanceNoPersist) {
      console.log("ATTENDANCE_NO_PERSIST is enabled. Attendance submissions are stored in memory only.");
    }
  });
}

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
