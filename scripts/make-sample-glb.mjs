// サンプル GLB (ベルトコンベヤ風) を生成する: node scripts/make-sample-glb.mjs
// 長手方向を Z 軸にしてあるのは意図的 (ユーザーが搬送方向を選ぶ体験のため)。外形 ≈ X0.75 × Y0.5 × Z1.6 m
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = new URL('../public/samples/belt_conveyor.glb', import.meta.url);

const mats = [
  { name: 'FrameMetal', color: [0.55, 0.62, 0.7, 1], metallic: 0.6, rough: 0.45 },
  { name: 'BeltRubber', color: [0.12, 0.14, 0.17, 1], metallic: 0.05, rough: 0.9 },
  { name: 'LegSteel', color: [0.28, 0.31, 0.35, 1], metallic: 0.5, rough: 0.5 },
  { name: 'Marker', color: [0.95, 0.7, 0.2, 1], metallic: 0, rough: 0.8 },
];
// [name, size(x,y,z), centre(x,y,z), material]
const parts = [
  ['Frame_L', [0.05, 0.1, 1.6], [-0.35, 0.45, 0], 0],
  ['Frame_R', [0.05, 0.1, 1.6], [0.35, 0.45, 0], 0],
  ['Belt', [0.64, 0.04, 1.56], [0, 0.46, 0], 1],
  ['Leg_FL', [0.05, 0.4, 0.05], [-0.35, 0.2, 0.7], 2],
  ['Leg_FR', [0.05, 0.4, 0.05], [0.35, 0.2, 0.7], 2],
  ['Leg_BL', [0.05, 0.4, 0.05], [-0.35, 0.2, -0.7], 2],
  ['Leg_BR', [0.05, 0.4, 0.05], [0.35, 0.2, -0.7], 2],
  ['Cross_Mid', [0.65, 0.03, 0.03], [0, 0.15, 0], 2],
];

// 面ごとに [法線, 4頂点]
function box([sx, sy, sz]) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const faces = [
    [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]],
    [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]],
    [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]],
    [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]],
    [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]],
    [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]],
  ];
  const pos = [], nor = [], idx = [];
  faces.forEach(([n, vs], f) => {
    vs.forEach((v) => { pos.push(...v); nor.push(...n); });
    const b = f * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint16Array(idx), min: [-hx, -hy, -hz], max: [hx, hy, hz] };
}

const chunks = [];
let offset = 0;
const bufferViews = [];
const accessors = [];
function push(typed, target) {
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const pad = (4 - (buf.length % 4)) % 4;
  chunks.push(buf, Buffer.alloc(pad));
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
  offset += buf.length + pad;
  return bufferViews.length - 1;
}

const meshes = [];
const nodes = [];
parts.forEach(([name, size, c, m], i) => {
  const g = box(size);
  const vp = push(g.pos, 34962);
  const vn = push(g.nor, 34962);
  const vi = push(g.idx, 34963);
  const a = accessors.length;
  accessors.push(
    { bufferView: vp, componentType: 5126, count: 24, type: 'VEC3', min: g.min, max: g.max },
    { bufferView: vn, componentType: 5126, count: 24, type: 'VEC3' },
    { bufferView: vi, componentType: 5123, count: 36, type: 'SCALAR' },
  );
  meshes.push({ name, primitives: [{ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2, material: m }] });
  nodes.push({ name, mesh: i, translation: c });
});
const root = { name: 'BeltConveyor', children: nodes.map((_, i) => i) };
nodes.push(root);

const gltf = {
  asset: { version: '2.0', generator: 'make-sample-glb.mjs' },
  scene: 0,
  scenes: [{ nodes: [nodes.length - 1] }],
  nodes,
  meshes,
  materials: mats.map((m) => ({
    name: m.name,
    pbrMetallicRoughness: { baseColorFactor: m.color, metallicFactor: m.metallic, roughnessFactor: m.rough },
  })),
  accessors,
  bufferViews,
  buffers: [{ byteLength: offset }],
};

let json = Buffer.from(JSON.stringify(gltf), 'utf8');
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const bin = Buffer.concat(chunks);
const total = 12 + 8 + json.length + 8 + bin.length;
const head = Buffer.alloc(12);
head.write('glTF', 0, 'ascii');
head.writeUInt32LE(2, 4);
head.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(json.length, 0);
jh.write('JSON', 4, 'ascii');
const bh = Buffer.alloc(8);
bh.writeUInt32LE(bin.length, 0);
bh.write('BIN\0', 4, 'binary');
mkdirSync(dirname(OUT.pathname), { recursive: true });
writeFileSync(OUT, Buffer.concat([head, jh, json, bh, bin]));
console.log(`wrote ${OUT.pathname} (${total} bytes)`);
