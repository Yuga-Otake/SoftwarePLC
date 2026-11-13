import { useMemo } from 'react';
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import type { Sensor } from '@core/ir';
import { getMats } from './materials';
import { HitBox, Part, UNIT } from './geo';
import type { BuiltinProps, ConvDims } from './props';

const BY = 0.085; // ビーム高さ (搬送面から)

/** L 字ブラケット (側面フレーム外面にクランプ)。s=+1 で +Z 側、-1 で鏡像 */
function Bracket({ s, zf, m, top }: { s: number; zf: number; m: ReturnType<typeof getMats>; top: number }) {
  return (
    <group scale={[1, 1, s]}>
      <Part g={UNIT.box} m={m.steel} p={[0, (top - 0.085) / 2, zf + 0.002]} s={[0.03, top + 0.085, 0.004]} />
      <Part g={UNIT.box} m={m.steel} p={[0, top - 0.002, zf + 0.009]} s={[0.03, 0.004, 0.022]} />
      <Part g={UNIT.cylZ} m={m.aluDark} p={[0, -0.05, zf + 0.007]} s={[0.006, 0.006, 0.006]} />
      <Part g={UNIT.cylZ} m={m.aluDark} p={[0, 0.02, zf + 0.007]} s={[0.006, 0.006, 0.006]} />
    </group>
  );
}

/** 原点 = コンベヤ搬送面上の取付位置。反射型光電センサ (+Z 側) と反射板 (-Z 側) + ビーム */
export function SensorMesh({ ghost, live, conv }: BuiltinProps<Sensor> & { conv: ConvDims }) {
  const m = getMats(ghost);
  const W = conv.widthM;
  const zf = W / 2 + 0.06; // 側面フレーム外面
  const zl = W / 2 + 0.058; // レンズ面
  const detecting = !!live?.detecting;
  const top = BY - 0.027; // ブラケット上面
  const cable = useMemo(() => {
    const c = new CatmullRomCurve3(
      [
        new Vector3(0.005, BY - 0.01, zl + 0.022),
        new Vector3(0.005, BY - 0.01, zl + 0.045),
        new Vector3(-0.02, BY - 0.05, zl + 0.05),
        new Vector3(-0.07, -0.05, zf + 0.012),
        new Vector3(-0.16, -0.112, zf + 0.012),
      ],
      false,
      'catmullrom',
      0.4,
    );
    return new TubeGeometry(c, 20, 0.0025, 5, false);
  }, [zl, zf]);
  return (
    <group>
      {/* 投受光器 (+Z) */}
      <Bracket s={1} zf={zf} m={m} top={top} />
      <Part g={UNIT.box} m={m.sensorBody} p={[0, BY, zl + 0.011]} s={[0.034, 0.05, 0.022]} />
      <Part g={UNIT.box} m={m.glass} p={[0, BY, zl + 0.0005]} s={[0.026, 0.034, 0.002]} />
      <Part g={UNIT.cylZ} m={detecting ? m.beamOn : m.beamIdle} p={[0, BY, zl - 0.0004]} s={[0.006, 0.006, 0.001]} />
      <Part g={UNIT.box} m={detecting ? m.ledOn : m.ledOff} p={[0.008, BY + 0.0265, zl + 0.011]} s={[0.011, 0.003, 0.008]} />
      <Part g={UNIT.cylZ} m={m.plastic} p={[0.005, BY - 0.012, zl + 0.0245]} s={[0.005, 0.005, 0.005]} />
      <mesh geometry={cable} material={m.cable} />
      {/* 反射板 (-Z) */}
      <Bracket s={-1} zf={zf} m={m} top={top} />
      <Part g={UNIT.box} m={m.plastic} p={[0, BY, -(zl + 0.004)]} s={[0.052, 0.052, 0.008]} />
      <Part g={UNIT.box} m={m.reflector} p={[0, BY, -(zl - 0.0005)]} s={[0.044, 0.044, 0.002]} />
      {/* ビーム */}
      <Part g={UNIT.cylZ} m={detecting ? m.beamOn : m.beamIdle} p={[0, BY, 0]} s={detecting ? [0.0045, 0.0045, 2 * zl] : [0.0022, 0.0022, 2 * zl]} />
      <HitBox p={[0, BY - 0.02, zl + 0.015]} s={[0.08, 0.2, 0.07]} />
      <HitBox p={[0, BY - 0.02, -(zl + 0.015)]} s={[0.08, 0.2, 0.07]} />
    </group>
  );
}
