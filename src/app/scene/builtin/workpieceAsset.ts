import { BufferGeometry, Color, Float32BufferAttribute, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** 段ボール箱 (単位立方体。スケールで寸法を与える) と、OK/NG 表示用ステッカー。Workpieces と Source が共有 */
function flat(g: BufferGeometry): BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}

function colored(g0: BufferGeometry, hex: string) {
  const g = flat(g0);
  const c = new Color(hex);
  const n = g.getAttribute('position').count;
  const a: number[] = [];
  for (let i = 0; i < n; i++) a.push(c.r, c.g, c.b);
  g.setAttribute('color', new Float32BufferAttribute(a, 3));
  return g;
}

let box: BufferGeometry | null = null;
let stickers: BufferGeometry | null = null;

/** 少し面取りした箱 + 上面の梱包テープ */
export function cardboardGeometry(): BufferGeometry {
  if (box) return box;
  const body = colored(new RoundedBoxGeometry(1, 1, 1, 2, 0.035), '#c79d66');
  const tape = colored(new PlaneGeometry(0.13, 0.96).rotateX(-Math.PI / 2).translate(0, 0.5 + 0.004, 0), '#dcc79c');
  box = mergeGeometries([body, tape], false);
  return box;
}

/** 上面 + 両側面のステッカー (色は instanceColor で OK/NG/未検査を切り替える) */
export function stickerGeometry(): BufferGeometry {
  if (stickers) return stickers;
  const o = 0.012;
  const top = new PlaneGeometry(0.26, 0.5).rotateX(-Math.PI / 2).translate(0.27, 0.5 + o, 0);
  const side = (s: number) => {
    const g = new PlaneGeometry(0.42, 0.34);
    if (s < 0) g.rotateY(Math.PI);
    return g.translate(0, 0.02, s * (0.5 + o));
  };
  stickers = mergeGeometries([flat(top), flat(side(1)), flat(side(-1))], false);
  return stickers;
}

let cardMat: MeshStandardMaterial | null = null;
let stickerMat: MeshBasicMaterial | null = null;
export function cardboardMaterial() {
  return (cardMat ??= new MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.85, metalness: 0 }));
}
export function stickerMaterial() {
  return (stickerMat ??= new MeshBasicMaterial({ color: '#ffffff', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
}

/** 結果ごとの (箱の色味, ステッカー色) */
export const RESULT_COLORS = {
  pending: { box: new Color('#ffffff'), sticker: new Color('#ece7dc') },
  ok: { box: new Color('#d6f5de'), sticker: new Color('#22d27c') },
  ng: { box: new Color('#ffd9d4'), sticker: new Color('#ff3b36') },
};
