import type { Generic } from '@core/ir';
import { getMats } from './materials';
import type { BuiltinProps } from './props';

export function GenericMesh({ ghost }: BuiltinProps<Generic>) {
  const m = getMats(ghost);
  return (
    <mesh position={[0, 0.15, 0]} material={m.grey}>
      <boxGeometry args={[0.3, 0.3, 0.3]} />
    </mesh>
  );
}
