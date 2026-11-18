import {
  BufferGeometry, CanvasTexture, Group, Mesh, MeshStandardMaterial, Object3D, RepeatWrapping, SRGBColorSpace, Texture,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { solve } from '../core/mission';
import { Place, Site } from '../core/site';
import { drawInk, wrap } from '../maps/ink';
import { drawInkCountry } from '../maps/inkCountry';
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
    format: 'dungeons-site', version: 2,
    ...site,
    solution: solution.moves.map((m) => ({ way: m.way, to: m.to, events: m.events })),
    // Numbers are written to a tenth of a millimetre, which drops the noise of binary fractions.
  }, (_key, value) => (typeof value === 'number' ? Math.round(value * 1e4) / 1e4 : value), 1);
}

export function exportJson(site: Site): void {
  download(new Blob([siteJson(site)], { type: 'application/json' }), `${site.seed}.json`);
}

/** The plan, fully revealed and numbered, above a key listing every place. */
export function planCanvas(site: Site, size = 1800): HTMLCanvasElement {
  const map = document.createElement('canvas');
  drawPlan(map, site, { pixels: size, labels: true, items: site.items, levers: site.levers, showSecrets: true, shut: new Set(site.ways.map((w, i) => (w.door && w.door.leaf !== 'open' ? i : -1))) });
  const rows = site.places.filter((p) => p.role !== 'approach');
  const line = size * 0.021;
  const columns = 2;
  const perColumn = Math.ceil(rows.length / columns);
  const out = document.createElement('canvas');
  out.width = size;
  // A second, smaller sheet below the key shows the house in its valley.
  const valley = site.grounds ? Math.round(size * 0.62) : 0;
  out.height = Math.round(size + line * (perColumn + 6.5)) + (valley ? valley + line * 3 : 0);
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
    ctx.fillText(placeLine(site, p), x, y, size / columns - line * 2);
  });
  if (valley) {
    const sheet = document.createElement('canvas');
    drawPlan(sheet, site, { pixels: valley, valley: true, showSecrets: true });
    const top = size + line * (perColumn + 6.5);
    ctx.font = `600 ${line * 0.95}px ui-serif, Georgia, serif`;
    ctx.fillText('The valley', line * 1.5, top);
    ctx.font = `${line * 0.82}px ui-serif, Georgia, serif`;
    wrap(ctx, 'The track from where you arrive to the door, the pond, and the standing stones. Rock shuts the valley in on three sides.', size - valley - line * 5)
      .forEach((text, k) => ctx.fillText(text, line * 1.5, top + line * (1.5 + k * 1.15)));
    ctx.drawImage(sheet, size - valley - line * 1.5, top);
  }
  return out;
}

/** One line of the key to a map: a place's number, its name and what is to be found there. */
export function placeLine(site: Site, p: Place): string {
  const notes: string[] = [];
  // A room on another storey says which room it is over or under: its number is not on the plan.
  if (p.level) {
    const stair = site.ways.find((w) => w.kind === 'stair' && (w.a === p.id || w.b === p.id));
    if (stair) notes.push(`${p.level > 0 ? 'over' : 'under'} ${(stair.a === p.id ? stair.b : stair.a) + 1}, by a stair`);
  }
  if (p.fallen) notes.push('the roof has fallen');
  else if (p.roof === 'sky') notes.push('open to the sky');
  else if (p.roof === 'cave') notes.push('natural cave');
  else notes.push(p.roof === 'timber' ? 'timber ceiling' : 'stone vault');
  if (p.shaft) notes.push('daylight from a hole in the roof');
  if (p.light === 'glow') notes.push('lit by growths that glow');
  if (p.light === 'dark') notes.push('unlit');
  for (const it of site.items) if (it.place === p.id) notes.push(`${it.key} key`);
  if (site.levers.some((l) => l.place === p.id)) notes.push('lever');
  if (p.id === site.secret) notes.push('behind a secret door, with a relic');
  if (p.id === site.goal) notes.push('the goal');
  return `${p.id + 1}. ${p.name[0].toUpperCase()}${p.name.slice(1)}: ${notes.join(', ')}`;
}

/** The ink map above a key to its rooms and its signs. */
export function inkCanvas(site: Site, size = 2000): HTMLCanvasElement {
  const rows = site.places.filter((p) => p.role !== 'approach');
  const u = size / 2000;
  const line = 38 * u, edge = 50 * u;
  const perColumn = Math.ceil(rows.length / 2);
  const signs = 'Signs: a door is a bar across its opening, in the colour of its key if it is locked; a heavy stroke beside it is the side it is barred from; a row of dots is a portcullis, raised by the lever marked with a red stroke; S is a secret door; slanting lines are an unlit room; the large star is the goal.';
  const out = document.createElement('canvas');
  const measure = out.getContext('2d')!;
  measure.font = `italic ${24 * u}px Georgia, 'Times New Roman', serif`;
  const signLines = wrap(measure, signs, size - 2 * edge);
  const top = drawInk(out, site, { pixels: size, labels: true, secrets: true, below: line * (perColumn + 1.2) + signLines.length * 32 * u + edge });
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#1d1a17';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `${27 * u}px Georgia, 'Times New Roman', serif`;
  rows.forEach((p, k) => {
    ctx.fillText(placeLine(site, p), edge + Math.floor(k / perColumn) * (size / 2), top + line * (k % perColumn), size / 2 - edge * 1.5);
  });
  ctx.font = `italic ${24 * u}px Georgia, 'Times New Roman', serif`;
  signLines.forEach((text, k) => ctx.fillText(text, edge, top + line * (perColumn + 0.6) + k * 32 * u));
  // A second sheet below: the whole place, the valley, the island or the mountain top, in the same hand.
  const country = document.createElement('canvas');
  if (!drawInkCountry(country, site, { pixels: size })) return out;
  const both = document.createElement('canvas');
  both.width = size;
  both.height = out.height + country.height;
  const b = both.getContext('2d')!;
  b.drawImage(out, 0, 0);
  b.drawImage(country, 0, out.height);
  return both;
}

export function exportInk(site: Site): void {
  inkCanvas(site).toBlob((blob) => blob && download(blob, `${site.seed}-map.png`), 'image/png');
}

export function exportPlan(site: Site): void {
  planCanvas(site).toBlob((blob) => blob && download(blob, `${site.seed}-plan.png`), 'image/png');
}

/** Turns a generated texture into something an exporter can save. */
function toCanvasTexture(set: TextureSet, which: 0 | 1 | 2): Texture {
  const w = set.size, h = set.size, pixels = set.pixels[which];
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
  /** Doors and gates in their current positions, with the way each hangs in and what its leaf is made of. */
  doors: { node: Object3D; way: number; material: string }[];
  /** The texture set behind each material name. */
  textures: Record<string, TextureSet>;
}

/**
 * Builds a plain copy of the world for export: the same geometry and vertex tints with ordinary
 * materials, without the tool's own shading. Baked light is not included.
 */
export function buildExportScene(source: ModelSource): Group {
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
      maps = [0, 1, 2].map((k) => toCanvasTexture(set, k as 0 | 1 | 2));
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
  // Ironwork, lock plates and bars: plain coloured metal, one mesh per colour on each door.
  const plainMetal = new Map<string, MeshStandardMaterial>();
  const metalFor = (m: MeshStandardMaterial): MeshStandardMaterial => {
    const key = `${m.color.getHexString()}/${m.roughness}/${m.metalness}`;
    let out = plainMetal.get(key);
    if (!out) {
      out = new MeshStandardMaterial({ name: `metal_${m.color.getHexString()}`, color: m.color, roughness: m.roughness, metalness: m.metalness });
      plainMetal.set(key, out);
    }
    return out;
  };
  for (const { node: door, way, material } of source.doors) {
    // The node sits on the hinge line at floor level: turning it about its upright axis swings
    // the door, and lifting it raises a gate.
    const node = new Group();
    node.name = `door_${way}`;
    node.position.copy(door.position);
    node.quaternion.copy(door.quaternion);
    const fittings = new Map<MeshStandardMaterial, BufferGeometry[]>();
    for (const child of door.children as Mesh[]) {
      if (!child.isMesh) continue;
      if (child.geometry.getAttribute('aField')) {
        const copy = plain(child);
        copy.name = `door_${way}_leaf`;
        copy.material = materialFor(material);
        node.add(copy);
        continue;
      }
      child.updateMatrix();
      const g = new BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) g.setAttribute(name, child.geometry.getAttribute(name).clone());
      g.setIndex(child.geometry.getIndex()!.clone());
      g.applyMatrix4(child.matrix);
      const m = metalFor(child.material as MeshStandardMaterial);
      if (!fittings.has(m)) fittings.set(m, []);
      fittings.get(m)!.push(g);
    }
    let k = 0;
    for (const [m, parts] of fittings) {
      const mesh = new Mesh(mergeGeometries(parts), m);
      mesh.name = `door_${way}_fittings_${k++}`;
      node.add(mesh);
    }
    root.add(node);
  }
  return root;
}

export async function modelGlb(source: ModelSource): Promise<ArrayBuffer> {
  const scene = buildExportScene(source);
  const exporter = new GLTFExporter();
  return (await exporter.parseAsync(scene, { binary: true })) as ArrayBuffer;
}

export async function exportModel(source: ModelSource, name: string): Promise<void> {
  const glb = await modelGlb(source);
  download(new Blob([glb], { type: 'model/gltf-binary' }), `${name}.glb`);
}
