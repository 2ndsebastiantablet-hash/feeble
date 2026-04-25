(function () {
  const clamp = THREE.MathUtils.clamp;

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
      handRadius: { default: 0.14 },
      floorHeight: { default: 0 },
      cameraGroundOffset: { default: 0 },
      gravity: { default: 18 },
      airDamping: { default: 0.92 },
      groundDamping: { default: 0.72 },
      maxVelocity: { default: 6.5 },
      maxMovePerFrame: { default: 0.35 },
      velocitySampleCount: { default: 6 }
    },

    init: function () {
      this.rig = this.el.object3D;
      this.rigPosition = this.rig.position;
      this.velocity = new THREE.Vector3();
      this.currentAverageVelocity = new THREE.Vector3();
      this.frameMovement = new THREE.Vector3();

      this.leftCurrent = new THREE.Vector3();
      this.rightCurrent = new THREE.Vector3();
      this.leftPrevious = new THREE.Vector3();
      this.rightPrevious = new THREE.Vector3();
      this.leftDelta = new THREE.Vector3();
      this.rightDelta = new THREE.Vector3();

      this.colliderCenter = new THREE.Vector3();
      this.colliderMin = new THREE.Vector3();
      this.colliderMax = new THREE.Vector3();
      this.closestPoint = new THREE.Vector3();
      this.sampleVelocity = new THREE.Vector3();
      this.headLocalPosition = new THREE.Vector3();

      this.leftTouching = false;
      this.rightTouching = false;
      this.hasPreviousHandPositions = false;

      this.velocitySamples = [];
      this.velocitySampleIndex = 0;
      this.velocitySampleFilled = 0;

      for (let i = 0; i < this.data.velocitySampleCount; i += 1) {
        this.velocitySamples.push(new THREE.Vector3());
      }

      this.colliders = [];
      this.setup = this.setup.bind(this);

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

      this.storeFinalHandPositions();
      this.hasPreviousHandPositions = true;
      this.updateDebugText(false, false);
    },

    tick: function (time, deltaMs) {
      if (!this.hasPreviousHandPositions || !this.data.leftHand || !this.data.rightHand) {
        return;
      }

      const deltaSeconds = Math.min(deltaMs / 1000, 0.05);

      if (!deltaSeconds) {
        return;
      }

      this.data.leftHand.object3D.getWorldPosition(this.leftCurrent);
      this.data.rightHand.object3D.getWorldPosition(this.rightCurrent);

      this.leftDelta.subVectors(this.leftCurrent, this.leftPrevious);
      this.rightDelta.subVectors(this.rightCurrent, this.rightPrevious);

      this.leftTouching = this.handTouchesColliders(this.leftCurrent);
      this.rightTouching = this.handTouchesColliders(this.rightCurrent);

      // When a hand is touching, move the rig opposite the hand's travel so the
      // hand feels braced against the world. Averaging both hands keeps two-hand
      // pushes from doubling the movement too aggressively.
      this.frameMovement.set(0, 0, 0);

      if (this.leftTouching) {
        this.frameMovement.sub(this.leftDelta);
      }

      if (this.rightTouching) {
        this.frameMovement.sub(this.rightDelta);
      }

      if (this.leftTouching && this.rightTouching) {
        this.frameMovement.multiplyScalar(0.5);
      }

      this.clampVectorLength(this.frameMovement, this.data.maxMovePerFrame);

      if (this.leftTouching || this.rightTouching) {
        this.rigPosition.add(this.frameMovement);

        if (this.frameMovement.lengthSq() > 0.000001) {
          // Keep a short history of locomotion velocity so releasing the hands
          // carries a little momentum instead of stopping instantly.
          this.sampleVelocity.copy(this.frameMovement).divideScalar(deltaSeconds);
          this.pushVelocitySample(this.sampleVelocity);
          this.velocity.lerp(this.getAverageVelocity(), 0.35);
        } else {
          this.velocity.multiplyScalar(Math.pow(0.4, deltaSeconds * 60));
        }
      } else {
        this.velocity.y -= this.data.gravity * deltaSeconds;
        this.rigPosition.addScaledVector(this.velocity, deltaSeconds);
      }

      this.applyFloorCollision();
      this.applyVelocityDamping(deltaSeconds);
      this.clampVectorLength(this.velocity, this.data.maxVelocity);

      // Store the final world hand positions after moving the rig so the rig's own
      // translation is not misread as extra controller motion on the next frame.
      this.storeFinalHandPositions();
      this.updateDebugText(this.leftTouching, this.rightTouching);
    },

    handTouchesColliders: function (handWorldPosition) {
      const handRadius = this.data.handRadius;

      for (const colliderEl of this.colliders) {
        const collider = colliderEl.components["locomotion-collider"];

        if (!collider) {
          continue;
        }

        const data = collider.data;
        colliderEl.object3D.getWorldPosition(this.colliderCenter);

        if (data.type === "floor") {
          const halfWidth = data.size.x * 0.5;
          const halfDepth = data.size.z * 0.5;
          const withinX = handWorldPosition.x >= this.colliderCenter.x - halfWidth &&
            handWorldPosition.x <= this.colliderCenter.x + halfWidth;
          const withinZ = handWorldPosition.z >= this.colliderCenter.z - halfDepth &&
            handWorldPosition.z <= this.colliderCenter.z + halfDepth;
          const touchingFloor = handWorldPosition.y <= this.colliderCenter.y + handRadius;

          if (withinX && withinZ && touchingFloor) {
            return true;
          }

          continue;
        }

        if (data.type === "box") {
          // Use a simple sphere-vs-box overlap test by clamping the hand position
          // to the nearest point inside the box and measuring the distance.
          this.colliderMin.set(
            this.colliderCenter.x - data.size.x * 0.5,
            this.colliderCenter.y - data.size.y * 0.5,
            this.colliderCenter.z - data.size.z * 0.5
          );
          this.colliderMax.set(
            this.colliderCenter.x + data.size.x * 0.5,
            this.colliderCenter.y + data.size.y * 0.5,
            this.colliderCenter.z + data.size.z * 0.5
          );

          this.closestPoint.set(
            clamp(handWorldPosition.x, this.colliderMin.x, this.colliderMax.x),
            clamp(handWorldPosition.y, this.colliderMin.y, this.colliderMax.y),
            clamp(handWorldPosition.z, this.colliderMin.z, this.colliderMax.z)
          );

          if (this.closestPoint.distanceToSquared(handWorldPosition) <= handRadius * handRadius) {
            return true;
          }
        }
      }

      return false;
    },

    pushVelocitySample: function (newVelocity) {
      this.velocitySamples[this.velocitySampleIndex].copy(newVelocity);
      this.velocitySampleIndex = (this.velocitySampleIndex + 1) % this.velocitySamples.length;

      if (this.velocitySampleFilled < this.velocitySamples.length) {
        this.velocitySampleFilled += 1;
      }
    },

    getAverageVelocity: function () {
      this.currentAverageVelocity.set(0, 0, 0);

      if (!this.velocitySampleFilled) {
        return this.currentAverageVelocity;
      }

      for (let i = 0; i < this.velocitySampleFilled; i += 1) {
        this.currentAverageVelocity.add(this.velocitySamples[i]);
      }

      this.currentAverageVelocity.multiplyScalar(1 / this.velocitySampleFilled);
      this.clampVectorLength(this.currentAverageVelocity, this.data.maxVelocity);

      return this.currentAverageVelocity;
    },

    applyFloorCollision: function () {
      if (this.data.head) {
        // Keep the headset itself down at floor height by offsetting the rig by
        // the tracked local headset Y position every frame.
        this.headLocalPosition.copy(this.data.head.object3D.position);
        this.rigPosition.y = this.data.floorHeight - this.headLocalPosition.y + this.data.cameraGroundOffset;
        this.velocity.y = 0;
        return;
      }

      if (this.rigPosition.y < this.data.floorHeight) {
        this.rigPosition.y = this.data.floorHeight;

        if (this.velocity.y < 0) {
          this.velocity.y = 0;
        }
      }
    },

    applyVelocityDamping: function (deltaSeconds) {
      // Air damping is light so launches carry a bit. Ground damping is stronger
      // so the player settles instead of skating forever across the floor.
      const damping = this.rigPosition.y <= this.data.floorHeight + 0.001
        ? this.data.groundDamping
        : this.data.airDamping;
      const dampingFactor = Math.pow(damping, deltaSeconds * 60);

      this.velocity.multiplyScalar(dampingFactor);

      if (this.rigPosition.y <= this.data.floorHeight + 0.001 && this.velocity.y < 0.001) {
        this.velocity.y = 0;
      }
    },

    clampVectorLength: function (vector, maxLength) {
      if (vector.lengthSq() > maxLength * maxLength) {
        vector.setLength(maxLength);
      }
    },

    storeFinalHandPositions: function () {
      this.data.leftHand.object3D.getWorldPosition(this.leftPrevious);
      this.data.rightHand.object3D.getWorldPosition(this.rightPrevious);
    },

    updateDebugText: function (leftTouching, rightTouching) {
      if (!this.data.debugText) {
        return;
      }

      const value = [
        "Left touching: " + leftTouching,
        "Right touching: " + rightTouching,
        "Velocity: " +
          this.velocity.x.toFixed(2) + ", " +
          this.velocity.y.toFixed(2) + ", " +
          this.velocity.z.toFixed(2)
      ].join("\n");

      this.data.debugText.setAttribute("value", value);
    }
  });
}());
