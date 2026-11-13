import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Shape, ShapeGeometry } from 'three';
import type { Conveyor } from '@core/ir';
import { getMats } from './materials';
import type { BuiltinProps } from './props';

const RAIL_H = 0.14;

function useChevronGeometry() {
  return useMemo(() => {
    const s = new Shape();
    s.moveTo(0, 0.06);
    s.lineTo(0.05, 0);
    s.lineTo(0, -0.06);
    s.lineTo(-0.025, -0.06);
    s.lineTo(0.025, 0);
    s.lineTo(-0.025, 0.06);
    s.closePath();
    const g = new ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
}

export function ConveyorMesh({ eq, ghost, live, children }: BuiltinProps<Conveyor> & { children?: React.ReactNode }) {
  const { lengthM: L, widthM: W, heightM: H } = eq.params;
  const m = getMats(ghost);
  const chev = useChevronGeometry();
  const rz = W / 2 + 0.025;
  const legCount = Math.max(2, Math.round(L / 1.2) + 1);
  const legH = Math.max(0.05, H - RAIL_H + 0.02);
  const chevrons = Math.max(1, Math.floor(L / 0.3));
  const chevRef = useRef<Group>(null);
  const phase = useRef(0);
  const running = !!live?.running;
  const speed = eq.params.speedMps;
  useFrame((_, dt) => {
    const g = chevRef.current;
    if (!g) return;
    if (running) phase.current = (phase.current + speed * Math.min(dt, 0.1)) % L;
    else if (phase.current === 0) return;
    const sp = L / chevrons;
    g.children.forEach((ch, i) => {
      ch.position.x = (sp * (i + 0.5) + phase.current) % L;
    });
  });

  return (
    <group>
      {/* 側面フレーム */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[L / 2, H - RAIL_H / 2 + 0.02, s * rz]} material={m.frame}>
          <boxGeometry args={[L, RAIL_H, 0.05]} />
        </mesh>
      ))}
      {/* ベルト面 */}
      <mesh position={[L / 2, H - 0.012, 0]} material={m.belt}>
        <boxGeometry args={[L, 0.03, W]} />
      </mesh>
      {/* 端部ローラ */}
      {[0, L].map((x) => (
        <mesh key={x} position={[x, H - 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.steel}>
          <cylinderGeometry args={[0.04, 0.04, W + 0.02, 16]} />
        </mesh>
      ))}
      {/* 脚 */}
      {Array.from({ length: legCount }, (_, i) => {
        const x = 0.1 + (i * (L - 0.2)) / (legCount - 1);
        return [-1, 1].map((s) => (
          <mesh key={`${i}${s}`} position={[x, legH / 2 - 0.0, s * rz]} material={m.dark}>
            <boxGeometry args={[0.05, legH, 0.05]} />
          </mesh>
        ));
      })}
      {/* 脚の渡り */}
      {Array.from({ length: legCount }, (_, i) => {
        const x = 0.1 + (i * (L - 0.2)) / (legCount - 1);
        return (
          <mesh key={i} position={[x, 0.15, 0]} material={m.dark}>
            <boxGeometry args={[0.03, 0.03, 2 * rz]} />
          </mesh>
        );
      })}
      {/* 搬送方向 (+X) の矢印 */}
      <group ref={chevRef}>
        {Array.from({ length: chevrons }, (_, i) => (
          <mesh key={i} position={[(L * (i + 0.5)) / chevrons, H + 0.004, 0]} geometry={chev} material={m.chevron} />
        ))}
      </group>
      {children}
    </group>
  );
}
