import { useMemo } from 'react';
import { CatmullRomCurve3, TorusGeometry, TubeGeometry, Vector3 } from 'three';
import type { InspectionStation } from '@core/ir';
import { getMats } from './materials';
import { HitBox, Inst, PROFILE, Part, UNIT } from './geo';
import type { InstItem } from './geo';
import type { BuiltinProps, ConvDims } from './props';

const TOP = 0.55; // 門型フレームの梁の高さ (搬送面から)
const ringGeo = new TorusGeometry(1, 0.2, 10, 28).rotateX(Math.PI / 2);

/** 原点 = 搬送面上の検査位置。マシンビジョンセル: 門型アルミフレーム + 下向きカメラ + リング照明 + 制御箱 + 3 色シグナルタワー */
export function InspectionStationMesh({
  ghost,
  live,
  conv,
  inspecting,
  lastResult,
}: BuiltinProps<InspectionStation> & { conv: ConvDims; inspecting?: boolean; lastResult?: 'ok' | 'ng' | null }) {
  const m = getMats(ghost);
  const W = conv.widthM;
  const H = conv.heightM;
  const zc = W / 2 + 0.15; // ストッパのエアシリンダ (側面フレーム外側) を避けて外側に立てる
  const isInspecting = inspecting ?? live?.inspecting ?? false;
  const result = lastResult ?? live?.lastResult ?? null;
  const shadow = !ghost;
  const floorY = -H;
  const postLen = TOP - 0.02 - (floorY + 0.012);
  const posts = useMemo<InstItem[]>(() => [-1, 1].map((s) => [0, floorY + 0.012, s * zc, 1, postLen, 1] as InstItem), [floorY, zc, postLen]);
  const plates = useMemo<InstItem[]>(() => [-1, 1].map((s) => [0, floorY + 0.006, s * zc, 0.1, 0.012, 0.1] as InstItem), [floorY, zc]);
  const cable = useMemo(
    () =>
      new TubeGeometry(
        new CatmullRomCurve3([
          new Vector3(0.03, 0.39, zc + 0.09),
          new Vector3(0.03, TOP + 0.045, zc + 0.04),
          new Vector3(0.03, TOP + 0.045, 0.02),
          new Vector3(0.025, TOP - 0.03, 0.0),
          new Vector3(0.02, TOP - 0.06, 0.0),
        ]),
        24,
        0.003,
        5,
        false,
      ),
    [zc],
  );
  const lensY = TOP - 0.145;
  const ringY = TOP - 0.19;
  const ringMat = isInspecting ? m.ringOn : result ? m.ringIdle : m.ringOff;
  const bz = zc + 0.02 + 0.045; // 制御箱中心 Z
  const bTop = 0.39;
  return (
    <group>
      {/* 門型フレーム */}
      <Inst geometry={PROFILE.postY} material={m.alu} items={posts} castShadow={shadow} />
      <Inst geometry={UNIT.box} material={m.darkMetal} items={plates} />
      <mesh geometry={PROFILE.postZ} material={m.alu} position={[0, TOP, -zc - 0.02]} scale={[1, 1, 2 * zc + 0.04]} castShadow={shadow} />
      {/* カメラ */}
      <Part g={UNIT.box} m={m.steel} p={[0, TOP - 0.024, 0]} s={[0.07, 0.008, 0.07]} />
      <Part g={UNIT.box} m={m.aluDark} p={[0, TOP - 0.075, 0]} s={[0.055, 0.09, 0.055]} cast={shadow} />
      <Part g={UNIT.box} m={m.motor} p={[0, TOP - 0.075, 0.0285]} s={[0.04, 0.05, 0.002]} />
      <Part g={UNIT.cylY} m={m.steel} p={[0, lensY + 0.008, 0]} s={[0.024, 0.05, 0.024]} />
      <Part g={UNIT.cylY} m={m.glass} p={[0, lensY - 0.0185, 0]} s={[0.0215, 0.004, 0.0215]} />
      {/* リング照明 */}
      <mesh geometry={ringGeo} material={m.aluDark} position={[0, ringY + 0.012, 0]} scale={[0.05, 0.05, 0.05]} />
      <mesh geometry={ringGeo} material={ringMat} position={[0, ringY, 0]} scale={[0.04, 0.04, 0.04]} />
      {isInspecting && <mesh geometry={UNIT.cylY} material={m.cone} position={[0, (ringY - 0.01) / 2, 0]} scale={[0.14, ringY - 0.01, 0.14]} raycast={() => null} />}
      <mesh geometry={cable} material={m.cable} />
      {/* 制御箱 + HMI */}
      <Part g={UNIT.box} m={m.white} p={[0, 0.28, bz]} s={[0.16, 0.22, 0.09]} cast={shadow} />
      <Part g={UNIT.box} m={m.screen} p={[0, 0.315, bz + 0.0465]} s={[0.1, 0.07, 0.003]} />
      <Part g={UNIT.cylZ} m={m.greenOn} p={[-0.04, 0.23, bz + 0.047]} s={[0.008, 0.008, 0.004]} />
      <Part g={UNIT.cylZ} m={m.redOn} p={[-0.013, 0.23, bz + 0.047]} s={[0.008, 0.008, 0.004]} />
      <Part g={UNIT.cylZ} m={m.yellow} p={[0.04, 0.232, bz + 0.047]} s={[0.016, 0.016, 0.003]} />
      <Part g={UNIT.cylZ} m={m.redOn} p={[0.04, 0.232, bz + 0.0495]} s={[0.011, 0.011, 0.004]} />
      {/* シグナルタワー (緑: OK / 赤: NG / 黄: 検査中) */}
      <Part g={UNIT.cylY} m={m.plastic} p={[0, bTop + 0.01, bz]} s={[0.02, 0.02, 0.02]} />
      <Part g={UNIT.cylY} m={!isInspecting && result === 'ok' ? m.greenOn : m.greenOff} p={[0, bTop + 0.0275, bz]} s={[0.021, 0.035, 0.021]} />
      <Part g={UNIT.cylY} m={isInspecting ? m.amberOn : m.amberOff} p={[0, bTop + 0.0625, bz]} s={[0.021, 0.035, 0.021]} />
      <Part g={UNIT.cylY} m={!isInspecting && result === 'ng' ? m.redOn : m.redOff} p={[0, bTop + 0.0975, bz]} s={[0.021, 0.035, 0.021]} />
      <Part g={UNIT.cylY} m={m.plastic} p={[0, bTop + 0.12, bz]} s={[0.018, 0.01, 0.018]} />
      <HitBox p={[0, TOP - 0.1, 0]} s={[0.12, 0.2, 0.12]} />
    </group>
  );
}
