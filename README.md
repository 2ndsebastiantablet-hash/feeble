# Quest Gorilla Locomotion Prototype

This is a small WebXR locomotion prototype for Meta Quest Browser using A-Frame and plain JavaScript.

It is not a full Gorilla Tag clone. It is only a first browser-based test of hand-push locomotion.

## Files

- `index.html`
- `main.js`
- `README.md`
- `netlify.toml`
- `.nojekyll`

## What it does

- Shows the normal A-Frame `Enter VR` button.
- Creates a player rig with a camera and left/right tracked controller entities.
- Renders visible hand spheres so you can see your controller positions.
- Lets you move by pushing your hands against the floor or test blocks.
- Applies simple release momentum, gravity, floor collision, damping, and velocity clamping.
- Shows in-headset debug text for:
  - left hand touching
  - right hand touching
  - player velocity

## How the movement works

Each frame, the prototype:

1. Reads the world position of the left and right hand/controller entities.
2. Measures how far each hand moved since the previous frame.
3. Checks whether each hand sphere overlaps the floor or a test block.
4. If a hand is touching, moves the player rig in the opposite direction of that hand movement.
5. If both hands are touching, averages the combined movement.
6. Stores recent locomotion velocity so releasing your hands keeps a small launch effect.
7. Applies gravity and damping when you are not actively pushing.
8. Clamps movement and velocity so the browser prototype stays stable.

This is intentionally simple and meant for debugging, not for perfect Gorilla Tag feel yet.

## How to deploy

1. Upload this folder to a static HTTPS host such as Netlify, GitHub Pages, or Cloudflare Pages.
2. Make sure `index.html` is served from the site root.
3. Do not add a build step. This project is already static.

## How to test on Meta Quest

1. Open the deployed HTTPS URL in Meta Quest Browser.
2. Wait for the page to load.
3. Press `Enter VR`.
4. Confirm you can see:
   - the floor
   - the test blocks
   - the left and right hand spheres
   - the debug text panel
5. Push your hands against the floor or blocks and confirm the rig moves without thumbstick locomotion or teleport.
6. Release after a strong push and confirm there is slight momentum.
7. Confirm gravity brings you back down and the floor catches you.

## Important notes

- Keyboard movement, thumbstick locomotion, and teleport are not included.
- Hand collision is simple on purpose and uses sphere-vs-floor and sphere-vs-box overlap checks.
- The player body does not have a full physics capsule yet.
- This is a first working prototype for Quest Browser testing, not final locomotion.
