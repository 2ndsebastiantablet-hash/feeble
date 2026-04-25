// This file is a small browser-side helper for the locomotion template.
// The actual movement system lives in gorilla-locomotion.js.

window.addEventListener("DOMContentLoaded", function () {
  const scene = document.querySelector("a-scene");
  const note = document.getElementById("note");

  if (!scene || !note) {
    return;
  }

  const defaultNote = note.textContent.trim();

  scene.addEventListener("enter-vr", function () {
    note.textContent = "Push against the floor or blocks with your tracked hands. Thumbsticks and teleport are intentionally disabled.";
  });

  scene.addEventListener("exit-vr", function () {
    note.textContent = defaultNote;
  });
});
