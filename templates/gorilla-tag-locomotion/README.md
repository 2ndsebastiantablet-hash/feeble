# Gorilla Tag Locomotion Template

This folder is a reusable WebXR/A-Frame starter for Quest browser projects that need simple Gorilla Tag-style hand locomotion.

## Files

- `index.html` sets up the A-Frame scene, player rig, tracked controllers, colliders, and in-world debug panel.
- `main.js` contains a tiny scene helper for updating the on-screen note when VR starts.
- `gorilla-locomotion.js` contains the reusable locomotion component with clear tuning constants and comments.

## Features

- A-Frame WebXR scene with the normal `Enter VR` button
- Quest controller tracking
- Visible hand spheres
- Hand push locomotion
- Floor collision
- Basic wall and box collisions
- Launch and bounce from stronger pushes
- Gravity and drag/damping
- Simple tuning constants at the top of `gorilla-locomotion.js`
- Debug text in the scene
- No thumbstick locomotion
- No teleport locomotion

## How To Use

1. Copy this folder into a new static site repo.
2. Keep the files together so `index.html` can load `main.js` and `gorilla-locomotion.js`.
3. Deploy the folder to an HTTPS static host.
4. Open the deployed URL in Meta Quest Browser.
5. Press `Enter VR`.
6. Push your tracked hands against the floor or boxes to move.

## Tuning Notes

- Increase `HAND_PUSH_MULTIPLIER` for faster hand-driven movement.
- Increase `UPWARD_BOUNCE_BOOST` for more upward pop.
- Increase `ONE_HAND_LAUNCH_MULTIPLIER` and `TWO_HAND_LAUNCH_MULTIPLIER` for stronger release launches.
- Lower `AIR_DRAG` if you want momentum to last longer.
- Raise `GROUND_DRAG` if you want the movement to feel more controlled and less slippery.
- Adjust `playerHeightOffset` in `index.html` if the floor feels too hard or too easy to reach in Quest.

## Hosting Notes

- This template is fully static.
- No npm, React, Vite, Webpack, Unity, or build step is required.
- The page must be hosted over HTTPS for WebXR to work in Quest Browser.
- The debug text is helpful while tuning and can be removed later for production.
