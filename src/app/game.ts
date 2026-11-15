import {
  BoxGeometry, BufferAttribute, Color, CylinderGeometry, Group, Material, Mesh, Scene, TorusGeometry, Vector3,
} from 'three';
import { makePropMaterial } from '../render/siteMaterial';
import { DoorSpec, Item, KeyId, Site } from '../core/site';
import { placeAt } from '../maps/plan';
import { DoorDesc, SceneDescription } from '../render/scene';
import { Player } from './player';

/**
 * What can change while a site is being explored: doors that open, keys that are picked up, and
 * whether the goal has been reached. Everything is done by walking: coming up to a door tries it,
 * and walking up to a key takes it.
 */

export interface GameUi {
  toast(message: string): void;
  keysChanged(keys: KeyId[]): void;
  won(seconds: number): void;
}

const METAL: Record<KeyId, Color> = { iron: new Color(0.42, 0.44, 0.48), gold: new Color(1.0, 0.76, 0.28) };

interface Door {
  desc: DoorDesc;
  spec: DoorSpec;
  group: Group;
  leaf: Mesh;
  bar: Mesh | null;
  open: boolean;
  angle: number;
  blocker: { min: Vector3; max: Vector3; active: boolean };
  /** Unit vector along the leaf's z when shut, in the world. */
  facing: Vector3;
  quietUntil: number;
}

interface KeyThing {
  item: Item;
  group: Group;
  at: Vector3;
  taken: boolean;
}

export class Game {
  readonly keys = new Set<KeyId>();
  readonly visited = new Set<number>();
  readonly doors: Door[] = [];
  readonly things: KeyThing[] = [];
  won = false;
  private elapsed = 0;
  private goalAt: Vector3 | null;

  constructor(private site: Site, desc: SceneDescription, scene: Scene, wood: Material, private player: Player, private ui: GameUi) {
    const iron = makePropMaterial({ color: new Color(0.07, 0.065, 0.06), roughness: 0.74, metalness: 0.5 });
    const timber = makePropMaterial({ color: new Color(0.2, 0.13, 0.08), roughness: 0.85, metalness: 0 });

    for (const d of desc.doors ?? []) {
      const spec = site.ways[d.way].door!;
      const group = new Group();
      group.position.copy(d.hinge);
      const leaf = new Mesh(d.leaf.build(), wood);
      leaf.receiveShadow = true;
      group.add(leaf);

      const W = d.halfWidth * 2;
      const t = d.thickness;
      // Iron straps and a ring pull on both faces.
      for (const y of [0.42, 1.5]) {
        const strap = new Mesh(new BoxGeometry(W - 0.12, 0.075, t + 0.024), iron);
        strap.position.set(W / 2 - 0.03, y, 0);
        group.add(strap);
      }
      for (const side of [1, -1]) {
        const ring = new Mesh(new TorusGeometry(0.055, 0.011, 6, 14), iron);
        ring.position.set(W - 0.16, 1.02, side * (t / 2 + 0.014));
        group.add(ring);
      }
      // The lock plate takes the colour of its key, so a locked door says what it wants.
      if (spec.lock) {
        const plate = new Mesh(new BoxGeometry(0.13, 0.19, t + 0.04), makePropMaterial({
          color: METAL[spec.lock], metalness: 0.8, roughness: 0.5, emissive: METAL[spec.lock], emissiveIntensity: 0.1,
        }));
        plate.position.set(W - 0.16, 1.22, 0);
        group.add(plate);
      }
      let bar: Mesh | null = null;
      if (d.barSide !== 0) {
        bar = new Mesh(new BoxGeometry(W + 0.5, 0.13, 0.09), timber);
        bar.position.set(W / 2, 1.0, d.barSide * (t / 2 + 0.06));
        group.add(bar);
      }

      const open = spec.leaf === 'open';
      const angle = open ? 1 : 0;
      group.rotation.y = d.yaw + d.swing * angle;
      scene.add(group);
      const blocker = { min: d.blocker.min, max: d.blocker.max, active: !open };
      player.blockers.push(blocker);
      this.doors.push({
        desc: d, spec, group, leaf, bar, open, angle, blocker, quietUntil: 0,
        facing: new Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw)),
      });
    }

    for (const item of site.items) {
      const anchor = desc.anchors?.get(item.place);
      if (!anchor) continue;
      const group = makeKey(METAL[item.key]);
      const at = anchor.clone().add(new Vector3(0, 0.3, 0));
      group.position.copy(at);
      scene.add(group);
      this.things.push({ item, group, at, taken: false });
    }
    this.goalAt = desc.anchors?.get(site.goal) ?? null;
    this.visited.add(site.start);
  }

  update(dt: number, time: number): void {
    const p = this.player.position;
    this.elapsed += dt;
    const here = placeAt(this.site, p.x, p.z);
    if (here) this.visited.add(here.id);

    for (const d of this.doors) {
      if (!d.open) {
        const c = d.desc.centre;
        const near = Math.hypot(p.x - c.x, p.z - c.z) < 1.7 && Math.abs(p.y + 1.2 - c.y) < 1.6;
        if (near) this.tryDoor(d, time);
      }
      const target = d.open ? 1 : 0;
      if (d.angle !== target) {
        d.angle = Math.min(1, Math.max(0, d.angle + Math.sign(target - d.angle) * dt * 1.5));
        // Ease in and out, so the door has some weight.
        const e = d.angle * d.angle * (3 - 2 * d.angle);
        d.group.rotation.y = d.desc.yaw + d.desc.swing * e;
      }
    }

    for (const k of this.things) {
      if (k.taken) continue;
      k.group.position.y = k.at.y + Math.sin(time * 1.7) * 0.035;
      k.group.rotation.y = time * 0.9;
      if (Math.hypot(p.x - k.at.x, p.z - k.at.z) < 1.2 && Math.abs(p.y + 1.0 - k.at.y) < 1.7) {
        k.taken = true;
        k.group.visible = false;
        this.keys.add(k.item.key);
        this.ui.keysChanged([...this.keys]);
        this.ui.toast(`You take the ${k.item.key} key.`);
      }
    }

    if (!this.won && this.goalAt && here?.id === this.site.goal && Math.hypot(p.x - this.goalAt.x, p.z - this.goalAt.z) < 2.0) {
      this.won = true;
      this.ui.won(this.elapsed);
    }
  }

  private tryDoor(d: Door, time: number): void {
    const say = (message: string) => {
      if (time < d.quietUntil) return;
      d.quietUntil = time + 5;
      this.ui.toast(message);
    };
    const { lock, barredFrom } = d.spec;
    if (lock && !this.keys.has(lock)) {
      say(`Locked. The plate on it is ${lock === 'iron' ? 'iron' : 'gold'}; it wants a key to match.`);
      return;
    }
    if (barredFrom !== undefined) {
      const p = this.player.position;
      const side = Math.sign((p.x - d.desc.centre.x) * d.facing.x + (p.z - d.desc.centre.z) * d.facing.z);
      if (side !== d.desc.barSide) {
        say('It will not move. Something bars it from the other side.');
        return;
      }
      this.ui.toast('You lift the bar. The door swings free.');
      if (d.bar) d.bar.visible = false;
    } else if (lock) {
      this.ui.toast(`The ${lock} key turns.`);
    }
    d.open = true;
    d.blocker.active = false;
  }

  /**
   * Gives the door leaves their share of the baked light. They move, so they cannot be baked with
   * the walls; each face takes the light found a pace in front of it.
   */
  applyBake(sample: (at: Vector3) => { e: [number, number, number]; sky: number; sun: number }): void {
    for (const d of this.doors) {
      const probes = [1, -1].map((s) => sample(d.desc.centre.clone().addScaledVector(d.facing, s * 0.7)));
      const g = d.leaf.geometry;
      const pos = g.getAttribute('position');
      const sh = ['aSHr', 'aSHg', 'aSHb'].map((n) => g.getAttribute(n) as BufferAttribute);
      const bake = g.getAttribute('aBake') as BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const probe = probes[pos.getZ(i) >= 0 ? 0 : 1];
        for (let c = 0; c < 3; c++) sh[c].setXYZW(i, probe.e[c], 0, 0, 0);
        bake.setXY(i, probe.sky, probe.sun);
      }
      for (const a of [...sh, bake]) a.needsUpdate = true;
    }
  }
}

function makeKey(colour: Color): Group {
  const metal = makePropMaterial({ color: colour, metalness: 0.9, roughness: 0.3, emissive: colour, emissiveIntensity: 0.35 });
  const g = new Group();
  const bow = new Mesh(new TorusGeometry(0.06, 0.014, 8, 18), metal);
  bow.position.y = 0.13;
  const shaft = new Mesh(new CylinderGeometry(0.012, 0.012, 0.22, 8), metal);
  shaft.position.y = -0.04;
  const bit1 = new Mesh(new BoxGeometry(0.06, 0.022, 0.014), metal);
  bit1.position.set(0.03, -0.12, 0);
  const bit2 = new Mesh(new BoxGeometry(0.045, 0.022, 0.014), metal);
  bit2.position.set(0.022, -0.085, 0);
  g.add(bow, shaft, bit1, bit2);
  g.rotation.z = 0.35;
  const holder = new Group();
  holder.add(g);
  return holder;
}
