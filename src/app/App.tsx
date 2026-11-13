import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';

export function App() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        color: '#e8eef4',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <header
        style={{
          padding: 'calc(env(safe-area-inset-top) + 10px) 16px 10px',
          background: '#1a2128',
          fontSize: 16,
          fontWeight: 600,
        }}
      >
        Conversational Factory Builder
      </header>
      <div style={{ flex: 1, minHeight: 0, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <Canvas camera={{ position: [4, 4, 6], fov: 50 }}>
          <color attach="background" args={['#101418']} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 8, 3]} intensity={1.2} />
          <Grid args={[20, 20]} cellColor="#3a4654" sectionColor="#5b6b7d" infiniteGrid fadeDistance={30} />
          <OrbitControls makeDefault />
        </Canvas>
      </div>
    </div>
  );
}
