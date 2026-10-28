// Real 3D avatar (Three.js, bundled — no runtime module restriction here).
// A stylized character built from primitives: blinking eyes, a mouth driven by
// live audio level (or a fallback oscillation for system voices), head nods,
// and per-role outfits/accessories. Throws when WebGL is unavailable so the
// caller can show the CSS fallback face instead.
import * as THREE from 'three';

const ROLES = {
  friend: { body: 0xf59e0b, accessory: null, hair: 0x4a3226 },
  cafe: { body: 0xb45309, accessory: 'apron', hair: 0x3d3d3d },
  gentle: { body: 0x7c9a6d, accessory: 'glasses', hair: 0xd9d9d9 },
  shop: { body: 0x3b82f6, accessory: null, hair: 0x1f2937 },
  hotel: { body: 0x334155, accessory: 'glasses', hair: 0x111827 },
  doctor: { body: 0xf8fafc, accessory: 'stethoscope', hair: 0x1f2937 },
};
const ROLE_BY_TOPIC = {
  'lam-quen': 'friend', 'goi-mon': 'cafe', 'chi-duong': 'gentle',
  'mua-sam': 'shop', 'khach-san': 'hotel', 'kham-benh': 'doctor',
};

export function initAvatar(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
  camera.position.set(0, 1.5, 3.6);
  camera.lookAt(0, 1.35, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const dir = new THREE.DirectionalLight(0xffffff, 1.1);
  dir.position.set(2, 4, 3);
  scene.add(dir);

  const skin = new THREE.MeshStandardMaterial({ color: 0xffcf9e, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.7 });

  const char = new THREE.Group();
  scene.add(char);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.95, 24), bodyMat);
  body.position.y = 0.55;
  char.add(body);

  const head = new THREE.Group();
  head.position.y = 1.55;
  char.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 24), skin);
  head.add(skull);
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x4a3226, roughness: 0.9 });
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.57, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
  hair.position.y = 0.08;
  hair.rotation.x = -0.35;
  head.add(hair);

  const eyes = [];
  const brows = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(0.21 * side, 0.08, 0.48);
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), white);
    w.scale.set(1, 1.25, 0.5);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), dark);
    p.position.z = 0.06;
    eye.add(w, p);
    head.add(eye);
    eyes.push(eye);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.02), dark);
    brow.position.set(0.21 * side, 0.28, 0.5);
    head.add(brow);
    brows.push({ mesh: brow, side });
  }

  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), mouthMat);
  mouth.scale.set(1.4, 0.45, 0.5);
  mouth.position.set(0, -0.24, 0.5);
  head.add(mouth);

  // Accessories (toggled per role)
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.7, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xfff7ed, roughness: 0.9 }),
  );
  apron.position.set(0, 0.55, 0.47);
  apron.visible = false;
  char.add(apron);

  const glasses = new THREE.Group();
  for (const side of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.015, 8, 24), dark);
    ring.position.set(0.21 * side, 0.08, 0.52);
    glasses.add(ring);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.02), dark);
  bridge.position.set(0, 0.1, 0.52);
  glasses.add(bridge);
  glasses.visible = false;
  head.add(glasses);

  const steth = new THREE.Group();
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 8, 24), dark);
  loop.position.set(0, 1.15, 0.1);
  loop.rotation.x = 0.4;
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.6, roughness: 0.3 }));
  chest.position.set(0.18, 0.72, 0.48);
  steth.add(loop, chest);
  steth.visible = false;
  char.add(steth);

  let talking = false;
  let listening = false;
  let levelFn = null;
  let expression = 'neutral';
  let nextBlink = 2.5;
  let blinkUntil = 0;
  let raf = 0;
  const clock = new THREE.Clock();

  function applyExpression() {
    const grumpy = expression === 'grumpy';
    brows.forEach(({ mesh, side }) => {
      mesh.rotation.z = grumpy ? -0.5 * side : expression === 'happy' ? 0.18 * side : 0;
    });
    mouth.scale.x = expression === 'happy' || expression === 'soft' ? 1.9 : expression === 'grumpy' ? 1.0 : 1.4;
  }

  // The canvas moves between the lobby and session stages, so size is read
  // from its current parent on every frame instead of a fixed container.
  let lastW = 0;
  let lastH = 0;
  function resize() {
    const parent = renderer.domElement.parentElement || container;
    const w = parent.clientWidth || 300;
    const h = parent.clientHeight || 280;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  function tick() {
    raf = requestAnimationFrame(tick);
    resize();
    const t = clock.getElapsedTime();
    // Blink
    if (t >= nextBlink) { blinkUntil = t + 0.12; nextBlink = t + 2.2 + Math.random() * 3; }
    const blinking = t < blinkUntil;
    eyes.forEach((e) => { e.scale.y = blinking ? 0.12 : 1; });
    // Mouth
    let open = 0.45;
    if (talking) {
      // levelFn returns -1 when no audio analyser exists (system voices):
      // fall back to a speech-like oscillation in that case.
      const lv = levelFn ? levelFn() : -1;
      if (lv >= 0) open = 0.35 + lv * 2.4;
      else open = 0.6 + Math.abs(Math.sin(t * 16)) * 1.1;
    }
    mouth.scale.y = THREE.MathUtils.lerp(mouth.scale.y, open, 0.5);
    // Head motion
    head.rotation.x = talking
      ? Math.sin(t * 2.2) * 0.05
      : listening ? Math.sin(t * 1.4) * 0.07 : Math.sin(t * 0.8) * 0.02;
    head.rotation.y = Math.sin(t * 0.5) * 0.05;
    char.position.y = Math.sin(t * 1.1) * 0.02;
    renderer.render(scene, camera);
  }
  tick();

  return {
    setRole(topicId) {
      const role = ROLES[ROLE_BY_TOPIC[topicId] || 'friend'];
      bodyMat.color.setHex(role.body);
      hairMat.color.setHex(role.hair);
      apron.visible = role.accessory === 'apron';
      glasses.visible = role.accessory === 'glasses';
      steth.visible = role.accessory === 'stethoscope';
    },
    setExpression(name) { expression = name; applyExpression(); },
    setTalking(on, fn = null) { talking = on; levelFn = fn; },
    setListening(on) { listening = on; },
    dispose() {
      cancelAnimationFrame(raf);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
