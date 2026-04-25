import { LobbyDirectory, LobbyService } from "./lobby-manager.js";
import { GameRoom } from "./realtime-server.js";
import { corsHeaders, jsonResponse, readJson } from "./utils.js";

export { LobbyDirectory, GameRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";
    const lobbyService = new LobbyService(env);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin)
      });
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return jsonResponse(
          {
            ok: true,
            status: "healthy",
            runtime: "cloudflare-workers",
            idleTimeoutMs: Number(env.IDLE_TIMEOUT_MS || 50000),
            reconnectGraceMs: Number(env.RECONNECT_GRACE_MS || 20000),
            maxPlayersPerLobby: Number(env.MAX_PLAYERS_PER_LOBBY || 12)
          },
          200,
          allowedOrigin
        );
      }

      if (request.method === "GET" && url.pathname === "/api/lobbies/public") {
        const data = await lobbyService.listPublicLobbies();
        return jsonResponse(data, 200, allowedOrigin);
      }

      if (request.method === "POST" && url.pathname === "/api/lobbies/create") {
        const body = await readJson(request);
        const data = await lobbyService.createLobby(body);
        return jsonResponse(data, 200, allowedOrigin);
      }

      if (request.method === "POST" && url.pathname === "/api/lobbies/join") {
        const body = await readJson(request);
        const data = await lobbyService.joinLobby(body);
        return jsonResponse(data, 200, allowedOrigin);
      }

      if (request.method === "POST" && url.pathname === "/api/lobbies/restore") {
        const body = await readJson(request);
        const data = await lobbyService.restoreSession(body);
        return jsonResponse(data, 200, allowedOrigin);
      }

      if (request.method === "POST" && url.pathname === "/api/lobbies/leave") {
        const body = await readJson(request);
        const data = await lobbyService.leaveLobby(body);
        return jsonResponse(data, 200, allowedOrigin);
      }

      if (request.method === "POST" && url.pathname === "/api/lobbies/kick") {
        const body = await readJson(request);
        const data = await lobbyService.kickPlayer(body);
        return jsonResponse(data, 200, allowedOrigin);
      }

      if (request.method === "POST" && url.pathname === "/api/lobbies/close") {
        const body = await readJson(request);
        const data = await lobbyService.closeLobby(body);
        return jsonResponse(data, 200, allowedOrigin);
      }

      if (request.method === "GET" && url.pathname === "/ws") {
        const lobbyId = url.searchParams.get("lobbyId");
        const sessionToken = url.searchParams.get("sessionToken");

        if (!lobbyId || !sessionToken) {
          return new Response("Missing lobbyId or sessionToken.", { status: 400 });
        }

        return lobbyService.connectSocket(request, lobbyId, sessionToken);
      }

      return jsonResponse({ ok: false, error: "Not found." }, 404, allowedOrigin);
    } catch (error) {
      return jsonResponse(
        { ok: false, error: error.message || "Request failed." },
        400,
        allowedOrigin
      );
    }
  }
};
