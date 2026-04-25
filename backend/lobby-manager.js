import { DurableObject } from "cloudflare:workers";
import {
  cleanCode,
  clamp,
  createJsonRequest,
  generateCode,
  jsonResponse,
  parseJsonResponse,
  readJson,
  sanitizeLobbyName,
  sanitizePlayerName
} from "./utils.js";

const DIRECTORY_OBJECT_NAME = "global-lobby-directory";

function publicSummaryFromSnapshot(snapshot) {
  const host = snapshot.players.find((player) => player.isHost);
  return {
    lobbyId: snapshot.lobbyId,
    name: snapshot.name,
    private: false,
    playerCount: snapshot.playerCount,
    maxPlayers: snapshot.maxPlayers,
    hostName: host?.name || null,
    createdAt: snapshot.createdAt
  };
}

export class LobbyService {
  constructor(env) {
    this.env = env;
  }

  directoryStub() {
    const id = this.env.LOBBY_DIRECTORY.idFromName(DIRECTORY_OBJECT_NAME);
    return this.env.LOBBY_DIRECTORY.get(id);
  }

  roomStub(lobbyId) {
    const id = this.env.GAME_ROOM.idFromName(lobbyId);
    return this.env.GAME_ROOM.get(id);
  }

  async listPublicLobbies() {
    const response = await this.directoryStub().fetch(
      new Request("https://directory.internal/directory/public")
    );
    return parseJsonResponse(response);
  }

  async createLobby(body) {
    const response = await this.directoryStub().fetch(
      createJsonRequest("https://directory.internal/directory/create", body)
    );
    return parseJsonResponse(response);
  }

  async joinLobby(body) {
    const response = await this.directoryStub().fetch(
      createJsonRequest("https://directory.internal/directory/join", body)
    );
    return parseJsonResponse(response);
  }

  async restoreSession(body) {
    const response = await this.roomStub(body.lobbyId).fetch(
      createJsonRequest("https://room.internal/room/restore", body)
    );
    return parseJsonResponse(response);
  }

  async leaveLobby(body) {
    const response = await this.roomStub(body.lobbyId).fetch(
      createJsonRequest("https://room.internal/room/leave", body)
    );
    return parseJsonResponse(response);
  }

  async kickPlayer(body) {
    const response = await this.roomStub(body.lobbyId).fetch(
      createJsonRequest("https://room.internal/room/kick", body)
    );
    return parseJsonResponse(response);
  }

  async closeLobby(body) {
    const response = await this.roomStub(body.lobbyId).fetch(
      createJsonRequest("https://room.internal/room/close", body)
    );
    return parseJsonResponse(response);
  }

  async connectSocket(request, lobbyId, sessionToken) {
    const url = new URL("https://room.internal/room/ws");
    url.searchParams.set("sessionToken", sessionToken);

    return this.roomStub(lobbyId).fetch(
      new Request(url.toString(), {
        method: "GET",
        headers: request.headers
      })
    );
  }
}

export class LobbyDirectory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.loaded = false;
    this.publicLobbies = {};
    this.codeLookup = {};
    this.lobbyMeta = {};
  }

  async ensureLoaded() {
    if (this.loaded) return;
    this.publicLobbies = (await this.ctx.storage.get("publicLobbies")) || {};
    this.codeLookup = (await this.ctx.storage.get("codeLookup")) || {};
    this.lobbyMeta = (await this.ctx.storage.get("lobbyMeta")) || {};
    this.loaded = true;
  }

  async saveIndex() {
    await this.ctx.storage.put("publicLobbies", this.publicLobbies);
    await this.ctx.storage.put("codeLookup", this.codeLookup);
    await this.ctx.storage.put("lobbyMeta", this.lobbyMeta);
  }

  roomStub(lobbyId) {
    const id = this.env.GAME_ROOM.idFromName(lobbyId);
    return this.env.GAME_ROOM.get(id);
  }

  async fetch(request) {
    await this.ensureLoaded();
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/directory/public") {
        const lobbies = Object.values(this.publicLobbies).sort((a, b) => b.createdAt - a.createdAt);
        return jsonResponse({ ok: true, lobbies });
      }

      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "Not found." }, 404);
      }

      if (url.pathname === "/directory/create") {
        return this.handleCreate(request);
      }

      if (url.pathname === "/directory/join") {
        return this.handleJoin(request);
      }

      if (url.pathname === "/directory/update-summary") {
        return this.handleUpdateSummary(request);
      }

      if (url.pathname === "/directory/remove") {
        return this.handleRemove(request);
      }

      return jsonResponse({ ok: false, error: "Not found." }, 404);
    } catch (error) {
      return jsonResponse({ ok: false, error: error.message || "Directory request failed." }, 400);
    }
  }

  async handleCreate(request) {
    const body = await readJson(request);
    const requestedCode = cleanCode(body.code);
    const privateLobby = Boolean(body.privateLobby);
    let finalCode = null;

    if (privateLobby) {
      if (requestedCode) {
        if (this.codeLookup[requestedCode]) {
          throw new Error("That lobby code is already in use.");
        }
        finalCode = requestedCode;
      } else {
        do {
          finalCode = generateCode(6);
        } while (this.codeLookup[finalCode]);
      }
    }

    const lobbyId = crypto.randomUUID();
    const maxPlayers = clamp(
      Number(body.maxPlayers || this.env.MAX_PLAYERS_PER_LOBBY || 12),
      2,
      Number(this.env.MAX_PLAYERS_PER_LOBBY || 12)
    );
    const roomResponse = await this.roomStub(lobbyId).fetch(
      createJsonRequest("https://room.internal/room/create", {
        lobbyId,
        lobbyName: sanitizeLobbyName(body.lobbyName),
        privateLobby,
        code: finalCode,
        maxPlayers,
        playerName: sanitizePlayerName(body.playerName),
        playerState: body.playerState,
        playerMeta: body.playerMeta
      })
    );

    const roomData = await parseJsonResponse(roomResponse);
    this.lobbyMeta[lobbyId] = {
      private: privateLobby,
      code: finalCode
    };
    if (finalCode) {
      this.codeLookup[finalCode] = lobbyId;
    }
    if (!privateLobby) {
      this.publicLobbies[lobbyId] = publicSummaryFromSnapshot(roomData.lobby);
    }
    await this.saveIndex();

    return jsonResponse(roomData);
  }

  async handleJoin(request) {
    const body = await readJson(request);
    const requestedCode = cleanCode(body.code);
    const lobbyId = requestedCode ? this.codeLookup[requestedCode] : body.lobbyId;

    if (!lobbyId || !this.lobbyMeta[lobbyId]) {
      throw new Error("Lobby not found.");
    }

    const roomResponse = await this.roomStub(lobbyId).fetch(
      createJsonRequest("https://room.internal/room/join", {
        lobbyId,
        playerName: sanitizePlayerName(body.playerName),
        playerState: body.playerState,
        playerMeta: body.playerMeta
      })
    );

    const roomData = await parseJsonResponse(roomResponse);
    if (!this.lobbyMeta[lobbyId].private) {
      this.publicLobbies[lobbyId] = publicSummaryFromSnapshot(roomData.lobby);
      await this.saveIndex();
    }

    return jsonResponse(roomData);
  }

  async handleUpdateSummary(request) {
    const body = await readJson(request);
    const lobbyId = body.lobbyId;
    if (!lobbyId || !this.lobbyMeta[lobbyId]) {
      return jsonResponse({ ok: true });
    }

    if (body.remove) {
      const existingMeta = this.lobbyMeta[lobbyId];
      delete this.publicLobbies[lobbyId];
      delete this.lobbyMeta[lobbyId];
      if (existingMeta?.code) {
        delete this.codeLookup[existingMeta.code];
      }
      await this.saveIndex();
      return jsonResponse({ ok: true });
    }

    if (!this.lobbyMeta[lobbyId].private && body.summary) {
      this.publicLobbies[lobbyId] = body.summary;
      await this.saveIndex();
    }

    return jsonResponse({ ok: true });
  }

  async handleRemove(request) {
    const body = await readJson(request);
    const lobbyId = body.lobbyId;
    if (!lobbyId || !this.lobbyMeta[lobbyId]) {
      return jsonResponse({ ok: true });
    }

    const existingMeta = this.lobbyMeta[lobbyId];
    delete this.publicLobbies[lobbyId];
    delete this.lobbyMeta[lobbyId];
    if (existingMeta?.code) {
      delete this.codeLookup[existingMeta.code];
    }
    await this.saveIndex();

    return jsonResponse({ ok: true });
  }
}
