import { useEffect, useMemo } from 'react';
import { MeshStandardMaterial } from 'three';
import { makeFloorTexture, makeSkyTexture } from './builtin/textures';

/** エポキシ塗床コンクリート (手続きテクスチャ)。グリッドより僅かに下に置く */
export function Floor({ receive }: { receive: boolean }) {
  const mat = useMemo(() => {
    const map = makeFloorTexture();
    map.repeat.set(20, 20); // 4 m タイル x 20 = 80 m
    return new MeshStandardMaterial({ map, roughness: 0.42, metalness: 0.15, envMapIntensity: 0.6 });
  }, []);
  useEffect(
    () => () => {
      mat.map?.dispose();
      mat.dispose();
    },
    [mat],
  );
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} material={mat} receiveShadow={receive} raycast={() => null}>
      <planeGeometry args={[80, 80]} />
    </mesh>
  );
}

/** 背景 (縦グラデーション) */
export function SkyBackground() {
  const tex = useMemo(() => makeSkyTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  return <primitive object={tex} attach="background" />;
}
