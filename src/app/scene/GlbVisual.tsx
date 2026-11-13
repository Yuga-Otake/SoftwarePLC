import { useEffect, useMemo, useState } from 'react';
import { BoxGeometry, Box3, EdgesGeometry, Group, Material, Mesh } from 'three';
import { Html } from '@react-three/drei';
import type { Equipment, Visual } from '@core/ir';
import { loadAssetScene, measure } from '../assets/assetStore';
import { computePlacement } from '../assets/fit';
import type { GlbDims, GlbPlacement } from '../assets/fit';
import { useUiStore } from '../store/uiStore';

type GlbVisualData = Extract<Visual, { type: 'glb' }>;
const DEG = Math.PI / 180;

const dimsCache = new WeakMap<Group, GlbDims>();
function dimsOf(scene: Group): GlbDims {
  let d = dimsCache.get(scene);
  if (!d) {
    const { box, sizeM } = measure(scene);
    const c = box.getCenter(box.min.clone());
    d = { size: sizeM, centerXZ: [c.x, c.z], minY: (box as Box3).min.y };
    dimsCache.set(scene, d);
  }
  return d;
}

export type AssetState = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; scene: Group };

export function useAssetScene(assetId: string | null): AssetState {
  const [state, setState] = useState<AssetState>({ status: 'loading' });
  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    setState({ status: 'loading' });
    loadAssetScene(assetId)
      .then((scene) => alive && setState(scene ? { status: 'ready', scene } : { status: 'missing' }))
      .catch(() => alive && setState({ status: 'missing' }));
    return () => {
      alive = false;
    };
  }, [assetId]);
  return state;
}

export interface GlbInfo {
  visual: GlbVisualData;
  asset: AssetState;
  placement: GlbPlacement;
  /** 取付設備でない glb を意味付けウィザードでプレビュー中 */
  previewing: boolean;
}

/** glb 視覚を持つ設備の配置情報。glb でなければ null。フックは常に同じ順で呼ぶ */
export function useGlbInfo(eq: Equipment): GlbInfo | null {
  const visual = eq.visual.type === 'glb' ? eq.visual : null;
  const asset = useAssetScene(visual?.assetId ?? null);
  const preview = useUiStore((s) => (s.preview && s.preview.id === eq.id ? s.preview : null));
  if (!visual) return null;
  const fit = preview && eq.kind === 'generic' ? { ...visual.fit, rotationYDeg: preview.rotationYDeg } : visual.fit;
  let dims: GlbDims;
  if (asset.status === 'ready') dims = dimsOf(asset.scene);
  else {
    const s = visual.meta?.sizeM ?? [0.5, 0.5, 0.5];
    dims = { size: s, centerXZ: [0, 0], minY: 0 };
  }
  // 幾何情報は Equipment の kind と params だけに依存する
  const placementEq = preview && eq.kind === 'generic' ? { kind: 'generic' as const } : eq;
  return { visual, asset, placement: computePlacement(placementEq, fit, dims), previewing: !!preview && eq.kind === 'generic' };
}

function Placeholder({ size, center }: { size: [number, number, number]; center: [number, number, number] }) {
  const geo = useMemo(() => new EdgesGeometry(new BoxGeometry(...size)), [size[0], size[1], size[2]]);
  return (
    <group position={center}>
      <lineSegments geometry={geo}>
        <lineBasicMaterial color="#f5a524" />
      </lineSegments>
      <Html center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className="glb-missing">モデル未読込</div>
      </Html>
      {/* タップ選択用の透明な箱 */}
      <mesh>
        <boxGeometry args={size} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  );
}

function Model({ scene, ghost }: { scene: Group; ghost: boolean }) {
  const obj = useMemo(() => {
    const c = scene.clone(true);
    const owned: Material[] = [];
    if (ghost) {
      c.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const swap = (mat: Material) => {
          const n = mat.clone();
          n.transparent = true;
          n.opacity = 0.4;
          n.depthWrite = false;
          owned.push(n);
          return n;
        };
        m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
      });
    }
    c.userData.owned = owned;
    return c;
  }, [scene, ghost]);
  useEffect(() => () => (obj.userData.owned as Material[]).forEach((m) => m.dispose()), [obj]);
  return <primitive object={obj} />;
}

/** glb 視覚の本体 (設備ローカル座標へ自動配置 + fit 補正) */
export function GlbVisual({ info, ghost }: { info: GlbInfo; ghost: boolean }) {
  const { asset, placement: p } = info;
  if (asset.status === 'loading') return null;
  if (asset.status === 'missing') return <Placeholder size={p.size} center={p.center} />;
  return (
    <group position={p.pos} rotation={[0, p.rotYDeg * DEG, 0]} scale={p.scale}>
      <group position={p.inner}>
        <Model scene={asset.scene} ghost={ghost} />
      </group>
    </group>
  );
}

/** 搬送方向 (+X) の矢印と搬送面。意味付けが主張する内容を 3D 上で見せる (設備ローカル座標, 原点=搬入端) */
export function ConveyorOverlay({
  lengthM,
  widthM,
  heightM,
  originX = 0,
}: {
  lengthM: number;
  widthM: number;
  heightM: number;
  originX?: number;
}) {
  const L = lengthM;
  const head = Math.min(0.18, L * 0.25);
  const planeGeo = useMemo(() => new EdgesGeometry(new BoxGeometry(L, 0.002, widthM)), [L, widthM]);
  return (
    <group position={[originX, heightM, 0]} renderOrder={12}>
      {/* 搬送面 (薄い半透明) */}
      <mesh position={[L / 2, 0.003, 0]} raycast={() => null} renderOrder={11}>
        <boxGeometry args={[L, 0.002, widthM]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} depthWrite={false} depthTest={false} />
      </mesh>
      <lineSegments geometry={planeGeo} position={[L / 2, 0.003, 0]} raycast={() => null} renderOrder={12}>
        <lineBasicMaterial color="#38bdf8" depthTest={false} transparent />
      </lineSegments>
      {/* 矢印: 軸 + 頭 */}
      <mesh position={[(L - head) / 2, 0.02, 0]} raycast={() => null} renderOrder={13}>
        <boxGeometry args={[L - head, 0.025, 0.04]} />
        <meshBasicMaterial color="#ffb020" depthTest={false} transparent />
      </mesh>
      <mesh position={[L - head / 2, 0.02, 0]} rotation={[0, 0, -Math.PI / 2]} raycast={() => null} renderOrder={13}>
        <coneGeometry args={[0.07, head, 16]} />
        <meshBasicMaterial color="#ffb020" depthTest={false} transparent />
      </mesh>
      <Html position={[L, 0.16, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
        <div className="overlay-tag">搬送方向</div>
      </Html>
    </group>
  );
}
