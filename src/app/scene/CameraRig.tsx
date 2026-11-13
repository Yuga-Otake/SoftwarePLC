import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { conveyorPointToWorld } from '@core/ir/geometry';
import type { LineIR } from '@core/ir';
import { useUiStore } from '../store/uiStore';
import { useLineStore } from '../store/lineStore';

/** ライン全体を囲む球 (center, radius) */
export function lineBounds(ir: LineIR): { center: Vector3; radius: number } {
  const pts: Vector3[] = [];
  for (const e of ir.equipment) {
    if (e.kind === 'conveyor') {
      const a = conveyorPointToWorld(e, 0);
      const b = conveyorPointToWorld(e, e.params.lengthM);
      pts.push(new Vector3(a[0], 0, a[2]), new Vector3(b[0], 0, b[2]));
      pts.push(new Vector3(a[0], a[1], a[2]), new Vector3(b[0], b[1], b[2]));
    } else if ('transform' in e) {
      pts.push(new Vector3(...e.transform.position));
      if (e.visual.type === 'glb' && e.visual.meta) {
        const r = (Math.max(e.visual.meta.sizeM[0], e.visual.meta.sizeM[2]) / 2) * e.transform.scale * e.visual.fit.scale;
        const [x, y, z] = e.transform.position;
        pts.push(new Vector3(x - r, y, z - r), new Vector3(x + r, y, z + r));
      }
    }
  }
  if (pts.length === 0) return { center: new Vector3(0, 0.3, 0), radius: 2 };
  const min = pts[0].clone();
  const max = pts[0].clone();
  for (const p of pts) {
    min.min(p);
    max.max(p);
  }
  const center = min.clone().add(max).multiplyScalar(0.5);
  const radius = Math.max(0.7, min.distanceTo(max) / 2 + 0.2);
  return { center, radius };
}

/** fitNonce が増えるたびにカメラをライン全体へ合わせる (UI の被り分だけ画面中心をずらす) */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const fitNonce = useUiStore((s) => s.fitNonce);

  useEffect(() => {
    if (!controls) return;
    const ir = useLineStore.getState().ir;
    const { center, radius } = lineBounds(ir);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const wide = W >= 900;
    const sheetOpen = useUiStore.getState().sheetOpen;
    const top = 112;
    const availLeft = 0;
    const availRight = wide ? W - 380 : W;
    const availTop = top;
    const availBottom = wide ? H : sheetOpen ? H * 0.46 : H - 110;
    const availW = availRight - availLeft;
    const availH = availBottom - availTop;

    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = W / H;
    const tanH = tanV * aspect;
    const dV = radius / Math.sin(Math.atan(tanV * (availH / H)));
    const dH = radius / Math.sin(Math.atan(tanH * (availW / W)));
    const d = Math.max(dV, dH);

    const dir = new Vector3(0.55, 0.6, 0.8).normalize();
    const f = dir.clone().negate();
    const right = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, f).normalize();
    const unit = (2 * d * tanV) / H;
    const dx = (availLeft + availRight) / 2 - W / 2;
    const dy = (availTop + availBottom) / 2 - H / 2;
    const shift = right.clone().multiplyScalar(-dx * unit).add(up.clone().multiplyScalar(dy * unit));

    controls.target.copy(center).add(shift);
    camera.position.copy(center).addScaledVector(dir, d).add(shift);
    camera.lookAt(controls.target);
    controls.update();
  }, [fitNonce, controls, camera]);

  return null;
}
