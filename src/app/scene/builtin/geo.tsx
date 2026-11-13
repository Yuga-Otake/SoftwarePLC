import { useLayoutEffect, useRef } from 'react';
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  InstancedMesh,
  Material,
  Object3D,
  Shape,
  SphereGeometry,
} from 'three';

/** 単位ジオメトリ (全設備で共有)。形状はメッシュの scale で決める */
export const UNIT = {
  box: new BoxGeometry(1, 1, 1),
  /** 半径 1 / 高さ 1, 軸 Y */
  cylY: new CylinderGeometry(1, 1, 1, 20),
  /** 軸 Z */
  cylZ: new CylinderGeometry(1, 1, 1, 20).rotateX(Math.PI / 2),
  /** 軸 X */
  cylX: new CylinderGeometry(1, 1, 1, 20).rotateZ(Math.PI / 2),
  sphere: new SphereGeometry(1, 14, 10),
};

/**
 * T スロット付きアルミ押出材の断面。w x h (m)。
 * 辺ごとにスロット数を指定する (w 方向の辺 nW 本, h 方向の辺 nH 本)。
 */
function slotShape(w: number, h: number, nW: number, nH: number): Shape {
  const o = 0.008; // 開口
  const wi = 0.016; // 内部の広がり
  const d1 = 0.004;
  const d2 = 0.0105;
  const pts: [number, number][] = [];
  const edge = (p0: [number, number], dir: [number, number], nrm: [number, number], len: number, n: number) => {
    pts.push(p0);
    for (let i = 0; i < n; i++) {
      const c = ((i + 0.5) / n) * len;
      const P = (u: number, v: number): [number, number] => [p0[0] + dir[0] * u + nrm[0] * v, p0[1] + dir[1] * u + nrm[1] * v];
      pts.push(P(c - o / 2, 0), P(c - o / 2, d1), P(c - wi / 2, d1), P(c - wi / 2, d2), P(c + wi / 2, d2), P(c + wi / 2, d1), P(c + o / 2, d1), P(c + o / 2, 0));
    }
  };
  edge([-w / 2, -h / 2], [1, 0], [0, 1], w, nW);
  edge([w / 2, -h / 2], [0, 1], [-1, 0], h, nH);
  edge([w / 2, h / 2], [-1, 0], [0, -1], w, nW);
  edge([-w / 2, h / 2], [0, -1], [1, 0], h, nH);
  const s = new Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

function extrusion(w: number, h: number, nW: number, nH: number): ExtrudeGeometry {
  const g = new ExtrudeGeometry(slotShape(w, h, nW, nH), { depth: 1, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(Math.PI / 2); // 押出方向 +Z → +X (長さ 0..1)
  return g;
}

/** アルミ押出材 (断面は設備ローカルの Y-Z 面, 長さ 1 で +X へ伸びる)。スケールで長さを決める */
export const PROFILE = {
  /** 側面フレーム 40 x 80 (Z 厚 0.04, Y 高 0.08), 長さ +X */
  rail: extrusion(0.04, 0.08, 1, 2),
  /** 40 角, +X */
  postX: extrusion(0.04, 0.04, 1, 1),
  /** 40 角, +Y (下から上へ) */
  postY: extrusion(0.04, 0.04, 1, 1).rotateZ(Math.PI / 2),
  /** 40 角, +Z */
  postZ: extrusion(0.04, 0.04, 1, 1).rotateY(-Math.PI / 2),
};

export type Vec3 = [number, number, number];
export type InstItem = [number, number, number, number, number, number];

/** 繰り返し部品 (ローラ・脚・支柱) 用インスタンス描画。items は useMemo で安定させること */
export function Inst({
  geometry,
  material,
  items,
  castShadow,
  receiveShadow,
}: {
  geometry: BufferGeometry;
  material: Material;
  items: InstItem[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new Object3D();
    items.forEach((it, i) => {
      o.position.set(it[0], it[1], it[2]);
      o.scale.set(it[3], it[4], it[5]);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  if (items.length === 0) return null;
  return (
    <instancedMesh
      key={items.length}
      ref={ref}
      args={[geometry, undefined, items.length]}
      material={material}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}

/** 単一メッシュの省略記法 */
export function Part({
  g,
  m,
  p,
  s,
  cast,
  recv,
}: {
  g: BufferGeometry;
  m: Material;
  p: Vec3;
  s?: Vec3;
  cast?: boolean;
  recv?: boolean;
}) {
  return <mesh geometry={g} material={m} position={p} scale={s} castShadow={cast} receiveShadow={recv} />;
}

/** タップ選択用の見えない当たり判定 */
export function HitBox({ p, s }: { p: Vec3; s: Vec3 }) {
  return (
    <mesh position={p} scale={s} geometry={UNIT.box}>
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}
