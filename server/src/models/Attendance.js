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
    dateOnly: {
      type: String,
      index: true,
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
    },
    normalizedNameKey: {
      type: String,
      required: true,
      index: true,
    },
    deviceHash: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      required: true,
      enum: ["present", "absent"],
      default: "present",
    },
  },
  { timestamps: true }
);

attendanceSchema.index({ sessionKey: 1, normalizedName: 1 }, { unique: true });
attendanceSchema.index({ sessionKey: 1, normalizedNameKey: 1 }, { unique: true });
attendanceSchema.index(
  { sessionKey: 1, deviceHash: 1 },
  { unique: true, partialFilterExpression: { deviceHash: { $type: "string" } } }
);

export const Attendance = mongoose.model("Attendance", attendanceSchema);
