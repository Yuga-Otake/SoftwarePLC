import { useMemo } from 'react';
import { CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import type { Stopper } from '@core/ir';
import { getMats } from './materials';
import { HitBox, Part, UNIT } from './geo';
import type { BuiltinProps, ConvDims } from './props';

const CLOSED_TOP = 0.105; // 閉: ストップバー上端 (搬送面から)
const OPEN_TOP = -0.03; // 全開: ベルト面下
const BODY_TOP = -0.045;

/** open: 0 (閉=ワークを止める) .. 1 (全開=ベルト面下へ)。原点 = 搬送面上のストップ位置 */
export function StopperMesh({ ghost, live, conv, open }: BuiltinProps<Stopper> & { conv: ConvDims; open?: number }) {
  const m = getMats(ghost);
  const o = Math.min(1, Math.max(0, open ?? live?.open ?? 0));
  const W = conv.widthM;
  const zb = W / 2 + 0.088; // シリンダ中心 Z (側面フレーム外側)
  const rise = CLOSED_TOP - o * (CLOSED_TOP - OPEN_TOP);
  const rodTop = rise - 0.014;
  const rodLen = Math.max(0.001, rodTop - BODY_TOP);
  const x0 = -(W / 2 - 0.012);
  const armLen = zb - x0;
  const shadow = !ghost;
  const tubes = useMemo(() => {
    const mk = (y: number) =>
      new TubeGeometry(
        new CatmullRomCurve3([new Vector3(0, y, zb + 0.03), new Vector3(-0.012, y - 0.004, zb + 0.034), new Vector3(-0.05, y - 0.012, zb + 0.034), new Vector3(-0.2, y - 0.03, zb + 0.034)]),
        14,
        0.003,
        5,
        false,
      );
    return [mk(-0.06), mk(-0.13)];
  }, [zb]);
  return (
    <group>
      {/* 取付プレート (側面フレーム外面) */}
      <Part g={UNIT.box} m={m.steel} p={[0, -0.075, W / 2 + 0.063]} s={[0.05, 0.1, 0.006]} />
      {/* エアシリンダ本体 */}
      <Part g={UNIT.cylY} m={m.alu} p={[0, -0.095, zb]} s={[0.022, 0.1, 0.022]} cast={shadow} />
      <Part g={UNIT.cylY} m={m.darkMetal} p={[0, -0.049, zb]} s={[0.0245, 0.012, 0.0245]} />
      <Part g={UNIT.cylY} m={m.darkMetal} p={[0, -0.141, zb]} s={[0.0245, 0.012, 0.0245]} />
      <Part g={UNIT.cylY} m={m.steel} p={[0, -0.038, zb]} s={[0.012, 0.014, 0.012]} />
      {/* ピストンロッド */}
      <Part g={UNIT.cylY} m={m.chrome} p={[0, BODY_TOP + rodLen / 2, zb]} s={[0.0055, rodLen, 0.0055]} />
      {/* エア継手 + チューブ */}
      <Part g={UNIT.cylZ} m={m.brass} p={[0, -0.06, zb + 0.026]} s={[0.006, 0.006, 0.016]} />
      <Part g={UNIT.cylZ} m={m.brass} p={[0, -0.13, zb + 0.026]} s={[0.006, 0.006, 0.016]} />
      <mesh geometry={tubes[0]} material={m.airBlue} />
      <mesh geometry={tubes[1]} material={m.airBlue} />
      {/* クレビス + アーム + ストップバー */}
      <Part g={UNIT.box} m={m.steel} p={[0, rise - 0.007, zb]} s={[0.02, 0.02, 0.02]} />
      <Part g={UNIT.box} m={m.orange} p={[0.012, rise - 0.007, (zb + x0) / 2]} s={[0.02, 0.014, armLen]} cast={shadow} />
      <Part g={UNIT.box} m={m.orange} p={[0.012, rise - 0.018, 0]} s={[0.02, 0.036, W - 0.024]} cast={shadow} />
      <Part g={UNIT.box} m={m.rubber} p={[-0.0015, rise - 0.018, 0]} s={[0.004, 0.03, W - 0.04]} />
      <HitBox p={[0.01, 0.02, 0]} s={[0.08, 0.17, W + 0.02]} />
      <HitBox p={[0, -0.09, zb]} s={[0.08, 0.17, 0.08]} />
    </group>
  );
}
