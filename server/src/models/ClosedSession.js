import mongoose from "mongoose";

const closedSessionSchema = new mongoose.Schema(
  {
    sessionKey: {
      type: String,
      required: true,
      unique: true,
    },
  },
  { timestamps: true }
);

export const ClosedSession = mongoose.model("ClosedSession", closedSessionSchema);
