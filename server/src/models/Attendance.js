import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    sessionKey: {
      type: String,
      required: true,
      index: true,
    },
    sessionLabel: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    normalizedName: {
      type: String,
      required: true,
      index: true,
    },
    deviceHash: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

attendanceSchema.index({ sessionKey: 1, deviceHash: 1 }, { unique: true });
attendanceSchema.index({ sessionKey: 1, normalizedName: 1 }, { unique: true });

export const Attendance = mongoose.model("Attendance", attendanceSchema);
