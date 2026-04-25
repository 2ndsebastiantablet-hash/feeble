# Quest Gorilla Locomotion Prototype

This is a WebXR locomotion prototype for Meta Quest Browser using A-Frame and plain JavaScript.

It now includes:

- Gorilla Tag-style hand locomotion
- a Cloudflare Worker multiplayer backend adapted from the `fly-game` multiplayer template
- a browser multiplayer client that syncs VR rig, head, and hand positions
- simple remote player avatars rendered directly in the A-Frame scene

## Frontend files

- `index.html`
- `main.js`
- `gorilla-locomotion.js`
- `frontend/multiplayer-client.js`

## Multiplayer backend files

- `backend/server.js`
- `backend/lobby-manager.js`
- `backend/realtime-server.js`
- `backend/server-authority.js`
- `backend/rate-limit.js`
- `backend/utils.js`
- `wrangler.toml`
- `package.json`

## What the multiplayer adaptation uses from the template

The multiplayer system is based on the pinned template from:

- repo: `2ndsebastiantablet-hash/fly-game`
- commit: `389610aa69a18eb56eadb228520a5f4dfd33109d`
- folder: `multiplayer-template`

Template pieces reused as the base:

- public and private lobby flow
- Durable Object lobby directory
- one room Durable Object per lobby
- reconnect support
- WebSocket state sync
- rate limiting and message validation
- frontend `MultiplayerClient`

Game-specific adaptations made here:

- the server authority now accepts VR pose state instead of a 2D demo state
- snapshots expose `youPlayerId` so the frontend can avoid rendering your own remote avatar
- the frontend pushes `rig`, `head`, `leftHand`, and `rightHand` world positions from the A-Frame scene
- the frontend renders remote players as simple head/body/hand avatars

## How to run the frontend

1. Deploy the root folder to a normal HTTPS static host such as Netlify, GitHub Pages, or Cloudflare Pages.
2. Open the deployed site in a desktop browser or Meta Quest Browser.
3. Enter your deployed Worker URL in the multiplayer panel before creating or joining a lobby.

## How to run the multiplayer backend

1. Install dependencies:
   `npm install`
2. Log into Cloudflare:
   `npx wrangler login`
3. Run locally:
   `npm run dev`
4. Deploy:
   `npm run deploy`

The Worker entry stays at `backend/server.js`, following the template layout.

## How to test on Quest

1. Deploy the static frontend to HTTPS.
2. Deploy the Cloudflare Worker backend.
3. Open the frontend URL in Meta Quest Browser.
4. Enter the Worker URL in the multiplayer panel.
5. Create or join a lobby.
6. Press `Enter VR`.
7. Confirm you can:
   - move with hand locomotion
   - see remote player avatars update live
   - create public lobbies, private lobbies, and join by code

## Cloudflare deployment settings

Use Cloudflare as two separate deployments:

- Frontend: Cloudflare Pages
- Multiplayer backend: Cloudflare Workers with Durable Objects

Do not try to deploy the Worker backend as a Pages build artifact.

### Cloudflare Pages settings for the frontend

- Project type: `Cloudflare Pages`
- Production branch: `main`
- Framework preset: `None`
- Root directory: `/`
- Build command: `npm run build`
- Build output directory / publish directory: `.`

Why these settings:

- the frontend is already a static site in the repo root
- `npm run build` is now a no-op success script so Pages can complete the build cleanly
- the publish directory must stay `.` because `index.html`, `main.js`, and `gorilla-locomotion.js` live in the repo root

### Cloudflare Workers settings for the multiplayer backend

- Project type: `Cloudflare Worker`
- Wrangler config: `wrangler.toml`
- Worker entry file: `backend/server.js`
- Deploy command: `npm install && npm run deploy`

### Required environment variables

No extra required variables are needed to get the Worker running because the defaults already exist in `wrangler.toml`.

For production, you should set:

- `ALLOWED_ORIGIN` = your real Cloudflare Pages site URL instead of `*`

Example:

- `ALLOWED_ORIGIN=https://your-project.pages.dev`

### Recommended deployment order

1. Deploy the Worker first and copy its URL.
2. Deploy the Pages frontend with the settings above.
3. Open the site and paste the Worker URL into the multiplayer panel.

## Important notes

- Thumbstick locomotion and teleport are still disabled.
- This is still a prototype. The multiplayer sync is pose/state sync, not a full authoritative physics simulation.
- The server-authoritative hooks live in `backend/server-authority.js`.
