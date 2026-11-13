import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { InstancedMesh, Object3D } from 'three';
import { conveyorPointToWorld } from '@core/ir/geometry';
import type { Conveyor, LineIR, WorkpieceSpec } from '@core/ir';
import { useLineStore } from '../store/lineStore';
import { useSimStore } from '../store/simStore';
import {
  RESULT_COLORS,
  cardboardGeometry,
  cardboardMaterial,
  stickerGeometry,
  stickerMaterial,
} from './builtin/workpieceAsset';

const DEG = Math.PI / 180;
const POOL = 96;
const FALLBACK: WorkpieceSpec = { lengthM: 0.2, widthM: 0.2, heightM: 0.15 };

/** コンベヤ ID → そのコンベヤへワークを供給する供給口のワーク仕様 (上流を遡る) */
function specsByConveyor(ir: LineIR): Map<string, WorkpieceSpec> {
  const out = new Map<string, WorkpieceSpec>();
  for (const e of ir.equipment) {
    if (e.kind !== 'conveyor') continue;
    let cur = e.id;
    const seen = new Set<string>();
    while (!seen.has(cur)) {
      seen.add(cur);
      const c = ir.connections.find((x) => x.to.equipmentId === cur);
      if (!c) break;
      const from = ir.equipment.find((x) => x.id === c.from.equipmentId);
      if (!from) break;
      if (from.kind === 'source') {
        out.set(e.id, from.params.workpiece);
        break;
      }
      cur = from.id;
    }
  }
  return out;
}

/**
 * シミュレーションのワークを描画。段ボール箱 (InstancedMesh 1 本) + OK/NG ステッカー (InstancedMesh 1 本)。
 * スナップショットは useFrame で直接読み、React を再描画しない。
 */
export function Workpieces() {
  const ir = useLineStore((s) => s.ir);
  const boxRef = useRef<InstancedMesh>(null);
  const stkRef = useRef<InstancedMesh>(null);
  const geoBox = useMemo(() => cardboardGeometry(), []);
  const geoStk = useMemo(() => stickerGeometry(), []);
  const dummy = useMemo(() => new Object3D(), []);
  useEffect(() => {
    // 初期化時に instanceColor を確保 (setColorAt で作られる)
    for (const r of [boxRef.current, stkRef.current]) {
      if (!r) continue;
      r.count = 0;
      r.frustumCulled = false;
    }
  }, []);
  const specs = useMemo(() => specsByConveyor(ir), [ir]);
  const convs = useMemo(() => {
    const m = new Map<string, Conveyor>();
    for (const e of ir.equipment) if (e.kind === 'conveyor') m.set(e.id, e);
    return m;
  }, [ir]);

  useFrame(() => {
    const box = boxRef.current;
    const stk = stkRef.current;
    if (!box || !stk) return;
    const snap = useSimStore.getState().snapshot;
    const list = snap?.workpieces ?? [];
    let n = 0;
    for (let i = 0; i < list.length && n < POOL; i++) {
      const w = list[i];
      const conv = convs.get(w.conveyorId);
      if (!conv) continue;
      const spec = specs.get(w.conveyorId) ?? FALLBACK;
      const k = conv.transform.scale;
      const p = conveyorPointToWorld(conv, w.offsetM);
      dummy.position.set(p[0], p[1] + 0.004 + (spec.heightM * k) / 2, p[2]);
      dummy.rotation.set(0, conv.transform.rotationYDeg * DEG, 0);
      dummy.scale.set(spec.lengthM * k * 0.98, spec.heightM * k, spec.widthM * k * 0.98);
      dummy.updateMatrix();
      box.setMatrixAt(n, dummy.matrix);
      stk.setMatrixAt(n, dummy.matrix);
      const c = RESULT_COLORS[w.result];
      box.setColorAt(n, c.box);
      stk.setColorAt(n, c.sticker);
      n++;
    }
    box.count = n;
    stk.count = n;
    box.instanceMatrix.needsUpdate = true;
    stk.instanceMatrix.needsUpdate = true;
    if (box.instanceColor) box.instanceColor.needsUpdate = true;
    if (stk.instanceColor) stk.instanceColor.needsUpdate = true;
  });

  return (
    <group name="workpieces">
      <instancedMesh
        ref={boxRef}
        args={[geoBox, cardboardMaterial(), POOL]}
        castShadow
        receiveShadow
        raycast={() => null}
      />
      <instancedMesh ref={stkRef} args={[geoStk, stickerMaterial(), POOL]} raycast={() => null} />
    </group>
  );
}
