/**
 * A minimal example of using an exported site outside the tool that made it.
 *
 * It reads the two files the tool exports for a place, the model (.glb) and the site document
 * (.json), and uses them together: the model is what is drawn, and the document says what the
 * model is: where the rooms are, what they are called, how they join, and the route through them.
 * Nothing here is imported from the generator. The format is described in docs/05-site-format.md.
 */
import {
  AmbientLight, BufferGeometry, CanvasTexture, Color, DirectionalLight, Group, HemisphereLight, Line, LineBasicMaterial,
  PerspectiveCamera, Plane, Scene, Sprite, SpriteMaterial, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The parts of the site document this example reads. The document holds more.
interface Place { id: number; name: string; role: string; x0: number; x1: number; z0: number; z1: number; floor: number; wall: number }
interface SiteDocument {
  format: string; version: number; seed: string; title: string; top: number; start: number;
  sun: [number, number, number];
  places: Place[];
  solution: { way: number; to: number; events: string[] }[];
}

const $ = (id: string) => document.getElementById(id)!;
const renderer = new WebGLRenderer({ canvas: $('view') as HTMLCanvasElement, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new Scene();
scene.background = new Color(0x14110e);
const camera = new PerspectiveCamera(50, 1, 0.5, 600);
camera.position.set(0, 40, 40);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new HemisphereLight(0xcfe0ff, 0x6b5a45, 1.6), new AmbientLight(0xffffff, 0.5));
const sun = new DirectionalLight(0xfff1dc, 2.6);
scene.add(sun);

// Everything above this plane is not drawn, which opens the building like a doll's house.
const cut = new Plane(new Vector3(0, -1, 0), 100);
renderer.clippingPlanes = [cut];

let model: Group | null = null;
let site: SiteDocument | null = null;
const marks = new Group();          // labels and the route: made from the document, not the model
const route = new Group();
scene.add(marks, route);

const centre = (p: Place) => new Vector3((p.x0 + p.x1) / 2, p.floor, (p.z0 + p.z1) / 2);

function label(text: string): Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 44px system-ui, sans-serif';
  canvas.width = Math.ceil(ctx.measureText(text).width) + 36;
  canvas.height = 64;
  ctx.font = '600 44px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(20,17,14,0.78)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f3e7cf';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 18, 34);
  const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false, clippingPlanes: [] }));
  sprite.scale.set((canvas.width / canvas.height) * 0.75, 0.75, 1);
  sprite.renderOrder = 2;
  return sprite;
}

function setCut(): void {
  if (!site) return;
  const low = Math.min(...site.places.map((p) => p.floor)) + 0.6;
  const height = low + (site.top + 1.5 - low) * Number(($('cut') as HTMLInputElement).value);
  cut.constant = height;
  $('cutAt').textContent = `${height.toFixed(1)} m`;
}

/** Called whenever a file arrives. Model and document can come in either order. */
function build(): void {
  $('status').textContent = model && site ? '' : model ? 'Model loaded. Now the site data (.json).' : site ? 'Site data loaded. Now the model (.glb).' : '';
  if (!site) return;
  $('name').textContent = site.seed;
  $('title').textContent = site.title;

  // The document's axes are the model's: +x east, +y up, +z south, in metres.
  const house = site.places.filter((p) => p.role !== 'approach');
  const mid = house.reduce((sum, p) => sum.add(centre(p)), new Vector3()).multiplyScalar(1 / house.length);
  const span = Math.max(...house.map((p) => p.x1)) - Math.min(...house.map((p) => p.x0));
  controls.target.copy(mid);
  camera.position.set(mid.x, mid.y + span * 0.9, mid.z + span * 0.75);
  sun.position.set(...site.sun).multiplyScalar(100).add(mid);
  sun.target.position.copy(mid);
  scene.add(sun.target);
  setCut();

  // A label over every place, and a list of them that moves the camera.
  marks.clear();
  $('places').replaceChildren();
  for (const p of house) {
    const name = `${p.id + 1} ${p.name}`;
    const sprite = label(name);
    sprite.position.copy(centre(p)).setY(p.floor + 1.4);
    marks.add(sprite);
    const item = document.createElement('li');
    item.textContent = p.name;
    item.value = p.id + 1;
    item.addEventListener('click', () => {
      const to = centre(p);
      camera.position.add(to.clone().sub(controls.target));
      controls.target.copy(to);
    });
    $('places').append(item);
  }

  // The route the solver found, from the start through each place it enters.
  route.clear();
  const points = [centre(site.places[site.start]), ...site.solution.map((m) => centre(site!.places[m.to]))].map((v) => v.setY(v.y + 1.0));
  const line = new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: 0xff6a3c, depthTest: false, clippingPlanes: [] }));
  line.renderOrder = 1;
  route.add(line);

  // The model's meshes are named for the place they belong to ("p3_stone" is place 3), so the
  // document can be used to pick parts of it out. Doors are nodes named for their way ("door_12").
  if (model) {
    let meshes = 0, doors = 0;
    model.traverse((o) => {
      if (/^p\d+_/.test(o.name)) meshes++;
      if (/^door_\d+$/.test(o.name)) doors++;
    });
    $('status').textContent = `${house.length} places, ${meshes} meshes, ${doors} doors and gates.`;
  }
}

async function take(file: File): Promise<void> {
  try {
    if (file.name.endsWith('.json')) {
      const doc = JSON.parse(await file.text()) as SiteDocument;
      if (doc.format !== 'dungeons-site') throw new Error('this is not a site document');
      if (doc.version !== 1) throw new Error(`this example reads version 1 of the format, and the file is version ${doc.version}`);
      site = doc;
    } else {
      const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
      if (model) scene.remove(model);
      model = gltf.scene;
      scene.add(model);
    }
    build();
  } catch (err) {
    $('status').textContent = `${file.name} could not be read: ${(err as Error).message}`;
  }
}

$('files').addEventListener('change', (e) => { for (const f of (e.target as HTMLInputElement).files ?? []) void take(f); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); for (const f of e.dataTransfer?.files ?? []) void take(f); });
$('cut').addEventListener('input', setCut);
$('route').addEventListener('change', (e) => (route.visible = (e.target as HTMLInputElement).checked));

function frame(): void {
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  if (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
(window as unknown as { __viewer: unknown }).__viewer = { scene, camera, state: () => ({ model: !!model, site: !!site, labels: marks.children.length, status: $('status').textContent }) };
