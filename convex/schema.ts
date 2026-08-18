import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  scoreRuns: defineTable({
    browserId: v.string(),
    token: v.string(),
    createdAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index("by_browserId", ["browserId"])
    .index("by_token", ["token"]),

  scores: defineTable({
    browserId: v.string(),
    username: v.string(),
    usernameKey: v.string(),
    score: v.number(),
    wave: v.number(),
    level: v.number(),
    durationSeconds: v.number(),
    submittedAt: v.number(),
  })
    .index("by_browserId", ["browserId"])
    .index("by_usernameKey", ["usernameKey"])
    .index("by_score_and_wave_and_durationSeconds", [
      "score",
      "wave",
      "durationSeconds",
    ]),
});
