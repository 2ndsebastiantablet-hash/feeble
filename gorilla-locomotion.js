(function () {
  const TEMP = {
    bodyCenter: new THREE.Vector3(),
    boxCenter: new THREE.Vector3(),
    boxMin: new THREE.Vector3(),
    boxMax: new THREE.Vector3(),
    closestPoint: new THREE.Vector3(),
    handPush: new THREE.Vector3(),
    handResolved: new THREE.Vector3(),
    visualLocal: new THREE.Vector3()
  };

  AFRAME.registerComponent("locomotion-collider", {
    schema: {
      type: { default: "box" },
      size: { type: "vec3", default: { x: 1, y: 1, z: 1 } }
    }
  });

  AFRAME.registerComponent("gorilla-locomotion", {
    schema: {
      leftHand: { type: "selector" },
      rightHand: { type: "selector" },
      head: { type: "selector" },
      debugText: { type: "selector" },
      handRadius: { default: 0.12 },
      floorHeight: { default: 0 },
      gravity: { default: -14.7 },
      linearDrag: { default: 3.5 },
      maxMovePerFrame: { default: 0.3 },
      maxVelocity: { default: 6.5 },
      bodyRadius: { default: 0.32 },
      bodyHeight: { default: 1.0 }
    },

    init: function () {
      this.rig = this.el.object3D;
      this.leftVisual = null;
      this.rightVisual = null;
      this.colliders = [];

      this.currentLeftWorld = new THREE.Vector3();
      this.currentRightWorld = new THREE.Vector3();
      this.currentHeadWorld = new THREE.Vector3();
      this.previousLeftWorld = new THREE.Vector3();
      this.previousRightWorld = new THREE.Vector3();
      this.leftDelta = new THREE.Vector3();
      this.rightDelta = new THREE.Vector3();
      this.frameMovement = new THREE.Vector3();
      this.velocity = new THREE.Vector3();
      this.leftResolved = new THREE.Vector3();
      this.rightResolved = new THREE.Vector3();

      this.leftTouchingFloor = false;
      this.rightTouchingFloor = false;
      this.leftTouchingSurface = false;
      this.rightTouchingSurface = false;
      this.hasPreviousHands = false;

      this.setup = this.setup.bind(this);
      this.resetTracking = this.resetTracking.bind(this);

      if (this.el.sceneEl.hasLoaded) {
        this.setup();
      } else {
        this.el.sceneEl.addEventListener("loaded", this.setup, { once: true });
      }
    },

    setup: function () {
      this.colliders = Array.from(
        this.el.sceneEl.querySelectorAll("[locomotion-collider]")
      );
      this.leftVisual = this.el.sceneEl.querySelector("#left-hand-visual");
      this.rightVisual = this.el.sceneEl.querySelector("#right-hand-visual");

      this.el.sceneEl.addEventListener("enter-vr", this.resetTracking);
      this.resetTracking();
      this.updateDebugText();
    },

    remove: function () {
      this.el.sceneEl.removeEventListener("enter-vr", this.resetTracking);
    },

    resetTracking: function () {
      // Start the locomotion rig at floor level. In Quest, the XR headset pose
      // already supplies the user's real standing eye height.
      this.rig.position.y = this.data.floorHeight;
      this.velocity.set(0, 0, 0);
      this.leftDelta.set(0, 0, 0);
      this.rightDelta.set(0, 0, 0);
      this.frameMovement.set(0, 0, 0);

      this.readHandWorldPositions();
      this.previousLeftWorld.copy(this.currentLeftWorld);
      this.previousRightWorld.copy(this.currentRightWorld);
      this.hasPreviousHands = true;

      this.leftTouchingFloor = false;
      this.rightTouchingFloor = false;
      this.leftTouchingSurface = false;
      this.rightTouchingSurface = false;

      this.updateHandVisual(this.data.leftHand, this.leftVisual, this.currentLeftWorld);
      this.updateHandVisual(this.data.rightHand, this.rightVisual, this.currentRightWorld);
      this.updateDebugText();
    },

    tock: function (time, deltaMs) {
      if (!this.data.leftHand || !this.data.rightHand || !this.data.head || !this.data.debugText) {
        return;
      }

      const deltaTime = Math.min(deltaMs / 1000, 0.05);

      if (!deltaTime) {
        return;
      }

      this.readHandWorldPositions();

      if (!this.hasPreviousHands) {
        this.previousLeftWorld.copy(this.currentLeftWorld);
        this.previousRightWorld.copy(this.currentRightWorld);
        this.hasPreviousHands = true;
        this.updateDebugText();
        return;
      }

      this.leftDelta.subVectors(this.currentLeftWorld, this.previousLeftWorld);
      this.rightDelta.subVectors(this.currentRightWorld, this.previousRightWorld);

      this.leftTouchingFloor = this.currentLeftWorld.y - this.data.handRadius <= this.data.floorHeight;
      this.rightTouchingFloor = this.currentRightWorld.y - this.data.handRadius <= this.data.floorHeight;

      this.leftTouchingSurface = this.resolveHandCollision(this.currentLeftWorld, this.leftResolved);
      this.rightTouchingSurface = this.resolveHandCollision(this.currentRightWorld, this.rightResolved);

      this.frameMovement.set(0, 0, 0);

      if (this.leftTouchingSurface) {
        this.frameMovement.sub(this.leftDelta);
      }

      if (this.rightTouchingSurface) {
        this.frameMovement.sub(this.rightDelta);
      }

      if (this.leftTouchingSurface && this.rightTouchingSurface) {
        this.frameMovement.multiplyScalar(0.5);
      }

      if (this.frameMovement.lengthSq() > this.data.maxMovePerFrame * this.data.maxMovePerFrame) {
        this.frameMovement.setLength(this.data.maxMovePerFrame);
      }

      if (this.frameMovement.lengthSq() > 0) {
        this.rig.position.add(this.frameMovement);
        this.velocity.copy(this.frameMovement).divideScalar(deltaTime);
      } else {
        this.velocity.y += this.data.gravity * deltaTime;
        this.rig.position.addScaledVector(this.velocity, deltaTime);
      }

      this.applyRigFloorClamp();
      this.resolveBodyCollision();

      const dragFactor = Math.max(0, 1 - this.data.linearDrag * deltaTime);
      this.velocity.multiplyScalar(dragFactor);

      if (this.velocity.lengthSq() > this.data.maxVelocity * this.data.maxVelocity) {
        this.velocity.setLength(this.data.maxVelocity);
      }

      // Re-read after moving the rig so next-frame deltas only represent the
      // player's real controller motion, not the rig translation we just applied.
      this.readHandWorldPositions();
      this.previousLeftWorld.copy(this.currentLeftWorld);
      this.previousRightWorld.copy(this.currentRightWorld);

      this.updateHandVisual(
        this.data.leftHand,
        this.leftVisual,
        this.leftTouchingSurface ? this.leftResolved : this.currentLeftWorld
      );
      this.updateHandVisual(
        this.data.rightHand,
        this.rightVisual,
        this.rightTouchingSurface ? this.rightResolved : this.currentRightWorld
      );

      this.updateDebugText();
    },

    readHandWorldPositions: function () {
      this.el.sceneEl.object3D.updateMatrixWorld(true);
      this.data.leftHand.object3D.updateMatrixWorld(true);
      this.data.rightHand.object3D.updateMatrixWorld(true);
      this.data.head.object3D.updateMatrixWorld(true);

      this.data.leftHand.object3D.getWorldPosition(this.currentLeftWorld);
      this.data.rightHand.object3D.getWorldPosition(this.currentRightWorld);
      this.data.head.object3D.getWorldPosition(this.currentHeadWorld);
    },

    resolveHandCollision: function (worldPosition, resolvedTarget) {
      let touching = false;
      resolvedTarget.copy(worldPosition);

      if (resolvedTarget.y - this.data.handRadius <= this.data.floorHeight) {
        resolvedTarget.y = this.data.floorHeight + this.data.handRadius;
        touching = true;
      }

      for (const colliderEl of this.colliders) {
        const collider = colliderEl.components["locomotion-collider"];

        if (!collider || collider.data.type !== "box") {
          continue;
        }

        colliderEl.object3D.getWorldPosition(TEMP.boxCenter);
        TEMP.boxMin.set(
          TEMP.boxCenter.x - collider.data.size.x * 0.5,
          TEMP.boxCenter.y - collider.data.size.y * 0.5,
          TEMP.boxCenter.z - collider.data.size.z * 0.5
        );
        TEMP.boxMax.set(
          TEMP.boxCenter.x + collider.data.size.x * 0.5,
          TEMP.boxCenter.y + collider.data.size.y * 0.5,
          TEMP.boxCenter.z + collider.data.size.z * 0.5
        );

        if (this.getSphereBoxPush(resolvedTarget, this.data.handRadius, TEMP.boxMin, TEMP.boxMax, TEMP.handPush)) {
          resolvedTarget.add(TEMP.handPush);
          touching = true;
        }
      }

      return touching;
    },

    resolveBodyCollision: function () {
      TEMP.bodyCenter.set(
        this.rig.position.x,
        this.rig.position.y + this.data.bodyHeight,
        this.rig.position.z
      );

      for (const colliderEl of this.colliders) {
        const collider = colliderEl.components["locomotion-collider"];

        if (!collider || collider.data.type !== "box") {
          continue;
        }

        colliderEl.object3D.getWorldPosition(TEMP.boxCenter);
        TEMP.boxMin.set(
          TEMP.boxCenter.x - collider.data.size.x * 0.5,
          TEMP.boxCenter.y - collider.data.size.y * 0.5,
          TEMP.boxCenter.z - collider.data.size.z * 0.5
        );
        TEMP.boxMax.set(
          TEMP.boxCenter.x + collider.data.size.x * 0.5,
          TEMP.boxCenter.y + collider.data.size.y * 0.5,
          TEMP.boxCenter.z + collider.data.size.z * 0.5
        );

        if (this.getSphereBoxPush(TEMP.bodyCenter, this.data.bodyRadius, TEMP.boxMin, TEMP.boxMax, TEMP.handPush)) {
          this.rig.position.add(TEMP.handPush);
          TEMP.bodyCenter.add(TEMP.handPush);

          if (Math.abs(TEMP.handPush.y) > 0.001 && this.velocity.y < 0) {
            this.velocity.y = 0;
          }
        }
      }
    },

    getSphereBoxPush: function (position, radius, min, max, target) {
      TEMP.closestPoint.set(
        THREE.MathUtils.clamp(position.x, min.x, max.x),
        THREE.MathUtils.clamp(position.y, min.y, max.y),
        THREE.MathUtils.clamp(position.z, min.z, max.z)
      );

      target.copy(position).sub(TEMP.closestPoint);
      const distanceSq = target.lengthSq();

      if (distanceSq > 0.000001) {
        const distance = Math.sqrt(distanceSq);

        if (distance >= radius) {
          target.set(0, 0, 0);
          return false;
        }

        target.multiplyScalar((radius - distance) / distance);
        return true;
      }

      if (
        position.x < min.x || position.x > max.x ||
        position.y < min.y || position.y > max.y ||
        position.z < min.z || position.z > max.z
      ) {
        target.set(0, 0, 0);
        return false;
      }

      const distances = [
        { axis: "x", value: -(position.x - min.x + radius), abs: position.x - min.x + radius },
        { axis: "x", value: max.x - position.x + radius, abs: max.x - position.x + radius },
        { axis: "y", value: -(position.y - min.y + radius), abs: position.y - min.y + radius },
        { axis: "y", value: max.y - position.y + radius, abs: max.y - position.y + radius },
        { axis: "z", value: -(position.z - min.z + radius), abs: position.z - min.z + radius },
        { axis: "z", value: max.z - position.z + radius, abs: max.z - position.z + radius }
      ];

      distances.sort(function (a, b) {
        return a.abs - b.abs;
      });

      target.set(0, 0, 0);
      target[distances[0].axis] = distances[0].value;
      return true;
    },

    applyRigFloorClamp: function () {
      if (this.rig.position.y < this.data.floorHeight) {
        this.rig.position.y = this.data.floorHeight;

        if (this.velocity.y < 0) {
          this.velocity.y = 0;
        }
      }
    },

    updateHandVisual: function (handEntity, handVisual, worldPosition) {
      if (!handEntity || !handVisual) {
        return;
      }

      TEMP.visualLocal.copy(worldPosition);
      handEntity.object3D.worldToLocal(TEMP.visualLocal);
      handVisual.object3D.position.copy(TEMP.visualLocal);
    },

    updateDebugText: function () {
      if (!this.data.debugText) {
        return;
      }

      this.data.debugText.setAttribute("value", [
        "L world: " + this.formatVector(this.currentLeftWorld),
        "R world: " + this.formatVector(this.currentRightWorld),
        "L delta: " + this.formatVector(this.leftDelta),
        "R delta: " + this.formatVector(this.rightDelta),
        "L touching floor: " + this.leftTouchingFloor,
        "R touching floor: " + this.rightTouchingFloor,
        "Move applied: " + this.formatVector(this.frameMovement),
        "Rig pos: " + this.formatVector(this.rig.position),
        "Velocity: " + this.formatVector(this.velocity)
      ].join("\n"));
    },

    formatVector: function (vector) {
      return [
        vector.x.toFixed(2),
        vector.y.toFixed(2),
        vector.z.toFixed(2)
      ].join(", ");
    }
  });
}());
