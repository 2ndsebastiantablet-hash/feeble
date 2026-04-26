# FEEBLE

This is a WebXR Quest game prototype for Meta Quest Browser using A-Frame and plain JavaScript.

It now includes:

- a VR-first `FEEBLE` main menu with a Play button
- left joystick movement, right joystick turning, and right-button jump
- grabbable objects that can be picked up with either controller grip button
- a Cloudflare Worker multiplayer backend adapted from the `fly-game` multiplayer template
- a browser multiplayer client that syncs VR rig, head, and hand positions
- simple remote player avatars rendered directly in the A-Frame scene

## Frontend files

- `index.html`
- `main.js`
- `gorilla-locomotion.js`
- `frontend/multiplayer-client.js`

## Reusable Templates

- `templates/simple-vr-scene` = minimal Quest WebXR/A-Frame starter
- `templates/gorilla-tag-locomotion` = Gorilla Tag-style WebXR hand movement starter

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

## How to run on Cloudflare

This project now uses a single Cloudflare Worker deployment:

- the main Worker URL serves the game frontend
- the same Worker URL also serves the multiplayer API and WebSocket backend

Worker entry:

- `backend/server.js`

Static assets served by the Worker from `public/`:

- `index.html`
- `main.js`
- `gorilla-locomotion.js`
- `frontend/multiplayer-client.js`

Deploy steps:

1. Install dependencies:
   `npm install`
2. Log into Cloudflare:
   `npx wrangler login`
3. Run locally:
   `npm run dev`
4. Deploy:
   `npm run deploy`

## How to test on Quest

1. Deploy the Cloudflare Worker.
2. Open the Worker root URL in Meta Quest Browser.
3. Press `Enter VR`.
4. Confirm you can:
   - use the VR main menu
   - move with the left joystick
   - turn with the right joystick
   - jump with the right controller button
   - pick up scene objects with either grip button
   - see remote player avatars update live
   - create public lobbies, create private lobbies, and join public lobby listings from the VR multiplayer menu

The multiplayer input now defaults to the current site origin, so when you open the deployed Worker URL it already points at the correct backend.

## Cloudflare deployment settings

Use Cloudflare Workers, not Cloudflare Pages, for this deployment.

### Cloudflare Worker settings

- Project type: `Cloudflare Worker`
- Wrangler config: `wrangler.toml`
- Worker entry file: `backend/server.js`
- Deploy command: `npm install && npm run deploy`

### Static asset settings in `wrangler.toml`

- `directory = "public"`
- `binding = "ASSETS"`
- `run_worker_first = true`

This means:

- `/` serves `index.html`
- `/main.js` serves the frontend bootstrap
- `/gorilla-locomotion.js` serves the locomotion script
- `/frontend/multiplayer-client.js` serves the browser multiplayer client
- `/api/*` stays on the Worker backend
- `/ws` stays on the Worker backend

Only browser files should live in `public/`.
Do not place `node_modules`, backend files, package files, or logs in that folder.

### Required environment variables

No extra required variables are needed to get the Worker running because the defaults already exist in `wrangler.toml`.

For production, you should set:

- `ALLOWED_ORIGIN=<your deployed Worker origin>`

Example:

- `ALLOWED_ORIGIN=https://feeble-multiplayer.your-subdomain.workers.dev`

## Important notes

- Teleport is still disabled.
- This is still a prototype. The multiplayer sync is pose/state sync, not a full authoritative physics simulation.
- The server-authoritative hooks live in `backend/server-authority.js`.
