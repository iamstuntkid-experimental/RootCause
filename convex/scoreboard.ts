import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const RUN_TTL_MS = 24 * 60 * 60 * 1000;

export const startRun = internalMutation({
  args: {
    browserId: v.string(),
    proposedToken: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const submitted = await ctx.db
      .query("scores")
      .withIndex("by_browserId", (q) => q.eq("browserId", args.browserId))
      .first();

    if (submitted) {
      return { status: "already_submitted" as const };
    }

    const activeRun = await ctx.db
      .query("scoreRuns")
      .withIndex("by_browserId", (q) => q.eq("browserId", args.browserId))
      .order("desc")
      .first();

    if (
      activeRun &&
      activeRun.usedAt === undefined &&
      args.now - activeRun.createdAt < RUN_TTL_MS
    ) {
      return { status: "ready" as const, token: activeRun.token };
    }

    await ctx.db.insert("scoreRuns", {
      browserId: args.browserId,
      token: args.proposedToken,
      createdAt: args.now,
    });

    return { status: "ready" as const, token: args.proposedToken };
  },
});
export const submitScore = internalMutation({
  args: {
    browserId: v.string(),
    token: v.string(),
    username: v.string(),
    usernameKey: v.string(),
    score: v.number(),
    wave: v.number(),
    level: v.number(),
    durationSeconds: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("scoreRuns")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!run || run.browserId !== args.browserId) {
      return { status: "invalid_run" as const };
    }
    if (run.usedAt !== undefined) {
      return { status: "run_used" as const };
    }
    if (args.now - run.createdAt >= RUN_TTL_MS) {
      return { status: "run_expired" as const };
    }

    const existingBrowser = await ctx.db
      .query("scores")
      .withIndex("by_browserId", (q) => q.eq("browserId", args.browserId))
      .first();
    if (existingBrowser) {
      return { status: "already_submitted" as const };
    }

    const existingUsername = await ctx.db
      .query("scores")
      .withIndex("by_usernameKey", (q) => q.eq("usernameKey", args.usernameKey))
      .first();
    if (existingUsername) {
      return { status: "username_taken" as const };
    }

    await ctx.db.patch("scoreRuns", run._id, { usedAt: args.now });
    await ctx.db.insert("scores", {
      browserId: args.browserId,
      username: args.username,
      usernameKey: args.usernameKey,
      score: args.score,
      wave: args.wave,
      level: args.level,
      durationSeconds: args.durationSeconds,
      submittedAt: args.now,
    });

    return { status: "submitted" as const };
  },
});

export const listScores = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("scores")
      .withIndex("by_score_and_wave_and_durationSeconds")
      .order("desc")
      .take(25);

    return rows.map((row) => ({
      username: row.username,
      score: row.score,
      wave: row.wave,
      level: row.level,
      durationSeconds: row.durationSeconds,
      submittedAt: row.submittedAt,
    }));
  },
});
