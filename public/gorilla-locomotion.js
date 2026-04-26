(function () {
  AFRAME.registerComponent("locomotion-collider", {
    schema: {
      type: { default: "box" },
      size: { type: "vec3", default: { x: 1, y: 1, z: 1 } }
    }
  });

  AFRAME.registerComponent("simple-vr-locomotion", {
    schema: {
      leftController: { type: "selector" },
      rightController: { type: "selector" },
      camera: { type: "selector" },
      moveSpeed: { default: 3.25 },
      turnSpeed: { default: 120 },
      jumpVelocity: { default: 4.75 },
      gravity: { default: -11 },
      floorY: { default: 0 }
    },

    init: function () {
      this.moveInput = { x: 0, y: 0 };
      this.turnInput = 0;
      this.keyboardInput = { x: 0, z: 0 };
      this.pressedKeys = new Set();
      this.velocityY = 0;
      this.grounded = true;
      this.worldQuaternion = new THREE.Quaternion();
      this.yawEuler = new THREE.Euler(0, 0, 0, "YXZ");
      this.forward = new THREE.Vector3();
      this.right = new THREE.Vector3();
      this.move = new THREE.Vector3();

      this.onLeftThumbstickMoved = this.onLeftThumbstickMoved.bind(this);
      this.onLeftThumbstickEnd = this.onLeftThumbstickEnd.bind(this);
      this.onRightThumbstickMoved = this.onRightThumbstickMoved.bind(this);
      this.onRightThumbstickEnd = this.onRightThumbstickEnd.bind(this);
      this.onJumpButton = this.onJumpButton.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onKeyUp = this.onKeyUp.bind(this);

      this.setupDesktopFallback();
    },

    play: function () {
      window.addEventListener("keydown", this.onKeyDown);
      window.addEventListener("keyup", this.onKeyUp);

      if (this.data.leftController) {
        this.data.leftController.addEventListener("thumbstickmoved", this.onLeftThumbstickMoved);
        this.data.leftController.addEventListener("thumbsticktouchend", this.onLeftThumbstickEnd);
      }

      if (this.data.rightController) {
        this.data.rightController.addEventListener("thumbstickmoved", this.onRightThumbstickMoved);
        this.data.rightController.addEventListener("thumbsticktouchend", this.onRightThumbstickEnd);
        this.data.rightController.addEventListener("abuttondown", this.onJumpButton);
        this.data.rightController.addEventListener("bbuttondown", this.onJumpButton);
      }
    },

    pause: function () {
      window.removeEventListener("keydown", this.onKeyDown);
      window.removeEventListener("keyup", this.onKeyUp);

      if (this.data.leftController) {
        this.data.leftController.removeEventListener("thumbstickmoved", this.onLeftThumbstickMoved);
        this.data.leftController.removeEventListener("thumbsticktouchend", this.onLeftThumbstickEnd);
      }

      if (this.data.rightController) {
        this.data.rightController.removeEventListener("thumbstickmoved", this.onRightThumbstickMoved);
        this.data.rightController.removeEventListener("thumbsticktouchend", this.onRightThumbstickEnd);
        this.data.rightController.removeEventListener("abuttondown", this.onJumpButton);
        this.data.rightController.removeEventListener("bbuttondown", this.onJumpButton);
      }
    },

    onKeyDown: function (event) {
      if (event.repeat && event.code === "Space") {
        return;
      }

      if (this.applyKeyboardEvent(event.code, true)) {
        event.preventDefault();
      }
    },

    onKeyUp: function (event) {
      if (this.applyKeyboardEvent(event.code, false)) {
        event.preventDefault();
      }
    },

    applyKeyboardEvent: function (code, pressed) {
      if (code === "KeyW" || code === "KeyS" || code === "KeyA" || code === "KeyD") {
        if (pressed) {
          this.pressedKeys.add(code);
        } else {
          this.pressedKeys.delete(code);
        }

        this.keyboardInput.x = (this.pressedKeys.has("KeyD") ? 1 : 0) - (this.pressedKeys.has("KeyA") ? 1 : 0);
        this.keyboardInput.z = (this.pressedKeys.has("KeyW") ? 1 : 0) - (this.pressedKeys.has("KeyS") ? 1 : 0);
        return true;
      }

      if (code === "Space") {
        if (pressed) {
          this.onJumpButton();
        }

        return true;
      }

      return false;
    },

    setupDesktopFallback: function () {
      const cameraEl = this.data.camera;
      const updateNote = function () {
        const noteEl = document.getElementById("note");

        if (noteEl) {
          noteEl.textContent = "Neighborhood hub loaded. Quest: left joystick moves, right joystick turns, A/B jumps, grip grabs. PC: WASD moves, space jumps, mouse looks, and left/right mouse click grabs loose supplies.";
        }
      };

      if (cameraEl) {
        cameraEl.setAttribute("look-controls", "pointerLockEnabled: true");
        // Defer this so the component registration below is definitely available.
        setTimeout(function () {
          cameraEl.setAttribute("desktop-click-grabber", "");
        }, 0);
      }

      updateNote();
      window.addEventListener("DOMContentLoaded", updateNote);
      setTimeout(updateNote, 250);
    },

    onLeftThumbstickMoved: function (event) {
      this.moveInput.x = event.detail.x || 0;
      this.moveInput.y = event.detail.y || 0;
    },

    onLeftThumbstickEnd: function () {
      this.moveInput.x = 0;
      this.moveInput.y = 0;
    },

    onRightThumbstickMoved: function (event) {
      this.turnInput = event.detail.x || 0;
    },

    onRightThumbstickEnd: function () {
      this.turnInput = 0;
    },

    onJumpButton: function () {
      if (!this.grounded) {
        return;
      }

      this.velocityY = this.data.jumpVelocity;
      this.grounded = false;
    },

    tick: function (time, deltaMs) {
      if (!this.data.camera) {
        return;
      }

      const deltaTime = Math.min(deltaMs / 1000, 0.05);

      if (!deltaTime) {
        return;
      }

      // Smooth turn using the right joystick X axis.
      this.el.object3D.rotation.y -= THREE.MathUtils.degToRad(this.turnInput * this.data.turnSpeed * deltaTime);

      // Move in the direction the headset is facing, but ignore headset pitch and roll.
      this.data.camera.object3D.getWorldQuaternion(this.worldQuaternion);
      this.yawEuler.setFromQuaternion(this.worldQuaternion);
      this.yawEuler.x = 0;
      this.yawEuler.z = 0;

      this.forward.set(0, 0, -1).applyEuler(this.yawEuler);
      this.right.set(1, 0, 0).applyEuler(this.yawEuler);

      this.move.set(0, 0, 0);
      this.move.addScaledVector(this.right, this.moveInput.x + this.keyboardInput.x);
      this.move.addScaledVector(this.forward, -this.moveInput.y + this.keyboardInput.z);

      if (this.move.lengthSq() > 1) {
        this.move.normalize();
      }

      this.el.object3D.position.addScaledVector(this.move, this.data.moveSpeed * deltaTime);

      this.velocityY += this.data.gravity * deltaTime;
      this.el.object3D.position.y += this.velocityY * deltaTime;

      if (this.el.object3D.position.y <= this.data.floorY) {
        this.el.object3D.position.y = this.data.floorY;
        this.velocityY = 0;
        this.grounded = true;
      }
    }
  });

  AFRAME.registerComponent("desktop-click-grabber", {
    schema: {
      distance: { default: 5 },
      leftHoldOffset: { type: "vec3", default: { x: -0.28, y: -0.24, z: -0.85 } },
      rightHoldOffset: { type: "vec3", default: { x: 0.28, y: -0.24, z: -0.85 } }
    },

    init: function () {
      this.heldByButton = {};
      this.raycaster = new THREE.Raycaster();
      this.origin = new THREE.Vector3();
      this.direction = new THREE.Vector3();
      this.meshTargets = [];

      this.onMouseDown = this.onMouseDown.bind(this);
      this.onMouseUp = this.onMouseUp.bind(this);
      this.onContextMenu = this.onContextMenu.bind(this);
    },

    play: function () {
      window.addEventListener("mousedown", this.onMouseDown);
      window.addEventListener("mouseup", this.onMouseUp);
      window.addEventListener("contextmenu", this.onContextMenu);
    },

    pause: function () {
      window.removeEventListener("mousedown", this.onMouseDown);
      window.removeEventListener("mouseup", this.onMouseUp);
      window.removeEventListener("contextmenu", this.onContextMenu);
    },

    onContextMenu: function (event) {
      event.preventDefault();
    },

    onMouseDown: function (event) {
      if (event.button !== 0 && event.button !== 2) {
        return;
      }

      event.preventDefault();

      if (document.body.requestPointerLock && document.pointerLockElement !== document.body) {
        document.body.requestPointerLock();
      }

      this.pickUp(event.button);
    },

    onMouseUp: function (event) {
      if (event.button !== 0 && event.button !== 2) {
        return;
      }

      event.preventDefault();
      this.drop(event.button);
    },

    pickUp: function (button) {
      if (this.heldByButton[button]) {
        return;
      }

      const target = this.findClosestGrabbable();

      if (!target) {
        return;
      }

      this.el.object3D.attach(target.object3D);
      target.object3D.position.copy(button === 0 ? this.data.leftHoldOffset : this.data.rightHoldOffset);
      target.object3D.rotation.set(0, 0, 0);
      target.addState("held");
      this.heldByButton[button] = target;
    },

    drop: function (button) {
      const heldEl = this.heldByButton[button];

      if (!heldEl) {
        return;
      }

      this.el.sceneEl.object3D.attach(heldEl.object3D);
      heldEl.removeState("held");
      delete this.heldByButton[button];
    },

    findClosestGrabbable: function () {
      const candidates = Array.from(this.el.sceneEl.querySelectorAll(".grabbable-object"));

      if (!candidates.length) {
        return null;
      }

      this.el.sceneEl.object3D.updateMatrixWorld(true);
      this.el.object3D.getWorldPosition(this.origin);
      this.direction.set(0, 0, -1).applyQuaternion(this.el.object3D.getWorldQuaternion(new THREE.Quaternion())).normalize();
      this.raycaster.set(this.origin, this.direction);
      this.raycaster.far = this.data.distance;
      this.meshTargets.length = 0;

      for (const candidate of candidates) {
        if (candidate.is("held")) {
          continue;
        }

        candidate.object3D.traverse((object) => {
          if (object.isMesh) {
            object.userData.grabbableEl = candidate;
            this.meshTargets.push(object);
          }
        });
      }

      const hits = this.raycaster.intersectObjects(this.meshTargets, true);

      if (!hits.length) {
        return null;
      }

      return hits[0].object.userData.grabbableEl || null;
    }
  });
}());
