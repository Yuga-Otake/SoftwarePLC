import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import type { Object3D } from 'three';
import { useLineStore } from '../store/lineStore';
import { useUiStore } from '../store/uiStore';

const DEG = Math.PI / 180;
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** 選択中の床置き設備に移動/回転/スケールのギズモを出す。ドラッグ終了時に update を 1 回だけ発行 */
export function Gizmo({ id, tick }: { id: string; tick: unknown }) {
  const scene = useThree((s) => s.scene);
  const mode = useUiStore((s) => s.gizmoMode);
  const [obj, setObj] = useState<Object3D | null>(null);

  useEffect(() => {
    setObj(scene.getObjectByName(`eq:${id}`) ?? null);
  }, [scene, id, tick]);

  if (!obj) return null;

  const onMouseUp = () => {
    const { dispatch, ir } = useLineStore.getState();
    const eq = ir.equipment.find((e) => e.id === id);
    if (!eq || !('transform' in eq)) return;
    const q = obj.quaternion;
    // 搬送方向 (+X) の向きから Y 回転角を求める
    const dx = 1 - 2 * (q.y * q.y + q.z * q.z);
    let deg = Math.atan2(-(2 * (q.x * q.z - q.w * q.y)), dx) / DEG;
    deg = round(deg, 2);
    if (deg <= -180) deg += 360;
    const patch = {
      position: [round(obj.position.x), eq.transform.position[1], round(obj.position.z)] as [number, number, number],
      rotationYDeg: deg,
      scale: Math.max(0.1, round(obj.scale.x, 3)),
    };
    const res = dispatch([{ op: 'update', id, transform: patch }], `${eq.name} を変形`);
    if (res.errors.length) useUiStore.getState().toast(res.errors[0], 'error');
    // 見た目を IR に再同期 (非一様スケールや丸め)
    const t = (useLineStore.getState().ir.equipment.find((e) => e.id === id) as typeof eq).transform;
    obj.position.set(t.position[0], t.position[1], t.position[2]);
    obj.rotation.set(0, t.rotationYDeg * DEG, 0);
    obj.scale.setScalar(t.scale);
  };

  return (
    <TransformControls
      object={obj}
      mode={mode}
      space="world"
      translationSnap={0.05}
      rotationSnap={15 * DEG}
      scaleSnap={0.05}
      showX={mode !== 'rotate'}
      showY={mode === 'rotate' || mode === 'scale'}
      showZ={mode !== 'rotate'}
      size={0.9}
      onMouseUp={onMouseUp}
    />
  );
}
