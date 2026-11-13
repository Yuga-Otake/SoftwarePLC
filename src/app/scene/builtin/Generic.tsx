import type { Generic } from '@core/ir';
import { getMats } from './materials';
import { Part, UNIT } from './geo';
import type { BuiltinProps } from './props';

/** 汎用オブジェクト (置物): 塗装された機械筐体 */
export function GenericMesh({ ghost }: BuiltinProps<Generic>) {
  const m = getMats(ghost);
  return (
    <group>
      <Part g={UNIT.box} m={m.paint} p={[0, 0.15, 0]} s={[0.3, 0.3, 0.3]} cast={!ghost} />
      <Part g={UNIT.box} m={m.darkMetal} p={[0, 0.005, 0]} s={[0.32, 0.01, 0.32]} />
      <Part g={UNIT.box} m={m.aluDark} p={[0, 0.296, 0]} s={[0.31, 0.008, 0.31]} />
    </group>
  );
}
