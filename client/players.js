// Remote players: snapshot buffering + interpolation (~100 ms behind), capsule avatars, name tags,
// and the seeker's flashlight (SpotLight + visible cone) that everyone can see.
import * as THREE from 'three';
import { CONFIG } from '/shared/config.js';
import { makeTextSprite } from './world.js';

const lerpAngle = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.avatars = new Map(); // id -> avatar
    this.info = new Map();    // id -> {name,color}

    // Seeker flashlight shown on everyone's screen (for the remote seeker).
    this.flash = new THREE.SpotLight('#fff4d6', 0, CONFIG.FLASHLIGHT_DISTANCE, CONFIG.FLASHLIGHT_ANGLE, 0.45, 1.2);
    this.flashTarget = new THREE.Object3D();
    this.flash.target = this.flashTarget;
    scene.add(this.flash, this.flashTarget);
    const coneLen = 7;
    const coneGeo = new THREE.ConeGeometry(Math.tan(CONFIG.FLASHLIGHT_ANGLE) * coneLen, coneLen, 24, 1, true);
    coneGeo.translate(0, -coneLen / 2, 0);  // apex at origin, opening towards -Y
    coneGeo.rotateX(-Math.PI / 2);          // opening towards -Z (forward)
    this.cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: '#fff1c4', transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    this.cone.visible = false;
    scene.add(this.cone);
  }

  setInfo(players) {
    for (const p of players) {
      const old = this.info.get(p.id);
      this.info.set(p.id, { name: p.name, color: p.color });
      const av = this.avatars.get(p.id);
      if (av && old && (old.name !== p.name || old.color !== p.color)) { this.remove(p.id); }
    }
  }

  remove(id) {
    const av = this.avatars.get(id);
    if (!av) return;
    this.scene.remove(av.group);
    this.avatars.delete(id);
  }

  makeAvatar(id) {
    const info = this.info.get(id) ?? { name: '?', color: '#cccccc' };
    const group = new THREE.Group();
    const body = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: info.color, roughness: 0.55, emissive: info.color, emissiveIntensity: 0.08 });
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(CONFIG.PLAYER_RADIUS, CONFIG.HEIGHT_STAND - CONFIG.PLAYER_RADIUS * 2, 6, 14), mat);
    capsule.position.y = CONFIG.HEIGHT_STAND / 2;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.13, 0.12), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.2, metalness: 0.6 }));
    visor.position.set(0, CONFIG.EYE_STAND, -0.26);
    body.add(capsule, visor);
    group.add(body);
    const tag = makeTextSprite(info.name, info.color, 1);
    tag.position.y = CONFIG.HEIGHT_STAND + 0.35;
    group.add(tag);
    this.scene.add(group);
    const av = { id, group, body, tag, buf: [], crouchScale: 1, cur: null, stepAcc: 0, lastPos: null };
    this.avatars.set(id, av);
    return av;
  }

  pushSnapshot(snap, now) {
    const seen = new Set();
    for (const p of snap.players) {
      seen.add(p.id);
      let av = this.avatars.get(p.id);
      if (!av) av = this.makeAvatar(p.id);
      av.buf.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, c: p.c, s: p.s, st: p.st });
      if (av.buf.length > 30) av.buf.shift();
    }
    for (const id of [...this.avatars.keys()]) if (!seen.has(id)) this.remove(id);
  }

  sample(av, renderT) {
    const b = av.buf;
    if (!b.length) return null;
    if (renderT <= b[0].t) return b[0];
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t <= renderT) {
        const a = b[i], n = b[i + 1];
        if (!n) return a;
        const t = (renderT - a.t) / Math.max(1, n.t - a.t);
        return {
          x: a.x + (n.x - a.x) * t, y: a.y + (n.y - a.y) * t, z: a.z + (n.z - a.z) * t,
          yaw: lerpAngle(a.yaw, n.yaw, t), pitch: a.pitch + (n.pitch - a.pitch) * t,
          c: t < 0.5 ? a.c : n.c, s: n.s, st: n.st,
        };
      }
    }
    return b[0];
  }

  /** ctx: { localId, localRole, phase, seekerId } — returns nothing; positions in av.cur */
  update(now, dt, ctx) {
    const renderT = now - CONFIG.INTERP_DELAY_MS;
    let seekerShown = false;
    for (const av of this.avatars.values()) {
      const s = this.sample(av, renderT);
      av.cur = s;
      if (!s) continue;
      const isLocal = av.id === ctx.localId;
      const inWorld = s.st === 'alive' || s.st === 'lobby';
      av.group.visible = !isLocal && inWorld && !(ctx.hideAll);
      if (ctx.spectateId === av.id) av.group.visible = false; // first-person spectating
      av.group.position.set(s.x, s.y, s.z);
      av.group.rotation.y = s.yaw;
      const targetScale = s.c ? CONFIG.HEIGHT_CROUCH / CONFIG.HEIGHT_STAND : 1;
      av.crouchScale += (targetScale - av.crouchScale) * Math.min(1, dt * 12);
      av.body.scale.y = av.crouchScale;
      av.tag.position.y = CONFIG.HEIGHT_STAND * av.crouchScale + 0.35;
      const isSeeker = av.id === ctx.seekerId && ctx.phase !== 'lobby';
      // The seeker can't see hiders' name tags.
      av.tag.visible = !(ctx.localRole === 'seeker' && ctx.phase !== 'lobby' && !isSeeker);

      // footstep bookkeeping for audio
      if (av.lastPos && inWorld) {
        const d = Math.hypot(s.x - av.lastPos[0], s.z - av.lastPos[2]);
        if (d < 2) av.stepAcc += d;
      }
      av.lastPos = [s.x, s.y, s.z];

      if (isSeeker && inWorld && (!isLocal || ctx.spectateId === av.id)) {
        seekerShown = true;
        const eyeY = s.y + (s.c ? CONFIG.EYE_CROUCH : CONFIG.EYE_STAND);
        const dir = new THREE.Vector3(-Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), -Math.cos(s.yaw) * Math.cos(s.pitch));
        const origin = new THREE.Vector3(s.x, eyeY - 0.15, s.z).addScaledVector(dir, 0.35);
        this.flash.position.copy(origin);
        this.flashTarget.position.copy(origin).add(dir);
        this.cone.position.copy(origin);
        this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
        this.cone.visible = ctx.spectateId !== av.id;
      }
    }
    this.flash.intensity = seekerShown ? CONFIG.FLASHLIGHT_INTENSITY : 0;
    if (!seekerShown) this.cone.visible = false;
  }

  get(id) { return this.avatars.get(id)?.cur ?? null; }
}
