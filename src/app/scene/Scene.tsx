import { useMemo } from 'react';
import { Grid, OrbitControls } from '@react-three/drei';
import { TOUCH, MOUSE } from 'three';
import type { Conveyor, Equipment } from '@core/ir';
import { useLineStore } from '../store/lineStore';
import { useUiStore } from '../store/uiStore';
import { EquipmentNode, convDims } from './EquipmentNode';
import { CameraRig } from './CameraRig';
import { Gizmo } from './Gizmo';
import type { LiveState } from './live';

export interface SceneProps {
  /** 設備 ID → ライブ表示状態 (シミュレーション等から) */
  live?: Record<string, LiveState>;
}

export function Scene({ live }: SceneProps) {
  const ir = useLineStore((s) => s.ir);
  const selectedId = useLineStore((s) => s.selectedId);
  const select = useLineStore((s) => s.select);

  const onSelect = (id: string) => {
    select(id);
    useUiStore.getState().setTab('properties');
  };

  const mountedByConv = useMemo(() => {
    const m = new Map<string, Equipment[]>();
    for (const e of ir.equipment) {
      if ('mount' in e) {
        const list = m.get(e.mount.conveyorId) ?? [];
        list.push(e);
        m.set(e.mount.conveyorId, list);
      }
    }
    return m;
  }, [ir]);

  const selected = ir.equipment.find((e) => e.id === selectedId);
  const gizmoable =
    selected &&
    (selected.kind === 'conveyor' ||
      selected.kind === 'generic' ||
      (selected.kind === 'source' &&
        !ir.connections.some((c) => c.from.equipmentId === selected.id || c.to.equipmentId === selected.id)));

  return (
    <>
      <color attach="background" args={['#0f1419']} />
      <hemisphereLight args={['#cfe0f2', '#1b232c', 0.9]} />
      <directionalLight position={[4, 8, 5]} intensity={1.4} />
      <directionalLight position={[-5, 4, -3]} intensity={0.35} />
      <Grid
        args={[40, 40]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#2a3441"
        sectionSize={1}
        sectionThickness={1.1}
        sectionColor="#44546a"
        fadeDistance={22}
        fadeStrength={1.5}
        infiniteGrid
        raycast={() => null}
      />
      {ir.equipment.map((e) => {
        if (!('transform' in e)) return null;
        if (e.kind === 'conveyor') {
          const conv = e as Conveyor;
          const dims = convDims(conv);
          return (
            <EquipmentNode key={e.id} eq={e} selected={e.id === selectedId} live={live?.[e.id]} onSelect={onSelect}>
              {(mountedByConv.get(e.id) ?? []).map((m) => (
                <EquipmentNode
                  key={m.id}
                  eq={m}
                  conv={dims}
                  selected={m.id === selectedId}
                  live={live?.[m.id]}
                  onSelect={onSelect}
                />
              ))}
            </EquipmentNode>
          );
        }
        return <EquipmentNode key={e.id} eq={e} selected={e.id === selectedId} live={live?.[e.id]} onSelect={onSelect} />;
      })}
      {gizmoable && selectedId && <Gizmo key={selectedId} id={selectedId} tick={ir} />}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        maxPolarAngle={Math.PI / 2 - 0.04}
        minDistance={0.8}
        maxDistance={40}
        screenSpacePanning
        touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
        mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      />
      <CameraRig />
    </>
  );
}
