import { useEffect, useState } from 'react';
import { usePLCStore } from '../../store/plcStore';
import { TrendChart } from './TrendChart';
import { StatusBoard } from './StatusBoard';
import { SystemTrend } from './SystemTrend';

export function VizTab() {
  const signals = usePLCStore((s) => s.signals);
  const loadSignals = usePLCStore((s) => s.loadSignals);
  const [selected, setSelected] = useState<string[]>([]);
  const [picker, setPicker] = useState('');

  useEffect(() => {
    loadSignals();
    const interval = setInterval(loadSignals, 5000);
    return () => clearInterval(interval);
  }, []);

  const addSignal = (path: string) => {
    if (!path || selected.includes(path)) return;
    setSelected((s) => [...s, path]);
    setPicker('');
  };

  const removeSignal = (path: string) => {
    setSelected((s) => s.filter((p) => p !== path));
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 24, background: '#0a0f1a', display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Trend graphs */}
      <section>
        <h2 style={{ fontSize: 15, color: '#e2e8f0', margin: 0, marginBottom: 10 }}>信号トレンド</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <select
            value={picker}
            onChange={(e) => addSignal(e.target.value)}
            style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 5,
              color: '#94a3b8',
              fontSize: 11,
              padding: '4px 8px',
            }}
          >
            <option value="">監視する信号を追加…</option>
            {signals.map((s) => (
              <option key={s.path} value={s.path}>
                {s.path} ({s.data_type})
              </option>
            ))}
          </select>
          {selected.map((sig) => (
            <span
              key={sig}
              style={{
                fontSize: 10.5,
                color: '#cbd5e1',
                background: '#1e293b',
                borderRadius: 5,
                padding: '3px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {sig}
              <button
                onClick={() => removeSignal(sig)}
                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11, padding: 0 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {selected.length > 0 ? (
          <TrendChart signals={selected} />
        ) : (
          <div style={{ fontSize: 11.5, color: '#475569' }}>
            上のドロップダウンから信号を選ぶとトレンドグラフが表示されます(ブール信号はステップ波形)。
          </div>
        )}
      </section>

      {/* Status board */}
      <section>
        <h2 style={{ fontSize: 15, color: '#e2e8f0', margin: 0, marginBottom: 10 }}>稼働状況ボード</h2>
        <StatusBoard />
      </section>

      {/* System trend */}
      <section>
        <h2 style={{ fontSize: 15, color: '#e2e8f0', margin: 0, marginBottom: 10 }}>システムトレンド (スキャン時間 / タスク使用率)</h2>
        <SystemTrend />
      </section>
    </div>
  );
}
