(function () {
  // The live game now uses simple Quest locomotion instead of Gorilla Tag hand pushing.
  // Left joystick moves the rig and the right controller jump button applies a fixed jump.
  AFRAME.registerComponent("simple-vr-locomotion", {
    schema: {
      leftController: { type: "selector" },
      rightController: { type: "selector" },
      camera: { type: "selector" },
      moveSpeed: { default: 3.25 },
      jumpVelocity: { default: 4.75 },
      gravity: { default: -11 },
      floorY: { default: 0 }
    },

    init: function () {
      this.input = { x: 0, y: 0 };
      this.velocityY = 0;
      this.grounded = true;
      this.yawEuler = new THREE.Euler(0, 0, 0, "YXZ");
      this.forward = new THREE.Vector3();
      this.right = new THREE.Vector3();
      this.move = new THREE.Vector3();

      this.onThumbstickMoved = this.onThumbstickMoved.bind(this);
      this.onThumbstickEnd = this.onThumbstickEnd.bind(this);
      this.onJumpButton = this.onJumpButton.bind(this);
    },

    play: function () {
      if (this.data.leftController) {
        this.data.leftController.addEventListener("thumbstickmoved", this.onThumbstickMoved);
        this.data.leftController.addEventListener("thumbsticktouchend", this.onThumbstickEnd);
      }

      if (this.data.rightController) {
        this.data.rightController.addEventListener("abuttondown", this.onJumpButton);
        this.data.rightController.addEventListener("bbuttondown", this.onJumpButton);
      }
    },

    pause: function () {
      if (this.data.leftController) {
        this.data.leftController.removeEventListener("thumbstickmoved", this.onThumbstickMoved);
        this.data.leftController.removeEventListener("thumbsticktouchend", this.onThumbstickEnd);
      }

      if (this.data.rightController) {
        this.data.rightController.removeEventListener("abuttondown", this.onJumpButton);
        this.data.rightController.removeEventListener("bbuttondown", this.onJumpButton);
      }
    },

    onThumbstickMoved: function (event) {
      this.input.x = event.detail.x || 0;
      this.input.y = event.detail.y || 0;
    },

    onThumbstickEnd: function () {
      this.input.x = 0;
      this.input.y = 0;
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

      this.yawEuler.setFromQuaternion(this.data.camera.object3D.quaternion);
      this.yawEuler.x = 0;
      this.yawEuler.z = 0;

      this.forward.set(0, 0, -1).applyEuler(this.yawEuler);
      this.right.set(1, 0, 0).applyEuler(this.yawEuler);

      this.move.set(0, 0, 0);
      this.move.addScaledVector(this.right, this.input.x);
      this.move.addScaledVector(this.forward, -this.input.y);

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
