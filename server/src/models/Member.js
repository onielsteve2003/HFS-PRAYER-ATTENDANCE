import mongoose from "mongoose";

const memberSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    normalizedName: {
      type: String,
      required: true,
      unique: true,
    },
    nameKey: {
      type: String,
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

export const Member = mongoose.model("Member", memberSchema);
