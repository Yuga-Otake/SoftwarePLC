import { memo, useMemo, useRef } from 'react';
import { BoxGeometry, EdgesGeometry, MeshBasicMaterial } from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { Conveyor, Equipment } from '@core/ir';
import type { LiveState } from './live';
import { ConveyorMesh } from './builtin/Conveyor';
import { SourceMesh } from './builtin/Source';
import { SensorMesh } from './builtin/Sensor';
import { StopperMesh } from './builtin/Stopper';
import { InspectionStationMesh } from './builtin/InspectionStation';
import { GenericMesh } from './builtin/Generic';
import type { ConvDims } from './builtin/props';
import { ConveyorOverlay, GlbVisual, useGlbInfo } from './GlbVisual';
import type { GlbInfo } from './GlbVisual';
import { useUiStore } from '../store/uiStore';

const DEG = Math.PI / 180;

export interface EquipmentNodeProps {
  eq: Equipment;
  selected: boolean;
  /** 取付先コンベヤ寸法 (取付設備のみ) */
  conv?: ConvDims;
  live?: LiveState;
  onSelect?: (id: string) => void;
  children?: React.ReactNode;
}

/** 選択枠: 箱の辺を描く */
function SelectionBox({ size, center }: { size: [number, number, number]; center: [number, number, number] }) {
  const geo = useMemo(() => new EdgesGeometry(new BoxGeometry(...size)), [size[0], size[1], size[2]]);
  return (
    <lineSegments geometry={geo} position={center} renderOrder={20}>
      <lineBasicMaterial color="#38bdf8" depthTest={false} transparent />
    </lineSegments>
  );
}

/** 故障設備を赤く点滅させる半透明の箱 */
function FaultBlink({ size, center }: { size: [number, number, number]; center: [number, number, number] }) {
  const mat = useRef<MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.18 + 0.5 * (Math.sin(clock.elapsedTime * 9) > 0 ? 1 : 0);
  });
  return (
    <mesh position={center} renderOrder={15} raycast={() => null}>
      <boxGeometry args={[size[0] + 0.04, size[1] + 0.04, size[2] + 0.04]} />
      <meshBasicMaterial ref={mat} color="#ff2a2a" transparent opacity={0.5} depthWrite={false} />
    </mesh>
  );
}

function Badge({ position }: { position: [number, number, number] }) {
  return (
    <Html position={position} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
      <div className="badge-q">?</div>
    </Html>
  );
}

function selectionFor(
  eq: Equipment,
  conv?: ConvDims,
  glb?: GlbInfo | null,
): { size: [number, number, number]; center: [number, number, number] } {
  if (glb) {
    const { size, center } = glb.placement;
    return { size: [size[0] + 0.04, size[1] + 0.04, size[2] + 0.04], center };
  }
  const W = conv?.widthM ?? 0.4;
  switch (eq.kind) {
    case 'conveyor':
      return {
        size: [eq.params.lengthM + 0.05, eq.params.heightM + 0.04, eq.params.widthM + 0.14],
        center: [eq.params.lengthM / 2, eq.params.heightM / 2 + 0.02, 0],
      };
    case 'source':
      return { size: [0.6, 0.6, 0.5], center: [0.05, 0.3, 0] };
    case 'sensor':
      return { size: [0.1, 0.22, W + 0.22], center: [0, 0.06, 0] };
    case 'stopper':
      return { size: [0.1, 0.24, W + 0.18], center: [0, 0.03, 0] };
    case 'inspection_station':
      return { size: [0.22, 0.6, W + 0.3], center: [0, 0.27, 0] };
    case 'generic':
      return { size: [0.34, 0.34, 0.34], center: [0, 0.15, 0] };
  }
}

function badgeY(eq: Equipment, glb?: GlbInfo | null): number {
  if (glb) return glb.placement.center[1] + glb.placement.size[1] / 2 + 0.25;
  switch (eq.kind) {
    case 'conveyor':
      return eq.params.heightM + 0.35;
    case 'inspection_station':
      return 0.8;
    case 'source':
      return 0.75;
    case 'generic':
      return 0.5;
    default:
      return 0.4;
  }
}

function Body({ eq, ghost, conv, live, children }: { eq: Equipment; ghost: boolean; conv?: ConvDims; live?: LiveState; children?: React.ReactNode }) {
  switch (eq.kind) {
    case 'conveyor':
      return (
        <ConveyorMesh eq={eq} ghost={ghost} live={live}>
          {children}
        </ConveyorMesh>
      );
    case 'source':
      return <SourceMesh eq={eq} ghost={ghost} live={live} />;
    case 'sensor':
      return conv ? <SensorMesh eq={eq} ghost={ghost} live={live} conv={conv} /> : null;
    case 'stopper':
      return conv ? <StopperMesh eq={eq} ghost={ghost} live={live} conv={conv} /> : null;
    case 'inspection_station':
      return conv ? <InspectionStationMesh eq={eq} ghost={ghost} live={live} conv={conv} /> : null;
    case 'generic':
      return <GenericMesh eq={eq} ghost={ghost} live={live} />;
  }
}

/**
 * 1 設備の 3D 表示。props のみに依存する純粋コンポーネント。
 * 床置き設備は transform を、取付設備は呼び出し側が渡す conv と mount を使って配置する。
 * コンベヤの children にはそのコンベヤに取付けた設備 (ローカル空間) を渡す。
 */
export const EquipmentNode = memo(function EquipmentNode({ eq, selected, conv, live, onSelect, children }: EquipmentNodeProps) {
  const ghost = eq.semantics.status === 'proposed';
  const glb = useGlbInfo(eq);
  const preview = useUiStore((s) => (s.preview && s.preview.id === eq.id ? s.preview : null));
  const handle = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect?.(eq.id);
  };
  const sel = selectionFor(eq, conv, glb);
  const showOverlay = eq.kind === 'conveyor' && !!glb && (selected || ghost);
  const body = (
    <>
      {glb ? (
        <>
          <GlbVisual info={glb} ghost={ghost} />
          {children}
        </>
      ) : (
        <Body eq={eq} ghost={ghost} conv={conv} live={live}>
          {children}
        </Body>
      )}
      {showOverlay && eq.kind === 'conveyor' && (
        <ConveyorOverlay lengthM={eq.params.lengthM} widthM={eq.params.widthM} heightM={eq.params.heightM} />
      )}
      {preview && glb && eq.kind === 'generic' && (
        <ConveyorOverlay lengthM={preview.lengthM} widthM={preview.widthM} heightM={preview.heightM} originX={-preview.lengthM / 2} />
      )}
      {live?.fault && <FaultBlink {...sel} />}
      {selected && <SelectionBox {...sel} />}
      {ghost && <Badge position={[sel.center[0], badgeY(eq, glb), sel.center[2]]} />}
    </>
  );

  if ('transform' in eq) {
    const t = eq.transform;
    return (
      <group
        name={`eq:${eq.id}`}
        position={t.position}
        rotation={[0, t.rotationYDeg * DEG, 0]}
        scale={t.scale}
        onClick={handle}
      >
        {body}
      </group>
    );
  }
  if (!conv) return null;
  return (
    <group name={`eq:${eq.id}`} position={[eq.mount.offsetM, conv.heightM, 0]} onClick={handle}>
      {body}
    </group>
  );
});

export const convDims = (c: Conveyor): ConvDims => ({
  widthM: c.params.widthM,
  heightM: c.params.heightM,
  lengthM: c.params.lengthM,
});
