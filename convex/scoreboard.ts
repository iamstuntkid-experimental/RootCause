import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const RULES_VERSION = 1;
const START_REQUEST_TOLERANCE_SECONDS = 15;
const MAX_CONCURRENT_ISSUES = 220;
const ABSOLUTE_MAX_KILLS_PER_SECOND = 70;

function minimumSecondsToStartWave(targetWave: number) {
  if (targetWave > 10_000) return Number.POSITIVE_INFINITY;
  let elapsed = 0;
  for (let wave = 1; wave < targetWave; wave += 1) {
    if (wave % 10 === 0) {
      elapsed += 2.6;
      continue;
    }

    let budget = Math.round(6 + wave * 2.5);
    if (wave % 4 === 0) budget = Math.round(budget * 1.2);
    const interval = Math.max(0.15, 0.6 - wave * 0.02);
    const maximumPerSpawnTick = budget > 24 ? 2 : 1;
    const spawnTicks = Math.ceil(budget / maximumPerSpawnTick);
    elapsed += Math.max(0, spawnTicks - 1) * interval + 2.6;
  }
  return elapsed;
}

function classifyIntegrity(args: {
  score: number;
  wave: number;
  startedAt: number;
  now: number;
}) {
  const serverElapsedSeconds = Math.max(0, (args.now - args.startedAt) / 1000);
  // Wall time keeps advancing while the game is paused or the tab is unfocused,
  // so pausing can only make these deliberately generous bounds more lenient.
  const effectiveElapsed = serverElapsedSeconds + START_REQUEST_TOLERANCE_SECONDS;
  const minimumWaveTime = minimumSecondsToStartWave(args.wave);
  const absoluteScoreLimit =
    MAX_CONCURRENT_ISSUES +
    Math.ceil(effectiveElapsed * ABSOLUTE_MAX_KILLS_PER_SECOND);

  if (minimumWaveTime > effectiveElapsed) {
    return {
      likelyCheater: true,
      integrityReason: "wave_progression",
      serverElapsedSeconds,
    };
  }
  if (args.score > absoluteScoreLimit) {
    return {
      likelyCheater: true,
      integrityReason: "score_progression",
      serverElapsedSeconds,
    };
  }
  return {
    likelyCheater: false,
    integrityReason: undefined,
    serverElapsedSeconds,
  };
}

export const startRun = internalMutation({
  args: {
    browserId: v.string(),
    proposedToken: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const activeRun = await ctx.db
      .query("scoreRuns")
      .withIndex("by_browserId", (q) => q.eq("browserId", args.browserId))
      .order("desc")
      .first();

    if (
      activeRun &&
      activeRun.usedAt === undefined
    ) {
      return { status: "ready" as const, token: activeRun.token };
    }

    await ctx.db.insert("scoreRuns", {
      browserId: args.browserId,
      token: args.proposedToken,
      createdAt: args.now,
      rulesVersion: RULES_VERSION,
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
    const existingBrowser = await ctx.db
      .query("scores")
      .withIndex("by_browserId", (q) => q.eq("browserId", args.browserId))
      .first();

    const existingUsername = await ctx.db
      .query("scores")
      .withIndex("by_usernameKey", (q) => q.eq("usernameKey", args.usernameKey))
      .first();
    if (existingUsername && existingUsername.browserId !== args.browserId) {
      return { status: "username_taken" as const };
    }

    const integrity = run.rulesVersion === RULES_VERSION
      ? classifyIntegrity({
          score: args.score,
          wave: args.wave,
          startedAt: run.createdAt,
          now: args.now,
        })
      : {
          likelyCheater: false,
          integrityReason: "rules_version_unverified",
          serverElapsedSeconds: Math.max(0, (args.now - run.createdAt) / 1000),
        };

    await ctx.db.patch("scoreRuns", run._id, { usedAt: args.now });
    const isPersonalBest = !existingBrowser || args.score > existingBrowser.score;
    if (existingBrowser && isPersonalBest) {
      await ctx.db.patch("scores", existingBrowser._id, {
        username: args.username,
        usernameKey: args.usernameKey,
        score: args.score,
        wave: args.wave,
        level: args.level,
        durationSeconds: args.durationSeconds,
        submittedAt: args.now,
        likelyCheater: integrity.likelyCheater,
        integrityReason: integrity.integrityReason,
        serverElapsedSeconds: integrity.serverElapsedSeconds,
        rulesVersion: run.rulesVersion,
      });
    } else if (!existingBrowser) {
      await ctx.db.insert("scores", {
        browserId: args.browserId,
        username: args.username,
        usernameKey: args.usernameKey,
        score: args.score,
        wave: args.wave,
        level: args.level,
        durationSeconds: args.durationSeconds,
        submittedAt: args.now,
        likelyCheater: integrity.likelyCheater,
        integrityReason: integrity.integrityReason,
        serverElapsedSeconds: integrity.serverElapsedSeconds,
        rulesVersion: run.rulesVersion,
      });
    }

    const personalBest = isPersonalBest || !existingBrowser
      ? { username: args.username, score: args.score }
      : { username: existingBrowser.username, score: existingBrowser.score };

    return {
      status: "submitted" as const,
      isPersonalBest,
      personalBestUsername: personalBest.username,
      personalBestScore: personalBest.score,
      attemptLikelyCheater: integrity.likelyCheater,
    };
  },
});

export const listScores = internalQuery({
  args: { browserId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const topRows = await ctx.db
      .query("scores")
      .withIndex("by_score_and_wave_and_durationSeconds")
      .order("desc")
      .take(100);
    const currentPlayer = args.browserId
      ? await ctx.db
          .query("scores")
          .withIndex("by_browserId", (q) => q.eq("browserId", args.browserId!))
          .first()
      : null;

    let currentRank: number | null = null;
    if (currentPlayer) {
      const topIndex = topRows.findIndex((row) => row._id === currentPlayer._id);
      if (topIndex >= 0) {
        currentRank = topIndex + 1;
      } else {
        const allRows = await ctx.db
          .query("scores")
          .withIndex("by_score_and_wave_and_durationSeconds")
          .order("desc")
          .collect();
        const index = allRows.findIndex((row) => row._id === currentPlayer._id);
        if (index >= 0) currentRank = index + 1;
      }
    }

    const publicRow = (row: (typeof topRows)[number], rank: number) => ({
      rank,
      username: row.username,
      score: row.score,
      wave: row.wave,
      level: row.level,
      durationSeconds: row.durationSeconds,
      submittedAt: row.submittedAt,
      likelyCheater: row.likelyCheater ?? false,
      isCurrentPlayer: currentPlayer?._id === row._id,
    });

    return {
      scores: topRows.map((row, index) => publicRow(row, index + 1)),
      currentPlayer: currentPlayer && currentRank
        ? publicRow(currentPlayer, currentRank)
        : null,
    };
  },
});
