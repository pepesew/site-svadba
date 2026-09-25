import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createShadow } from './shadow.js';

// 03_3d_gifts_scene: матовая графитовая коробка с хромированной лентой
export function createGift({ reduced, finePointer }) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const matte = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.8,
    metalness: 0.1,
    transparent: true,
  });
  const chrome = new THREE.MeshStandardMaterial({
    color: 0xd8d8d8,
    roughness: 0.05,
    metalness: 1,
    transparent: true,
  });

  const S = 1.3;
  body.add(new THREE.Mesh(new RoundedBoxGeometry(S, S, S, 4, 0.08), matte));

  // Две перекрещенные ленты, опоясывающие коробку
  const R = S + 0.02;
  body.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, R, R), chrome));
  body.add(new THREE.Mesh(new THREE.BoxGeometry(R, R, 0.14), chrome));

  // Маленький бант из двух петель
  const loop = new THREE.TorusGeometry(0.15, 0.03, 12, 48);
  [-1, 1].forEach((side) => {
    const m = new THREE.Mesh(loop, chrome);
    m.position.set(side * 0.13, S / 2 + 0.13, 0);
    m.rotation.set(0, side * 0.6, side * -0.5);
    body.add(m);
  });

  const shadow = createShadow({ width: 2.2, height: 0.45, opacity: 0.16 });
  shadow.position.set(0, -1.35, -0.8);
  root.add(shadow);

  const BASE_X = 0.45;
  const BASE_Y = 0.6;
  body.rotation.set(BASE_X, BASE_Y, 0);

  const state = {
    appear: reduced ? 1 : 0,
    appeared: reduced,
    tiltX: 0,
    tiltY: 0,
    autoY: 0,
  };

  const materials = [matte, chrome];

  return {
    name: 'gift',
    object: root,
    nativeSize: 2.5,
    slot: () => document.querySelector('[data-scene-slot="gift"]'),
    state,

    update({ dt, pointer, slotRect, viewport, gsap }) {
      // Появление: упругое масштабирование, когда блок входит в экран
      if (!state.appeared && slotRect.top < viewport.h * 0.8) {
        state.appeared = true;
        if (gsap) gsap.to(state, { appear: 1, duration: 1.6, ease: 'elastic.out(1, 0.5)' });
        else state.appear = 1;
      }

      if (!reduced) {
        if (finePointer) {
          // Magnetic tilt: тяжелое, инерционное следование за курсором
          const k = 1 - Math.exp(-dt * 3);
          state.tiltY += (pointer.x * 0.4 - state.tiltY) * k;
          state.tiltX += (pointer.y * 0.35 - state.tiltX) * k;
        } else {
          state.autoY += dt * 0.35; // на тач-экранах — медленное вращение
        }
      }
      body.rotation.x = BASE_X + state.tiltX;
      body.rotation.y = BASE_Y + state.tiltY + state.autoY;

      // Дальше вниз: коробка проваливается вглубь и растворяется
      const center = slotRect.top + slotRect.height / 2;
      const sink = reduced ? 0 : THREE.MathUtils.clamp((viewport.h * 0.35 - center) / (viewport.h * 0.5), 0, 1);
      root.position.z = -sink * 3;

      const opacity = 1 - sink;
      materials.forEach((m) => { m.opacity = opacity; });
      body.visible = opacity > 0.01;

      root.scale.setScalar(Math.max(state.appear, 0.0001));
      shadow.material.opacity = shadow.userData.baseOpacity * opacity * Math.min(state.appear, 1);
    },
  };
}
