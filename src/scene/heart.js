import * as THREE from 'three';
import { createShadow } from './shadow.js';

function heartGeometry() {
  // Классический контур сердца (кривые Безье), затем объем с мягкими фасками
  const s = new THREE.Shape();
  s.moveTo(5, 5);
  s.bezierCurveTo(5, 5, 4, 0, 0, 0);
  s.bezierCurveTo(-6, 0, -6, 7, -6, 7);
  s.bezierCurveTo(-6, 11, -3, 15.4, 5, 19);
  s.bezierCurveTo(12, 15.4, 16, 11, 16, 7);
  s.bezierCurveTo(16, 7, 16, 0, 10, 0);
  s.bezierCurveTo(7, 0, 5, 5, 5, 5);

  const g = new THREE.ExtrudeGeometry(s, {
    depth: 2.5,
    bevelEnabled: true,
    bevelThickness: 2,
    bevelSize: 1.6,
    bevelSegments: 8,
    curveSegments: 28,
  });
  g.center();
  g.rotateZ(Math.PI); // у исходного контура острие смотрит вверх
  g.scale(0.1, 0.1, 0.1);
  g.computeVertexNormals();
  return g;
}

// «Сердечный ритм»: двойной толчок 1.0 → 1.06 → 1.02 → 1.08 → 1.0 за 0.6 с
const BEAT = [[0, 1], [0.12, 1.06], [0.24, 1.02], [0.38, 1.08], [0.6, 1]];
function beat(phase) {
  for (let i = 1; i < BEAT.length; i++) {
    if (phase <= BEAT[i][0]) {
      const [t0, v0] = BEAT[i - 1];
      const [t1, v1] = BEAT[i];
      const k = (phase - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (k * k * (3 - 2 * k)); // smoothstep
    }
  }
  return 1;
}

function createBurst() {
  const N = 160;
  const positions = new Float32Array(N * 3);
  const velocity = new Float32Array(N * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0x111111,
    size: 0.05,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.visible = false;
  points.frustumCulled = false;

  let life = -1;
  const DURATION = 1.4;

  return {
    points,
    fire() {
      for (let i = 0; i < N; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(1.4 + Math.random() * 1.8);
        velocity.set([v.x, v.y, v.z * 0.5], i * 3);
      }
      life = 0;
      points.visible = true;
    },
    update(dt) {
      if (life < 0) return;
      life += dt;
      const t = Math.min(life / DURATION, 1);
      const travel = 1 - Math.exp(-4 * t); // быстро разлетаются и тормозят
      for (let i = 0; i < N * 3; i++) positions[i] = velocity[i] * travel;
      geometry.attributes.position.needsUpdate = true;
      material.opacity = 1 - t;
      if (t >= 1) { life = -1; points.visible = false; }
    },
  };
}

// 04_3d_rsvp_heart: темное «жидкое стекло», пульс и реакция на RSVP
export function createHeart({ reduced, lowTier }) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // transmission — дополнительный проход рендера; на слабых телефонах выключен
  const material = new THREE.MeshPhysicalMaterial(lowTier ? {
    color: 0x181818,
    roughness: 0.15,
    metalness: 0.9,
  } : {
    color: 0x181818,
    roughness: 0.15,
    metalness: 0.2,
    transmission: 0.3,
    thickness: 0.5,
    ior: 1.5,
  });
  const mesh = new THREE.Mesh(heartGeometry(), material);
  body.add(mesh);

  const shadow = createShadow({ width: 2, height: 0.4, opacity: 0.14 });
  shadow.position.set(0, -1.4, -0.6);
  root.add(shadow);

  const burst = createBurst();
  root.add(burst.points);

  const state = {
    amp: 1,        // сила пульса
    period: 1.5,   // секунды между ударами
    phase: 0,
    spin: 0,
    z: 0,
    toThanks: 0,   // 0 — у таймера, 1 — в блоке благодарности
  };

  const heartSlot = () => document.querySelector('[data-scene-slot="heart"]');
  const thanksSlot = () => document.querySelector('[data-scene-slot="thanks"]');

  return {
    name: 'heart',
    object: root,
    nativeSize: 2.6,
    slot: heartSlot,
    // Сердце может «перелететь» к благодарности после отправки формы
    altSlot: thanksSlot,
    blend: () => state.toThanks,
    state,

    onRsvp(status, gsap) {
      if (!gsap) return;
      gsap.to(state, { toThanks: 1, duration: 1.2, ease: 'power3.inOut' });

      if (status === 'decline') {
        // Пульс почти затихает, сердце отходит вглубь
        gsap.to(state, { amp: 0.2, period: 3, z: -2, duration: 1.6, ease: 'power2.out' });
      } else {
        gsap.to(state, { amp: 1, period: 1.5, z: 0, duration: 0.6 });
        gsap.to(state, { spin: state.spin + Math.PI * 2, duration: 1.2, ease: 'power3.out', delay: 0.5 });
        gsap.delayedCall(0.6, burst.fire);
      }
    },

    reset(gsap) {
      if (!gsap) return;
      gsap.to(state, { toThanks: 0, amp: 1, period: 1.5, z: 0, duration: 0.8, ease: 'power2.out' });
    },

    update({ dt, time }) {
      let pulse = 1;
      if (!reduced) {
        state.phase = (state.phase + dt) % state.period;
        pulse = 1 + (beat(state.phase) - 1) * state.amp;
        body.rotation.y = state.spin + Math.sin(time * 0.5) * 0.25;
      } else {
        body.rotation.y = state.spin;
      }

      body.scale.setScalar(pulse);
      root.position.z = state.z;

      // Тень пульсирует в такт
      const k = (pulse - 1) * 4;
      shadow.scale.x = shadow.userData.baseWidth * (1 + k * 0.3);
      shadow.material.opacity = shadow.userData.baseOpacity * (1 + k);

      burst.update(dt);
    },
  };
}
