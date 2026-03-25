import crypto from "crypto";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import mongoose from "mongoose";
import { Attendance } from "./models/Attendance.js";
import { getPrayerSessionState } from "./utils/prayerWindow.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const mongoUri = process.env.MONGODB_URI;
const timeZone = process.env.TIMEZONE || "Africa/Lagos";
const deviceHashSalt = process.env.DEVICE_HASH_SALT || "dev-salt-change-me";
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
const attendanceForceOpen = process.env.ATTENDANCE_FORCE_OPEN === "true";

if (!mongoUri) {
  throw new Error("MONGODB_URI is required in environment variables.");
}

app.use(
  cors({
    origin: allowedOrigin,
  })
);
app.use(express.json());

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function hashDeviceToken(deviceToken) {
  return crypto.createHash("sha256").update(`${deviceToken}:${deviceHashSalt}`).digest("hex");
}

function parseAndValidatePayload(req, res) {
  const { name, deviceToken } = req.body ?? {};

  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ message: "Please enter your name." });
    return null;
  }

  const cleanedName = name.trim().replace(/\s+/g, " ");

  if (cleanedName.length < 2 || cleanedName.length > 60) {
    res.status(400).json({ message: "Name must be between 2 and 60 characters." });
    return null;
  }

  if (typeof deviceToken !== "string" || deviceToken.length < 10) {
    res.status(400).json({ message: "Invalid device token." });
    return null;
  }

  return { cleanedName, deviceToken };
}

async function getGroupedAttendance() {
  const rows = await Attendance.find({}, { _id: 0, sessionKey: 1, sessionLabel: 1, name: 1, createdAt: 1 })
    .sort({ createdAt: 1 })
    .lean();

  const map = new Map();

  for (const row of rows) {
    if (!map.has(row.sessionKey)) {
      map.set(row.sessionKey, {
        sessionKey: row.sessionKey,
        sessionLabel: row.sessionLabel,
        attendees: [],
        latestCreatedAt: row.createdAt,
      });
    }

    const group = map.get(row.sessionKey);
    group.attendees.push(row.name);
    if (!group.latestCreatedAt || row.createdAt > group.latestCreatedAt) {
      group.latestCreatedAt = row.createdAt;
    }
  }

  return [...map.values()]
    .sort((a, b) => new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime())
    .map(({ latestCreatedAt, ...rest }) => rest);
}

app.get("/api/status", async (req, res) => {
  const state = getPrayerSessionState(new Date(), timeZone, {
    forceOpen: attendanceForceOpen,
  });
  const deviceToken = req.query.deviceToken;

  let alreadySubmitted = false;

  if (typeof deviceToken === "string" && deviceToken.length >= 10) {
    const deviceHash = hashDeviceToken(deviceToken);
    alreadySubmitted =
      (await Attendance.exists({
        sessionKey: state.sessionKey,
        deviceHash,
      })) !== null;
  }

  res.json({
    ...state,
    alreadySubmitted,
  });
});

app.get("/api/attendance", async (req, res, next) => {
  try {
    const grouped = await getGroupedAttendance();
    res.json(grouped);
  } catch (error) {
    next(error);
  }
});

app.post("/api/attendance", async (req, res, next) => {
  try {
    const payload = parseAndValidatePayload(req, res);
    if (!payload) {
      return;
    }

    const { cleanedName, deviceToken } = payload;
    const state = getPrayerSessionState(new Date(), timeZone, {
      forceOpen: attendanceForceOpen,
    });

    if (!state.isPrayerDay || !state.inWindow) {
      res.status(403).json({
        message: "Attendance is only open on Tuesdays and Thursdays from 9:00pm to 10:00pm.",
        state,
      });
      return;
    }

    const deviceHash = hashDeviceToken(deviceToken);

    await Attendance.create({
      sessionKey: state.sessionKey,
      sessionLabel: state.sessionLabel,
      name: cleanedName,
      normalizedName: normalizeName(cleanedName),
      deviceHash,
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

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ message: "Unexpected server error." });
});

async function start() {
  await mongoose.connect(mongoUri);
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Timezone: ${timeZone}`);
    if (attendanceForceOpen) {
      console.log("ATTENDANCE_FORCE_OPEN is enabled. Time restrictions are bypassed for testing.");
    }
  });
}

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
