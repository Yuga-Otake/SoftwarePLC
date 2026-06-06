import { useState } from 'react';
import { usePLCStore } from '../../store/plcStore';

export function PerformanceBar() {
  const metrics = usePLCStore((s) => s.metrics);
  const wsConnected = usePLCStore((s) => s.wsConnected);
  const [expanded, setExpanded] = useState(false);

  const util = metrics?.utilization_pct ?? 0;
  const utilColor = util > 80 ? '#ef4444' : util > 50 ? '#f59e0b' : '#22c55e';

  return (
    <div
      style={{
        background: '#0f172a',
        borderTop: '1px solid #1e293b',
        padding: '3px 12px',
        fontSize: 10,
        color: '#64748b',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      {/* WS status */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: wsConnected ? '#22c55e' : '#ef4444',
            display: 'inline-block',
          }}
        />
        {wsConnected ? 'Connected' : 'Disconnected'}
      </span>

      {metrics && (
        <>
          {/* Scan utilization bar */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Scan: <span style={{ color: '#94a3b8' }}>{metrics.cycle_time_ms.toFixed(1)}ms</span> / {metrics.target_cycle_ms}ms</span>
            <div style={{ width: 60, height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(util, 100)}%`,
                  height: '100%',
                  background: utilColor,
                  borderRadius: 2,
                  transition: 'width 0.3s',
                }}
              />
            </div>
            <span style={{ color: utilColor }}>{util.toFixed(0)}%</span>
          </span>

          <span>Nodes: <span style={{ color: '#94a3b8' }}>{metrics.nodes_evaluated}</span></span>
          <span>RAM: <span style={{ color: '#94a3b8' }}>{metrics.memory_mb.toFixed(1)} MB</span></span>
          <span>Scan#: <span style={{ color: '#94a3b8' }}>{metrics.scan_index}</span></span>
        </>
      )}
    </div>
  );
}
