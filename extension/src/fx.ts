// Scriba's paper-scrap field: characters and words from the paused line drift up behind the
// full-screen overlay on hand-cut paper scraps, like notes floating out of Scriba's scroll.
// Built as its own module (dist/fx.js) and imported the first time the overlay opens, so
// three.js never weighs on normal YouTube browsing.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  LinearFilter,
  MathUtils,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Timer,
  WebGLRenderer,
} from "three";

export type Fx = {
  setGlyphs(glyphs: string[]): void;
  setSpeaking(on: boolean): void;
  start(): void;
  stop(): void;
  dispose(): void;
};

const INK = "#2b2420";
const SCRAPS = ["#fffdf8", "#ffe7c7", "#ffdcd2", "#fff3df"];
const INKS = [INK, "#d6533a", INK, "#c76a12"];
const FONT = `"Arial Rounded MT Bold", "PingFang SC", "Hiragino Maru Gothic ProN", "Apple SD Gothic Neo", system-ui, sans-serif`;
const DEFAULT_GLYPHS = ["字", "あ", "한", "ñ", "é", "文", "?", "ü", "語", "!", "ç", "ß"];
const FLAKES = 16; // minimal: a faint texture, not confetti
const DUST = 28;
const CAM_Z = 10;
const NEAR_Z = 2.5;
const FAR_Z = -9;

type Scrap = { tex: CanvasTexture; aspect: number };
type Flake = {
  sprite: Sprite;
  mat: SpriteMaterial;
  x: number;
  speed: number;
  sway: number;
  swayF: number;
  phase: number;
  rot: number;
  size: number;
  alpha: number;
  slot: number;
};

/** A hand-cut paper scrap with one character or word inked on it. */
function drawScrap(text: string, n: number): Scrap {
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const single = [...text].length === 1;
  const fs = single ? 84 : 62;
  g.font = `${fs}px ${FONT}`;
  const h = 168;
  const w = Math.max(h, Math.min(600, Math.ceil(g.measureText(text).width + 72)));
  c.width = w; // resizing resets the context, so the font is set again below
  c.height = h;
  const pad = 10;
  const r = 26;
  const j = () => (Math.random() - 0.5) * 7;
  g.beginPath();
  g.moveTo(pad + r, pad + j());
  g.lineTo(w - pad - r, pad + j());
  g.quadraticCurveTo(w - pad, pad, w - pad + j(), pad + r);
  g.lineTo(w - pad + j(), h - pad - r);
  g.quadraticCurveTo(w - pad, h - pad, w - pad - r, h - pad + j());
  g.lineTo(pad + r, h - pad + j());
  g.quadraticCurveTo(pad, h - pad, pad + j(), h - pad - r);
  g.lineTo(pad + j(), pad + r);
  g.quadraticCurveTo(pad, pad, pad + r, pad);
  g.closePath();
  g.fillStyle = SCRAPS[n % SCRAPS.length];
  g.fill();
  g.lineWidth = 6;
  g.lineJoin = "round";
  g.strokeStyle = INK;
  g.stroke();
  g.font = `${fs}px ${FONT}`;
  g.fillStyle = INKS[n % INKS.length];
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 4);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace; // canvas colors are sRGB
  tex.generateMipmaps = false; // UI sprites: no mip chain
  tex.minFilter = LinearFilter;
  return { tex, aspect: w / h };
}

function dotTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,.85)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  return tex;
}

export function createFx(canvas: HTMLCanvasElement): Fx {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  // A full-screen transparent layer shades every pixel: cap the pixel ratio to keep fill rate down.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.1, 60);
  camera.position.set(0, 0, CAM_Z);
  const timer = new Timer();
  timer.connect(document); // freezes the delta while the tab is hidden

  const tanHalf = Math.tan(MathUtils.degToRad(camera.fov / 2));
  const halfH = (z: number) => tanHalf * (CAM_Z - z);

  let scraps: Scrap[] = [];
  const flakes: Flake[] = [];

  const applyScrap = (f: Flake) => {
    const s = scraps[f.slot % scraps.length];
    const first = !f.mat.map;
    f.mat.map = s.tex;
    if (first) f.mat.needsUpdate = true; // adding a map changes the shader
    f.sprite.scale.set(f.size * s.aspect, f.size, 1);
  };

  const respawn = (f: Flake, anywhere: boolean) => {
    const z = MathUtils.randFloat(FAR_Z, NEAR_Z);
    const hh = halfH(z);
    const hw = hh * camera.aspect;
    f.x = MathUtils.randFloat(-hw, hw);
    f.speed = MathUtils.randFloat(0.25, 0.6);
    f.sway = MathUtils.randFloat(0.1, 0.45);
    f.swayF = MathUtils.randFloat(0.3, 0.8);
    f.phase = Math.random() * Math.PI * 2;
    f.rot = MathUtils.randFloat(-0.45, 0.45);
    f.size = MathUtils.randFloat(0.42, 0.7);
    f.alpha = MathUtils.mapLinear(z, FAR_Z, NEAR_Z, 0.18, 0.55); // farther scraps fade, like fog
    f.sprite.position.set(f.x, anywhere ? MathUtils.randFloat(-hh, hh) : -hh - 1.2, z);
    if (scraps.length) applyScrap(f);
  };

  // Dust: tiny warm dots, one draw call. Positions change every frame, so culling is off for it.
  const dustPos = new Float32Array(DUST * 3);
  const dustSpeed = new Float32Array(DUST);
  const seedDust = (i: number, anywhere: boolean) => {
    const z = MathUtils.randFloat(FAR_Z, NEAR_Z);
    const hh = halfH(z);
    dustPos[i * 3] = MathUtils.randFloat(-hh * camera.aspect, hh * camera.aspect);
    dustPos[i * 3 + 1] = anywhere ? MathUtils.randFloat(-hh, hh) : -hh - 0.3;
    dustPos[i * 3 + 2] = z;
    dustSpeed[i] = MathUtils.randFloat(0.15, 0.45);
  };
  const dustAttr = new BufferAttribute(dustPos, 3);
  const dustGeo = new BufferGeometry();
  dustGeo.setAttribute("position", dustAttr);
  const dustMat = new PointsMaterial({ map: dotTexture(), color: 0xffa33c, size: 0.14, transparent: true, opacity: 0.45, depthWrite: false });
  const dust = new Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  for (let i = 0; i < FLAKES; i++) {
    const mat = new SpriteMaterial({ transparent: true, depthWrite: false });
    const sprite = new Sprite(mat);
    scene.add(sprite);
    const f: Flake = { sprite, mat, x: 0, speed: 0, sway: 0, swayF: 0, phase: 0, rot: 0, size: 0, alpha: 0, slot: i };
    respawn(f, true);
    flakes.push(f);
  }
  for (let i = 0; i < DUST; i++) seedDust(i, true);

  const pointer = { x: 0, y: 0 };
  const onPointer = (e: PointerEvent) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  let speaking = false;
  let boost = 1;
  let t = 0;
  // No allocations in here: everything it touches was created above.
  const frame = () => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    t += dt;
    boost += ((speaking ? 2.1 : 1) - boost) * (1 - Math.exp(-dt * 3));
    for (const f of flakes) {
      const p = f.sprite.position;
      p.y += f.speed * boost * dt;
      p.x = f.x + Math.sin(t * f.swayF + f.phase) * f.sway;
      f.mat.rotation = f.rot + Math.sin(t * 0.7 + f.phase) * 0.25;
      // Fade out near the top and bottom edges so the header and footer text stay clean.
      f.mat.opacity = f.alpha * (1 - MathUtils.smoothstep(Math.abs(p.y) / halfH(p.z), 0.7, 0.97));
      if (p.y > halfH(p.z) + 1.2) respawn(f, false);
    }
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3 + 1] += dustSpeed[i] * boost * dt;
      if (dustPos[i * 3 + 1] > halfH(dustPos[i * 3 + 2]) + 0.3) seedDust(i, false);
    }
    dustAttr.needsUpdate = true;
    // Gentle parallax toward the pointer.
    const k = 1 - Math.exp(-dt * 2);
    camera.position.x += (pointer.x * 0.9 - camera.position.x) * k;
    camera.position.y += (pointer.y * 0.6 - camera.position.y) * k;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  };

  const fx: Fx = {
    setGlyphs(glyphs) {
      const old = scraps;
      scraps = (glyphs.length ? glyphs : DEFAULT_GLYPHS).map((g, n) => drawScrap(g, n));
      for (const f of flakes) applyScrap(f);
      for (const s of old) s.tex.dispose();
    },
    setSpeaking(on) {
      speaking = on;
    },
    start() {
      renderer.setAnimationLoop(frame);
    },
    stop() {
      renderer.setAnimationLoop(null);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      for (const s of scraps) s.tex.dispose();
      for (const f of flakes) f.mat.dispose();
      dustGeo.dispose();
      dustMat.map?.dispose();
      dustMat.dispose();
      timer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  fx.setGlyphs(DEFAULT_GLYPHS);
  return fx;
}
