import { MultiplayerClient } from "./frontend/multiplayer-client.js";

const REMOTE_HEAD_RADIUS = 0.16;
const REMOTE_HAND_RADIUS = 0.1;
const REMOTE_BODY_HEIGHT = 0.55;
const REMOTE_BODY_RADIUS = 0.12;
const PLAYER_NAME_KEY = "feeble_player_name";
const DEFAULT_LOBBY_NAME = "Feeble Room";
const LOCAL_META = {
  headColor: "#F2F5FF",
  bodyColor: "#7A9BFF",
  leftHandColor: "#FF7AA2",
  rightHandColor: "#6FC3FF"
};

const TEMP = {
  head: new THREE.Vector3(),
  leftHand: new THREE.Vector3(),
  rightHand: new THREE.Vector3(),
  rig: new THREE.Vector3(),
  world: new THREE.Vector3()
};

const avatarMap = new Map();

AFRAME.registerComponent("menu-interactor", {
  schema: {
    defaultLength: { default: 4.5 }
  },

  init: function () {
    this.onTriggerDown = this.onTriggerDown.bind(this);
    this.hoveredEl = null;
  },

  play: function () {
    this.el.addEventListener("triggerdown", this.onTriggerDown);
  },

  pause: function () {
    this.el.removeEventListener("triggerdown", this.onTriggerDown);
  },

  tick: function () {
    const raycaster = this.el.components.raycaster;
    const intersection = raycaster?.intersections?.[0] || null;
    const nextHovered = intersection ? findMenuButton(intersection.object.el) : null;

    if (nextHovered !== this.hoveredEl) {
      if (this.hoveredEl) {
        this.hoveredEl.emit("menu-hover-end");
      }

      this.hoveredEl = nextHovered;

      if (this.hoveredEl) {
        this.hoveredEl.emit("menu-hover-start");
      }
    }

    const lineLength = intersection ? intersection.distance : this.data.defaultLength;
    this.el.setAttribute("line", "end", "0 0 " + (-lineLength));
  },

  onTriggerDown: function () {
    const raycaster = this.el.components.raycaster;
    const intersection = raycaster?.intersections?.[0] || null;

    if (!intersection) {
      return;
    }

    const button = findMenuButton(intersection.object.el);

    if (button) {
      button.emit("click");
    }
  }
});

AFRAME.registerComponent("grabbable", {
  init: function () {
    this.el.addEventListener("stateadded", updateGrabTint);
    this.el.addEventListener("stateremoved", updateGrabTint);
  }
});

AFRAME.registerComponent("hand-grabber", {
  schema: {
    radius: { default: 0.4 }
  },

  init: function () {
    this.heldEl = null;
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
    this.el.object3D.getWorldPosition(TEMP.world);

    for (const candidate of candidates) {
      if (candidate.is("held")) {
        continue;
      }

      candidate.object3D.getWorldPosition(TEMP.rig);
      const distance = TEMP.world.distanceTo(TEMP.rig);

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

window.addEventListener("DOMContentLoaded", function () {
  const scene = document.querySelector("a-scene");
  const note = document.getElementById("note");
  const remotePlayersRoot = document.getElementById("remote-players");
  const rigEl = document.getElementById("player-rig");
  const headEl = document.getElementById("player-camera");
  const leftHandEl = document.getElementById("left-hand");
  const rightHandEl = document.getElementById("right-hand");
  const mainMenuEl = document.getElementById("main-menu");
  const multiplayerMenuEl = document.getElementById("multiplayer-menu");
  const playButtonEl = document.getElementById("play-button");
  const createPublicButtonEl = document.getElementById("create-public-button");
  const createPrivateButtonEl = document.getElementById("create-private-button");
  const refreshLobbiesButtonEl = document.getElementById("refresh-lobbies-button");
  const leaveLobbyButtonEl = document.getElementById("leave-lobby-button");
  const menuStatusTextEl = document.getElementById("menu-status-text");
  const menuCodeTextEl = document.getElementById("menu-code-text");
  const publicLobbiesPanelEl = document.getElementById("public-lobbies-panel");

  if (
    !scene ||
    !note ||
    !remotePlayersRoot ||
    !rigEl ||
    !headEl ||
    !leftHandEl ||
    !rightHandEl ||
    !mainMenuEl ||
    !multiplayerMenuEl ||
    !playButtonEl ||
    !createPublicButtonEl ||
    !createPrivateButtonEl ||
    !refreshLobbiesButtonEl ||
    !leaveLobbyButtonEl ||
    !menuStatusTextEl ||
    !menuCodeTextEl ||
    !publicLobbiesPanelEl
  ) {
    return;
  }

  const defaultNote = note.textContent.trim();
  const playerName = getOrCreatePlayerName();
  let client = null;
  let hasStarted = false;
  let currentPublicLobbies = [];

  registerHoverButton(playButtonEl, "#235F9F", "#3A86D1");
  registerHoverButton(createPublicButtonEl, "#2B7A78", "#389E9B");
  registerHoverButton(createPrivateButtonEl, "#7A4BC2", "#9562E0");
  registerHoverButton(refreshLobbiesButtonEl, "#235F9F", "#3A86D1");
  registerHoverButton(leaveLobbyButtonEl, "#9E3D3D", "#C45656");

  function setStatus(text) {
    menuStatusTextEl.setAttribute("value", text);
  }

  function setCodeText(text) {
    menuCodeTextEl.setAttribute("value", text);
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

  function ensureClient() {
    const apiBase = window.location.origin;

    if (client && client.apiBase === apiBase) {
      return client;
    }

    if (client) {
      client.disconnectSocket();
    }

    client = new MultiplayerClient(apiBase, {
      storageKey: "feeble_multiplayer_session",
      onSnapshot: renderSnapshot,
      onOpen: function (snapshot) {
        setStatus("Connected to " + snapshot.name + ".");
      },
      onClose: function () {
        setStatus("Realtime connection closed.");
      },
      onError: function (error) {
        setStatus(error.message);
      }
    });

    return client;
  }

  function showMultiplayerMenu() {
    hasStarted = true;
    mainMenuEl.setAttribute("visible", "false");
    multiplayerMenuEl.setAttribute("visible", "true");
    note.textContent = "Move with the left joystick, turn with the right joystick, jump with the right A button, use the trigger on menu buttons, and grip objects to pick them up.";
  }

  function renderSnapshot(snapshot) {
    clearMissingAvatars(snapshot);

    if (!snapshot) {
      setStatus("Not in a lobby.");
      setCodeText("Private code: none");
      return;
    }

    const codeText = snapshot.code ? "Private code: " + snapshot.code : "Private code: none";
    setStatus(snapshot.name + " | " + snapshot.playerCount + "/" + snapshot.maxPlayers);
    setCodeText(codeText);

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

  function renderPublicLobbies(lobbies) {
    currentPublicLobbies = lobbies.slice(0, 4);

    while (publicLobbiesPanelEl.firstChild) {
      publicLobbiesPanelEl.removeChild(publicLobbiesPanelEl.firstChild);
    }

    if (!currentPublicLobbies.length) {
      const emptyText = document.createElement("a-text");
      emptyText.setAttribute("value", "No public lobbies found.");
      emptyText.setAttribute("align", "center");
      emptyText.setAttribute("color", "#DCEEFF");
      emptyText.setAttribute("width", "2.7");
      emptyText.setAttribute("wrap-count", "26");
      publicLobbiesPanelEl.appendChild(emptyText);
      return;
    }

    currentPublicLobbies.forEach(function (lobby, index) {
      const y = -index * 0.28;
      const button = createMenuButton({
        id: "join-lobby-" + index,
        color: "#3D5A80",
        label: "Join " + trimLabel(lobby.name, 12) + " (" + lobby.playerCount + "/" + lobby.maxPlayers + ")",
        position: "0 " + y + " 0.02",
        width: 1.95,
        height: 0.2,
        textWidth: 2.7
      });

      registerHoverButton(button, "#3D5A80", "#5072A0");
      button.addEventListener("click", function () {
        joinPublicLobby(lobby.lobbyId).catch(function (error) {
          setStatus(error.message);
        });
      });
      publicLobbiesPanelEl.appendChild(button);
    });
  }

  async function refreshPublicLobbies() {
    const activeClient = ensureClient();
    const lobbies = await activeClient.listPublicLobbies();
    renderPublicLobbies(lobbies);
  }

  async function createLobby(privateLobby) {
    const activeClient = ensureClient();
    const code = privateLobby ? generatePrivateCode() : "";

    await activeClient.createLobby({
      playerName: playerName,
      lobbyName: DEFAULT_LOBBY_NAME,
      privateLobby: privateLobby,
      code: code,
      maxPlayers: 12,
      playerState: buildLocalState(),
      playerMeta: LOCAL_META
    });

    if (privateLobby) {
      setCodeText("Private code: " + code);
    }
  }

  async function joinPublicLobby(lobbyId) {
    const activeClient = ensureClient();
    await activeClient.joinLobbyById({
      lobbyId: lobbyId,
      playerName: playerName,
      playerState: buildLocalState(),
      playerMeta: LOCAL_META
    });
  }

  function stateLoop() {
    if (client?.snapshot) {
      client.pushState(buildLocalState(), LOCAL_META);
    }

    requestAnimationFrame(stateLoop);
  }

  playButtonEl.addEventListener("click", function () {
    showMultiplayerMenu();
    refreshPublicLobbies().catch(function (error) {
      setStatus(error.message);
    });
  });

  createPublicButtonEl.addEventListener("click", function () {
    createLobby(false).catch(function (error) {
      setStatus(error.message);
    });
  });

  createPrivateButtonEl.addEventListener("click", function () {
    createLobby(true).catch(function (error) {
      setStatus(error.message);
    });
  });

  refreshLobbiesButtonEl.addEventListener("click", function () {
    refreshPublicLobbies().catch(function (error) {
      setStatus(error.message);
    });
  });

  leaveLobbyButtonEl.addEventListener("click", function () {
    if (!client) {
      return;
    }

    client.leave()
      .then(function () {
        clearMissingAvatars(null);
        renderSnapshot(null);
        refreshPublicLobbies().catch(function () {});
      })
      .catch(function (error) {
        setStatus(error.message);
      });
  });

  scene.addEventListener("enter-vr", function () {
    if (!hasStarted) {
      note.textContent = "Aim at the Play button with either controller and pull the trigger. After that, use the right-side VR menu for multiplayer.";
      return;
    }

    note.textContent = "Move with the left joystick, turn with the right joystick, jump with the right A button, use the trigger on menu buttons, and grip objects to pick them up.";
  });

  scene.addEventListener("exit-vr", function () {
    note.textContent = defaultNote;
  });

  const startupClient = ensureClient();
  startupClient.restore().then(function (snapshot) {
    if (snapshot) {
      renderSnapshot(snapshot);
    }
  }).catch(function () {});

  renderPublicLobbies([]);
  stateLoop();
});

function createMenuButton(options) {
  const button = document.createElement("a-plane");
  const text = document.createElement("a-text");

  button.setAttribute("id", options.id);
  button.setAttribute("class", "menu-hitbox");
  button.setAttribute("position", options.position);
  button.setAttribute("width", options.width);
  button.setAttribute("height", options.height);
  button.setAttribute("color", options.color);

  text.setAttribute("value", options.label);
  text.setAttribute("position", "0 0 0.01");
  text.setAttribute("align", "center");
  text.setAttribute("color", "#FFFFFF");
  text.setAttribute("width", options.textWidth || 2.2);
  text.setAttribute("wrap-count", "24");

  button.appendChild(text);
  return button;
}

function registerHoverButton(buttonEl, baseColor, hoverColor) {
  buttonEl.setAttribute("color", baseColor);
  buttonEl.addEventListener("menu-hover-start", function () {
    buttonEl.setAttribute("color", hoverColor);
  });
  buttonEl.addEventListener("menu-hover-end", function () {
    buttonEl.setAttribute("color", baseColor);
  });
}

function findMenuButton(startEl) {
  let el = startEl;

  while (el) {
    if (el.classList && el.classList.contains("menu-hitbox")) {
      return el;
    }

    el = el.parentEl;
  }

  return null;
}

function updateGrabTint(event) {
  const el = event.target;

  if (el.is("held")) {
    el.setAttribute("opacity", "0.8");
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

  head.setAttribute("radius", REMOTE_HEAD_RADIUS);
  head.setAttribute("color", "#F2F5FF");

  visor.setAttribute("radius", 0.11);
  visor.setAttribute("scale", "1.15 0.65 0.7");
  visor.setAttribute("color", "#12243A");
  visor.setAttribute("opacity", "0.96");

  torso.setAttribute("width", 0.34);
  torso.setAttribute("height", 0.42);
  torso.setAttribute("depth", 0.2);
  torso.setAttribute("color", "#7A9BFF");

  chest.setAttribute("width", 0.26);
  chest.setAttribute("height", 0.18);
  chest.setAttribute("depth", 0.22);
  chest.setAttribute("color", "#CFE1FF");

  hips.setAttribute("width", 0.28);
  hips.setAttribute("height", 0.12);
  hips.setAttribute("depth", 0.18);
  hips.setAttribute("color", "#4C6797");

  leftHand.setAttribute("radius", REMOTE_HAND_RADIUS);
  leftHand.setAttribute("color", "#FF7AA2");

  rightHand.setAttribute("radius", REMOTE_HAND_RADIUS);
  rightHand.setAttribute("color", "#6FC3FF");

  leftLeg.setAttribute("radius", 0.06);
  leftLeg.setAttribute("height", 0.32);
  leftLeg.setAttribute("color", "#2F4C7A");

  rightLeg.setAttribute("radius", 0.06);
  rightLeg.setAttribute("height", 0.32);
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

function generatePrivateCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function trimLabel(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength - 3) + "...";
}
