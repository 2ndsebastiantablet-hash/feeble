import { MultiplayerClient } from "./frontend/multiplayer-client.js";

const REMOTE_HEAD_RADIUS = 0.16;
const REMOTE_HAND_RADIUS = 0.1;
const REMOTE_BODY_HEIGHT = 0.55;
const REMOTE_BODY_RADIUS = 0.12;
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
  rig: new THREE.Vector3()
};

const avatarMap = new Map();

window.addEventListener("DOMContentLoaded", function () {
  const scene = document.querySelector("a-scene");
  const note = document.getElementById("note");
  const apiBaseInput = document.getElementById("api-base");
  const playerNameInput = document.getElementById("player-name");
  const lobbyNameInput = document.getElementById("lobby-name");
  const lobbyCodeInput = document.getElementById("lobby-code");
  const statusEl = document.getElementById("multiplayer-status");
  const lobbyListEl = document.getElementById("public-lobbies");
  const remotePlayersRoot = document.getElementById("remote-players");
  const rigEl = document.getElementById("player-rig");
  const headEl = document.getElementById("player-camera");
  const leftHandEl = document.getElementById("left-hand");
  const rightHandEl = document.getElementById("right-hand");

  if (
    !scene ||
    !note ||
    !apiBaseInput ||
    !playerNameInput ||
    !lobbyNameInput ||
    !lobbyCodeInput ||
    !statusEl ||
    !lobbyListEl ||
    !remotePlayersRoot ||
    !rigEl ||
    !headEl ||
    !leftHandEl ||
    !rightHandEl
  ) {
    return;
  }

  const defaultNote = note.textContent.trim();
  let client = null;

  function setStatus(text) {
    statusEl.textContent = text;
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
    const apiBase = apiBaseInput.value.trim();

    if (!apiBase) {
      throw new Error("Enter your multiplayer Worker URL first.");
    }

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

  function renderSnapshot(snapshot) {
    clearMissingAvatars(snapshot);

    if (!snapshot) {
      setStatus("Not in a lobby.");
      return;
    }

    const codeText = snapshot.code ? " | code: " + snapshot.code : "";
    setStatus(snapshot.name + " | " + snapshot.playerCount + "/" + snapshot.maxPlayers + codeText);

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

  async function refreshPublicLobbies() {
    const activeClient = ensureClient();
    const lobbies = await activeClient.listPublicLobbies();

    if (!lobbies.length) {
      lobbyListEl.innerHTML = "<strong>Public lobbies:</strong> none";
      return;
    }

    lobbyListEl.innerHTML = "<strong>Public lobbies:</strong> " + lobbies
      .map(function (lobby) {
        return (
          "<div>" +
          escapeHtml(lobby.name) +
          " (" + lobby.playerCount + "/" + lobby.maxPlayers + ")" +
          "<button data-lobby-id=\"" + lobby.lobbyId + "\">Join</button>" +
          "</div>"
        );
      })
      .join("");

    lobbyListEl.querySelectorAll("button[data-lobby-id]").forEach(function (button) {
      button.addEventListener("click", async function () {
        try {
          const joiningClient = ensureClient();
          await joiningClient.joinLobbyById({
            lobbyId: button.dataset.lobbyId,
            playerName: playerNameInput.value.trim(),
            playerState: buildLocalState(),
            playerMeta: LOCAL_META
          });
        } catch (error) {
          setStatus(error.message);
        }
      });
    });
  }

  async function createLobby(privateLobby) {
    const activeClient = ensureClient();
    await activeClient.createLobby({
      playerName: playerNameInput.value.trim(),
      lobbyName: lobbyNameInput.value.trim(),
      privateLobby: privateLobby,
      code: lobbyCodeInput.value.trim(),
      maxPlayers: 12,
      playerState: buildLocalState(),
      playerMeta: LOCAL_META
    });
  }

  async function joinByCode() {
    const activeClient = ensureClient();
    await activeClient.joinLobbyByCode({
      code: lobbyCodeInput.value.trim(),
      playerName: playerNameInput.value.trim(),
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

  document.getElementById("create-public").addEventListener("click", function () {
    createLobby(false).catch(function (error) {
      setStatus(error.message);
    });
  });

  document.getElementById("create-private").addEventListener("click", function () {
    createLobby(true).catch(function (error) {
      setStatus(error.message);
    });
  });

  document.getElementById("join-code").addEventListener("click", function () {
    joinByCode().catch(function (error) {
      setStatus(error.message);
    });
  });

  document.getElementById("refresh-lobbies").addEventListener("click", function () {
    refreshPublicLobbies().catch(function (error) {
      setStatus(error.message);
    });
  });

  document.getElementById("leave-lobby").addEventListener("click", function () {
    if (!client) {
      return;
    }

    client.leave()
      .then(function () {
        clearMissingAvatars(null);
        renderSnapshot(null);
      })
      .catch(function (error) {
        setStatus(error.message);
      });
  });

  scene.addEventListener("enter-vr", function () {
    note.textContent = "Press Enter VR, then push with your hands. Multiplayer avatars sync through the Cloudflare Worker URL in the panel.";
  });

  scene.addEventListener("exit-vr", function () {
    note.textContent = defaultNote;
  });

  ensureWorkerPlaceholder(apiBaseInput);

  if (apiBaseInput.value.trim()) {
    const startupClient = ensureClient();

    startupClient.restore().then(function (snapshot) {
      if (snapshot) {
        setStatus("Restored " + snapshot.name + ".");
      }
    }).catch(function () {});

    refreshPublicLobbies().catch(function () {});
  }

  stateLoop();
});

function getOrCreateAvatar(playerId, root) {
  const existing = avatarMap.get(playerId);

  if (existing) {
    return existing;
  }

  const avatarRoot = document.createElement("a-entity");
  const head = document.createElement("a-sphere");
  const body = document.createElement("a-cylinder");
  const leftHand = document.createElement("a-sphere");
  const rightHand = document.createElement("a-sphere");
  const label = document.createElement("a-text");

  head.setAttribute("radius", REMOTE_HEAD_RADIUS);
  head.setAttribute("color", "#F2F5FF");

  body.setAttribute("radius", REMOTE_BODY_RADIUS);
  body.setAttribute("height", REMOTE_BODY_HEIGHT);
  body.setAttribute("color", "#7A9BFF");

  leftHand.setAttribute("radius", REMOTE_HAND_RADIUS);
  leftHand.setAttribute("color", "#FF7AA2");

  rightHand.setAttribute("radius", REMOTE_HAND_RADIUS);
  rightHand.setAttribute("color", "#6FC3FF");

  label.setAttribute("align", "center");
  label.setAttribute("color", "#111111");
  label.setAttribute("width", "3.4");
  label.setAttribute("side", "double");

  avatarRoot.appendChild(head);
  avatarRoot.appendChild(body);
  avatarRoot.appendChild(leftHand);
  avatarRoot.appendChild(rightHand);
  avatarRoot.appendChild(label);
  root.appendChild(avatarRoot);

  const avatar = { root: avatarRoot, head, body, leftHand, rightHand, label };
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
  avatar.body.setAttribute("position", toPositionString({
    x: head.x,
    y: head.y - 0.42,
    z: head.z
  }));
  avatar.leftHand.setAttribute("position", toPositionString(leftHand));
  avatar.rightHand.setAttribute("position", toPositionString(rightHand));
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
    avatar.body.setAttribute("color", meta.bodyColor);
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

function ensureWorkerPlaceholder(apiBaseInput) {
  apiBaseInput.placeholder = "https://your-worker.workers.dev";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
