window.addEventListener("DOMContentLoaded", function () {
  const scene = document.querySelector("a-scene");
  const note = document.getElementById("note");

  if (!scene || !note) {
    return;
  }

  const defaultNote = note.textContent.trim();

  scene.addEventListener("enter-vr", function () {
    note.textContent = "Push your hands against the floor or blocks to move. Pull hard to unstick a hand.";
  });

  scene.addEventListener("exit-vr", function () {
    note.textContent = defaultNote;
  });
});
