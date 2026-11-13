import type { LiveState } from '../live';

export interface BuiltinProps<E> {
  eq: E;
  ghost: boolean;
  live?: LiveState;
}

/** コンベヤ取付設備が参照するコンベヤ寸法 (未スケール) */
export interface ConvDims {
  widthM: number;
  heightM: number;
  lengthM: number;
}
