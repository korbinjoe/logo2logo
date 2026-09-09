import * as THREE from "three";

export interface HeroScene {
  setRunning: (running: boolean) => void;
  updatePalette: () => void;
  dispose: () => void;
}

// Wide, gently folding surfaces. Vertex displacement runs on the GPU; there
// are no per-frame geometry uploads, particles, external assets or post effects.
const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  uniform vec2 uPointer;
  uniform vec2 uView;
  uniform float uPresence;
  varying vec3 vPosition;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    float s = (uv.x - .5) * 2.;
    float w = (uv.y - .5) * 2.;
    float phase = uPhase + uTime * .13;
    vec3 p = vec3(
      s * 15.,
      sin(s * 2.8 + phase) * 2.1 + w * 1.35 + (uPhase - 1.) * 1.6,
      cos(s * 3.2 + phase) * 1.1 + sin(w * 2.1 + s * 4. + phase) * .72
    );
    p.y += sin(s * 5. - uTime * .09) * .23;
    vec2 delta = p.xy - uPointer * uView;
    float influence = exp(-dot(delta, delta) * .14) * uPresence;
    p.z += influence * 1.6;
    p.y += influence * uPointer.y * .65;
    p.xy += uPointer * vec2(.65, .32) * uPresence;
    vPosition = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
  }
`;

const glowFragment = /* glsl */ `
  uniform vec2 uPointer;
  uniform float uAspect;
  uniform float uPresence;
  uniform vec3 uWarm;
  uniform vec3 uCool;
  varying vec2 vUv;
  void main() {
    vec2 delta = (vUv * 2. - 1. - uPointer) * vec2(uAspect, 1.);
    float halo = exp(-dot(delta, delta) * 2.);
    vec3 color = mix(uWarm, uCool, smoothstep(-.6, .6, delta.x));
    gl_FragColor = vec4(color, halo * uPresence * .36);
    #include <colorspace_fragment>
  }
`;
const fragment = /* glsl */ `
  uniform vec3 uWarm;
  uniform vec3 uCool;
  uniform float uPhase;
  varying vec3 vPosition;
  varying vec2 vUv;
  void main() {
    vec3 normal = normalize(cross(dFdx(vPosition), dFdy(vPosition)));
    float light = .45 + .55 * abs(dot(normal, normalize(vec3(-.3, .8, 1.))));
    float rim = pow(1. - abs(normal.z), 2.3);
    float tint = .5 + .5 * sin(vUv.x * 5. + uPhase * 1.7 + normal.y);
    vec3 color = mix(uWarm, uCool, tint);
    color = mix(color * light, vec3(1.), rim * .6);
    float width = abs(vUv.y * 2. - 1.);
    float fade = (1. - smoothstep(.52, 1., width)) * smoothstep(0., .14, vUv.x) * (1. - smoothstep(.86, 1., vUv.x));
    float folds = .6 + .4 * pow(abs(normal.y), 2.);
    gl_FragColor = vec4(color, fade * folds * .68);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createHeroScene(
  host: HTMLElement,
  surface: HTMLElement,
): HeroScene {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  const fine = matchMedia("(pointer: fine)");
  renderer.setPixelRatio(Math.min(devicePixelRatio, fine.matches ? 1.25 : 1));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = "atmosphere-canvas";
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 70);
  camera.position.set(0, 0, 13);
  const geometry = new THREE.PlaneGeometry(1, 1, 150, 22);
  const materials = [0, 1.8, 3.7].map(
    (phase) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPhase: { value: phase },
          uPointer: { value: new THREE.Vector2() },
          uView: { value: new THREE.Vector2() },
          uPresence: { value: 0 },
          uWarm: { value: new THREE.Color() },
          uCool: { value: new THREE.Color() },
        },
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
  );
  materials.forEach((material, index) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -index * 1.4;
    // Shader positions exceed the placeholder plane's bounds.
    mesh.frustumCulled = false;
    mesh.renderOrder = 2 - index;
    scene.add(mesh);
  });
  const glowGeometry = new THREE.PlaneGeometry(2, 2);
  const glowMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uPointer: { value: new THREE.Vector2() },
      uPresence: { value: 0 },
      uAspect: { value: 1 },
      uWarm: { value: new THREE.Color() },
      uCool: { value: new THREE.Color() },
    },
    vertexShader:
      "varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}",
    fragmentShader: glowFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.frustumCulled = false;
  glow.renderOrder = -1;
  scene.add(glow);
  let running = false,
    disposed = false,
    lost = false,
    elapsed = 0,
    lastTime = 0,
    presence = 0,
    targetPresence = 0;
  const target = new THREE.Vector2(),
    pointer = new THREE.Vector2();
  function render(time = 0) {
    if (disposed || lost) return;
    if (running && lastTime && time - lastTime < (fine.matches ? 33 : 66))
      return;
    if (running && lastTime) elapsed += Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    if (running) {
      pointer.lerp(target, 0.12);
      presence += (targetPresence - presence) * 0.09;
    }
    materials.forEach((material) => {
      material.uniforms.uTime.value = elapsed;
      material.uniforms.uPointer.value.copy(pointer);
      material.uniforms.uPresence.value = presence;
    });
    glowMaterial.uniforms.uPointer.value.copy(pointer);
    glowMaterial.uniforms.uPresence.value = presence;
    renderer.render(scene, camera);
  }
  function resize() {
    if (disposed) return;
    // Exact viewport bleed, including themes whose hero is an asymmetric column.
    host.style.setProperty(
      "--atmosphere-left",
      `${-surface.getBoundingClientRect().left - (parseFloat(getComputedStyle(surface).borderLeftWidth) || 0)}px`,
    );
    host.style.setProperty(
      "--atmosphere-width",
      `${document.documentElement.clientWidth}px`,
    );
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = width < 760 ? 16 : 13;
    camera.updateProjectionMatrix();
    const halfHeight =
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    materials.forEach((material) =>
      material.uniforms.uView.value.set(halfHeight * camera.aspect, halfHeight),
    );
    glowMaterial.uniforms.uAspect.value = camera.aspect;
    lastTime = 0;
    render();
  }
  function updatePalette() {
    const css = getComputedStyle(host);
    for (const material of [...materials, glowMaterial]) {
      material.uniforms.uWarm.value.set(
        css.getPropertyValue("--atmosphere-warm").trim() || "#eca47f",
      );
      material.uniforms.uCool.value.set(
        css.getPropertyValue("--atmosphere-cool").trim() || "#879bd7",
      );
    }
    resize();
  }
  function move(event: PointerEvent) {
    if (!running || !fine.matches || event.pointerType !== "mouse") return;
    const bounds = surface.getBoundingClientRect();
    if (
      event.clientY < Math.max(bounds.top, 0) ||
      event.clientY > bounds.bottom
    ) {
      leave();
      return;
    }
    const rect = host.getBoundingClientRect();
    targetPresence = 1;
    target.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
  }
  const leave = () => {
    targetPresence = 0;
    target.set(0, 0);
  };
  const exitWindow = (event: PointerEvent) => {
    if (!event.relatedTarget) leave();
  };
  const contextLost = () => {
    lost = true;
    renderer.setAnimationLoop(null);
    host.dataset.rendered = "false";
    host.dataset.motion = "unavailable";
  };
  host.append(renderer.domElement);
  const observer = new ResizeObserver(resize);
  observer.observe(surface);
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerout", exitWindow);
  window.addEventListener("blur", leave);
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  updatePalette();
  host.dataset.rendered = "true";
  return {
    updatePalette,
    setRunning(value) {
      if (disposed || lost) return;
      running = value;
      lastTime = 0;
      host.dataset.motion = value ? "running" : "paused";
      renderer.setAnimationLoop(value ? render : null);
      if (!value) render();
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerout", exitWindow);
      window.removeEventListener("blur", leave);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      glowGeometry.dispose();
      glowMaterial.dispose();
      geometry.dispose();
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      delete host.dataset.rendered;
    },
  };
}
