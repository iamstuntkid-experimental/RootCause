import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();
const BROWSER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_. -]{1,23}$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  Vary: "Origin",
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function options() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

http.route({
  path: "/api/scoreboard",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const requestedBrowserId = new URL(request.url).searchParams.get("browserId");
    const browserId = requestedBrowserId && BROWSER_ID_RE.test(requestedBrowserId)
      ? requestedBrowserId
      : undefined;
    const result = await ctx.runQuery(internal.scoreboard.listScores, {
      browserId,
    });
    return json(
      result,
      200,
      { "Cache-Control": "private, no-store" },
    );
  }),
});

http.route({
  path: "/api/scoreboard",
  method: "OPTIONS",
  handler: httpAction(async () => options()),
});

http.route({
  path: "/api/scoreboard/start",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (Number(request.headers.get("content-length") ?? 0) > 2048) {
      return json({ error: "Request too large." }, 413);
    }

    let body: { browserId?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }

    if (typeof body.browserId !== "string" || !BROWSER_ID_RE.test(body.browserId)) {
      return json({ error: "Invalid browser session." }, 400);
    }

    const result = await ctx.runMutation(internal.scoreboard.startRun, {
      browserId: body.browserId,
      proposedToken: crypto.randomUUID(),
      now: Date.now(),
    });

    return json({ token: result.token });
  }),
});

http.route({
  path: "/api/scoreboard/start",
  method: "OPTIONS",
  handler: httpAction(async () => options()),
});

http.route({
  path: "/api/scoreboard/submit",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (Number(request.headers.get("content-length") ?? 0) > 4096) {
      return json({ error: "Request too large." }, 413);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }

    const username = typeof body.username === "string" ? body.username.trim().replace(/\s+/g, " ") : "";
    if (!BROWSER_ID_RE.test(String(body.browserId ?? ""))) {
      return json({ error: "Invalid browser session." }, 400);
    }
    if (!BROWSER_ID_RE.test(String(body.token ?? ""))) {
      return json({ error: "Invalid or missing run token." }, 400);
    }
    if (!USERNAME_RE.test(username)) {
      return json({ error: "Use 2–24 letters, numbers, spaces, dots, underscores, or hyphens." }, 400);
    }
    if (
      !isNonNegativeSafeInteger(body.score) ||
      !isNonNegativeSafeInteger(body.wave) ||
      !isNonNegativeSafeInteger(body.level) ||
      !isNonNegativeSafeInteger(body.durationSeconds)
    ) {
      return json({ error: "Invalid score data." }, 400);
    }

    const result = await ctx.runMutation(internal.scoreboard.submitScore, {
      browserId: String(body.browserId),
      token: String(body.token),
      username,
      usernameKey: username.toLowerCase(),
      score: body.score,
      wave: body.wave,
      level: body.level,
      durationSeconds: body.durationSeconds,
      now: Date.now(),
    });

    const errors: Record<string, [number, string]> = {
      invalid_run: [400, "That game session is invalid."],
      run_used: [409, "That game session has already been submitted."],
      username_taken: [409, "That username is already on the board."],
    };
    const failure = errors[result.status];
    if (failure) {
      return json({ error: failure[1], code: result.status }, failure[0]);
    }

    return json({
      ok: true,
      isPersonalBest: result.isPersonalBest,
      personalBestUsername: result.personalBestUsername,
      personalBestScore: result.personalBestScore,
      attemptLikelyCheater: result.attemptLikelyCheater,
    }, 201);
  }),
});

http.route({
  path: "/api/scoreboard/submit",
  method: "OPTIONS",
  handler: httpAction(async () => options()),
});

export default http;
