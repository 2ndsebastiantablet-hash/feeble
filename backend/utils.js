export function now() {
  return Date.now();
}

export function randomId(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function cleanCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function generateCode(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  const parsed = safeJsonParse(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid JSON body.");
  }
  return parsed;
}

export function jsonResponse(payload, status = 200, allowedOrigin = "*") {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
}

export function corsHeaders(allowedOrigin = "*") {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };
}

export function createJsonRequest(url, body, method = "POST") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export async function parseJsonResponse(response) {
  const data = await response.json().catch(() => ({
    ok: false,
    error: "Server returned invalid JSON."
  }));

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}

export function sanitizePlayerName(value) {
  return String(value || "Player").trim().slice(0, 24) || "Player";
}

export function sanitizeLobbyName(value) {
  return String(value || "Lobby").trim().slice(0, 48) || "Lobby";
}
