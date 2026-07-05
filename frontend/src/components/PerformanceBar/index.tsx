import { useState, useEffect } from 'react';
import { usePLCStore } from '../../store/plcStore';

export function PerformanceBar() {
  const metrics = usePLCStore((s) => s.metrics);
  const wsConnected = usePLCStore((s) => s.wsConnected);
  const runtimeConfig = usePLCStore((s) => s.runtimeConfig);
  const updateRuntimeConfig = usePLCStore((s) => s.updateRuntimeConfig);

  const [expanded, setExpanded] = useState(false);
  const [sliderMs, setSliderMs] = useState(100);

  // Sync slider when config loads
  useEffect(() => {
    if (runtimeConfig) setSliderMs(runtimeConfig.scan_interval_ms);
  }, [runtimeConfig?.scan_interval_ms]);

  // Load config once on mount
  useEffect(() => {
    fetch('/api/runtime/config')
      .then((r) => r.json())
      .then((d) => {
        usePLCStore.setState({ runtimeConfig: d });
        setSliderMs(d.scan_interval_ms);
      })
      .catch(() => {});
  }, []);

  const util = metrics?.utilization_pct ?? 0;
  const utilColor = util > 80 ? '#ef4444' : util > 50 ? '#f59e0b' : '#22c55e';

  const handleApply = () => updateRuntimeConfig(sliderMs);

  return (
    <div style={{ background: '#0f172a', borderTop: '1px solid #1e293b' }}>
      {/* Expanded detail panel */}
      {expanded && (
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
            スキャン周期
          </span>
          <input
            type="range"
            min={10}
            max={1000}
            step={10}
            value={sliderMs}
            onChange={(e) => setSliderMs(Number(e.target.value))}
            style={{ width: 140, accentColor: '#6366f1' }}
          />
          <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 52 }}>
            {sliderMs} ms
          </span>
          <button
            onClick={handleApply}
            style={{
              background: '#4f46e520',
              border: '1px solid #6366f1',
              borderRadius: 5,
              color: '#a5b4fc',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '3px 12px',
            }}
          >
            適用
          </button>
          {runtimeConfig && (
            <span style={{ fontSize: 10, color: '#475569' }}>
              現在: {runtimeConfig.scan_interval_ms} ms
            </span>
          )}
        </div>
      )}

      {/* Status bar */}
      <div
        style={{
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
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>
                Scan: <span style={{ color: '#94a3b8' }}>{metrics.cycle_time_ms.toFixed(1)}ms</span>{' '}
                / {metrics.target_cycle_ms}ms
              </span>
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

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? '閉じる' : 'スキャン周期を調整する'}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: 'none',
            color: '#475569',
            cursor: 'pointer',
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 3,
          }}
        >
          {expanded ? '▼ 閉じる' : '▶ 設定'}
        </button>
      </div>
    </div>
  );
}
