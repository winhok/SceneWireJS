import {
  createThreeFrameAdapter,
  withSeededLibraryRandom,
} from '@scenewirejs/web-runtime';
import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Mesh,
  IcosahedronGeometry,
  TorusGeometry,
  MeshStandardMaterial,
  AmbientLight,
  DirectionalLight,
  Color,
  Group,
} from 'three';

export default {
  mount(root, init) {
    withSeededLibraryRandom(init.random, 'adoption-three', () => {
      const renderer = new WebGLRenderer({ antialias: true });
      renderer.setSize(init.width, init.height);
      root.append(renderer.domElement);
      const scene = new Scene();
      scene.background = new Color('#101b2a');
      const camera = new PerspectiveCamera(
        42,
        init.width / init.height,
        0.1,
        100,
      );
      camera.position.set(5, 3, 7);
      camera.lookAt(0, 0, 0);
      scene.add(new AmbientLight(0xffffff, 1.6));
      const key = new DirectionalLight(0xffffff, 4);
      key.position.set(3, 5, 5);
      scene.add(key);
      const fill = new DirectionalLight(0x59caba, 2);
      fill.position.set(-4, 1, 3);
      scene.add(fill);
      const geometry = new IcosahedronGeometry(1.15, 1);
      const ringGeometry = new TorusGeometry(1.9, 0.035, 12, 100);
      const material = new MeshStandardMaterial({
        color: 0x61d5bd,
        roughness: 0.35,
        metalness: 0.35,
        flatShading: true,
      });
      const ringMaterial = new MeshStandardMaterial({
        color: 0xf4b76c,
        roughness: 0.3,
        metalness: 0.5,
      });
      const object = new Mesh(geometry, material);
      const ring = new Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2.4;
      const group = new Group();
      group.add(object, ring);
      group.position.x = 0.75;
      scene.add(group);
      const label = document.createElement('div');
      label.style.cssText =
        'position:absolute;inset:0;padding:64px 76px;color:#edf5f0;font-family:Arial,sans-serif;pointer-events:none';
      label.innerHTML =
        '<p style="font-size:20px;margin:0 0 28px;color:#9cbdc6">SceneWire / Three.js visual study</p><h1 style="font-size:58px;line-height:1.05;letter-spacing:-1.5px;margin:0;max-width:420px">A frame.<br>A camera.<br>A world.</h1><p style="position:absolute;left:76px;bottom:86px;font-size:22px;color:#b6d5d5">Real geometry. Deterministic seeking.</p><span style="position:absolute;left:76px;bottom:58px;font:17px monospace"></span>';
      root.append(label);
      const counter = label.querySelector('span');
      init.registerAdapter(
        createThreeFrameAdapter({
          renderer,
          scene,
          camera,
          libraryRandom: init.random,
          update(context) {
            const t = context.timeSeconds;
            object.rotation.set(t * 0.22, t * 0.65, 0.15);
            ring.rotation.z = t * 0.32;
            group.position.y = Math.sin(t * 1.2) * 0.12;
            camera.position.set(5 + Math.sin(t * 0.45) * 0.8, 3, 7);
            camera.lookAt(0, 0, 0);
            counter.textContent = `frame ${String(context.frame).padStart(3, '0')} / 239 · 30 fps`;
          },
          dispose() {
            geometry.dispose();
            ringGeometry.dispose();
            material.dispose();
            ringMaterial.dispose();
            renderer.dispose();
            label.remove();
          },
        }),
      );
    });
  },
  seek() {},
};
