# Root Cause

A browser game built for hackweek, published as a static site on GitHub Pages.

## Scoreboard architecture

The game stays static on GitHub Pages. Its public leaderboard API and persistent data live in Convex:

```text
GitHub Pages → Convex HTTP actions → Convex database
```

Each game receives a one-time run token. At game over, the browser submits the username and the game's existing `issues resolved` count. The backend mutation atomically checks and writes the entry, so:

- a run token can be submitted only once;
- a browser can submit as many completed runs as it wants, while only its personal best is ranked;
- usernames are unique without regard to case; and
- simultaneous duplicate requests cannot alter an already-used run.

The leaderboard shows the top 100 personal bests and pins the current browser's exact rank when it falls below that cutoff. A deliberately generous integrity model labels, but never rejects, scores that exceed the game's maximum possible wave or score progression. It uses server wall time, so pausing or unfocusing the game only increases the time allowance. It does not use IP-based limits.

This is intentionally a casual, no-login scoreboard. Clearing browser data or waiting out a plausible forged run can still bypass browser identity and heuristic score integrity. True anti-cheat would require a server-verifiable deterministic replay.

## Local development

Install dependencies and start a local Convex backend:

```sh
npm install
npm run backend:dev
```

The command prints a local HTTP actions URL, normally `http://127.0.0.1:3211`. Put that URL in `scoreboard-config.js` while testing locally. Local Convex configuration and data are ignored by Git.

## One-time production setup

Only the project owner needs to perform these account-level steps:

1. Create a Convex project for the scoreboard.
2. Open its production deployment settings and generate a deploy key with the `deployment:deploy` permission.
3. Save the key as `CONVEX_DEPLOY_KEY` in `.env.local` at this repository's root. Never commit or place it in browser code.
4. Add the same value as a GitHub Actions repository secret named `CONVEX_DEPLOY_KEY`.

Then deploy the backend:

```sh
npm run backend:deploy
```

Copy the production HTTP actions URL ending in `.convex.site` into `scoreboard-config.js`. That URL is public and safe to commit. The workflow in `.github/workflows/deploy-convex.yml` deploys later backend changes whenever they reach `main`.

Finally, enable GitHub Pages under **Settings → Pages → Deploy from a branch → `main` / `(root)`**. GitHub Pages deployments replace the static frontend only; they do not reset Convex data.

## Configuration

`scoreboard-config.js` contains only the public HTTP actions URL:

```js
window.ROOT_CAUSE_SCOREBOARD = Object.freeze({
  apiUrl: "https://your-production-deployment.convex.site",
});
```

Until that URL is filled in, the game remains playable and displays the leaderboard as awaiting deployment.
