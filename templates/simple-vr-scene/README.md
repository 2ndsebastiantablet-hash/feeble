# Simple VR Scene Template

This is a minimal static A-Frame/WebXR starter for Meta Quest Browser testing.
It now includes simple Quest locomotion controls for template projects.

## Files

- `index.html` = A-Frame scene with floor, sky, lighting, player rig, and Quest controllers
- `main.js` = small browser-only locomotion helper for movement and jumping

## Features

- A-Frame setup
- automatic `Enter VR` button support
- basic camera/player rig
- left joystick movement
- right controller A-button jump
- floor
- sky/background
- simple objects
- basic lighting

## How to use

1. Copy this folder into a new static site project.
2. Deploy it to an HTTPS host.
3. Open the deployed URL in Meta Quest Browser.
4. Press `Enter VR`.
5. Confirm the scene appears in the headset.
6. Use the left joystick to move around.
7. Press the right controller `A` button to jump.

## Hosting notes

- Keep this as a static site.
- Do not use local file paths.
- No npm, React, Vite, Webpack, or build step is required.
