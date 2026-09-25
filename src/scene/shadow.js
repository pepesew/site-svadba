import * as THREE from 'three';

let texture = null;

// Мягкая «контактная» тень: плоскость с радиальным градиентом (см. 01_design_system)
function getTexture() {
  if (texture) return texture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)'); // белая маска: цвет тени задает material.color
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  texture = new THREE.CanvasTexture(canvas);
  return texture;
}

export function createShadow({ width = 2, height = 0.45, opacity = 0.14, color = 0x000000 } = {}) {
  const material = new THREE.MeshBasicMaterial({
    color,
    map: getTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.scale.set(width, height, 1);
  mesh.renderOrder = -1;
  mesh.userData.baseOpacity = opacity;
  mesh.userData.baseWidth = width;
  mesh.userData.baseHeight = height;
  return mesh;
}
