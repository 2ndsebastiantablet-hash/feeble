import { MultiplayerClient } from "./frontend/multiplayer-client.js";

const PLAYER_NAME_KEY = "feeble_player_name";
const LOCAL_META = {
  headColor: "#F2F5FF",
  bodyColor: "#7A9BFF",
  leftHandColor: "#FF7AA2",
  rightHandColor: "#6FC3FF"
};

const DAY_DURATION = 120;
const NIGHT_DURATION = 720;
const MAX_DAYS = 5;
const HOUSE_BODY_COLOR = "#F6E8BF";
const HOUSE_TRIM_COLOR = "#E3D6B0";
const HOUSE_ROOF_COLOR = "#8A5A43";
const HILL_COLOR = "#7BAF4B";
const FENCE_COLOR = "#F6F7FB";

const TEMP = {
  rig: new THREE.Vector3(),
  head: new THREE.Vector3(),
  leftHand: new THREE.Vector3(),
  rightHand: new THREE.Vector3()
};

const avatarMap = new Map();

AFRAME.registerComponent("grabbable", {
  init: function () {
    this.el.addEventListener("stateadded", updateGrabTint);
    this.el.addEventListener("stateremoved", updateGrabTint);
  }
});

AFRAME.registerComponent("hand-grabber", {
  schema: {
    radius: { default: 0.45 }
  },

  init: function () {
    this.heldEl = null;
    this.handWorld = new THREE.Vector3();
    this.objectWorld = new THREE.Vector3();
    this.onGripDown = this.onGripDown.bind(this);
    this.onGripUp = this.onGripUp.bind(this);
  },

  play: function () {
    this.el.addEventListener("gripdown", this.onGripDown);
    this.el.addEventListener("gripup", this.onGripUp);
  },

  pause: function () {
    this.el.removeEventListener("gripdown", this.onGripDown);
    this.el.removeEventListener("gripup", this.onGripUp);
  },

  onGripDown: function () {
    if (this.heldEl) {
      return;
    }

    const candidates = Array.from(this.el.sceneEl.querySelectorAll(".grabbable-object"));
    let closestEl = null;
    let closestDistance = this.data.radius;

    this.el.sceneEl.object3D.updateMatrixWorld(true);
    this.el.object3D.getWorldPosition(this.handWorld);

    for (const candidate of candidates) {
      if (candidate.is("held")) {
        continue;
      }

      candidate.object3D.getWorldPosition(this.objectWorld);
      const distance = this.handWorld.distanceTo(this.objectWorld);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestEl = candidate;
      }
    }

    if (!closestEl) {
      return;
    }

    this.el.sceneEl.object3D.updateMatrixWorld(true);
    this.el.object3D.attach(closestEl.object3D);
    closestEl.addState("held");
    this.heldEl = closestEl;
  },

  onGripUp: function () {
    if (!this.heldEl) {
      return;
    }

    this.el.sceneEl.object3D.updateMatrixWorld(true);
    this.el.sceneEl.object3D.attach(this.heldEl.object3D);
    this.heldEl.removeState("held");
    this.heldEl = null;
  }
});

AFRAME.registerComponent("face-player", {
  schema: {
    target: { type: "selector" }
  },

  init: function () {
    this.targetPosition = new THREE.Vector3();
    this.selfPosition = new THREE.Vector3();
  },

  tick: function () {
    const target = this.data.target;

    if (!target) {
      return;
    }

    target.object3D.getWorldPosition(this.targetPosition);
    this.el.object3D.getWorldPosition(this.selfPosition);
    this.el.object3D.lookAt(this.targetPosition);
  }
});

AFRAME.registerComponent("day-night-cycle", {
  schema: {
    dayDuration: { default: DAY_DURATION },
    nightDuration: { default: NIGHT_DURATION },
    maxDays: { default: MAX_DAYS }
  },

  init: function () {
    this.sceneEl = this.el.sceneEl;
    this.skyEl = document.getElementById("sky");
    this.sunEl = document.getElementById("sun");
    this.moonEl = document.getElementById("moon");
    this.phaseEl = document.getElementById("cycle-phase");
    this.timerEl = document.getElementById("cycle-timer");
    this.ambientEl = document.getElementById("ambient-light");
    this.sunLightEl = document.getElementById("sun-light");
    this.moonLightEl = document.getElementById("moon-light");
  },

  tick: function (timeMs) {
    const cycleDuration = this.data.dayDuration + this.data.nightDuration;
    const elapsedSeconds = timeMs / 1000;
    const cycleIndex = Math.floor(elapsedSeconds / cycleDuration);
    const secondsInCycle = elapsedSeconds % cycleDuration;
    const currentDay = Math.min(cycleIndex + 1, this.data.maxDays);
    const isDay = secondsInCycle < this.data.dayDuration;

    if (isDay) {
      const phaseProgress = secondsInCycle / this.data.dayDuration;
      const timeRemaining = this.data.dayDuration - secondsInCycle;
      this.renderDay(currentDay, phaseProgress, timeRemaining);
      return;
    }

    const nightSeconds = secondsInCycle - this.data.dayDuration;
    const phaseProgress = nightSeconds / this.data.nightDuration;
    const timeRemaining = this.data.nightDuration - nightSeconds;
    this.renderNight(currentDay, phaseProgress, timeRemaining);
  },

  renderDay: function (currentDay, phaseProgress, timeRemaining) {
    const skyColor = lerpColor("#DDF1FF", "#85C5FF", Math.sin(phaseProgress * Math.PI));
    const fogColor = lerpColor("#DDEED5", "#CDE4C1", phaseProgress);
    const sunX = THREE.MathUtils.lerp(-75, 75, phaseProgress);
    const sunY = 24 + Math.sin(phaseProgress * Math.PI) * 18;

    this.sceneEl.setAttribute("fog", "type: linear; color: " + fogColor + "; near: 40; far: 120");
    this.skyEl.setAttribute("color", skyColor);
    this.sunEl.setAttribute("visible", "true");
    this.moonEl.setAttribute("visible", "false");
    this.sunEl.setAttribute("position", sunX + " " + sunY + " -80");
    this.sunLightEl.setAttribute("light", {
      type: "directional",
      intensity: THREE.MathUtils.lerp(0.7, 1.15, Math.sin(phaseProgress * Math.PI)),
      color: "#FFF2C4"
    });
    this.sunLightEl.setAttribute("position", sunX * 0.7 + " " + (sunY + 8) + " -55");
    this.moonLightEl.setAttribute("light", { type: "directional", intensity: 0.08, color: "#8AA0FF" });
    this.ambientEl.setAttribute("light", {
      type: "ambient",
      intensity: THREE.MathUtils.lerp(0.45, 0.72, Math.sin(phaseProgress * Math.PI)),
      color: "#FFFFFF"
    });
    this.phaseEl.setAttribute("value", "DAY " + currentDay + " / " + this.data.maxDays + "   NIGHT IN");
    this.timerEl.setAttribute("value", formatCountdown(timeRemaining));
  },

  renderNight: function (currentDay, phaseProgress, timeRemaining) {
    const skyColor = lerpColor("#1E2A50", "#070B18", Math.sin(phaseProgress * Math.PI));
    const fogColor = lerpColor("#33405F", "#1B2338", phaseProgress);
    const moonX = THREE.MathUtils.lerp(75, -75, phaseProgress);
    const moonY = 20 + Math.sin(phaseProgress * Math.PI) * 14;

    this.sceneEl.setAttribute("fog", "type: linear; color: " + fogColor + "; near: 28; far: 95");
    this.skyEl.setAttribute("color", skyColor);
    this.sunEl.setAttribute("visible", "false");
    this.moonEl.setAttribute("visible", "true");
    this.moonEl.setAttribute("position", moonX + " " + moonY + " -80");
    this.sunLightEl.setAttribute("light", { type: "directional", intensity: 0.05, color: "#6B7399" });
    this.moonLightEl.setAttribute("light", {
      type: "directional",
      intensity: THREE.MathUtils.lerp(0.2, 0.34, Math.sin(phaseProgress * Math.PI)),
      color: "#94A9FF"
    });
    this.moonLightEl.setAttribute("position", moonX * 0.7 + " " + (moonY + 8) + " -55");
    this.ambientEl.setAttribute("light", {
      type: "ambient",
      intensity: THREE.MathUtils.lerp(0.14, 0.22, Math.sin(phaseProgress * Math.PI)),
      color: "#A8B6FF"
    });
    this.phaseEl.setAttribute("value", "DAY " + currentDay + " / " + this.data.maxDays + "   SUNRISE IN");
    this.timerEl.setAttribute("value", formatCountdown(timeRemaining));
  }
});

window.addEventListener("DOMContentLoaded", function () {
  const scene = document.querySelector("a-scene");
  const note = document.getElementById("note");
  const rigEl = document.getElementById("player-rig");
  const headEl = document.getElementById("player-camera");
  const leftHandEl = document.getElementById("left-hand");
  const rightHandEl = document.getElementById("right-hand");
  const remotePlayersRoot = document.getElementById("remote-players");
  const worldRoot = document.getElementById("world-root");

  if (!scene || !note || !rigEl || !headEl || !leftHandEl || !rightHandEl || !remotePlayersRoot || !worldRoot) {
    return;
  }

  buildNeighborhoodWorld(worldRoot);

  note.textContent = "You spawn directly into the Neighborhood hub. Move with the left joystick, turn with the right joystick, jump with the right A button, and grab loose supplies with either grip button.";

  let client = null;

  function ensureClient() {
    if (client) {
      return client;
    }

    client = new MultiplayerClient(window.location.origin, {
      storageKey: "feeble_multiplayer_session",
      onSnapshot: renderSnapshot,
      onError: function () {}
    });

    return client;
  }

  function buildLocalState() {
    scene.object3D.updateMatrixWorld(true);
    rigEl.object3D.getWorldPosition(TEMP.rig);
    headEl.object3D.getWorldPosition(TEMP.head);
    leftHandEl.object3D.getWorldPosition(TEMP.leftHand);
    rightHandEl.object3D.getWorldPosition(TEMP.rightHand);

    return {
      rig: vectorToObject(TEMP.rig),
      head: vectorToObject(TEMP.head),
      leftHand: vectorToObject(TEMP.leftHand),
      rightHand: vectorToObject(TEMP.rightHand)
    };
  }

  function renderSnapshot(snapshot) {
    clearMissingAvatars(snapshot);

    if (!snapshot) {
      return;
    }

    const localPlayerId = snapshot.youPlayerId || null;

    for (const player of snapshot.players) {
      if (player.playerId === localPlayerId) {
        continue;
      }

      const avatar = getOrCreateAvatar(player.playerId, remotePlayersRoot);
      updateAvatar(avatar, player);
    }
  }

  function clearMissingAvatars(snapshot) {
    const activeIds = new Set();

    if (snapshot) {
      for (const player of snapshot.players) {
        if (player.playerId !== snapshot.youPlayerId) {
          activeIds.add(player.playerId);
        }
      }
    }

    for (const [playerId, avatar] of avatarMap.entries()) {
      if (!activeIds.has(playerId)) {
        avatar.root.remove();
        avatarMap.delete(playerId);
      }
    }
  }

  function stateLoop() {
    if (client?.snapshot) {
      client.pushState(buildLocalState(), LOCAL_META);
    }

    requestAnimationFrame(stateLoop);
  }

  ensureClient().restore().then(function (snapshot) {
    if (snapshot) {
      renderSnapshot(snapshot);
    }
  }).catch(function () {});

  stateLoop();
});

function buildNeighborhoodWorld(root) {
  const hillsRoot = document.createElement("a-entity");
  const housesRoot = document.createElement("a-entity");
  const fencesRoot = document.createElement("a-entity");
  const propsRoot = document.createElement("a-entity");
  const lootRoot = document.createElement("a-entity");

  root.appendChild(hillsRoot);
  root.appendChild(housesRoot);
  root.appendChild(fencesRoot);
  root.appendChild(propsRoot);
  root.appendChild(lootRoot);

  const hillSpecs = [
    { x: -26, y: -7, z: -18, scale: "1.5 0.45 1.35" },
    { x: -12, y: -6.3, z: -26, scale: "1.2 0.4 1.15" },
    { x: 8, y: -7.2, z: -22, scale: "1.45 0.48 1.25" },
    { x: 22, y: -7, z: -14, scale: "1.35 0.44 1.3" },
    { x: -30, y: -7, z: 16, scale: "1.4 0.44 1.25" },
    { x: -12, y: -6.5, z: 20, scale: "1.15 0.38 1.1" },
    { x: 12, y: -7.2, z: 18, scale: "1.55 0.48 1.25" },
    { x: 30, y: -6.8, z: 12, scale: "1.25 0.42 1.1" },
    { x: -44, y: -8, z: -8, scale: "1.9 0.5 1.4" },
    { x: 45, y: -8, z: -4, scale: "1.8 0.5 1.35" },
    { x: -42, y: -8, z: 24, scale: "1.8 0.5 1.35" },
    { x: 42, y: -8, z: 26, scale: "1.9 0.52 1.4" }
  ];

  for (const hill of hillSpecs) {
    const hillEl = document.createElement("a-sphere");
    hillEl.setAttribute("radius", "18");
    hillEl.setAttribute("position", hill.x + " " + hill.y + " " + hill.z);
    hillEl.setAttribute("scale", hill.scale);
    hillEl.setAttribute("color", HILL_COLOR);
    hillEl.setAttribute("shader", "flat");
    hillsRoot.appendChild(hillEl);
  }

  const houseSpecs = [
    { x: -18, y: 3.6, z: -12, scale: 1.1, rotation: -8 },
    { x: -4, y: 1.8, z: -28, scale: 0.85, rotation: 10 },
    { x: 14, y: 3.6, z: -18, scale: 1.2, rotation: -5 },
    { x: 26, y: 2.8, z: -7, scale: 0.9, rotation: 12 },
    { x: -24, y: 3.4, z: 18, scale: 0.95, rotation: 7 },
    { x: -6, y: 2.4, z: 24, scale: 0.82, rotation: -12 },
    { x: 18, y: 3.7, z: 16, scale: 1.05, rotation: -9 },
    { x: 34, y: 2.8, z: 10, scale: 0.88, rotation: 6 },
    { x: -39, y: 4.4, z: -6, scale: 1.1, rotation: 10 },
    { x: 41, y: 4.3, z: 1, scale: 1.08, rotation: -6 }
  ];

  for (const house of houseSpecs) {
    housesRoot.appendChild(createHouse(house));
  }

  createFenceLine(fencesRoot, { xStart: -62, xEnd: 62, z: -5.2 });
  createFenceLine(fencesRoot, { xStart: -62, xEnd: 62, z: 5.2 });
  createFenceCurve(fencesRoot, { xStart: -30, xEnd: -4, z: -20, y: 0.8 });
  createFenceCurve(fencesRoot, { xStart: 8, xEnd: 34, z: 18, y: 1.1 });

  propsRoot.appendChild(createWaterTower(-32, 9.5, -24, 1.15));
  propsRoot.appendChild(createRoadSign(10, 1.1, 13, -15));
  propsRoot.appendChild(createRoadSign(-9, 1.1, -14, 14));

  const lootSpecs = [
    { x: -2.4, y: 0.55, z: -8, color: "#FFD36A", shape: "box" },
    { x: 3.1, y: 0.62, z: 11.4, color: "#90E0FF", shape: "sphere" },
    { x: -14.6, y: 1.1, z: -10.5, color: "#FF9BC3", shape: "cylinder" },
    { x: 15.6, y: 0.95, z: 15.8, color: "#B4FF9D", shape: "box" },
    { x: -23.5, y: 0.8, z: 17.4, color: "#E9C5FF", shape: "sphere" },
    { x: 26.8, y: 0.8, z: -6.4, color: "#FFE68E", shape: "cylinder" }
  ];

  for (const loot of lootSpecs) {
    lootRoot.appendChild(createLootProp(loot));
  }
}

function createHouse(options) {
  const root = document.createElement("a-entity");
  const body = document.createElement("a-box");
  const roof = document.createElement("a-cone");
  const door = document.createElement("a-plane");
  const trimLeft = document.createElement("a-box");
  const trimRight = document.createElement("a-box");
  const trimCenter = document.createElement("a-box");

  const scale = options.scale || 1;

  root.setAttribute("position", options.x + " " + options.y + " " + options.z);
  root.setAttribute("rotation", "0 " + (options.rotation || 0) + " 0");
  root.setAttribute("scale", scale + " " + scale + " " + scale);

  body.setAttribute("width", "3.2");
  body.setAttribute("height", "4.9");
  body.setAttribute("depth", "3");
  body.setAttribute("color", HOUSE_BODY_COLOR);
  body.setAttribute("position", "0 2.45 0");

  roof.setAttribute("radius-bottom", "2.55");
  roof.setAttribute("radius-top", "0.2");
  roof.setAttribute("height", "2.4");
  roof.setAttribute("segments-radial", "4");
  roof.setAttribute("rotation", "45 45 0");
  roof.setAttribute("position", "0 6 0");
  roof.setAttribute("color", HOUSE_ROOF_COLOR);

  door.setAttribute("width", "0.8");
  door.setAttribute("height", "1.55");
  door.setAttribute("position", "0 0.92 1.51");
  door.setAttribute("color", "#B28A68");

  trimLeft.setAttribute("width", "0.12");
  trimLeft.setAttribute("height", "4.95");
  trimLeft.setAttribute("depth", "3.05");
  trimLeft.setAttribute("position", "-1.57 2.48 0");
  trimLeft.setAttribute("color", HOUSE_TRIM_COLOR);

  trimRight.setAttribute("width", "0.12");
  trimRight.setAttribute("height", "4.95");
  trimRight.setAttribute("depth", "3.05");
  trimRight.setAttribute("position", "1.57 2.48 0");
  trimRight.setAttribute("color", HOUSE_TRIM_COLOR);

  trimCenter.setAttribute("width", "0.12");
  trimCenter.setAttribute("height", "4.95");
  trimCenter.setAttribute("depth", "3.05");
  trimCenter.setAttribute("position", "0 2.48 0");
  trimCenter.setAttribute("color", HOUSE_TRIM_COLOR);

  root.appendChild(body);
  root.appendChild(roof);
  root.appendChild(door);
  root.appendChild(trimLeft);
  root.appendChild(trimRight);
  root.appendChild(trimCenter);

  addHouseWindows(root);
  return root;
}

function addHouseWindows(root) {
  const rows = [
    { y: 3.85, xs: [-0.8, 0.8] },
    { y: 2.45, xs: [-0.8, 0.8] },
    { y: 1.08, xs: [-0.8, 0.8] }
  ];

  for (const row of rows) {
    for (const x of row.xs) {
      const frame = document.createElement("a-plane");
      const windowPane = document.createElement("a-plane");

      frame.setAttribute("width", "0.54");
      frame.setAttribute("height", "0.84");
      frame.setAttribute("position", x + " " + row.y + " 1.515");
      frame.setAttribute("color", "#F7F8F8");

      windowPane.setAttribute("width", "0.42");
      windowPane.setAttribute("height", "0.72");
      windowPane.setAttribute("position", x + " " + row.y + " 1.525");
      windowPane.setAttribute("color", "#1B2027");

      root.appendChild(frame);
      root.appendChild(windowPane);
    }
  }
}

function createFenceLine(root, options) {
  for (let x = options.xStart; x <= options.xEnd; x += 1.6) {
    const post = document.createElement("a-box");
    post.setAttribute("width", "0.16");
    post.setAttribute("height", "1.15");
    post.setAttribute("depth", "0.16");
    post.setAttribute("position", x + " 0.58 " + options.z);
    post.setAttribute("color", FENCE_COLOR);
    root.appendChild(post);
  }

  const railTop = document.createElement("a-box");
  railTop.setAttribute("width", options.xEnd - options.xStart + 0.8);
  railTop.setAttribute("height", "0.08");
  railTop.setAttribute("depth", "0.08");
  railTop.setAttribute("position", ((options.xStart + options.xEnd) / 2) + " 0.82 " + options.z);
  railTop.setAttribute("color", FENCE_COLOR);

  const railBottom = document.createElement("a-box");
  railBottom.setAttribute("width", options.xEnd - options.xStart + 0.8);
  railBottom.setAttribute("height", "0.08");
  railBottom.setAttribute("depth", "0.08");
  railBottom.setAttribute("position", ((options.xStart + options.xEnd) / 2) + " 0.45 " + options.z);
  railBottom.setAttribute("color", FENCE_COLOR);

  root.appendChild(railTop);
  root.appendChild(railBottom);
}

function createFenceCurve(root, options) {
  for (let x = options.xStart; x <= options.xEnd; x += 1.4) {
    const post = document.createElement("a-box");
    const y = options.y + Math.sin((x - options.xStart) * 0.18) * 0.35;
    post.setAttribute("width", "0.16");
    post.setAttribute("height", "1.1");
    post.setAttribute("depth", "0.16");
    post.setAttribute("position", x + " " + y + " " + options.z);
    post.setAttribute("color", FENCE_COLOR);
    root.appendChild(post);
  }
}

function createWaterTower(x, y, z, scale) {
  const root = document.createElement("a-entity");
  const tank = document.createElement("a-cylinder");
  const cap = document.createElement("a-sphere");

  root.setAttribute("position", x + " " + y + " " + z);
  root.setAttribute("scale", scale + " " + scale + " " + scale);

  tank.setAttribute("radius", "1.25");
  tank.setAttribute("height", "2.8");
  tank.setAttribute("color", "#E7E5D8");
  tank.setAttribute("position", "0 5.8 0");

  cap.setAttribute("radius", "1.28");
  cap.setAttribute("scale", "1 0.5 1");
  cap.setAttribute("color", "#EFEDE1");
  cap.setAttribute("position", "0 7.05 0");

  root.appendChild(tank);
  root.appendChild(cap);

  const legPositions = [
    [-0.9, 2.7, -0.9],
    [0.9, 2.7, -0.9],
    [-0.9, 2.7, 0.9],
    [0.9, 2.7, 0.9]
  ];

  for (const leg of legPositions) {
    const legEl = document.createElement("a-cylinder");
    legEl.setAttribute("radius", "0.1");
    legEl.setAttribute("height", "5.4");
    legEl.setAttribute("color", "#D9D7CA");
    legEl.setAttribute("position", leg[0] + " " + leg[1] + " " + leg[2]);
    root.appendChild(legEl);
  }

  return root;
}

function createRoadSign(x, y, z, rotationY) {
  const root = document.createElement("a-entity");
  const pole = document.createElement("a-cylinder");
  const sign = document.createElement("a-circle");
  const arrow = document.createElement("a-text");

  root.setAttribute("position", x + " " + y + " " + z);
  root.setAttribute("rotation", "0 " + rotationY + " 0");

  pole.setAttribute("radius", "0.05");
  pole.setAttribute("height", "1.8");
  pole.setAttribute("color", "#C6CDD4");
  pole.setAttribute("position", "0 0.9 0");

  sign.setAttribute("radius", "0.34");
  sign.setAttribute("color", "#FFFFFF");
  sign.setAttribute("position", "0 1.75 0");

  arrow.setAttribute("value", ">");
  arrow.setAttribute("color", "#2D5B9F");
  arrow.setAttribute("width", "2.5");
  arrow.setAttribute("align", "center");
  arrow.setAttribute("position", "0 1.74 0.02");

  root.appendChild(pole);
  root.appendChild(sign);
  root.appendChild(arrow);
  return root;
}

function createLootProp(options) {
  let el;

  if (options.shape === "sphere") {
    el = document.createElement("a-sphere");
    el.setAttribute("radius", "0.18");
  } else if (options.shape === "cylinder") {
    el = document.createElement("a-cylinder");
    el.setAttribute("radius", "0.12");
    el.setAttribute("height", "0.36");
  } else {
    el = document.createElement("a-box");
    el.setAttribute("width", "0.26");
    el.setAttribute("height", "0.2");
    el.setAttribute("depth", "0.34");
  }

  el.setAttribute("class", "grabbable-object");
  el.setAttribute("grabbable", "");
  el.setAttribute("position", options.x + " " + options.y + " " + options.z);
  el.setAttribute("color", options.color);
  return el;
}

function updateGrabTint(event) {
  const el = event.target;

  if (el.is("held")) {
    el.setAttribute("opacity", "0.82");
    return;
  }

  el.setAttribute("opacity", "1");
}

function getOrCreateAvatar(playerId, root) {
  const existing = avatarMap.get(playerId);

  if (existing) {
    return existing;
  }

  const avatarRoot = document.createElement("a-entity");
  const head = document.createElement("a-sphere");
  const visor = document.createElement("a-sphere");
  const torso = document.createElement("a-box");
  const chest = document.createElement("a-box");
  const hips = document.createElement("a-box");
  const leftHand = document.createElement("a-sphere");
  const rightHand = document.createElement("a-sphere");
  const leftLeg = document.createElement("a-cylinder");
  const rightLeg = document.createElement("a-cylinder");
  const label = document.createElement("a-text");

  head.setAttribute("radius", "0.16");
  head.setAttribute("color", "#F2F5FF");

  visor.setAttribute("radius", "0.11");
  visor.setAttribute("scale", "1.15 0.65 0.7");
  visor.setAttribute("color", "#12243A");
  visor.setAttribute("opacity", "0.96");

  torso.setAttribute("width", "0.34");
  torso.setAttribute("height", "0.42");
  torso.setAttribute("depth", "0.2");
  torso.setAttribute("color", "#7A9BFF");

  chest.setAttribute("width", "0.26");
  chest.setAttribute("height", "0.18");
  chest.setAttribute("depth", "0.22");
  chest.setAttribute("color", "#CFE1FF");

  hips.setAttribute("width", "0.28");
  hips.setAttribute("height", "0.12");
  hips.setAttribute("depth", "0.18");
  hips.setAttribute("color", "#4C6797");

  leftHand.setAttribute("radius", "0.1");
  leftHand.setAttribute("color", "#FF7AA2");

  rightHand.setAttribute("radius", "0.1");
  rightHand.setAttribute("color", "#6FC3FF");

  leftLeg.setAttribute("radius", "0.06");
  leftLeg.setAttribute("height", "0.32");
  leftLeg.setAttribute("color", "#2F4C7A");

  rightLeg.setAttribute("radius", "0.06");
  rightLeg.setAttribute("height", "0.32");
  rightLeg.setAttribute("color", "#2F4C7A");

  label.setAttribute("align", "center");
  label.setAttribute("color", "#111111");
  label.setAttribute("width", "3.4");
  label.setAttribute("side", "double");

  avatarRoot.appendChild(head);
  avatarRoot.appendChild(visor);
  avatarRoot.appendChild(torso);
  avatarRoot.appendChild(chest);
  avatarRoot.appendChild(hips);
  avatarRoot.appendChild(leftHand);
  avatarRoot.appendChild(rightHand);
  avatarRoot.appendChild(leftLeg);
  avatarRoot.appendChild(rightLeg);
  avatarRoot.appendChild(label);
  root.appendChild(avatarRoot);

  const avatar = {
    root: avatarRoot,
    head,
    visor,
    torso,
    chest,
    hips,
    leftHand,
    rightHand,
    leftLeg,
    rightLeg,
    label
  };

  avatarMap.set(playerId, avatar);
  return avatar;
}

function updateAvatar(avatar, player) {
  const state = player.state || {};
  const meta = player.meta || {};
  const head = normalizePosition(state.head || state.rig);
  const leftHand = normalizePosition(state.leftHand || state.head || state.rig);
  const rightHand = normalizePosition(state.rightHand || state.head || state.rig);

  avatar.head.setAttribute("position", toPositionString(head));
  avatar.visor.setAttribute("position", toPositionString({
    x: head.x,
    y: head.y - 0.01,
    z: head.z + 0.085
  }));
  avatar.torso.setAttribute("position", toPositionString({
    x: head.x,
    y: head.y - 0.39,
    z: head.z
  }));
  avatar.chest.setAttribute("position", toPositionString({
    x: head.x,
    y: head.y - 0.34,
    z: head.z + 0.03
  }));
  avatar.hips.setAttribute("position", toPositionString({
    x: head.x,
    y: head.y - 0.64,
    z: head.z
  }));
  avatar.leftHand.setAttribute("position", toPositionString(leftHand));
  avatar.rightHand.setAttribute("position", toPositionString(rightHand));
  avatar.leftLeg.setAttribute("position", toPositionString({
    x: head.x - 0.08,
    y: head.y - 0.86,
    z: head.z
  }));
  avatar.rightLeg.setAttribute("position", toPositionString({
    x: head.x + 0.08,
    y: head.y - 0.86,
    z: head.z
  }));
  avatar.label.setAttribute("value", player.name + (player.isHost ? " (Host)" : ""));
  avatar.label.setAttribute("position", toPositionString({
    x: head.x,
    y: head.y + 0.28,
    z: head.z
  }));

  if (meta.headColor) {
    avatar.head.setAttribute("color", meta.headColor);
  }

  if (meta.bodyColor) {
    avatar.torso.setAttribute("color", meta.bodyColor);
  }

  if (meta.leftHandColor) {
    avatar.leftHand.setAttribute("color", meta.leftHandColor);
  }

  if (meta.rightHandColor) {
    avatar.rightHand.setAttribute("color", meta.rightHandColor);
  }
}

function normalizePosition(value) {
  return {
    x: Number(value?.x || 0),
    y: Number(value?.y || 0),
    z: Number(value?.z || 0)
  };
}

function vectorToObject(vector) {
  return {
    x: round(vector.x),
    y: round(vector.y),
    z: round(vector.z)
  };
}

function toPositionString(position) {
  return position.x + " " + position.y + " " + position.z;
}

function round(value) {
  return Number(value.toFixed(3));
}

function getOrCreatePlayerName() {
  const stored = sessionStorage.getItem(PLAYER_NAME_KEY);

  if (stored) {
    return stored;
  }

  const generated = "Quest Player " + Math.floor(100 + Math.random() * 900);
  sessionStorage.setItem(PLAYER_NAME_KEY, generated);
  return generated;
}

function formatCountdown(secondsRemaining) {
  const totalSeconds = Math.max(0, Math.ceil(secondsRemaining));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

function lerpColor(startHex, endHex, amount) {
  const start = new THREE.Color(startHex);
  const end = new THREE.Color(endHex);
  start.lerp(end, THREE.MathUtils.clamp(amount, 0, 1));
  return "#" + start.getHexString();
}
