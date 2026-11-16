import { DirectionalLight, Light, OrthographicCamera, Plane, Scene, Vector3, WebGLRenderer } from 'three';
import { Site } from '../core/site';

/**
 * The rendered map: the built world itself, seen from straight above with the roofs cut away, as
 * a battle map for tabletop play. Where the plan and the ink map are drawn from the site document,
 * this one is a photograph of the 3D scene, so it shows the real stones, furniture and light.
 *
 * It is taken twice. Indoors, everything above head height is cut off and the exposure is opened
 * up, with a weak even light from above so that unlit rooms can still be read. Outdoors nothing is
 * cut, so trees keep their crowns, and the exposure is closed down for daylight. The two are then
 * put together by place: courts and open ground come from the second, the rest from the first.
 */

export interface RenderedOptions {
  /** Size of a grid square in metres. The image's edges fall on grid lines. */
  square?: number;
  /** Pixels to a grid square. Reduced if the image would be larger than `maxPixels` on a side. */
  pixelsPerSquare?: number;
  maxPixels?: number;
  /** Rule the grid on the image. */
  grid?: boolean;
  /** Exposure for roofed places, and for places open to the sky. */
  indoorExposure: number;
  outdoorExposure: number;
  /** Lights that belong to the player or follow them, switched off while the map is taken. */
  mute: Light[];
  /** Show the hidden chamber. Left out by default, so the map can be put in front of players. */
  secrets?: boolean;
}

export interface RenderedMap {
  canvas: HTMLCanvasElement;
  /** The world position of the image's top left corner, and the scale, for laying things over it. */
  x0: number;
  z0: number;
  pixelsPerMetre: number;
}

/**
 * Takes the map. The renderer is resized while this runs and is left at the map's size: the
 * caller should set its own size again afterwards.
 */
export function renderMap(renderer: WebGLRenderer, scene: Scene, site: Site, opts: RenderedOptions): RenderedMap {
  const square = opts.square ?? 1.5;
  const T = site.wallThickness;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of site.places) {
    x0 = Math.min(x0, p.x0 - T - 0.4); x1 = Math.max(x1, p.x1 + T + 0.4);
    z0 = Math.min(z0, p.z0 - T - 0.4); z1 = Math.max(z1, p.z1 + T + 0.4);
  }
  x0 = Math.floor(x0 / square) * square; x1 = Math.ceil(x1 / square) * square;
  z0 = Math.floor(z0 / square) * square; z1 = Math.ceil(z1 / square) * square;
  const across = Math.round((x1 - x0) / square), down = Math.round((z1 - z0) / square);
  const per = Math.max(8, Math.min(opts.pixelsPerSquare ?? 72, Math.floor((opts.maxPixels ?? 4096) / Math.max(across, down))));
  const W = across * per, H = down * per;

  // Straight down, north up the page.
  const camera = new OrthographicCamera(-(x1 - x0) / 2, (x1 - x0) / 2, (z1 - z0) / 2, -(z1 - z0) / 2, 1, 400);
  camera.position.set((x0 + x1) / 2, 200, (z0 + z1) / 2);
  camera.up.set(0, 0, -1);
  camera.lookAt((x0 + x1) / 2, 0, (z0 + z1) / 2);
  camera.updateMatrixWorld();

  const house = site.places.filter((p) => p.role !== 'approach');
  const cut = Math.max(...house.map((p) => p.floor)) + 2.05;
  const fill = new DirectionalLight(0xfff4e6, 0.5);
  fill.position.set((x0 + x1) / 2, 300, (z0 + z1) / 2);
  fill.target.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);

  const was = { exposure: renderer.toneMappingExposure, planes: renderer.clippingPlanes, muted: opts.mute.map((l) => l.intensity) };
  opts.mute.forEach((l) => (l.intensity = 0));
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setRenderTarget(null);

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;
  const X = (x: number) => ((x - x0) / square) * per, Z = (z: number) => ((z - z0) / square) * per;

  try {
    // Indoors: cut open, exposure up, a little light from above.
    scene.add(fill, fill.target);
    renderer.clippingPlanes = [new Plane(new Vector3(0, -1, 0), cut)];
    renderer.toneMappingExposure = opts.indoorExposure;
    renderer.render(scene, camera);
    ctx.drawImage(renderer.domElement, 0, 0);

    // Outdoors: whole, in daylight, and only where a place is open to the sky. The light from
    // above is turned up to stand in for the sky, or shadows on the ground would come out black.
    fill.intensity = 2.6;
    renderer.clippingPlanes = [];
    renderer.toneMappingExposure = opts.outdoorExposure;
    renderer.render(scene, camera);
    ctx.save();
    ctx.beginPath();
    for (const p of site.places) {
      if (p.roof !== 'sky') continue;
      ctx.rect(X(p.x0), Z(p.z0), X(p.x1) - X(p.x0), Z(p.z1) - Z(p.z0));
    }
    ctx.clip();
    ctx.drawImage(renderer.domElement, 0, 0);
    ctx.restore();
  } finally {
    scene.remove(fill, fill.target);
    renderer.clippingPlanes = was.planes;
    renderer.toneMappingExposure = was.exposure;
    opts.mute.forEach((l, k) => (l.intensity = was.muted[k]));
  }

  // A hidden chamber is blacked out with its doorway, as solid wall.
  if (site.secret >= 0 && !opts.secrets) {
    const p = site.places[site.secret], g = T - 0.03;
    ctx.fillStyle = '#000';
    ctx.fillRect(X(p.x0 - g), Z(p.z0 - g), X(p.x1 + g) - X(p.x0 - g), Z(p.z1 + g) - Z(p.z0 - g));
  }

  if (opts.grid ?? true) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.26)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < across; k++) { ctx.moveTo(k * per + 0.5, 0); ctx.lineTo(k * per + 0.5, H); }
    for (let k = 1; k < down; k++) { ctx.moveTo(0, k * per + 0.5); ctx.lineTo(W, k * per + 0.5); }
    ctx.stroke();
  }
  return { canvas: out, x0, z0, pixelsPerMetre: per / square };
}
