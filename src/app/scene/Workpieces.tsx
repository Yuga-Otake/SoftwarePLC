import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { conveyorPointToWorld } from '@core/ir/geometry';
import type { Conveyor, LineIR, WorkpieceSpec } from '@core/ir';
import { useLineStore } from '../store/lineStore';
import { useSimStore } from '../store/simStore';

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

/** シミュレーションのワークを描画。スナップショットは useFrame で直接読み、React を再描画しない */
export function Workpieces() {
  const ir = useLineStore((s) => s.ir);
  const refs = useRef<(Mesh | null)[]>([]);
  const geo = useMemo(() => new BoxGeometry(1, 1, 1), []);
  const mats = useMemo(
    () => ({
      pending: new MeshStandardMaterial({ color: '#c9a56e', roughness: 0.85, metalness: 0 }),
      ok: new MeshStandardMaterial({ color: '#2fc77a', roughness: 0.6, metalness: 0.05 }),
      ng: new MeshStandardMaterial({ color: '#ee4d4a', roughness: 0.6, metalness: 0.05 }),
    }),
    [],
  );
  useEffect(
    () => () => {
      geo.dispose();
      Object.values(mats).forEach((m) => m.dispose());
    },
    [geo, mats],
  );
  const specs = useMemo(() => specsByConveyor(ir), [ir]);
  const convs = useMemo(() => {
    const m = new Map<string, Conveyor>();
    for (const e of ir.equipment) if (e.kind === 'conveyor') m.set(e.id, e);
    return m;
  }, [ir]);

  useFrame(() => {
    const snap = useSimStore.getState().snapshot;
    const list = snap?.workpieces ?? [];
    for (let i = 0; i < POOL; i++) {
      const mesh = refs.current[i];
      if (!mesh) continue;
      const w = list[i];
      const conv = w && convs.get(w.conveyorId);
      if (!w || !conv) {
        mesh.visible = false;
        continue;
      }
      const spec = specs.get(w.conveyorId) ?? FALLBACK;
      const k = conv.transform.scale;
      const p = conveyorPointToWorld(conv, w.offsetM);
      mesh.visible = true;
      mesh.position.set(p[0], p[1] + 0.004 + (spec.heightM * k) / 2, p[2]);
      mesh.rotation.set(0, conv.transform.rotationYDeg * DEG, 0);
      mesh.scale.set(spec.lengthM * k * 0.98, spec.heightM * k, spec.widthM * k * 0.98);
      mesh.material = mats[w.result];
    }
  });

  return (
    <group name="workpieces">
      {Array.from({ length: POOL }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            refs.current[i] = m;
          }}
          geometry={geo}
          material={mats.pending}
          visible={false}
          raycast={() => null}
        />
      ))}
    </group>
  );
}
