import * as THREE from 'three';
import { createShadow } from './shadow.js';

// 02_3d_hero_rings: два переплетенных кольца из светлого хрома
export function createRings({ reduced }) {
  const root = new THREE.Group();
  const tilt = new THREE.Group(); // наклон от скролла
  const spin = new THREE.Group(); // медленное вращение в покое
  const pair = new THREE.Group(); // сами кольца
  root.add(tilt);
  tilt.add(spin);
  spin.add(pair);

  const material = new THREE.MeshPhysicalMaterial({
    color: 0xe8e8e8,
    metalness: 1,
    roughness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });

  // ~3.8k треугольников на кольцо — с запасом в бюджете 15–20k (docs_tech_01)
  const big = new THREE.Mesh(new THREE.TorusGeometry(1, 0.11, 20, 96), material);
  const small = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.1, 20, 96), material);

  // Кольца проходят друг через друга, но не касаются: центр каждого
  // лежит внутри отверстия другого, на расстоянии от трубок
  big.position.x = -0.45;
  small.position.x = 0.45;
  small.rotation.x = Math.PI / 2;
  pair.add(big, small);
  // Наклон на 45° по X: оба кольца видны одинаковыми эллипсами, пара симметрична
  pair.rotation.set(Math.PI / 4, 0, 0.12);

  const shadow = createShadow({ width: 2.6, height: 0.5, opacity: 0.12 });
  shadow.position.set(0, -1.55, -0.5);
  root.add(shadow);

  const state = { intro: reduced ? 1 : 0, spinY: 0 };

  return {
    name: 'rings',
    object: root,
    nativeSize: 2.4,
    slot: () => document.querySelector('[data-scene-slot="rings"]'),
    state,

    // Появление после прелоадера
    intro(gsap) {
      if (reduced || !gsap) { state.intro = 1; return; }
      gsap.to(state, { intro: 1, duration: 2, ease: 'power3.out' });
    },

    update({ dt, time, scrollProgress }) {
      const p = scrollProgress; // 0 — первый экран целиком, 1 — ушел за верх

      if (!reduced) {
        state.spinY += 0.06 * dt; // рад/с, не зависит от частоты кадров
        spin.position.y = Math.sin(time * 0.8) * 0.06;
      }

      spin.rotation.y = state.spinY - (1 - state.intro) * 1.4;
      root.scale.setScalar(0.6 + 0.4 * state.intro);

      // Скролл: кольца «раскрываются» — меняют угол наклона по Z и Y
      tilt.rotation.z = p * 0.6;
      tilt.rotation.y = p * 0.9;

      // Тень растягивается и бледнеет по мере отдаления
      const lift = spin.position.y;
      shadow.scale.x = shadow.userData.baseWidth * (1 + p * 0.6 - lift);
      shadow.material.opacity = shadow.userData.baseOpacity * (1 - p) * state.intro;
    },
  };
}
