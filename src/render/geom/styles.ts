import { MasonryStyle } from './masonry';

/** Masonry and timber styles shared by scenes and the site mesher. One builder culture, for now. */

const LIME: [number, number, number] = [0.86, 0.77, 0.63];
const MORTAR: [number, number, number] = [0.5, 0.45, 0.36];

/** Coursed wall stone. */
export const ashlar: MasonryStyle = {
  course: [0.26, 0.38], length: [0.5, 1.05], joint: 0.007, bevel: 0.013, depth: 0.014, proud: 0.009, relief: 0.004,
  maxSeg: 0.4, chip: 0.14, tint: LIME, tintVar: 0.13, hueVar: 0.035, mortar: MORTAR, uvScale: 0.8,
};
/** Finer, paler stone for arches, ribs and door surrounds. */
export const dressed: MasonryStyle = { ...ashlar, length: [0.26, 0.38], course: [0.3, 0.4], proud: 0.005, tint: [0.92, 0.84, 0.7], tintVar: 0.08, chip: 0.08 };
export const vaultStone: MasonryStyle = { ...ashlar, course: [0.28, 0.36], length: [0.45, 0.8], tint: [0.8, 0.73, 0.62] };
/** Paving. */
export const flag: MasonryStyle = {
  course: [0.55, 0.95], length: [0.6, 1.35], joint: 0.009, bevel: 0.012, depth: 0.012, proud: 0.007, relief: 0.005,
  maxSeg: 0.4, chip: 0.2, tint: [0.64, 0.59, 0.51], tintVar: 0.16, hueVar: 0.03, mortar: [0.4, 0.37, 0.3], uvScale: 0.7,
};
export const hallFlag: MasonryStyle = { ...flag, tint: [0.52, 0.49, 0.44], proud: 0.004 };
export const coping: MasonryStyle = { ...dressed, length: [0.6, 0.9], course: [0.4, 0.6] };
export const slate: MasonryStyle = {
  course: [0.24, 0.3], length: [0.3, 0.46], joint: 0.003, bevel: 0.008, depth: 0.012, proud: 0.014, relief: 0.003,
  maxSeg: 0.5, chip: 0.25, tint: [0.36, 0.39, 0.45], tintVar: 0.22, hueVar: 0.03, mortar: [0.12, 0.12, 0.13], uvScale: 1.4,
};
export const plank: MasonryStyle = {
  course: [0.19, 0.27], length: [2.2, 3.8], joint: 0.002, bevel: 0.005, depth: 0.012, proud: 0.005, relief: 0.003,
  maxSeg: 0.5, chip: 0, tint: [1, 1, 1], tintVar: 0.2, hueVar: 0.04, mortar: [0.1, 0.07, 0.05], uvScale: 0.55,
};
export const beam: MasonryStyle = { ...plank, course: [0.3, 0.4], length: [5, 6], bevel: 0.012, tint: [0.8, 0.78, 0.75], tintVar: 0.1 };

/** How each kind of stone tints the masonry, and its mortar. */
const STONE_TINT: Record<string, { stone: [number, number, number]; mortar: [number, number, number] }> = {
  limestone: { stone: [1, 1, 1], mortar: [1, 1, 1] },
  sandstone: { stone: [1.08, 0.86, 0.64], mortar: [1.05, 0.9, 0.72] },
  greystone: { stone: [0.76, 0.8, 0.86], mortar: [0.8, 0.82, 0.86] },
  basalt: { stone: [0.47, 0.48, 0.53], mortar: [0.62, 0.6, 0.58] },
};

/** The masonry styles for a site built of the given stone. */
export function stoneStyles(stone: string): { ashlar: MasonryStyle; dressed: MasonryStyle; vaultStone: MasonryStyle; flag: MasonryStyle; hallFlag: MasonryStyle; coping: MasonryStyle; tint: [number, number, number] } {
  const t = STONE_TINT[stone] ?? STONE_TINT.limestone;
  const of = (style: MasonryStyle): MasonryStyle => ({
    ...style,
    tint: [style.tint[0] * t.stone[0], style.tint[1] * t.stone[1], style.tint[2] * t.stone[2]],
    mortar: [style.mortar[0] * t.mortar[0], style.mortar[1] * t.mortar[1], style.mortar[2] * t.mortar[2]],
  });
  return { ashlar: of(ashlar), dressed: of(dressed), vaultStone: of(vaultStone), flag: of(flag), hallFlag: of(hallFlag), coping: of(coping), tint: t.stone };
}
