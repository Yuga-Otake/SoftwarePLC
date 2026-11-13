import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, MeshStandardMaterial } from 'three';
import type { Conveyor } from '@core/ir';
import { GHOST_OPACITY, getMats } from './materials';
import { makeBeltTexture } from './textures';
import { HitBox, Inst, PROFILE, Part, UNIT } from './geo';
import type { InstItem } from './geo';
import type { BuiltinProps } from './props';

const RAIL_T = 0.04; // 側面フレーム厚
const FOOT = 0.04; // 床からの脚下端 (レベリングフット分)

/** ベルト 1 周 (上面 + ドラム巻き付き + 戻り) の閉じた曲面。UV の U は周方向 (タイル数が整数になる) */
function beltGeometry(L: number, W: number, H: number, rb: number) {
  const pts: { x: number; y: number; nx: number; ny: number }[] = [];
  const x0 = rb;
  const x1 = Math.max(L - rb, x0 + 0.001);
  const cy = H - rb;
  const N = 14;
  pts.push({ x: x0, y: H, nx: 0, ny: 1 }, { x: x1, y: H, nx: 0, ny: 1 });
  for (let i = 1; i <= N; i++) {
    const a = Math.PI / 2 - (Math.PI * i) / N;
    pts.push({ x: x1 + rb * Math.cos(a), y: cy + rb * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) });
  }
  pts.push({ x: x0, y: cy - rb, nx: 0, ny: -1 });
  for (let i = 1; i <= N; i++) {
    const a = -Math.PI / 2 - (Math.PI * i) / N;
    pts.push({ x: x0 + rb * Math.cos(a), y: cy + rb * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) });
  }
  const s: number[] = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const loop = s[s.length - 1];
  const tiles = Math.max(1, Math.round(loop / 1.0));
  const tileLen = loop / tiles;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (const z of [-W / 2, W / 2]) {
      pos.push(pts[i].x, pts[i].y, z);
      nor.push(pts[i].nx, pts[i].ny, 0);
      uv.push(s[i] / tileLen, (z + W / 2) / 0.5);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const A = 2 * i;
    idx.push(A, A + 1, A + 2, A + 1, A + 3, A + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { geo: g, tileLen };
}

export function ConveyorMesh({ eq, ghost, live, children }: BuiltinProps<Conveyor> & { children?: React.ReactNode }) {
  const { lengthM: L, widthM: W, heightM: H, speedMps } = eq.params;
  const m = getMats(ghost);
  const railH = Math.min(0.08, Math.max(0.03, H - 0.03));
  const yT = H - 0.02; // 側面フレーム上端
  const yB = yT - railH; // 側面フレーム下端 = ベルト戻り面
  const rb = Math.min((railH + 0.02) / 2, L / 2.2); // ベルト巻き付き半径
  const rd = rb - 0.003; // ドラム半径
  const zr = W / 2 + RAIL_T; // 側面フレーム中心の Z

  const { geo: belt, tileLen } = useMemo(() => beltGeometry(L, W, H, rb), [L, W, H, rb]);
  const beltMat = useMemo(() => {
    const map = makeBeltTexture();
    return new MeshStandardMaterial({
      map,
      roughness: 0.9,
      metalness: 0,
      side: DoubleSide,
      ...(ghost ? { transparent: true, opacity: GHOST_OPACITY, depthWrite: false } : {}),
    });
  }, [ghost]);
  useEffect(
    () => () => {
      beltMat.map?.dispose();
      beltMat.dispose();
    },
    [beltMat],
  );
  useEffect(() => () => belt.dispose(), [belt]);

  const running = useRef(false);
  running.current = !!live?.running;
  useFrame((_, dt) => {
    if (!running.current || !beltMat.map) return;
    beltMat.map.offset.x = (beltMat.map.offset.x - (speedMps * Math.min(dt, 0.1)) / tileLen) % 1;
  });

  const legs = useMemo(() => {
    const n = Math.max(2, Math.round(L / 1.0) + 1);
    const margin = Math.min(0.12, L / 4);
    const xs = Array.from({ length: n }, (_, i) => margin + ((L - 2 * margin) * i) / (n - 1));
    const postLen = Math.max(0.02, yB - FOOT);
    const yL = FOOT + postLen * 0.3;
    const posts: InstItem[] = [];
    const braces: InstItem[] = [];
    const feet: InstItem[] = [];
    const stems: InstItem[] = [];
    for (const x of xs) {
      for (const s of [-1, 1]) {
        posts.push([x, FOOT, s * zr, 0.04, postLen, 1]);
        feet.push([x, 0.005, s * zr, 0.034, 0.01, 0.034]);
        stems.push([x, 0.027, s * zr, 0.009, 0.034, 0.009]);
      }
      braces.push([x, yB - 0.018, 0, 0.03, 0.03, W + 0.04]);
      if (postLen > 0.12) braces.push([x, yL, 0, 0.022, 0.022, W + 0.04]);
    }
    if (postLen > 0.12) for (const s of [-1, 1]) braces.push([(xs[0] + xs[xs.length - 1]) / 2, yL, s * zr, xs[xs.length - 1] - xs[0] + 0.02, 0.02, 0.02]);
    return { posts, braces, feet, stems };
  }, [L, W, yB, zr]);

  const guides = useMemo(() => {
    const n = Math.max(2, Math.round(L / 0.6) + 1);
    const margin = Math.min(0.08, L / 4);
    const posts: InstItem[] = [];
    for (let i = 0; i < n; i++) {
      const x = margin + ((L - 2 * margin) * i) / (n - 1);
      for (const s of [-1, 1]) posts.push([x, yT + 0.0425, s * (W / 2 + 0.045), 0.012, 0.085, 0.02]);
    }
    const gl = Math.max(0.05, L - 0.06);
    const bars: InstItem[] = [];
    const caps: InstItem[] = [];
    for (const s of [-1, 1]) {
      bars.push([L / 2, H + 0.045, s * (W / 2 + 0.031), gl, 0.03, 0.008]);
      caps.push([L / 2, H + 0.0615, s * (W / 2 + 0.031), gl, 0.003, 0.012]);
    }
    return { posts, bars, caps };
  }, [L, W, H, yT]);

  const drums = useMemo<InstItem[]>(() => [[rb, H - rb, 0, rd, rd, W + 0.03], [L - rb, H - rb, 0, rd, rd, W + 0.03]], [L, W, H, rb, rd]);
  const shafts = useMemo<InstItem[]>(
    () => [[rb, H - rb, 0, 0.012, 0.012, W + 0.14], [L - rb, H - rb, 0, 0.012, 0.012, W + 0.14]],
    [L, W, H, rb],
  );
  const yellowEdge = useMemo<InstItem[]>(
    () => [-1, 1].map((s) => [L / 2, H + 0.0008, s * (W / 2 - 0.009), Math.max(0.05, L - 2 * rb), 0.001, 0.009] as InstItem),
    [L, W, H, rb],
  );

  // 駆動部: 搬送下流端 (x=L) の +Z 側にギヤモータ
  const dx = L - rb;
  const dy = H - rb;
  const mz = W / 2 + 0.11;
  const shadow = !ghost;

  return (
    <group>
      {/* 側面フレーム (アルミ押出) */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          geometry={PROFILE.rail}
          material={m.alu}
          position={[0, yB + railH / 2, s * zr]}
          scale={[L, railH / 0.08, 1]}
          castShadow={shadow}
          receiveShadow={shadow}
        />
      ))}
      {/* ベルト (上面+巻き付き+戻り) */}
      <mesh geometry={belt} material={beltMat} receiveShadow={shadow} />
      {/* スライダーベッド */}
      <Part g={UNIT.box} m={m.darkMetal} p={[L / 2, H - 0.009, 0]} s={[Math.max(0.05, L - 2 * rb), 0.006, W]} />
      {/* ベルト縁の安全イエロー */}
      <Inst geometry={UNIT.box} material={m.yellowFlat} items={yellowEdge} />
      {/* 端部ドラム + シャフト */}
      <Inst geometry={UNIT.cylZ} material={m.steel} items={drums} />
      <Inst geometry={UNIT.cylZ} material={m.chrome} items={shafts} />
      {/* 脚: アルミ角材 + 渡り + レベリングフット */}
      <Inst geometry={PROFILE.postY} material={m.alu} items={legs.posts} castShadow={shadow} />
      <Inst geometry={UNIT.box} material={m.aluDark} items={legs.braces} castShadow={shadow} />
      <Inst geometry={UNIT.cylY} material={m.darkMetal} items={legs.feet} />
      <Inst geometry={UNIT.cylY} material={m.steel} items={legs.stems} />
      {/* サイドガイド (支柱 + バー + イエローキャップ) */}
      <Inst geometry={UNIT.box} material={m.aluDark} items={guides.posts} />
      <Inst geometry={UNIT.box} material={m.stainless} items={guides.bars} />
      <Inst geometry={UNIT.box} material={m.yellow} items={guides.caps} />
      {/* ギヤモータ (直交ギヤボックス + モータ + ジャンクションボックス) */}
      <Part g={UNIT.cylZ} m={m.chrome} p={[dx, dy, W / 2 + 0.08]} s={[0.014, 0.014, 0.05]} />
      <Part g={UNIT.box} m={m.gearbox} p={[dx, dy, mz]} s={[0.08, 0.085, 0.075]} cast={shadow} />
      <Part g={UNIT.cylX} m={m.motor} p={[dx - 0.125, dy, mz]} s={[0.17, 0.045, 0.045]} cast={shadow} />
      <Part g={UNIT.cylX} m={m.aluDark} p={[dx - 0.225, dy, mz]} s={[0.035, 0.04, 0.04]} />
      <Part g={UNIT.box} m={m.steel} p={[dx - 0.125, dy - 0.05, mz]} s={[0.14, 0.008, 0.07]} />
      <Part g={UNIT.box} m={m.white} p={[dx - 0.125, dy + 0.062, mz]} s={[0.06, 0.035, 0.05]} />
      <Part g={UNIT.cylY} m={m.plastic} p={[dx - 0.105, dy + 0.087, mz]} s={[0.008, 0.016, 0.008]} />
      <HitBox p={[dx - 0.1, dy, mz]} s={[0.22, 0.12, 0.1]} />
      {children}
    </group>
  );
}
