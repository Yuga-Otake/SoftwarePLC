import { AdditiveBlending, Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial } from 'three';

type Std = ConstructorParameters<typeof MeshStandardMaterial>[0];

/** 設備共通の PBR マテリアル一式。ghost (提案中) は半透明版を別に持つ。ジオメトリ/マテリアルは全設備で共有する */
function make(ghost: boolean) {
  const g: Std = ghost ? { transparent: true, opacity: 0.35, depthWrite: false } : {};
  const m = (color: string, roughness: number, metalness: number, extra: Std = {}) =>
    new MeshStandardMaterial({ color, roughness, metalness, ...g, ...extra });
  const lamp = (color: string, on: boolean) =>
    m(on ? color : '#' + new Color(color).multiplyScalar(0.3).getHexString(), 0.35, 0, {
      emissive: color,
      emissiveIntensity: on ? 2.6 : 0.03,
    });
  const beam = (opacity: number) =>
    new MeshBasicMaterial({
      color: '#ff2a2a',
      transparent: true,
      opacity: ghost ? opacity * 0.4 : opacity,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  return {
    alu: m('#c4cbd3', 0.38, 0.9),
    aluDark: m('#3f464e', 0.5, 0.7),
    steel: m('#aab2bb', 0.42, 0.85),
    stainless: m('#d7dce1', 0.3, 0.95),
    chrome: m('#eef1f3', 0.15, 1),
    brass: m('#c9a047', 0.35, 0.9),
    paint: m('#8d97a2', 0.55, 0.35),
    darkMetal: m('#3a424b', 0.6, 0.5),
    plastic: m('#1b1f24', 0.6, 0),
    rubber: m('#15181b', 0.92, 0),
    white: m('#d8dde2', 0.5, 0.1),
    motor: m('#2f66ad', 0.42, 0.45),
    gearbox: m('#99a5b1', 0.5, 0.6),
    yellow: m('#f2c200', 0.55, 0),
    yellowFlat: m('#f2c200', 0.6, 0, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    orange: m('#e8741f', 0.5, 0.2),
    airBlue: m('#2a7de0', 0.4, 0),
    cable: m('#15181b', 0.7, 0),
    sensorBody: m('#1f5fae', 0.4, 0.3),
    glass: m('#0b1016', 0.06, 0.2),
    reflector: m('#d1202a', 0.3, 0.1),
    screen: m('#0e2a3d', 0.3, 0, { emissive: '#1d79b8', emissiveIntensity: 0.9 }),
    beamIdle: beam(0.5),
    beamOn: beam(1),
    ledOff: lamp('#ff9a1f', false),
    ledOn: lamp('#ff9a1f', true),
    greenOff: lamp('#25d16f', false),
    greenOn: lamp('#25d16f', true),
    amberOff: lamp('#ffb81f', false),
    amberOn: lamp('#ffb81f', true),
    redOff: lamp('#ff3b36', false),
    redOn: lamp('#ff3b36', true),
    ringOff: m('#cfd6dd', 0.4, 0, { emissive: '#ffffff', emissiveIntensity: 0.25 }),
    ringIdle: m('#e9eef2', 0.4, 0, { emissive: '#ffffff', emissiveIntensity: 0.9 }),
    ringOn: m('#fff3c8', 0.4, 0, { emissive: '#fff0b0', emissiveIntensity: 3.2 }),
    cone: new MeshBasicMaterial({ color: '#ffe9a0', transparent: true, opacity: ghost ? 0.05 : 0.13, depthWrite: false, side: DoubleSide, toneMapped: false }),
  };
}

export type Mats = ReturnType<typeof make>;
let solid: Mats | null = null;
let ghostSet: Mats | null = null;
export const getMats = (isGhost: boolean): Mats => (isGhost ? (ghostSet ??= make(true)) : (solid ??= make(false)));

export const GHOST_OPACITY = 0.35;
