/**
 * Makes the figures' files in `public/figures/` from Quaternius's free packs (all CC0), which are not kept in the repository:
 *
 *   npx tsx tools/figures.ts <folder>
 *
 * where <folder> holds, unpacked anywhere beneath it, the Standard downloads of the Universal Animation Library (version 3, from
 * itch.io: its clips on the rig that the second library and the base characters share), the Universal Animation Library 2, and the
 * Universal Base Characters. What it writes:
 *
 *  - `clips.glb`: the male mannequin, rigged, and every clip of both libraries on its one skeleton. The first library comes twice, once
 *    with its root standing still and once moving (`_RM`); the still one is taken, since the game's body carries the figure, and from the
 *    moving one only the clips whose travel cannot be taken from a pace (the roll). Tracks that never leave the bone's rest are dropped
 *    (most bones are only turned, but every clip moved every bone), and keys that lie on the line between their neighbours.
 *  - `mannequin-f.glb`: the female mannequin, without clips (the same rig).
 *  - `superhero-male.glb`, `superhero-female.glb`: the two base characters of the free pack, their textures brought down to 1024 pixels
 *    and kept as JPEG (they come at 2048, as PNG, some 40 MB together).
 *  - `LICENSE.txt`: where they came from, and their licence.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Accessor, Document, Node, NodeIO } from '@gltf-transform/core';
import { dedup, prune, resample, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const from = process.argv[2];
if (!from || !existsSync(from)) {
  console.error('Usage: npx tsx tools/figures.ts <folder with the unpacked packs>');
  process.exit(1);
}
const out = resolve('public/figures');
mkdirSync(out, { recursive: true });

/** The one file of that name beneath the folder. */
function find(name: string): string {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e === name) hits.push(p);
    }
  };
  walk(from);
  if (!hits.length) throw new Error(`${name} is not in ${from}`);
  return hits[0];
}

const io = new NodeIO();

/** Whether every key of a track is the bone's rest: such a track says nothing that the bone does not already. */
function atRest(values: ArrayLike<number>, size: number, rest: number[]): boolean {
  for (let k = 0; k < values.length; k += size) {
    if (size === 4) {
      // (A turn and its negative are the same turn.)
      let dot = 0;
      for (let i = 0; i < 4; i++) dot += values[k + i] * rest[i];
      if (Math.abs(dot) < 1 - 1e-6) return false;
    } else {
      for (let i = 0; i < size; i++) if (Math.abs(values[k + i] - rest[i]) > 1e-4) return false;
    }
  }
  return true;
}

function restOf(node: Node, path: string): number[] {
  return path === 'translation' ? node.getTranslation() : path === 'rotation' ? node.getRotation() : node.getScale();
}

/** Takes away the tracks of `doc`'s clips that stay at rest. */
function dropResting(doc: Document): number {
  let dropped = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode(), path = ch.getTargetPath(), sampler = ch.getSampler();
      if (!node || !path || path === 'weights' || !sampler) continue;
      const output = sampler.getOutput()!;
      if (!atRest(output.getArray()!, output.getElementSize(), restOf(node, path))) continue;
      anim.removeChannel(ch);
      ch.dispose();
      if (!anim.listChannels().some((c) => c.getSampler() === sampler)) {
        anim.removeSampler(sampler);
        sampler.dispose();
      }
      dropped++;
    }
  }
  return dropped;
}

/** Copies the clip `name` of `src` into `dst` as `as`, its tracks bound to `dst`'s bones of the same names. */
function copyClip(src: Document, name: string, dst: Document, as: string): void {
  const clip = src.getRoot().listAnimations().find((a) => a.getName() === name);
  if (!clip) throw new Error(`no clip ${name}`);
  const bones = new Map(dst.getRoot().listNodes().map((n) => [n.getName(), n]));
  const buffer = dst.getRoot().listBuffers()[0];
  const copy = (a: Accessor) => dst.createAccessor().setType(a.getType()).setArray(a.getArray()!.slice()).setBuffer(buffer);
  const made = dst.createAnimation(as);
  for (const ch of clip.listChannels()) {
    const bone = bones.get(ch.getTargetNode()?.getName() ?? '');
    const s = ch.getSampler();
    if (!bone || !s) continue;
    const sampler = dst.createAnimationSampler().setInput(copy(s.getInput()!)).setOutput(copy(s.getOutput()!)).setInterpolation(s.getInterpolation());
    made.addSampler(sampler).addChannel(dst.createAnimationChannel().setTargetNode(bone).setTargetPath(ch.getTargetPath()!).setSampler(sampler));
  }
}

const size = (p: string) => `${(statSync(p).size / 1e6).toFixed(1)} MB`;

// ------------------------------------------------------------------ the clips, on the male mannequin
{
  const doc = await io.read(find('UAL1_Standard.glb'));
  const moving = await io.read(find('UAL1_Standard_RM.glb'));
  const second = await io.read(find('UAL2_Standard.glb'));
  const ours = new Set(doc.getRoot().listAnimations().map((a) => a.getName()));
  copyClip(moving, 'Roll', doc, 'Roll_RM');
  for (const a of second.getRoot().listAnimations()) {
    if (ours.has(a.getName())) continue;
    copyClip(second, a.getName(), doc, a.getName());
  }
  // (The pose the rig was made in is no clip to play.)
  for (const a of doc.getRoot().listAnimations()) if (a.getName() === 'A_TPose') a.dispose();
  const dropped = dropResting(doc);
  await doc.transform(resample(), dedup(), prune());
  const file = join(out, 'clips.glb');
  await io.write(file, doc);
  console.log(`clips.glb: ${doc.getRoot().listAnimations().length} clips, ${dropped} tracks at rest dropped, ${size(file)}`);
}

// ------------------------------------------------------------------ the bodies
/**
 * Reads a glTF with its files beside it. (The base characters' name some of their images `…_png.png` where the file is `….png`; the
 * file is taken when the name is missing.)
 */
async function readBeside(path: string): Promise<Document> {
  if (path.endsWith('.glb')) return io.read(path);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const resources: Record<string, Uint8Array> = {};
  for (const r of [...(json.buffers ?? []), ...(json.images ?? [])] as { uri?: string }[]) {
    if (!r.uri || r.uri.startsWith('data:')) continue;
    let file = join(dirname(path), decodeURIComponent(r.uri));
    if (!existsSync(file)) file = file.replace(/_png\.png$/, '.png');
    resources[r.uri] = new Uint8Array(readFileSync(file));
  }
  return io.readJSON({ json, resources });
}

for (const [name, as] of [['Mannequin_F.glb', 'mannequin-f.glb'], ['Superhero_Male_FullBody.gltf', 'superhero-male.glb'], ['Superhero_Female_FullBody.gltf', 'superhero-female.glb']]) {
  const doc = await readBeside(find(name));
  for (const a of doc.getRoot().listAnimations()) a.dispose();
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 88 }),
    dedup(),
    prune(),
  );
  const file = join(out, as);
  await io.write(file, doc);
  console.log(`${as}: ${size(file)}`);
}

writeFileSync(join(out, 'LICENSE.txt'), `The figures in this folder are by Quaternius (https://quaternius.com), from the free Standard versions of
the Universal Animation Library (version 3), the Universal Animation Library 2 and the Universal Base Characters.

License: CC0 1.0 Universal (CC0 1.0) Public Domain Dedication
https://creativecommons.org/publicdomain/zero/1.0/

They were brought into this form by tools/figures.ts: the clips of both libraries put on one skeleton, tracks that stay at rest and
keys that add nothing dropped, and the base characters' textures made smaller.
`);
