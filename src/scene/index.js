/*
 * Общая 3D-сцена: один WebGLRenderer и один canvas на всю страницу.
 * Каждый объект привязан к «слоту» в верстке ([data-scene-slot]) и двигается
 * на 30% быстрее скролла (слой 2 в 05_scroll_and_layout).
 * Сборка: npm run build → js/scene.js
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createRings } from './rings.js';
import { createGift } from './gift.js';
import { createHeart } from './heart.js';

const root = document.documentElement;
const canvas = document.querySelector('[data-webgl]');

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(pointer: fine)').matches;
const lowTier = !finePointer && (
  (navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4
);

const PARALLAX = reduced ? 1 : 1.3; // 130% скорости скролла
const CAMERA_Z = 10;
const MIN_FPS = 24;

function fallback(reason) {
  console.warn('[3D] статичный фолбэк:', reason);
  root.classList.add('no-webgl');
}

function init() {
  if (!canvas) return;
  if (/[?&]webgl=off\b/.test(location.search)) { fallback('отключено параметром ?webgl=off'); return; }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    fallback(e.message || 'WebGL недоступен');
    return;
  }

  const gsap = window.gsap || null;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowTier ? 1.5 : 2));
  renderer.setClearColor(0xfffdf5, 1); // тот же цвет, что у фона страницы (айвори)
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  const key = new THREE.DirectionalLight(0xf2f5ff, 1.4); // сверху-слева, холодный
  key.position.set(-4, 6, 5);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); // снизу-справа, заполняющий
  fill.position.set(4, -4, 3);
  scene.add(key, fill);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.z = CAMERA_Z;

  const options = { reduced, finePointer, lowTier };
  const actors = [createRings(options), createGift(options), createHeart(options)];

  // Каждый объект вложен в «якорь», который ставится по слоту
  actors.forEach((actor) => {
    actor.anchor = new THREE.Group();
    actor.anchor.add(actor.object);
    scene.add(actor.anchor);
  });

  /* ---------------- Размер ---------------- */
  const viewport = { w: 0, h: 0, worldPerPx: 0 };

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight; // 100lvh — не меняется от адресной строки
    if (w === viewport.w && h === viewport.h) return;
    viewport.w = w;
    viewport.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    viewport.worldPerPx = (2 * CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / h;
    needsRender = true;
  }
  window.addEventListener('resize', resize);

  /* ---------------- Курсор ---------------- */
  const pointer = { x: 0, y: 0 };
  if (finePointer && !reduced) {
    window.addEventListener('pointermove', (e) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  /* ---------------- Привязка к слотам ---------------- */
  const EMPTY = { top: 0, height: 0, left: 0, width: 0 };

  function slotRect(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.height ? r : null; // скрытый слот (hidden) — нулевой размер
  }

  function place(actor) {
    let r = slotRect(actor.slot());
    const alt = actor.altSlot && slotRect(actor.altSlot());
    const t = alt ? actor.blend() : 0;
    if (!r && !alt) return { visible: false, rect: EMPTY };
    if (!r) r = alt;

    let cx = r.left + r.width / 2;
    let cy = r.top + r.height / 2;
    let size = r.height;
    if (alt && t > 0) {
      cx += (alt.left + alt.width / 2 - cx) * t;
      cy += (alt.top + alt.height / 2 - cy) * t;
      size += (alt.height - size) * t;
    }

    // Параллакс: объект точно в слоте, когда слот в центре экрана (или при
    // нулевом скролле для первого экрана), дальше — опережает скролл на 30%
    const scrollY = window.scrollY;
    const refScroll = Math.max(0, cy + scrollY - viewport.h / 2);
    const sy = cy - (scrollY - refScroll) * (PARALLAX - 1);
    const half = size * 0.8;
    const visible = sy + half > -40 && sy - half < viewport.h + 40;

    const wpp = viewport.worldPerPx;
    actor.anchor.position.x = (cx - viewport.w / 2) * wpp;
    actor.anchor.position.y = -(sy - viewport.h / 2) * wpp;
    actor.anchor.scale.setScalar((size * wpp) / actor.nativeSize);

    return { visible, rect: r };
  }

  /* ---------------- Цикл ---------------- */
  let last = performance.now();
  let time = 0;
  let needsRender = true;
  let running = true;
  let lastVisible = false;

  // Проверка FPS после прелоадера: если стабильно ниже 24 — статичный фолбэк
  let fpsProbe = null;

  function frame() {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    time += dt;

    resize();

    const hero = document.querySelector('.hero');
    const heroRect = hero ? hero.getBoundingClientRect() : EMPTY;
    const scrollProgress = THREE.MathUtils.clamp(-heroRect.top / (heroRect.height || 1), 0, 1);

    // Легкий параллакс камеры от курсора
    const k = 1 - Math.exp(-dt * 2.5);
    camera.position.x += (-pointer.x * 0.25 - camera.position.x) * k;
    camera.position.y += (pointer.y * 0.2 - camera.position.y) * k;

    let anyVisible = false;
    actors.forEach((actor) => {
      const { visible, rect } = place(actor);
      actor.anchor.visible = visible;
      if (!visible) return;
      anyVisible = true;
      actor.update({ dt, time, pointer, scrollProgress, slotRect: rect, viewport, gsap });
    });

    // Когда в кадре ничего нет — не рендерим (но один кадр дорисовываем, чтобы очистить)
    if (anyVisible || lastVisible || needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
      if (fpsProbe && anyVisible) fpsProbe.frames++;
    }
    lastVisible = anyVisible;

    if (fpsProbe && performance.now() - fpsProbe.start > 2500) {
      const fps = fpsProbe.frames / 2.5;
      fpsProbe = null;
      if (fps < MIN_FPS) stop(`низкий FPS (${fps.toFixed(1)})`);
    }
  }

  function stop(reason) {
    running = false;
    if (gsap) gsap.ticker.remove(frame);
    renderer.dispose();
    fallback(reason);
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stop('потерян WebGL-контекст');
  });

  // Синхронно с GSAP/Lenis, если они есть
  if (gsap) gsap.ticker.add(frame);
  else (function loop() { if (running) { frame(); requestAnimationFrame(loop); } })();

  /* ---------------- События страницы ---------------- */
  const [rings, , heart] = actors;
  const skipFpsCheck = /[?&]fps=off\b/.test(location.search);

  document.addEventListener('preloader:done', () => {
    rings.intro(gsap);
    if (!skipFpsCheck) setTimeout(() => { fpsProbe = { start: performance.now(), frames: 0 }; }, 1200);
  });

  document.addEventListener('rsvp:success', (e) => heart.onRsvp(e.detail.status, gsap));
  const edit = document.querySelector('[data-rsvp-edit]');
  if (edit) edit.addEventListener('click', () => heart.reset(gsap));

  // Прелоадер ждет компиляции шейдеров, чтобы не было рывка на первом кадре
  resize();
  const ready = (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve())
    .then(() => renderer.render(scene, camera))
    .catch((e) => stop(e.message));
  (window.WEDDING_PRELOAD = window.WEDDING_PRELOAD || []).push(ready);
}

init();
