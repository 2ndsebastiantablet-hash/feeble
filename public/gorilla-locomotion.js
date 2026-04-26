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
    },

    play: function () {
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
      this.move.addScaledVector(this.right, this.moveInput.x);
      this.move.addScaledVector(this.forward, -this.moveInput.y);

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
}());
