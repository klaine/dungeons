import {
  BufferGeometry, CanvasTexture, Group, Mesh, MeshStandardMaterial, Object3D, RepeatWrapping, SRGBColorSpace, Texture, WebGLRenderer,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { solve } from '../core/mission';
import { Site } from '../core/site';
import { drawPlan } from '../maps/plan';
import { TextureSet } from '../render/textures';

/**
 * Taking a generated place out of the tool: the site document as JSON, the plan as an image with
 * a key to its rooms, and the built world as a glTF model.
 */

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** The site document, with the solver's route alongside it. */
export function siteJson(site: Site): string {
  const solution = solve(site);
  return JSON.stringify({
    format: 'dungeons-site', version: 1,
    ...site,
    solution: solution.moves.map((m) => ({ way: m.way, to: m.to, events: m.events })),
  }, null, 1);
}

export function exportJson(site: Site): void {
  download(new Blob([siteJson(site)], { type: 'application/json' }), `${site.seed}.json`);
}

/** The plan, fully revealed and numbered, above a key listing every place. */
export function planCanvas(site: Site, size = 1800): HTMLCanvasElement {
  const map = document.createElement('canvas');
  drawPlan(map, site, { pixels: size, labels: true, items: site.items, shut: new Set(site.ways.map((w, i) => (w.door?.leaf === 'shut' ? i : -1))) });
  const rows = site.places.filter((p) => p.role !== 'approach');
  const line = size * 0.021;
  const columns = 2;
  const perColumn = Math.ceil(rows.length / columns);
  const out = document.createElement('canvas');
  out.width = size;
  out.height = Math.round(size + line * (perColumn + 6.5));
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#e9dfc8';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(map, 0, line * 3);
  ctx.fillStyle = '#2b241c';
  ctx.textBaseline = 'top';
  ctx.font = `600 ${line * 1.15}px ui-serif, Georgia, serif`;
  ctx.fillText(site.seed, line * 1.5, line * 0.9);
  ctx.font = `${line * 0.82}px ui-serif, Georgia, serif`;
  ctx.fillText(site.title, line * 1.5, line * 2.3, size - line * 3);
  rows.forEach((p, k) => {
    const x = line * 1.5 + Math.floor(k / perColumn) * (size / columns);
    const y = size + line * (3.6 + (k % perColumn));
    const notes: string[] = [];
    if (p.roof === 'sky') notes.push('open to the sky');
    else if (p.roof === 'cave') notes.push('natural cave');
    else notes.push(p.roof === 'timber' ? 'timber ceiling' : 'stone vault');
    if (p.light === 'dark') notes.push('unlit');
    for (const it of site.items) if (it.place === p.id) notes.push(`${it.key} key`);
    if (p.id === site.goal) notes.push('the goal');
    ctx.fillText(`${p.id + 1}. ${p.name[0].toUpperCase()}${p.name.slice(1)}: ${notes.join(', ')}`, x, y, size / columns - line * 2);
  });
  return out;
}

export function exportPlan(site: Site): void {
  planCanvas(site).toBlob((blob) => blob && download(blob, `${site.seed}-plan.png`), 'image/png');
}

/** Reads a generated texture back from the graphics card into something an exporter can save. */
function toCanvasTexture(renderer: WebGLRenderer, set: TextureSet, which: 0 | 1 | 2): Texture {
  const rt = set.targets[which];
  const w = rt.width, h = rt.height;
  const pixels = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(w, h);
  // Rows come back bottom first; images are stored top first.
  for (let y = 0; y < h; y++) {
    const row = pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4);
    image.data.set(row, y * w * 4);
  }
  // Alpha carries height in the base colour map; saved images should be opaque.
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
  ctx.putImageData(image, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  if (which === 0) tex.colorSpace = SRGBColorSpace;
  return tex;
}

export interface ModelSource {
  /** Static meshes, named "place|material". */
  statics: Mesh[];
  /** Door leaves in their current positions. */
  doors: Object3D[];
  /** The texture set behind each material name. */
  textures: Record<string, TextureSet>;
}

/**
 * Builds a plain copy of the world for export: the same geometry and vertex tints with ordinary
 * materials, without the tool's own shading. Baked light is not included.
 */
export function buildExportScene(renderer: WebGLRenderer, source: ModelSource): Group {
  const root = new Group();
  root.name = 'site';
  const materials = new Map<string, MeshStandardMaterial>();
  const converted = new Map<TextureSet, Texture[]>();
  const materialFor = (name: string): MeshStandardMaterial => {
    let m = materials.get(name);
    if (m) return m;
    const set = source.textures[name] ?? source.textures.stone;
    let maps = converted.get(set);
    if (!maps) {
      maps = [0, 1, 2].map((k) => toCanvasTexture(renderer, set, k as 0 | 1 | 2));
      converted.set(set, maps);
    }
    m = new MeshStandardMaterial({ name, map: maps[0], normalMap: maps[1], aoMap: maps[2], roughnessMap: maps[2], metalnessMap: maps[2], roughness: 1, metalness: 1, vertexColors: true });
    materials.set(name, m);
    return m;
  };
  const plain = (mesh: Mesh): Mesh => {
    const g = new BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'color']) g.setAttribute(name, mesh.geometry.getAttribute(name));
    g.setIndex(mesh.geometry.getIndex());
    const material = mesh.name.split('|')[1] ?? 'wood';
    const out = new Mesh(g, materialFor(material));
    out.name = mesh.name.replace('|', '_');
    return out;
  };
  for (const mesh of source.statics) root.add(plain(mesh));
  source.doors.forEach((door, k) => {
    const node = new Group();
    node.name = `door_${k}`;
    node.position.copy(door.position);
    node.quaternion.copy(door.quaternion);
    const leaf = door.children.find((c) => (c as Mesh).isMesh && (c as Mesh).geometry.getAttribute('aField')) as Mesh | undefined;
    if (leaf) {
      const copy = plain(leaf);
      copy.name = `door_${k}_leaf`;
      copy.material = materialFor('wood');
      node.add(copy);
    }
    root.add(node);
  });
  return root;
}

export async function modelGlb(renderer: WebGLRenderer, source: ModelSource): Promise<ArrayBuffer> {
  const scene = buildExportScene(renderer, source);
  const exporter = new GLTFExporter();
  return (await exporter.parseAsync(scene, { binary: true })) as ArrayBuffer;
}

export async function exportModel(renderer: WebGLRenderer, source: ModelSource, name: string): Promise<void> {
  const glb = await modelGlb(renderer, source);
  download(new Blob([glb], { type: 'model/gltf-binary' }), `${name}.glb`);
}
