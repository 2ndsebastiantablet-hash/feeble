(function () {
  const HAND_PUSH_MULTIPLIER = 1.55; // Increase for faster movement, decrease for more control.
  const ONE_HAND_LAUNCH_MULTIPLIER = 1.4; // Increase for stronger one-hand hops and higher jumps, decrease for less flying.
  const TWO_HAND_LAUNCH_MULTIPLIER = 1.8; // Increase for stronger two-hand launches, decrease for more control.
  const UPWARD_BOUNCE_BOOST = 2.2; // Increase for higher jumps and more bounce, decrease for less flying.
  const MAX_LAUNCH_SPEED = 10.2; // Increase for faster/higher launches, decrease for less flying and more control.
  const VELOCITY_LIMIT = 1.15; // Lower for easier launches and less stiffness, raise for more control.
  const AIR_DRAG = 1.1; // Lower for longer air momentum and less stiffness, raise for more control.
  const GROUND_DRAG = 2.35; // Lower for slipperier movement and less stiffness, raise for more control.
  const GRAVITY = -13.2; // Lower magnitude for floatier higher jumps, raise magnitude for less flying.
  const MAX_FRAME_MOVE = 0.38; // Increase for faster hand pushes, decrease for more control and safety.

  const TEMP = {
    bodyCenter: new THREE.Vector3(),
    boxCenter: new THREE.Vector3(),
    boxMin: new THREE.Vector3(),
    boxMax: new THREE.Vector3(),
    closestPoint: new THREE.Vector3(),
    launchAverage: new THREE.Vector3(),
    handPush: new THREE.Vector3(),
    handResolved: new THREE.Vector3(),
    pushVelocity: new THREE.Vector3(),
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
      playerHeightOffset: { default: 0.62 },
      gravity: { default: GRAVITY },
      airDrag: { default: AIR_DRAG },
      groundDrag: { default: GROUND_DRAG },
      maxMovePerFrame: { default: MAX_FRAME_MOVE },
      handPushMultiplier: { default: HAND_PUSH_MULTIPLIER },
      maxVelocity: { default: MAX_LAUNCH_SPEED },
      oneHandLaunchMultiplier: { default: ONE_HAND_LAUNCH_MULTIPLIER },
      twoHandLaunchMultiplier: { default: TWO_HAND_LAUNCH_MULTIPLIER },
      floorLaunchUpwardFactor: { default: 0.42 },
      upwardBounceBoost: { default: UPWARD_BOUNCE_BOOST },
      maxLaunchSpeed: { default: MAX_LAUNCH_SPEED },
      velocityLimit: { default: VELOCITY_LIMIT },
      pushHistoryFrames: { default: 6 },
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
      this.launchVelocity = new THREE.Vector3();
      this.leftResolved = new THREE.Vector3();
      this.rightResolved = new THREE.Vector3();
      this.pushHistory = [];

      this.leftTouchingFloor = false;
      this.rightTouchingFloor = false;
      this.leftTouchingSurface = false;
      this.rightTouchingSurface = false;
      this.hasPreviousHands = false;
      this.grounded = true;
      this.wasTouchingSurface = false;
      this.wasTouchingFloor = false;
      this.wasTwoHandTouchingFloor = false;

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
      // Lower the XR reference space slightly so standing players can reach the
      // in-game floor comfortably without crouching to their real floor.
      this.rig.position.y = this.getGroundedRigY();
      this.velocity.set(0, 0, 0);
      this.launchVelocity.set(0, 0, 0);
      this.leftDelta.set(0, 0, 0);
      this.rightDelta.set(0, 0, 0);
      this.frameMovement.set(0, 0, 0);
      this.pushHistory = [];

      this.readHandWorldPositions();
      this.previousLeftWorld.copy(this.currentLeftWorld);
      this.previousRightWorld.copy(this.currentRightWorld);
      this.hasPreviousHands = true;

      this.leftTouchingFloor = false;
      this.rightTouchingFloor = false;
      this.leftTouchingSurface = false;
      this.rightTouchingSurface = false;
      this.wasTouchingSurface = false;
      this.wasTouchingFloor = false;
      this.wasTwoHandTouchingFloor = false;
      this.grounded = true;

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

      const touchingSurface = this.leftTouchingSurface || this.rightTouchingSurface;
      const touchingFloor = this.leftTouchingFloor || this.rightTouchingFloor;
      const twoHandsTouchingFloor = this.leftTouchingFloor && this.rightTouchingFloor;

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

      this.frameMovement.multiplyScalar(this.data.handPushMultiplier);

      if (this.frameMovement.lengthSq() > this.data.maxMovePerFrame * this.data.maxMovePerFrame) {
        this.frameMovement.setLength(this.data.maxMovePerFrame);
      }

      if (this.frameMovement.lengthSq() > 0) {
        this.rig.position.add(this.frameMovement);
        this.velocity.copy(this.frameMovement).divideScalar(deltaTime);
        this.recordPushVelocity(deltaTime);
      } else {
        if (this.wasTouchingSurface && !touchingSurface) {
          this.applyLaunchVelocity();
        } else if (!touchingSurface) {
          this.pushHistory = [];
          this.launchVelocity.set(0, 0, 0);
        }

        this.velocity.y += this.data.gravity * deltaTime;
        this.rig.position.addScaledVector(this.velocity, deltaTime);
      }

      this.applyRigFloorClamp();
      this.resolveBodyCollision();
      this.grounded = this.rig.position.y <= this.getGroundedRigY() + 0.01 && this.velocity.y <= 0.05;

      const activeDrag = this.grounded ? this.data.groundDrag : this.data.airDrag;
      const dragFactor = Math.max(0, 1 - activeDrag * deltaTime);
      this.velocity.multiplyScalar(dragFactor);

      if (this.velocity.lengthSq() > this.data.maxVelocity * this.data.maxVelocity) {
        this.velocity.setLength(this.data.maxVelocity);
      }

      // Re-read after moving the rig so next-frame deltas only represent the
      // player's real controller motion, not the rig translation we just applied.
      this.readHandWorldPositions();
      this.previousLeftWorld.copy(this.currentLeftWorld);
      this.previousRightWorld.copy(this.currentRightWorld);
      this.wasTouchingSurface = touchingSurface;
      this.wasTouchingFloor = touchingFloor;
      this.wasTwoHandTouchingFloor = twoHandsTouchingFloor;

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
      const groundedRigY = this.getGroundedRigY();

      if (this.rig.position.y < groundedRigY) {
        this.rig.position.y = groundedRigY;

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

    getGroundedRigY: function () {
      return this.data.floorHeight - this.data.playerHeightOffset;
    },

    recordPushVelocity: function (deltaTime) {
      TEMP.pushVelocity.copy(this.frameMovement).divideScalar(deltaTime);
      this.pushHistory.push(TEMP.pushVelocity.clone());

      if (this.pushHistory.length > this.data.pushHistoryFrames) {
        this.pushHistory.shift();
      }
    },

    getAveragePushVelocity: function () {
      TEMP.launchAverage.set(0, 0, 0);

      if (!this.pushHistory.length) {
        return TEMP.launchAverage;
      }

      for (const sample of this.pushHistory) {
        TEMP.launchAverage.add(sample);
      }

      TEMP.launchAverage.divideScalar(this.pushHistory.length);
      return TEMP.launchAverage;
    },

    applyLaunchVelocity: function () {
      const averagePush = this.getAveragePushVelocity();
      const averageSpeed = averagePush.length();
      const bothHandsWerePushing = this.wasTouchingFloor && this.wasTwoHandTouchingFloor;
      const launchMultiplier = bothHandsWerePushing
        ? this.data.twoHandLaunchMultiplier
        : this.data.oneHandLaunchMultiplier;

      this.launchVelocity.set(0, 0, 0);

      if (averageSpeed < this.data.velocityLimit) {
        this.pushHistory = [];
        return;
      }

      this.launchVelocity.copy(averagePush).multiplyScalar(launchMultiplier);

      if (this.wasTouchingFloor) {
        const planarSpeed = Math.hypot(averagePush.x, averagePush.z);
        const upwardFromPlanar = planarSpeed * this.data.floorLaunchUpwardFactor;
        const upwardFromDownPush = Math.max(0, averagePush.y) * this.data.upwardBounceBoost;
        this.launchVelocity.y = Math.max(
          this.launchVelocity.y,
          upwardFromPlanar,
          upwardFromDownPush
        );
      }

      if (this.launchVelocity.lengthSq() > this.data.maxLaunchSpeed * this.data.maxLaunchSpeed) {
        this.launchVelocity.setLength(this.data.maxLaunchSpeed);
      }

      this.velocity.copy(this.launchVelocity);
      this.pushHistory = [];
    },

    updateDebugText: function () {
      if (!this.data.debugText) {
        return;
      }

      this.data.debugText.setAttribute("value", [
        "Head y: " + this.currentHeadWorld.y.toFixed(2),
        "L hand y: " + this.currentLeftWorld.y.toFixed(2),
        "R hand y: " + this.currentRightWorld.y.toFixed(2),
        "L delta: " + this.formatVector(this.leftDelta),
        "R delta: " + this.formatVector(this.rightDelta),
        "L touching floor: " + this.leftTouchingFloor,
        "R touching floor: " + this.rightTouchingFloor,
        "Move applied: " + this.formatVector(this.frameMovement),
        "Launch velocity: " + this.formatVector(this.launchVelocity),
        "Grounded: " + this.grounded,
        "Rig y: " + this.rig.position.y.toFixed(2),
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
