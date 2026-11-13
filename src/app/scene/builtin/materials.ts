import { DoubleSide, MeshStandardMaterial } from 'three';

function make(ghost: boolean) {
  const m = (color: string, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) =>
    new MeshStandardMaterial({
      color,
      roughness: 0.6,
      metalness: 0.3,
      ...(ghost ? { transparent: true, opacity: 0.35, depthWrite: false } : {}),
      ...extra,
    });
  return {
    frame: m('#8a96a3', { metalness: 0.6, roughness: 0.45 }),
    belt: m('#2b3138', { roughness: 0.9, metalness: 0.05 }),
    chevron: m('#e9b44c', { roughness: 0.8, metalness: 0 }),
    dark: m('#3b444e'),
    steel: m('#b9c2cc', { metalness: 0.7, roughness: 0.35 }),
    blue: m('#3d7fd6', { side: DoubleSide }),
    orange: m('#e07b2f'),
    grey: m('#9aa3ad'),
    lens: m('#0b0e12', { metalness: 0.9, roughness: 0.2 }),
    beam: m('#ff3b3b', { emissive: '#ff2020', emissiveIntensity: 1.2, roughness: 1, metalness: 0 }),
  };
}

export type Mats = ReturnType<typeof make>;
const solid = make(false);
const ghost = make(true);
export const getMats = (isGhost: boolean): Mats => (isGhost ? ghost : solid);
