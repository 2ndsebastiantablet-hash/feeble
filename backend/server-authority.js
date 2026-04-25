import { clamp } from "./utils.js";

function sanitizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(parsed, -500, 500);
}

function sanitizeVector(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: sanitizeNumber(value?.x, fallback.x),
    y: sanitizeNumber(value?.y, fallback.y),
    z: sanitizeNumber(value?.z, fallback.z)
  };
}

function sanitizeColor(value, fallback) {
  const color = String(value || fallback).trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}

export const defaultAuthority = {
  createInitialPlayerState() {
    return {
      rig: { x: 0, y: 0, z: 4 },
      head: { x: 0, y: 1.6, z: 4 },
      leftHand: { x: -0.35, y: 1.15, z: 3.6 },
      rightHand: { x: 0.35, y: 1.15, z: 3.6 }
    };
  },

  filterClientStateUpdate({ proposedState, proposedMeta }) {
    const state = typeof proposedState === "object" && proposedState ? proposedState : {};
    const meta = typeof proposedMeta === "object" && proposedMeta ? proposedMeta : {};

    return {
      state: {
        rig: sanitizeVector(state.rig, { x: 0, y: 0, z: 4 }),
        head: sanitizeVector(state.head, { x: 0, y: 1.6, z: 4 }),
        leftHand: sanitizeVector(state.leftHand, { x: -0.35, y: 1.15, z: 3.6 }),
        rightHand: sanitizeVector(state.rightHand, { x: 0.35, y: 1.15, z: 3.6 })
      },
      meta: {
        headColor: sanitizeColor(meta.headColor, "#F2F5FF"),
        bodyColor: sanitizeColor(meta.bodyColor, "#7A9BFF"),
        leftHandColor: sanitizeColor(meta.leftHandColor, "#FF7AA2"),
        rightHandColor: sanitizeColor(meta.rightHandColor, "#6FC3FF")
      }
    };
  },

  onPlayerJoin() {},

  onPlayerLeave() {},

  onLobbyEmpty() {},

  onBeforeBroadcast({ snapshot }) {
    return snapshot;
  },

  onCustomMessage() {
    return { handled: false };
  }
};
