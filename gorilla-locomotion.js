(function () {
  const EPSILON = 0.00001;

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
      headRadius: { default: 0.2 },
      bodyRadius: { default: 0.35 },
      bodyOffsetY: { default: 1.2 },
      floorHeight: { default: 0 },
      maxArmLength: { default: 1.5 },
      unStickDistance: { default: 1.0 },
      velocityLimit: { default: 0.1 },
      maxJumpSpeed: { default: 14 },
      jumpMultiplier: { default: 1.8 },
      gravity: { default: -14.7 },
      linearDrag: { default: 0.05 },
      velocityHistorySize: { default: 5 },
      maxMovePerFrame: { default: 0.45 }
    },

    init: function () {
      this.rig = this.el.object3D;
      this.rigPosition = this.rig.position;
      this.colliders = [];

      this.velocity = new THREE.Vector3();
      this.lastPosition = new THREE.Vector3();
      this.lastHeadPosition = new THREE.Vector3();
      this.lastLeftHandPosition = new THREE.Vector3();
      this.lastRightHandPosition = new THREE.Vector3();

      this.currentLeftHand = new THREE.Vector3();
      this.currentRightHand = new THREE.Vector3();
      this.currentHead = new THREE.Vector3();
      this.currentHandWorld = new THREE.Vector3();
      this.currentHeadWorld = new THREE.Vector3();

      this.firstIterationLeftHand = new THREE.Vector3();
      this.firstIterationRightHand = new THREE.Vector3();
      this.rigidBodyMovement = new THREE.Vector3();
      this.distanceTraveled = new THREE.Vector3();
      this.finalHandPosition = new THREE.Vector3();
      this.gravityHandOffset = new THREE.Vector3();
      this.headCollisionPosition = new THREE.Vector3();
      this.bodyCollisionPosition = new THREE.Vector3();
      this.leftDisplayPosition = new THREE.Vector3();
      this.rightDisplayPosition = new THREE.Vector3();
      this.tempLocalPosition = new THREE.Vector3();

      this.collisionPush = new THREE.Vector3();
      this.totalPush = new THREE.Vector3();
      this.closestPoint = new THREE.Vector3();
      this.boxCenter = new THREE.Vector3();
      this.boxMin = new THREE.Vector3();
      this.boxMax = new THREE.Vector3();

      this.currentVelocity = new THREE.Vector3();
      this.denormalizedVelocityAverage = new THREE.Vector3();
      this.velocityHistory = [];
      this.velocityIndex = 0;

      this.wasLeftHandTouching = false;
      this.wasRightHandTouching = false;
      this.hasInitializedHands = false;

      for (let i = 0; i < this.data.velocityHistorySize; i += 1) {
        this.velocityHistory.push(new THREE.Vector3());
      }

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
      this.leftHandVisual = this.el.sceneEl.querySelector("#left-hand-visual");
      this.rightHandVisual = this.el.sceneEl.querySelector("#right-hand-visual");

      this.getCurrentLeftHandPosition(this.lastLeftHandPosition);
      this.getCurrentRightHandPosition(this.lastRightHandPosition);
      this.getHeadPosition(this.lastHeadPosition);
      this.lastPosition.copy(this.rigPosition);
      this.hasInitializedHands = true;
      this.updateHandVisuals(this.lastLeftHandPosition, this.lastRightHandPosition);
      this.updateDebugText(false, false);
    },

    tick: function (time, deltaMs) {
      if (!this.hasInitializedHands || !this.data.leftHand || !this.data.rightHand || !this.data.head) {
        return;
      }

      const deltaTime = Math.min(deltaMs / 1000, 0.05);

      if (!deltaTime) {
        return;
      }

      let leftHandColliding = false;
      let rightHandColliding = false;

      this.getCurrentLeftHandPosition(this.currentLeftHand);
      this.getCurrentRightHandPosition(this.currentRightHand);
      this.getHeadPosition(this.currentHead);

      this.gravityHandOffset.set(0, 2 * this.data.gravity * deltaTime * deltaTime, 0);

      this.firstIterationLeftHand.set(0, 0, 0);
      this.firstIterationRightHand.set(0, 0, 0);
      this.rigidBodyMovement.set(0, 0, 0);

      // Left hand first pass: project where the sticky hand would end up and resolve collision.
      this.distanceTraveled.copy(this.currentLeftHand)
        .sub(this.lastLeftHandPosition)
        .add(this.gravityHandOffset);
      this.finalHandPosition.copy(this.lastLeftHandPosition).add(this.distanceTraveled);

      if (this.getCollisionPush(this.finalHandPosition, this.data.handRadius, this.collisionPush)) {
        this.finalHandPosition.add(this.collisionPush);
        this.firstIterationLeftHand.copy(this.finalHandPosition).sub(this.currentLeftHand);
        this.velocity.set(0, 0, 0);
        leftHandColliding = true;
      }

      // Right hand first pass.
      this.distanceTraveled.copy(this.currentRightHand)
        .sub(this.lastRightHandPosition)
        .add(this.gravityHandOffset);
      this.finalHandPosition.copy(this.lastRightHandPosition).add(this.distanceTraveled);

      if (this.getCollisionPush(this.finalHandPosition, this.data.handRadius, this.collisionPush)) {
        this.finalHandPosition.add(this.collisionPush);
        this.firstIterationRightHand.copy(this.finalHandPosition).sub(this.currentRightHand);
        this.velocity.set(0, 0, 0);
        rightHandColliding = true;
      }

      if ((leftHandColliding || this.wasLeftHandTouching) && (rightHandColliding || this.wasRightHandTouching)) {
        this.rigidBodyMovement.copy(this.firstIterationLeftHand)
          .add(this.firstIterationRightHand)
          .multiplyScalar(0.5);
      } else {
        this.rigidBodyMovement.copy(this.firstIterationLeftHand).add(this.firstIterationRightHand);
      }

      if (this.rigidBodyMovement.lengthSq() > this.data.maxMovePerFrame * this.data.maxMovePerFrame) {
        this.rigidBodyMovement.setLength(this.data.maxMovePerFrame);
      }

      // Keep the head out of geometry after the hand push moves the rig.
      this.headCollisionPosition.copy(this.currentHead).add(this.rigidBodyMovement);
      if (this.getCollisionPush(this.headCollisionPosition, this.data.headRadius, this.collisionPush)) {
        this.rigidBodyMovement.add(this.collisionPush);
      }

      if (this.rigidBodyMovement.lengthSq() > 0) {
        this.rigPosition.add(this.rigidBodyMovement);
      }

      this.getHeadPosition(this.lastHeadPosition);

      // Final left hand position after rig movement.
      this.getCurrentLeftHandPosition(this.currentLeftHand);
      this.distanceTraveled.copy(this.currentLeftHand).sub(this.lastLeftHandPosition);
      this.finalHandPosition.copy(this.lastLeftHandPosition).add(this.distanceTraveled);

      if (this.getCollisionPush(this.finalHandPosition, this.data.handRadius, this.collisionPush)) {
        this.finalHandPosition.add(this.collisionPush);
        this.lastLeftHandPosition.copy(this.finalHandPosition);
        leftHandColliding = true;
      } else {
        this.lastLeftHandPosition.copy(this.currentLeftHand);
      }

      // Final right hand position after rig movement.
      this.getCurrentRightHandPosition(this.currentRightHand);
      this.distanceTraveled.copy(this.currentRightHand).sub(this.lastRightHandPosition);
      this.finalHandPosition.copy(this.lastRightHandPosition).add(this.distanceTraveled);

      if (this.getCollisionPush(this.finalHandPosition, this.data.handRadius, this.collisionPush)) {
        this.finalHandPosition.add(this.collisionPush);
        this.lastRightHandPosition.copy(this.finalHandPosition);
        rightHandColliding = true;
      } else {
        this.lastRightHandPosition.copy(this.currentRightHand);
      }

      this.storeVelocities(deltaTime);

      // Launch velocity is based on the recent rig movement average, just like the reference system.
      if (leftHandColliding || rightHandColliding) {
        const velocityMagnitude = this.denormalizedVelocityAverage.length();

        if (velocityMagnitude > this.data.velocityLimit) {
          const targetSpeed = velocityMagnitude * this.data.jumpMultiplier;

          if (targetSpeed > this.data.maxJumpSpeed) {
            this.velocity.copy(this.denormalizedVelocityAverage)
              .normalize()
              .multiplyScalar(this.data.maxJumpSpeed);
          } else {
            this.velocity.copy(this.denormalizedVelocityAverage)
              .multiplyScalar(this.data.jumpMultiplier);
          }
        }
      }

      // Pulling far enough away breaks a stuck hand free.
      if (leftHandColliding && this.currentLeftHand.distanceTo(this.lastLeftHandPosition) > this.data.unStickDistance) {
        this.lastLeftHandPosition.copy(this.currentLeftHand);
        leftHandColliding = false;
      }

      if (rightHandColliding && this.currentRightHand.distanceTo(this.lastRightHandPosition) > this.data.unStickDistance) {
        this.lastRightHandPosition.copy(this.currentRightHand);
        rightHandColliding = false;
      }

      if (!leftHandColliding && !rightHandColliding) {
        this.velocity.y += this.data.gravity * deltaTime;
      }

      this.velocity.multiplyScalar(1 / (1 + this.data.linearDrag * deltaTime));
      this.rigPosition.addScaledVector(this.velocity, deltaTime);

      this.resolveBodyCollisions();

      this.wasLeftHandTouching = leftHandColliding;
      this.wasRightHandTouching = rightHandColliding;
      this.leftDisplayPosition.copy(leftHandColliding ? this.lastLeftHandPosition : this.currentLeftHand);
      this.rightDisplayPosition.copy(rightHandColliding ? this.lastRightHandPosition : this.currentRightHand);
      this.updateHandVisuals(this.leftDisplayPosition, this.rightDisplayPosition);
      this.updateDebugText(leftHandColliding, rightHandColliding);
    },

    getHeadPosition: function (target) {
      this.data.head.object3D.getWorldPosition(target);
      return target;
    },

    getCurrentLeftHandPosition: function (target) {
      return this.getClampedHandPosition(this.data.leftHand, target);
    },

    getCurrentRightHandPosition: function (target) {
      return this.getClampedHandPosition(this.data.rightHand, target);
    },

    getClampedHandPosition: function (handEl, target) {
      handEl.object3D.getWorldPosition(this.currentHandWorld);
      this.getHeadPosition(this.currentHeadWorld);

      const distance = this.currentHandWorld.distanceTo(this.currentHeadWorld);

      if (distance <= this.data.maxArmLength) {
        target.copy(this.currentHandWorld);
        return target;
      }

      target.copy(this.currentHandWorld)
        .sub(this.currentHeadWorld)
        .normalize()
        .multiplyScalar(this.data.maxArmLength)
        .add(this.currentHeadWorld);

      return target;
    },

    getCollisionPush: function (position, radius, target) {
      let collided = false;
      target.set(0, 0, 0);

      for (const colliderEl of this.colliders) {
        const collider = colliderEl.components["locomotion-collider"];

        if (!collider) {
          continue;
        }

        if (collider.data.type === "floor") {
          colliderEl.object3D.getWorldPosition(this.boxCenter);

          const halfWidth = collider.data.size.x * 0.5;
          const halfDepth = collider.data.size.z * 0.5;
          const withinX = position.x >= this.boxCenter.x - halfWidth && position.x <= this.boxCenter.x + halfWidth;
          const withinZ = position.z >= this.boxCenter.z - halfDepth && position.z <= this.boxCenter.z + halfDepth;
          const penetration = this.boxCenter.y + radius - position.y;

          if (withinX && withinZ && penetration > 0) {
            target.y += penetration;
            collided = true;
          }

          continue;
        }

        if (collider.data.type === "box") {
          colliderEl.object3D.getWorldPosition(this.boxCenter);
          this.boxMin.set(
            this.boxCenter.x - collider.data.size.x * 0.5,
            this.boxCenter.y - collider.data.size.y * 0.5,
            this.boxCenter.z - collider.data.size.z * 0.5
          );
          this.boxMax.set(
            this.boxCenter.x + collider.data.size.x * 0.5,
            this.boxCenter.y + collider.data.size.y * 0.5,
            this.boxCenter.z + collider.data.size.z * 0.5
          );

          if (this.getBoxPush(position, radius, this.boxMin, this.boxMax, this.collisionPush)) {
            target.add(this.collisionPush);
            collided = true;
          }
        }
      }

      return collided;
    },

    getBoxPush: function (position, radius, min, max, target) {
      target.set(0, 0, 0);

      this.closestPoint.set(
        THREE.MathUtils.clamp(position.x, min.x, max.x),
        THREE.MathUtils.clamp(position.y, min.y, max.y),
        THREE.MathUtils.clamp(position.z, min.z, max.z)
      );

      target.copy(position).sub(this.closestPoint);
      const distanceSq = target.lengthSq();

      if (distanceSq > EPSILON) {
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

      const pushes = [
        { axis: "x", value: -(position.x - min.x + radius), abs: position.x - min.x + radius },
        { axis: "x", value: max.x - position.x + radius, abs: max.x - position.x + radius },
        { axis: "y", value: -(position.y - min.y + radius), abs: position.y - min.y + radius },
        { axis: "y", value: max.y - position.y + radius, abs: max.y - position.y + radius },
        { axis: "z", value: -(position.z - min.z + radius), abs: position.z - min.z + radius },
        { axis: "z", value: max.z - position.z + radius, abs: max.z - position.z + radius }
      ];

      pushes.sort(function (a, b) {
        return a.abs - b.abs;
      });

      target[pushes[0].axis] = pushes[0].value;
      return true;
    },

    resolveBodyCollisions: function () {
      this.bodyCollisionPosition.copy(this.rigPosition).y += this.data.bodyOffsetY;

      if (this.bodyCollisionPosition.y < this.data.floorHeight) {
        const floorPush = this.data.floorHeight - this.bodyCollisionPosition.y;
        this.rigPosition.y += floorPush;
        this.bodyCollisionPosition.y += floorPush;
        this.velocity.y = 0;
      }

      for (let i = 0; i < 4; i += 1) {
        let collided = false;
        this.totalPush.set(0, 0, 0);

        for (const colliderEl of this.colliders) {
          const collider = colliderEl.components["locomotion-collider"];

          if (!collider || collider.data.type !== "box") {
            continue;
          }

          colliderEl.object3D.getWorldPosition(this.boxCenter);
          this.boxMin.set(
            this.boxCenter.x - collider.data.size.x * 0.5,
            this.boxCenter.y - collider.data.size.y * 0.5,
            this.boxCenter.z - collider.data.size.z * 0.5
          );
          this.boxMax.set(
            this.boxCenter.x + collider.data.size.x * 0.5,
            this.boxCenter.y + collider.data.size.y * 0.5,
            this.boxCenter.z + collider.data.size.z * 0.5
          );

          if (this.getBoxPush(this.bodyCollisionPosition, this.data.bodyRadius, this.boxMin, this.boxMax, this.collisionPush)) {
            this.totalPush.add(this.collisionPush);
            collided = true;
          }
        }

        if (!collided) {
          break;
        }

        this.rigPosition.add(this.totalPush);
        this.bodyCollisionPosition.add(this.totalPush);

        if (Math.abs(this.totalPush.y) > 0.01) {
          this.velocity.y = 0;
        }
      }
    },

    updateHandVisuals: function (leftWorldPosition, rightWorldPosition) {
      if (this.leftHandVisual) {
        this.tempLocalPosition.copy(leftWorldPosition);
        this.data.leftHand.object3D.worldToLocal(this.tempLocalPosition);
        this.leftHandVisual.object3D.position.copy(this.tempLocalPosition);
      }

      if (this.rightHandVisual) {
        this.tempLocalPosition.copy(rightWorldPosition);
        this.data.rightHand.object3D.worldToLocal(this.tempLocalPosition);
        this.rightHandVisual.object3D.position.copy(this.tempLocalPosition);
      }
    },

    storeVelocities: function (deltaTime) {
      this.velocityIndex = (this.velocityIndex + 1) % this.data.velocityHistorySize;

      const oldestVelocity = this.velocityHistory[this.velocityIndex];

      this.currentVelocity.copy(this.rigPosition)
        .sub(this.lastPosition)
        .divideScalar(deltaTime);

      this.denormalizedVelocityAverage.add(
        this.currentVelocity.clone()
          .sub(oldestVelocity)
          .divideScalar(this.data.velocityHistorySize)
      );

      oldestVelocity.copy(this.currentVelocity);
      this.lastPosition.copy(this.rigPosition);
    },

    updateDebugText: function (leftTouching, rightTouching) {
      if (!this.data.debugText) {
        return;
      }

      this.data.debugText.setAttribute("value", [
        "Left touching: " + leftTouching,
        "Right touching: " + rightTouching,
        "Velocity: " +
          this.velocity.x.toFixed(2) + ", " +
          this.velocity.y.toFixed(2) + ", " +
          this.velocity.z.toFixed(2)
      ].join("\n"));
    }
  });
}());
