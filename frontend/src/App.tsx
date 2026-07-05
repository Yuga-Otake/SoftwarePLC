import { useEffect } from 'react';
import { usePLCStore } from './store/plcStore';
import { BlockCanvas } from './components/BlockCanvas';
import { BlockPalette } from './components/BlockPalette';
import { IOPanel } from './components/IOPanel';
import { AIPanel } from './components/AIPanel';
import { PerformanceBar } from './components/PerformanceBar';
import { Breadcrumb } from './components/Breadcrumb';
import { TabBar } from './components/TabBar';
import { HmiTab } from './components/HmiTab';
import { VizTab } from './components/VizTab';
import { ResourcesTab } from './components/ResourcesTab';
import { NetworkTab } from './components/NetworkTab';
import { SimulationTab } from './components/SimulationTab';
import { VariablesModal } from './components/VariablesModal';
import { RenameNotice } from './components/RenameNotice';

export default function App() {
  const loadProgram = usePLCStore((s) => s.loadProgram);
  const loadCatalog = usePLCStore((s) => s.loadCatalog);
  const loadIoValues = usePLCStore((s) => s.loadIoValues);
  const loadVariables = usePLCStore((s) => s.loadVariables);
  const connectWS = usePLCStore((s) => s.connectWS);
  const activeTab = usePLCStore((s) => s.activeTab);

  useEffect(() => {
    connectWS();
    loadCatalog();
    loadProgram();
    loadIoValues();
    // Load eagerly (not just when the variables modal opens) so the
    // VAR_READ/VAR_WRITE node pickers on the logic canvas have the variable
    // list available immediately, without requiring the user to first open
    // the variables modal once.
    loadVariables();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TabBar />

      {/* Logic design tab: existing UI, kept mounted-but-hidden isn't needed --
          it's cheap to remount and this keeps WS-driven state (zustand store)
          shared across tabs without double connections. */}
      {activeTab === 'logic' && (
        <>
          {/* Top palette bar */}
          <BlockPalette />

          {/* Main content */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Canvas area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <Breadcrumb />
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
        </>
      )}

      {activeTab === 'hmi' && <HmiTab />}
      {activeTab === 'viz' && <VizTab />}
      {activeTab === 'resources' && <ResourcesTab />}
      {activeTab === 'network' && <NetworkTab />}
      {activeTab === 'simulation' && <SimulationTab />}

      <VariablesModal />
      <RenameNotice />

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
