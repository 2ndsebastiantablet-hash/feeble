import { DurableObject } from "cloudflare:workers";
import { TokenBucketRateLimiter } from "./rate-limit.js";
import { defaultAuthority } from "./server-authority.js";
import {
  createJsonRequest,
  jsonResponse,
  now,
  randomId,
  readJson,
  safeJsonParse,
  sanitizePlayerName
} from "./utils.js";

const MAX_MESSAGE_SIZE = 16_000;
const ALLOWED_MESSAGE_TYPES = new Set(["ping", "state_update", "chat", "custom"]);

function sortPlayers(players) {
  return [...players.values()].sort((left, right) => left.joinedSeq - right.joinedSeq);
}

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.authority = defaultAuthority;
    this.rateLimiter = new TokenBucketRateLimiter();
    this.loaded = false;
    this.meta = null;
    this.players = new Map();
    this.sockets = new Map();

    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment?.sessionToken) {
        this.sockets.set(attachment.sessionToken, socket);
      }
    }
  }

  async ensureLoaded() {
    if (this.loaded) return;
    this.meta = (await this.ctx.storage.get("meta")) || null;
    const storedPlayers = (await this.ctx.storage.get("players")) || {};
    this.players = new Map(Object.entries(storedPlayers));
    this.loaded = true;
  }

  roomConfig() {
    return {
      idleTimeoutMs: Number(this.env.IDLE_TIMEOUT_MS || 50000),
      reconnectGraceMs: Number(this.env.RECONNECT_GRACE_MS || 20000),
      cleanupIntervalMs: Number(this.env.CLEANUP_INTERVAL_MS || 5000)
    };
  }

  serializePlayers() {
    return Object.fromEntries(this.players.entries());
  }

  async persistState() {
    await this.ctx.storage.put("meta", this.meta);
    await this.ctx.storage.put("players", this.serializePlayers());
    await this.scheduleCleanupAlarm();
  }

  async scheduleCleanupAlarm() {
    if (!this.meta || this.players.size === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const { cleanupIntervalMs } = this.roomConfig();
    await this.ctx.storage.setAlarm(now() + cleanupIntervalMs);
  }

  createPlayer({ playerName, playerState, playerMeta, isHost }) {
    const initialState =
      playerState && typeof playerState === "object"
        ? playerState
        : this.authority.createInitialPlayerState({ lobby: this.meta });

    return {
      sessionToken: randomId(24),
      playerId: randomId(8),
      name: sanitizePlayerName(playerName),
      joinedSeq: (this.meta?.nextJoinSeq || 0) + 1,
      joinedAt: now(),
      lastSeen: now(),
      disconnectedAt: null,
      isHost,
      state: initialState,
      meta: typeof playerMeta === "object" && playerMeta ? playerMeta : {}
    };
  }

  snapshotLobby(yourSessionToken = null) {
    const currentPlayer = yourSessionToken ? this.players.get(yourSessionToken) : null;
    const players = sortPlayers(this.players).map((player) => ({
      playerId: player.playerId,
      name: player.name,
      isHost: player.isHost,
      joinedAt: player.joinedAt,
      lastSeen: player.lastSeen,
      disconnectedAt: player.disconnectedAt,
      state: player.state,
      meta: player.meta
    }));

    const snapshot = {
      lobbyId: this.meta.lobbyId,
      name: this.meta.name,
      private: this.meta.private,
      code: this.meta.private ? this.meta.code : null,
      maxPlayers: this.meta.maxPlayers,
      playerCount: players.length,
      createdAt: this.meta.createdAt,
      you: yourSessionToken,
      youPlayerId: currentPlayer?.playerId || null,
      players
    };

    return this.authority.onBeforeBroadcast({ lobby: this.meta, snapshot }) || snapshot;
  }

  assignNextHost() {
    const ordered = sortPlayers(this.players);
    for (const player of ordered) {
      player.isHost = false;
    }
    if (ordered[0]) {
      ordered[0].isHost = true;
    }
  }

  async syncDirectorySummary(lobbyMeta = this.meta) {
    const directoryId = this.env.LOBBY_DIRECTORY.idFromName("global-lobby-directory");
    const directory = this.env.LOBBY_DIRECTORY.get(directoryId);

    if (!lobbyMeta || this.players.size === 0) {
      await directory.fetch(
        createJsonRequest("https://directory.internal/directory/update-summary", {
          lobbyId: lobbyMeta?.lobbyId,
          remove: true
        })
      );
      return;
    }

    const snapshot = this.snapshotLobby();
    const host = snapshot.players.find((player) => player.isHost);
    await directory.fetch(
      createJsonRequest("https://directory.internal/directory/update-summary", {
        lobbyId: lobbyMeta.lobbyId,
        summary: {
          lobbyId: snapshot.lobbyId,
          name: snapshot.name,
          private: false,
          playerCount: snapshot.playerCount,
          maxPlayers: snapshot.maxPlayers,
          hostName: host?.name || null,
          createdAt: snapshot.createdAt
        }
      })
    );
  }

  async cleanupDisconnectedOrIdlePlayers() {
    await this.ensureLoaded();
    if (!this.meta) return;

    const { idleTimeoutMs, reconnectGraceMs } = this.roomConfig();
    const currentTime = now();
    let changed = false;

    for (const [sessionToken, player] of [...this.players.entries()]) {
      const idleTooLong = currentTime - player.lastSeen > idleTimeoutMs;
      const reconnectExpired =
        player.disconnectedAt !== null && currentTime - player.disconnectedAt > reconnectGraceMs;

      if (idleTooLong || reconnectExpired) {
        const socket = this.sockets.get(sessionToken);
        if (socket) {
          try {
            socket.close(4000, idleTooLong ? "idle timeout" : "reconnect expired");
          } catch {}
          this.sockets.delete(sessionToken);
        }
        this.players.delete(sessionToken);
        this.authority.onPlayerLeave({
          lobby: this.meta,
          player,
          reason: idleTooLong ? "idle_timeout" : "reconnect_timeout"
        });
        changed = true;
      }
    }

    if (!changed) {
      await this.scheduleCleanupAlarm();
      return;
    }

    if (this.players.size === 0) {
      const oldLobby = this.meta;
      this.meta = null;
      await this.ctx.storage.delete("meta");
      await this.ctx.storage.delete("players");
      await this.ctx.storage.deleteAlarm();
      await this.syncDirectorySummary(oldLobby);
      this.authority.onLobbyEmpty({ lobby: oldLobby });
      return;
    }

    if (!sortPlayers(this.players).some((player) => player.isHost)) {
      this.assignNextHost();
    }

    await this.persistState();
    await this.syncDirectorySummary();
    this.broadcastSnapshot();
  }

  async alarm() {
    await this.cleanupDisconnectedOrIdlePlayers();
  }

  async fetch(request) {
    await this.ensureLoaded();
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/room/ws") {
        return this.handleWebSocket(request, url);
      }

      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "Not found." }, 404);
      }

      if (url.pathname === "/room/create") {
        return this.handleCreate(request);
      }

      if (url.pathname === "/room/join") {
        return this.handleJoin(request);
      }

      if (url.pathname === "/room/restore") {
        return this.handleRestore(request);
      }

      if (url.pathname === "/room/leave") {
        return this.handleLeave(request);
      }

      if (url.pathname === "/room/kick") {
        return this.handleKick(request);
      }

      if (url.pathname === "/room/close") {
        return this.handleClose(request);
      }

      return jsonResponse({ ok: false, error: "Not found." }, 404);
    } catch (error) {
      return jsonResponse({ ok: false, error: error.message || "Room request failed." }, 400);
    }
  }

  async handleCreate(request) {
    if (this.meta) {
      throw new Error("Lobby already exists.");
    }

    const body = await readJson(request);
    this.meta = {
      lobbyId: body.lobbyId,
      name: body.lobbyName,
      private: Boolean(body.privateLobby),
      code: body.code || null,
      maxPlayers: Number(body.maxPlayers || 12),
      createdAt: now(),
      nextJoinSeq: 0
    };

    const host = this.createPlayer({
      playerName: body.playerName,
      playerState: body.playerState,
      playerMeta: body.playerMeta,
      isHost: true
    });
    this.meta.nextJoinSeq = host.joinedSeq;
    this.players.set(host.sessionToken, host);
    this.authority.onPlayerJoin({ lobby: this.meta, player: host });

    await this.persistState();
    await this.syncDirectorySummary();

    return jsonResponse({
      ok: true,
      sessionToken: host.sessionToken,
      lobby: this.snapshotLobby(host.sessionToken)
    });
  }

  async handleJoin(request) {
    await this.cleanupDisconnectedOrIdlePlayers();
    const body = await readJson(request);

    if (!this.meta) {
      throw new Error("Lobby not found.");
    }
    if (this.players.size >= this.meta.maxPlayers) {
      throw new Error("Lobby is full.");
    }

    const player = this.createPlayer({
      playerName: body.playerName,
      playerState: body.playerState,
      playerMeta: body.playerMeta,
      isHost: false
    });
    this.meta.nextJoinSeq = player.joinedSeq;
    this.players.set(player.sessionToken, player);
    this.authority.onPlayerJoin({ lobby: this.meta, player });

    await this.persistState();
    await this.syncDirectorySummary();
    this.broadcastSnapshot();

    return jsonResponse({
      ok: true,
      sessionToken: player.sessionToken,
      lobby: this.snapshotLobby(player.sessionToken)
    });
  }

  async handleRestore(request) {
    await this.cleanupDisconnectedOrIdlePlayers();
    const body = await readJson(request);
    const player = this.players.get(body.sessionToken);
    if (!player || !this.meta) {
      throw new Error("Session not found.");
    }

    player.lastSeen = now();
    player.disconnectedAt = null;
    await this.persistState();

    return jsonResponse({
      ok: true,
      sessionToken: body.sessionToken,
      lobby: this.snapshotLobby(body.sessionToken)
    });
  }

  async handleLeave(request) {
    const body = await readJson(request);
    return this.removePlayer(body.sessionToken, "leave");
  }

  async handleKick(request) {
    const body = await readJson(request);
    const host = this.players.get(body.sessionToken);
    if (!host || !host.isHost) {
      throw new Error("Only the host can kick players.");
    }

    const target = sortPlayers(this.players).find((player) => player.playerId === body.targetPlayerId);
    if (!target) {
      throw new Error("Target player not found.");
    }
    if (target.sessionToken === host.sessionToken) {
      throw new Error("Host cannot kick themselves.");
    }

    return this.removePlayer(target.sessionToken, "kick");
  }

  async handleClose(request) {
    const body = await readJson(request);
    const host = this.players.get(body.sessionToken);
    if (!host || !host.isHost) {
      throw new Error("Only the host can close the lobby.");
    }

    for (const [sessionToken, socket] of this.sockets.entries()) {
      try {
        socket.close(4001, "Lobby closed");
      } catch {}
      this.sockets.delete(sessionToken);
    }

    const oldLobby = this.meta;
    this.players.clear();
    this.meta = null;
    await this.ctx.storage.delete("meta");
    await this.ctx.storage.delete("players");
    await this.ctx.storage.deleteAlarm();
    await this.syncDirectorySummary(oldLobby);
    this.authority.onLobbyEmpty({ lobby: oldLobby });

    return jsonResponse({ ok: true, closed: true });
  }

  async removePlayer(sessionToken, reason) {
    const player = this.players.get(sessionToken);
    if (!player || !this.meta) {
      return jsonResponse({ ok: true, left: true, ended: false });
    }

    const socket = this.sockets.get(sessionToken);
    if (socket) {
      try {
        socket.close(4000, reason);
      } catch {}
      this.sockets.delete(sessionToken);
    }

    this.players.delete(sessionToken);
    this.authority.onPlayerLeave({ lobby: this.meta, player, reason });

    if (this.players.size === 0) {
      const oldLobby = this.meta;
      this.meta = null;
      await this.ctx.storage.delete("meta");
      await this.ctx.storage.delete("players");
      await this.ctx.storage.deleteAlarm();
      await this.syncDirectorySummary(oldLobby);
      this.authority.onLobbyEmpty({ lobby: oldLobby });
      return jsonResponse({ ok: true, left: true, ended: true });
    }

    if (!sortPlayers(this.players).some((entry) => entry.isHost)) {
      this.assignNextHost();
    }

    await this.persistState();
    await this.syncDirectorySummary();
    this.broadcastSnapshot();

    return jsonResponse({
      ok: true,
      left: true,
      ended: false,
      lobby: this.snapshotLobby()
    });
  }

  async handleWebSocket(request, url) {
    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      throw new Error("Expected a WebSocket upgrade.");
    }

    const sessionToken = url.searchParams.get("sessionToken");
    const player = this.players.get(sessionToken);

    if (!this.meta || !player) {
      return new Response("Session not found.", { status: 404 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ sessionToken });

    const previousSocket = this.sockets.get(sessionToken);
    if (previousSocket && previousSocket !== server) {
      try {
        previousSocket.close(4002, "Reconnected elsewhere");
      } catch {}
    }

    this.sockets.set(sessionToken, server);
    player.lastSeen = now();
    player.disconnectedAt = null;
    await this.persistState();

    server.send(
      JSON.stringify({
        type: "auth_ok",
        sessionToken,
        lobby: this.snapshotLobby(sessionToken)
      })
    );
    this.broadcast(() => ({
      type: "player_connection_changed",
      playerId: player.playerId,
      connected: true
    }));
    this.broadcastSnapshot();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  sessionTokenFromSocket(socket) {
    const attachment = socket.deserializeAttachment();
    return attachment?.sessionToken || null;
  }

  broadcast(socketPayloadBuilder) {
    for (const [sessionToken, socket] of this.sockets.entries()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      socket.send(JSON.stringify(socketPayloadBuilder(sessionToken)));
    }
  }

  broadcastSnapshot() {
    if (!this.meta) return;
    this.broadcast((sessionToken) => ({
      type: "lobby_snapshot",
      lobby: this.snapshotLobby(sessionToken)
    }));
  }

  async webSocketMessage(socket, message) {
    await this.ensureLoaded();
    const sessionToken = this.sessionTokenFromSocket(socket);
    if (!sessionToken) return;

    const rawText = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (rawText.length > MAX_MESSAGE_SIZE) {
      socket.send(JSON.stringify({ type: "error", error: "Message too large." }));
      return;
    }

    const parsed = safeJsonParse(rawText);
    if (!parsed || typeof parsed !== "object") {
      socket.send(JSON.stringify({ type: "error", error: "Invalid JSON message." }));
      return;
    }

    if (!ALLOWED_MESSAGE_TYPES.has(parsed.type)) {
      socket.send(JSON.stringify({ type: "error", error: "Unknown message type." }));
      return;
    }

    if (!this.rateLimiter.allow(sessionToken, 1)) {
      socket.send(JSON.stringify({ type: "error", error: "Rate limit exceeded." }));
      return;
    }

    const player = this.players.get(sessionToken);
    if (!player || !this.meta) {
      socket.send(JSON.stringify({ type: "error", error: "Session not found." }));
      return;
    }

    try {
      if (parsed.type === "ping") {
        player.lastSeen = now();
        player.disconnectedAt = null;
        await this.persistState();
        socket.send(JSON.stringify({ type: "pong", ts: now() }));
        return;
      }

      if (parsed.type === "state_update") {
        if (parsed.state && typeof parsed.state !== "object") {
          throw new Error("State update must be an object.");
        }
        if (parsed.meta && typeof parsed.meta !== "object") {
          throw new Error("Meta update must be an object.");
        }

        const filtered = this.authority.filterClientStateUpdate({
          lobby: this.meta,
          player,
          proposedState: parsed.state,
          proposedMeta: parsed.meta
        });

        player.lastSeen = now();
        player.disconnectedAt = null;
        player.state = filtered.state;
        player.meta = filtered.meta;

        await this.persistState();
        this.broadcastSnapshot();
        return;
      }

      if (parsed.type === "chat") {
        const text = String(parsed.text || "").slice(0, 300);
        if (!text.trim()) {
          throw new Error("Chat message is empty.");
        }

        player.lastSeen = now();
        player.disconnectedAt = null;
        await this.persistState();
        this.broadcast(() => ({
          type: "chat",
          from: { playerId: player.playerId, name: player.name },
          text,
          sentAt: now()
        }));
        return;
      }

      if (parsed.type === "custom") {
        player.lastSeen = now();
        player.disconnectedAt = null;
        await this.persistState();

        const result = this.authority.onCustomMessage({
          lobby: this.meta,
          player,
          message: parsed,
          sendToPlayer: (payload) => socket.send(JSON.stringify(payload)),
          broadcast: (payload) => this.broadcast(() => payload)
        });

        if (!result?.handled) {
          throw new Error("Unknown custom message.");
        }
      }
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", error: error.message || "Realtime error." }));
    }
  }

  async webSocketClose(socket) {
    await this.ensureLoaded();
    const sessionToken = this.sessionTokenFromSocket(socket);
    if (!sessionToken) return;

    if (this.sockets.get(sessionToken) !== socket) return;
    this.sockets.delete(sessionToken);

    const player = this.players.get(sessionToken);
    if (!player) return;

    player.disconnectedAt = now();
    player.lastSeen = now();
    await this.persistState();

    this.broadcast(() => ({
      type: "player_connection_changed",
      playerId: player.playerId,
      connected: false
    }));
  }
}
