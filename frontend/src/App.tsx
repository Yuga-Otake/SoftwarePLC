import { useEffect } from 'react';
import { usePLCStore } from './store/plcStore';
import { BlockCanvas } from './components/BlockCanvas';
import { BlockPalette } from './components/BlockPalette';
import { IOPanel } from './components/IOPanel';
import { AIPanel } from './components/AIPanel';
import { PerformanceBar } from './components/PerformanceBar';

export default function App() {
  const loadProgram = usePLCStore((s) => s.loadProgram);
  const loadCatalog = usePLCStore((s) => s.loadCatalog);
  const loadIoValues = usePLCStore((s) => s.loadIoValues);
  const connectWS = usePLCStore((s) => s.connectWS);

  useEffect(() => {
    connectWS();
    loadCatalog();
    loadProgram();
    loadIoValues();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Top palette bar */}
      <BlockPalette />

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Canvas area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <BlockCanvas />
          </div>
          <IOPanel />
        </div>

        {/* Right panel - AI */}
        <div style={{ width: 300, minWidth: 260, flexShrink: 0 }}>
          <AIPanel />
        </div>
      </div>

      {/* Bottom status bar */}
      <PerformanceBar />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .react-flow__edge-path {
          transition: stroke 0.15s;
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
      `}</style>
    </div>
  );
}
