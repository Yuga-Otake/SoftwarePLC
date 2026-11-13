import { useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Environment, Grid, Lightformer, OrbitControls } from '@react-three/drei';
import { DirectionalLight, MOUSE, Object3D, TOUCH } from 'three';
import type { Conveyor, Equipment } from '@core/ir';
import { useLineStore } from '../store/lineStore';
import { useUiStore } from '../store/uiStore';
import { EquipmentNode, convDims } from './EquipmentNode';
import { CameraRig, lineBounds } from './CameraRig';
import { Floor, SkyBackground } from './Floor';
import { DEBUG_GL, SHADOWS_ON, SHADOW_MAP_SIZE } from '../perf';
import { Gizmo } from './Gizmo';
import type { LiveState } from './live';
import { Workpieces } from './Workpieces';
import { useSimStore } from '../store/simStore';

export interface SceneProps {
  /** 設備 ID → ライブ表示状態 (シミュレーション等から) */
  live?: Record<string, LiveState>;
}

/** 影付きキーライト。影の範囲はライン全体に合わせる (単一の平行光源) */
function KeyLight() {
  const ir = useLineStore((s) => s.ir);
  const ref = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const { center, radius } = useMemo(() => lineBounds(ir), [ir]);
  const R = Math.min(30, radius + 2);
  useLayoutEffect(() => {
    const l = ref.current;
    if (!l) return;
    l.position.set(center.x + 0.45 * (R + 8), 0.85 * (R + 8), center.z + 0.4 * (R + 8));
    target.position.set(center.x, 0, center.z);
    target.updateMatrixWorld();
    const c = l.shadow.camera;
    c.left = -R;
    c.right = R;
    c.top = R;
    c.bottom = -R;
    c.near = 0.5;
    c.far = 2.2 * (R + 8);
    c.updateProjectionMatrix();
  }, [center, R, target]);
  return (
    <>
      <directionalLight
        ref={ref}
        target={target}
        intensity={1.9}
        color="#fff4e6"
        castShadow={SHADOWS_ON}
        shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <primitive object={target} />
    </>
  );
}

/** ネットワーク不使用の反射環境 (Lightformer だけで組んだスタジオ照明) */
function Studio() {
  return (
    <Environment resolution={128} frames={1} environmentIntensity={0.85}>
      <color attach="background" args={['#222a33']} />
      <Lightformer form="rect" intensity={3} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} color="#ffffff" />
      <Lightformer form="rect" intensity={1.6} position={[-7, 2.5, 1]} rotation-y={Math.PI / 2} scale={[10, 3, 1]} color="#d6e4ff" />
      <Lightformer form="rect" intensity={1.4} position={[7, 2.5, -2]} rotation-y={-Math.PI / 2} scale={[10, 3, 1]} color="#fff0dc" />
      <Lightformer form="rect" intensity={1.0} position={[0, 2.5, 8]} rotation-y={Math.PI} scale={[12, 3, 1]} color="#ffffff" />
      <Lightformer form="rect" intensity={0.8} position={[0, 2.5, -8]} scale={[12, 3, 1]} color="#ffffff" />
    </Environment>
  );
}

/** ?debug=1 のとき renderer を window に公開 (検証用) */
function DebugGl() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  useLayoutEffect(() => {
    if (DEBUG_GL) Object.assign(window, { __gl: gl, __cam: camera, __controls: controls });
  }, [gl, camera, controls]);
  return null;
}

export function Scene({ live: liveProp }: SceneProps) {
  const simLive = useSimStore((s) => s.live);
  const idle = useSimStore((s) => s.status === 'idle');
  const live = liveProp ?? simLive;
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
    idle &&
    selected &&
    (selected.kind === 'conveyor' ||
      selected.kind === 'generic' ||
      (selected.kind === 'source' &&
        !ir.connections.some((c) => c.from.equipmentId === selected.id || c.to.equipmentId === selected.id)));

  return (
    <>
      <SkyBackground />
      <fog attach="fog" args={['#2a333d', 16, 48]} />
      <Studio />
      <hemisphereLight args={['#dbe7f5', '#3a4450', 0.55]} />
      <KeyLight />
      <directionalLight position={[-5, 4, -3]} intensity={0.35} color="#cfe0ff" />
      <Floor receive={SHADOWS_ON} />
      <Grid
        visible={idle}
        args={[40, 40]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#7f8a96"
        sectionSize={1}
        sectionThickness={0.9}
        sectionColor="#97a3b0"
        fadeDistance={14}
        fadeStrength={2}
        infiniteGrid
        raycast={() => null}
      />
      <DebugGl />
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
      <Workpieces />
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
