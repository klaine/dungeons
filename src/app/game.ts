import {
  BoxGeometry, BufferAttribute, Color, CylinderGeometry, Group, Material, Mesh, OctahedronGeometry, Scene, TorusGeometry, Vector3,
} from 'three';
import { makePropMaterial } from '../render/siteMaterial';
import { DoorSpec, Item, KeyId, Lever, Site } from '../core/site';
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
  /** Something happened that should be heard. */
  sound?(event: 'door' | 'locked' | 'key' | 'find' | 'lever' | 'won'): void;
  keysChanged(keys: KeyId[]): void;
  won(seconds: number): void;
}

const METAL: Record<KeyId, Color> = { iron: new Color(0.42, 0.44, 0.48), gold: new Color(1.0, 0.76, 0.28) };

interface Door {
  desc: DoorDesc;
  spec: DoorSpec;
  group: Group;
  /** The plank leaf, for a door; nothing for a gate. */
  leaf: Mesh | null;
  bar: Mesh | null;
  gate: boolean;
  open: boolean;
  angle: number;
  blocker: { min: Vector3; max: Vector3; active: boolean };
  /** Unit vector along the leaf's z when shut, in the world. */
  facing: Vector3;
  quietUntil: number;
  /** For a rising gate: the game time at which the way is clear. */
  clearAt: number;
}

interface LeverThing {
  lever: Lever;
  handle: Group;
  at: Vector3;
  thrown: boolean;
  swing: number;
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
  readonly levers: LeverThing[] = [];
  won = false;
  private elapsed = 0;
  private goalAt: Vector3 | null;

  /** Whether the relic in the hidden chamber has been found. */
  foundSecret = false;
  private relic: { group: Group; at: Vector3 } | null = null;
  /** Small things left about the valley, and whether each has been picked up. */
  readonly finds: { group: Group; at: Vector3; what: string; taken: boolean }[] = [];

  constructor(private site: Site, desc: SceneDescription, scene: Scene, materials: Record<string, Material>, private player: Player, private ui: GameUi) {
    const iron = makePropMaterial({ color: new Color(0.07, 0.065, 0.06), roughness: 0.74, metalness: 0.5 });
    const timber = makePropMaterial({ color: new Color(0.2, 0.13, 0.08), roughness: 0.85, metalness: 0 });

    for (const d of desc.doors ?? []) {
      const spec = site.ways[d.way].door!;
      const group = new Group();
      group.position.copy(d.hinge);
      const W = d.halfWidth * 2;
      const t = d.thickness;
      const gate = spec.leaf === 'gate';
      let leaf: Mesh | null = null;
      let bar: Mesh | null = null;
      if (gate || !d.leaf) {
        // A portcullis: upright bars cut to the arch, tied by three rails. It can be seen through.
        const spacing = 0.19;
        const count = Math.max(2, Math.round(W / spacing));
        for (let k = 0; k <= count; k++) {
          const x = (W * k) / count;
          const height = d.spring + Math.sqrt(Math.max(0, d.halfWidth * d.halfWidth - (x - d.halfWidth) * (x - d.halfWidth)));
          const upright = new Mesh(new BoxGeometry(0.035, height, 0.035), iron);
          upright.position.set(x, height / 2, 0);
          upright.rotation.y = Math.PI / 4;
          group.add(upright);
          // Each bar ends in a point, as if it could be dropped into the floor.
          const point = new Mesh(new CylinderGeometry(0, 0.03, 0.09, 4), iron);
          point.position.set(x, -0.03, 0);
          point.rotation.x = Math.PI;
          group.add(point);
        }
        for (const y of [0.35, 1.15, 1.95]) {
          const rail = new Mesh(new BoxGeometry(W, 0.05, 0.02), iron);
          rail.position.set(W / 2, y, 0);
          group.add(rail);
        }
      } else {
        leaf = new Mesh(d.leaf.build(), materials[d.material] ?? materials.wood);
        leaf.receiveShadow = true;
        group.add(leaf);
        // Iron straps and a ring pull on both faces; a secret door has neither, or it would be no secret.
        for (const y of d.material === 'stone' ? [] : [0.42, 1.5]) {
          const strap = new Mesh(new BoxGeometry(W - 0.12, 0.075, t + 0.024), iron);
          strap.position.set(W / 2 - 0.03, y, 0);
          group.add(strap);
        }
        for (const side of d.material === 'stone' ? [] : [1, -1]) {
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
        if (d.barSide !== 0) {
          bar = new Mesh(new BoxGeometry(W + 0.5, 0.13, 0.09), timber);
          bar.position.set(W / 2, 1.0, d.barSide * (t / 2 + 0.06));
          group.add(bar);
        }
      }

      const open = spec.leaf === 'open';
      const angle = open ? 1 : 0;
      group.rotation.y = d.yaw + d.swing * angle;
      scene.add(group);
      const blocker = { min: d.blocker.min, max: d.blocker.max, active: !open };
      player.blockers.push(blocker);
      this.doors.push({
        desc: d, spec, group, leaf, bar, gate, open, angle, blocker, quietUntil: 0, clearAt: Infinity,
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
    // Levers: an iron handle in a stone foot, standing on the floor.
    for (const lever of site.levers) {
      const stone = makePropMaterial({ color: new Color(0.42, 0.39, 0.34), roughness: 0.95, metalness: 0 });
      const at = new Vector3(lever.x, site.places[lever.place].floor, lever.z);
      const group = new Group();
      group.position.copy(at);
      const foot = new Mesh(new BoxGeometry(0.34, 0.3, 0.26), stone);
      foot.position.y = 0.15;
      const handle = new Group();
      handle.position.y = 0.28;
      const rod = new Mesh(new CylinderGeometry(0.018, 0.022, 0.85, 8), iron);
      rod.position.y = 0.42;
      const grip = new Mesh(new CylinderGeometry(0.035, 0.035, 0.16, 8), timber);
      grip.position.y = 0.86;
      handle.add(rod, grip);
      handle.rotation.z = 0.55;
      group.add(foot, handle);
      scene.add(group);
      this.levers.push({ lever, handle, at, thrown: false, swing: 0 });
    }
    // What the hidden chamber holds: something small that catches the light.
    const hiddenAt = site.secret >= 0 ? desc.anchors?.get(site.secret) : undefined;
    if (hiddenAt) {
      const colour = new Color(0.35, 0.9, 0.75);
      const gem = new Mesh(new OctahedronGeometry(0.09), makePropMaterial({ color: colour, metalness: 0.3, roughness: 0.15, emissive: colour, emissiveIntensity: 0.6 }));
      gem.scale.y = 1.5;
      const group = new Group();
      group.add(gem);
      const at = hiddenAt.clone().add(new Vector3(0, 0.3, 0));
      group.position.copy(at);
      scene.add(group);
      this.relic = { group, at };
    }
    for (const f of desc.finds ?? []) {
      const colour = new Color(0.95, 0.9, 0.75);
      const thing = new Mesh(new OctahedronGeometry(0.07), makePropMaterial({ color: colour, metalness: 0.6, roughness: 0.25, emissive: colour, emissiveIntensity: 0.35 }));
      const group = new Group();
      group.add(thing);
      group.position.copy(f.at);
      scene.add(group);
      this.finds.push({ group, at: f.at.clone(), what: f.what, taken: false });
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
        // A secret door has to be all but leaned on before it gives.
        const reach = d.spec.leaf === 'secret' ? 0.85 : 1.7;
        const near = Math.hypot(p.x - c.x, p.z - c.z) < reach && Math.abs(p.y + 1.2 - c.y) < 1.6;
        if (near) this.tryDoor(d, time);
      }
      if (d.blocker.active && this.elapsed >= d.clearAt) d.blocker.active = false;
      const target = d.open ? 1 : 0;
      if (d.angle !== target) {
        d.angle = Math.min(1, Math.max(0, d.angle + Math.sign(target - d.angle) * dt * (d.gate ? 0.6 : 1.5)));
        // Ease in and out, so the door has some weight.
        const e = d.angle * d.angle * (3 - 2 * d.angle);
        if (d.gate) d.group.position.y = d.desc.hinge.y + e * (d.desc.spring + d.desc.halfWidth + 0.15);
        else d.group.rotation.y = d.desc.yaw + d.desc.swing * e;
      }
    }

    for (const l of this.levers) {
      if (!l.thrown && Math.hypot(p.x - l.at.x, p.z - l.at.z) < 1.25 && Math.abs(p.y - l.at.y) < 1.2) {
        l.thrown = true;
        const gate = this.doors.find((d) => d.desc.way === l.lever.opens);
        if (gate) {
          gate.open = true;
          // The way clears once the gate is most of the way up, not the moment the lever moves.
          gate.clearAt = this.elapsed + 1.2;
        }
        this.ui.toast('You throw the lever. Iron grinds, and the portcullis rises.');
        this.ui.sound?.('lever');
      }
      if (l.thrown && l.swing < 1) {
        l.swing = Math.min(1, l.swing + dt * 2.5);
        l.handle.rotation.z = 0.55 - 1.1 * l.swing;
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
        this.ui.sound?.('key');
      }
    }

    for (const f of this.finds) {
      if (f.taken) continue;
      f.group.rotation.y = time * 1.1;
      f.group.position.y = f.at.y + Math.sin(time * 1.9 + f.at.x) * 0.03;
      if (Math.hypot(p.x - f.at.x, p.z - f.at.z) < 1.1 && Math.abs(p.y + 1.0 - f.at.y) < 1.8) {
        f.taken = true;
        f.group.visible = false;
        this.ui.toast(`You find ${f.what}.`);
        this.ui.sound?.('find');
      }
    }

    if (this.relic && !this.foundSecret) {
      const r = this.relic;
      r.group.rotation.y = time * 1.3;
      r.group.position.y = r.at.y + Math.sin(time * 2.1) * 0.03;
      if (Math.hypot(p.x - r.at.x, p.z - r.at.z) < 1.2 && Math.abs(p.y + 1.0 - r.at.y) < 1.7) {
        this.foundSecret = true;
        r.group.visible = false;
        this.ui.toast('A relic, sealed up here for who knows how long. You take it.');
        this.ui.sound?.('find');
      }
    }

    if (!this.won && this.goalAt && here?.id === this.site.goal && Math.hypot(p.x - this.goalAt.x, p.z - this.goalAt.z) < 2.0) {
      this.won = true;
      this.ui.won(this.elapsed);
      this.ui.sound?.('won');
    }
  }

  private tryDoor(d: Door, time: number): void {
    const say = (message: string) => {
      if (time < d.quietUntil) return;
      d.quietUntil = time + 5;
      this.ui.toast(message);
      this.ui.sound?.('locked');
    };
    const { lock, barredFrom } = d.spec;
    if (d.gate) {
      say('A portcullis, down. Something must raise it; look for a lever.');
      return;
    }
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
    } else if (d.spec.leaf === 'secret') {
      this.ui.toast('The wall gives under your hand. A door, faced in stone.');
    }
    d.open = true;
    d.blocker.active = false;
    this.ui.sound?.('door');
  }

  /**
   * Gives the door leaves their share of the baked light. They move, so they cannot be baked with
   * the walls; each face takes the light found a pace in front of it.
   */
  applyBake(sample: (at: Vector3) => { e: [number, number, number]; sky: number; sun: number }): void {
    for (const d of this.doors) {
      if (!d.leaf) continue;
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
