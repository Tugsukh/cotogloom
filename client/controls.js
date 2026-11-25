// Local player: input -> velocity -> shared collision. The camera rotation is driven by PointerLockControls.
import * as THREE from 'three';
import { CONFIG, bodyHeight, eyeHeight } from '/shared/config.js';
import { MAP } from '/shared/map.js';
import { moveBody, canStand } from '/shared/collision.js';

const euler = new THREE.Euler(0, 0, 0, 'YXZ');

export class LocalPlayer {
  constructor(camera) {
    this.camera = camera;
    this.s = { x: 0, y: 0, z: 0, vy: 0, onGround: false };
    this.vx = 0; this.vz = 0;
    this.crouched = false;
    this.sprinting = false;
    this.stamina = CONFIG.STAMINA_MAX;
    this.exhausted = false;
    this.eye = CONFIG.EYE_STAND;
    this.speedMult = 1;
    this.moved = 0; // metres moved since last footstep
  }

  setPosition(pos, yaw) {
    this.s.x = pos[0]; this.s.y = pos[1]; this.s.z = pos[2];
    this.s.vy = 0; this.vx = 0; this.vz = 0;
    if (typeof yaw === 'number') {
      euler.set(0, yaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(euler);
    }
    this.syncCamera(1);
  }

  get yawPitch() {
    euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    return { yaw: euler.y, pitch: euler.x };
  }

  /** input: {f,b,l,r,sprint,crouch}; frozen: no horizontal input at all */
  update(dt, input, frozen) {
    const { yaw } = this.yawPitch;
    let ix = 0, iz = 0;
    if (!frozen) {
      if (input.f) iz -= 1;
      if (input.b) iz += 1;
      if (input.l) ix -= 1;
      if (input.r) ix += 1;
    }
    const len = Math.hypot(ix, iz);
    if (len > 0) { ix /= len; iz /= len; }

    // crouch (cannot stand up under something low)
    if (!frozen && input.crouch) this.crouched = true;
    else if (this.crouched && canStand(this.s.x, this.s.y, this.s.z, MAP.boxes)) this.crouched = false;

    // sprint + stamina
    const moving = len > 0;
    if (this.stamina <= 0) this.exhausted = true;
    if (this.exhausted && this.stamina >= CONFIG.STAMINA_MIN_TO_SPRINT) this.exhausted = false;
    this.sprinting = !frozen && input.sprint && moving && iz < 0.2 && !this.crouched && !this.exhausted && this.stamina > 0;
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - CONFIG.STAMINA_DRAIN * dt);
    else this.stamina = Math.min(CONFIG.STAMINA_MAX, this.stamina + CONFIG.STAMINA_REGEN * dt);

    const speed = (this.crouched ? CONFIG.CROUCH_SPEED : this.sprinting ? CONFIG.SPRINT_SPEED : CONFIG.WALK_SPEED) * this.speedMult;
    // rotate input by yaw (camera looks down -Z at yaw 0)
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const tx = (ix * cos + iz * sin) * speed;
    const tz = (-ix * sin + iz * cos) * speed;
    const a = CONFIG.ACCELERATION * dt;
    const dvx = tx - this.vx, dvz = tz - this.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl <= a) { this.vx = tx; this.vz = tz; } else { this.vx += dvx / dl * a; this.vz += dvz / dl * a; }

    const ox = this.s.x, oz = this.s.z;
    moveBody(this.s, this.vx * dt, this.vz * dt, dt, bodyHeight(this.crouched), MAP.boxes);
    // keep velocity consistent with what actually happened (sliding along walls)
    if (dt > 0) {
      const ax = (this.s.x - ox) / dt, az = (this.s.z - oz) / dt;
      if (Math.abs(ax) < Math.abs(this.vx) - 0.01) this.vx = ax;
      if (Math.abs(az) < Math.abs(this.vz) - 0.01) this.vz = az;
    }
    if (this.s.onGround) this.moved += Math.hypot(this.s.x - ox, this.s.z - oz);
    if (this.s.y < -20) { this.s.y = 1; this.s.vy = 0; } // safety
    this.syncCamera(dt);
  }

  syncCamera(dt) {
    const target = eyeHeight(this.crouched);
    this.eye += (target - this.eye) * Math.min(1, CONFIG.CROUCH_LERP * dt);
    this.camera.position.set(this.s.x, this.s.y + this.eye, this.s.z);
  }
}
