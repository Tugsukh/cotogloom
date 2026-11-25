// Builds the Three.js scene from shared/map.js: merged box meshes, lights, stations, code signs, exit door.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '/shared/config.js';
import { MAP } from '/shared/map.js';

function noiseTexture(base, variance = 18, size = 128, lines = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const col = new THREE.Color(base);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * variance;
    img.data[i * 4] = Math.max(0, Math.min(255, col.r * 255 + n));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, col.g * 255 + n));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, col.b * 255 + n));
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (lines) {
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
    g.strokeRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const MATS = {
  wall: { color: '#8c8f99', rough: 0.95, tex: true },
  floor: { color: '#5a4b3c', rough: 0.9, tex: true, lines: true },
  ceiling: { color: '#4a4a52', rough: 1 },
  wood: { color: '#7a5130', rough: 0.7, tex: true },
  shelf: { color: '#5d3f24', rough: 0.8, tex: true },
  crate: { color: '#8a6a3a', rough: 0.9, tex: true, lines: true },
  rack: { color: '#22252b', rough: 0.5, emissive: '#0a2a14' },
  rail: { color: '#6d717a', rough: 0.4, metal: 0.6 },
  pillar: { color: '#a3a3a8', rough: 0.9, tex: true },
  counter: { color: '#b9b4aa', rough: 0.6 },
  stair: { color: '#6a5a4a', rough: 0.85, tex: true },
  closet: { color: '#6e5a48', rough: 0.85, tex: true },
  metal: { color: '#7a8088', rough: 0.4, metal: 0.5 },
  bench: { color: '#4a3a2a', rough: 0.8 },
  fridge: { color: '#d8dade', rough: 0.4 },
  plant: { color: '#2e5a2e', rough: 1 },
};

/** Box geometry with world-scaled UVs so textures don't stretch. */
function boxGeometry(b) {
  const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const uv = geo.attributes.uv, nrm = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    const u = uv.getX(i), v = uv.getY(i);
    if (nx > 0.5) uv.setXY(i, u * sz / 2, v * sy / 2);
    else if (ny > 0.5) uv.setXY(i, u * sx / 2, v * sz / 2);
    else uv.setXY(i, u * sx / 2, v * sy / 2);
  }
  geo.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  return geo;
}

function textSprite(text, color = '#fff', scale = 1) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  const w = Math.min(250, g.measureText(text).width + 24);
  g.fillRect(128 - w / 2, 8, w, 48);
  g.fillStyle = color;
  g.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(1.2 * scale, 0.3 * scale, 1);
  return s;
}

export function makeTextSprite(text, color, scale) { return textSprite(text, color, scale); }

function codeSignTexture(code) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e2cf'; g.fillRect(0, 0, 256, 160);
  g.strokeStyle = '#3a2f22'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 152);
  g.fillStyle = '#3a2f22';
  g.font = 'bold 26px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText('LOCK CODE', 128, 42);
  g.font = 'bold 70px ui-monospace, monospace';
  g.fillText(code, 128, 122);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorld(scene) {
  scene.background = new THREE.Color('#050608');
  scene.fog = new THREE.Fog('#050608', 8, 34);

  // ---- static geometry, merged per material
  const groups = {};
  for (const b of MAP.boxes) {
    if (b.mat === 'station' || b.mat === 'exit') continue; // drawn separately
    (groups[b.mat] ??= []).push(boxGeometry(b));
  }
  const meshes = [];
  for (const [mat, geos] of Object.entries(groups)) {
    const def = MATS[mat] ?? MATS.wall;
    const m = new THREE.MeshStandardMaterial({
      color: def.tex ? '#ffffff' : def.color,
      map: def.tex ? noiseTexture(def.color, 22, 128, def.lines) : null,
      roughness: def.rough ?? 0.9, metalness: def.metal ?? 0,
      emissive: def.emissive ?? '#000000',
    });
    const mesh = new THREE.Mesh(mergeGeometries(geos), m);
    mesh.name = 'map-' + mat;
    scene.add(mesh);
    meshes.push(mesh);
  }

  // ---- lights
  scene.add(new THREE.AmbientLight('#8090b0', CONFIG.AMBIENT_INTENSITY));
  scene.add(new THREE.HemisphereLight('#6a7090', '#1a140e', 0.35));
  for (const L of MAP.lights) {
    const pl = new THREE.PointLight(L.color ?? '#ffe2b0', L.intensity ?? CONFIG.ROOM_LIGHT_INTENSITY, L.distance ?? CONFIG.ROOM_LIGHT_DISTANCE, 1.4);
    pl.position.set(...L.pos);
    scene.add(pl);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: L.color ?? '#ffe2b0' }));
    bulb.position.set(...L.pos);
    scene.add(bulb);
  }

  // ---- stations
  const stations = new Map();
  for (const st of MAP.stations) {
    const g = new THREE.Group();
    g.position.set(...st.pos);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.6),
      new THREE.MeshStandardMaterial({ color: '#2a2e38', roughness: 0.5, metalness: 0.4 }));
    base.position.y = 0.5;
    const screenMat = new THREE.MeshStandardMaterial({ color: '#0a2a2a', emissive: '#22ffd0', emissiveIntensity: 1.6 });
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), screenMat);
    screen.position.y = 1.03;
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#22ffd0', transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(1.6, 1.6, 1);
    glow.position.y = 1.15;
    const label = textSprite('TASK', '#9ffff0', 0.7);
    label.position.y = 1.55;
    g.add(base, screen, glow, label);
    scene.add(g);

    // Sign for the code-lock task (texture set per round)
    let sign = null;
    if (st.sign) {
      sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.56), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, emissive: '#ffffff', emissiveIntensity: 0.45 }));
      sign.position.set(...st.sign.pos);
      sign.rotation.y = st.sign.rotY ?? 0;
      sign.visible = false;
      scene.add(sign);
    }
    stations.set(st.id, { def: st, group: g, screenMat, glowMat, label, sign, done: false, type: null });
  }

  // ---- exit door
  const ex = MAP.exit;
  const exitMat = new THREE.MeshStandardMaterial({ color: '#5a1010', emissive: '#ff2020', emissiveIntensity: 0.5, roughness: 0.6 });
  const exitDoor = new THREE.Mesh(new THREE.BoxGeometry(0.12, ex.height, ex.width), exitMat);
  exitDoor.position.set(ex.pos[0] - 0.04, ex.height / 2, ex.pos[2]);
  if (Math.abs(ex.normal[2]) > 0.5) exitDoor.rotation.y = Math.PI / 2;
  scene.add(exitDoor);
  const exitLabel = textSprite('EXIT — LOCKED', '#ff8080', 1.1);
  exitLabel.position.set(ex.pos[0] + ex.normal[0] * 0.3, ex.height + 0.3, ex.pos[2] + ex.normal[2] * 0.3);
  scene.add(exitLabel);
  const exitLight = new THREE.PointLight('#ff3030', 3, 5, 1.5);
  exitLight.position.set(ex.pos[0] + ex.normal[0] * 0.8, 2.2, ex.pos[2] + ex.normal[2] * 0.8);
  scene.add(exitLight);

  let exitUnlocked = null;
  const api = {
    meshes,
    stations,
    setStationState(id, { type, done }) {
      const s = stations.get(id); if (!s) return;
      s.type = type ?? s.type; s.done = !!done;
      s.screenMat.emissive.set(done ? '#333333' : '#22ffd0');
      s.screenMat.emissiveIntensity = done ? 0.2 : 1.6;
      s.glowMat.opacity = done ? 0.0 : 0.8;
      s.label.material.opacity = done ? 0.25 : 1;
    },
    setSigns(roundStations) {
      for (const s of stations.values()) if (s.sign) s.sign.visible = false;
      for (const rs of roundStations ?? []) {
        const s = stations.get(rs.id);
        if (!s || !s.sign) continue;
        if (rs.type === 'codelock' && rs.code) {
          s.sign.material.map?.dispose();
          s.sign.material.map = codeSignTexture(rs.code);
          s.sign.material.emissiveMap = s.sign.material.map;
          s.sign.material.needsUpdate = true;
          s.sign.visible = true;
        }
      }
    },
    setExitUnlocked(v) {
      if (v === exitUnlocked) return;
      exitUnlocked = v;
      exitMat.color.set(v ? '#0f5a1a' : '#5a1010');
      exitMat.emissive.set(v ? '#20ff50' : '#ff2020');
      exitLight.color.set(v ? '#30ff60' : '#ff3030');
      exitLabel.material.map.dispose();
      const fresh = textSprite(v ? 'EXIT — OPEN' : 'EXIT — LOCKED', v ? '#90ffa8' : '#ff8080', 1.1);
      exitLabel.material.map = fresh.material.map;
      exitLabel.material.needsUpdate = true;
    },
    update(t) {
      for (const s of stations.values()) {
        if (!s.done) s.glowMat.opacity = 0.55 + 0.3 * Math.sin(t * 3 + s.def.pos[0]);
      }
    },
  };
  api.setExitUnlocked(false);
  return api;
}

let _glow;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}
