import { BufferGeometry, Group, Material, Mesh, Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Merges the meshes directly in `group` that share a material into one mesh each, their places
 * within the group baked into the geometry, so that a prop of several parts is drawn in as many
 * calls as it has materials, not parts. (A torch was five draw calls, a door with its straps and
 * ring a dozen; drawing calls, not triangles, were what the frame was spent on.) Meshes in `keep`
 * are left as they are: the parts that move, or that something else holds on to.
 */
export function mergeParts(group: Group, keep: (Object3D | null | undefined)[] = []): void {
  const byMaterial = new Map<Material, Mesh[]>();
  for (const child of group.children) {
    if (!(child instanceof Mesh) || keep.includes(child) || Array.isArray(child.material) || child.children.length) continue;
    const list = byMaterial.get(child.material) ?? [];
    list.push(child);
    byMaterial.set(child.material, list);
  }
  for (const [material, list] of byMaterial) {
    if (list.length < 2) continue;
    const geometries: BufferGeometry[] = [];
    for (const m of list) {
      m.updateMatrix();
      // (Only what every part has: a box has no more than position, normal and uv, and the merge wants them alike.)
      const g = m.geometry.index ? m.geometry.clone() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      g.applyMatrix4(m.matrix);
      geometries.push(g.index ? g : g);
    }
    const allIndexed = geometries.every((g) => g.index), merged = mergeGeometries(allIndexed ? geometries : geometries.map((g) => (g.index ? g.toNonIndexed() : g)));
    if (!merged) continue;
    const one = new Mesh(merged, material);
    one.castShadow = list.some((m) => m.castShadow);
    one.receiveShadow = list.some((m) => m.receiveShadow);
    one.layers.mask = list[0].layers.mask;
    for (const m of list) { group.remove(m); m.geometry.dispose(); }
    group.add(one);
  }
}
