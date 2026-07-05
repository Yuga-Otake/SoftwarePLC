import { useEffect, useState } from 'react';
import { usePLCStore } from '../../store/plcStore';
import type { ResourceTask } from '../../types';

const TASK_LABELS: Record<string, string> = {
  control: '制御 (スキャン)',
  hmi: 'HMI (状態配信)',
  viz: '見える化 (トレンド)',
};

const TASK_DESCRIPTIONS: Record<string, string> = {
  control: 'PLCスキャンサイクルの実行。常に保護され、デグレードされません。',
  hmi: 'WebSocketでのフロントエンドへの状態配信。',
  viz: 'トレンド履歴のサンプリングと集約配信。',
};

function TaskCard({ task }: { task: ResourceTask }) {
  const updateResourceTask = usePLCStore((s) => s.updateResourceTask);
  const [periodMs, setPeriodMs] = useState(task.period_ms);
  const [cpuShare, setCpuShare] = useState(task.cpu_share);

  useEffect(() => setPeriodMs(task.period_ms), [task.period_ms]);
  useEffect(() => setCpuShare(task.cpu_share), [task.cpu_share]);

  const util = task.utilization_pct;
  const overShare = util > task.cpu_share;
  const utilColor = task.degraded || overShare ? '#ef4444' : util > task.cpu_share * 0.7 ? '#f59e0b' : '#22c55e';

  return (
    <div
      style={{
        background: '#111827',
        border: `1px solid ${task.degraded ? '#f59e0b80' : '#1e293b'}`,
        borderRadius: 10,
        padding: 18,
        minWidth: 300,
        flex: '1 1 300px',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>
          {TASK_LABELS[task.name] || task.name}
        </span>
        {task.protected && (
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              color: '#818cf8',
              background: '#6366f120',
              border: '1px solid #6366f150',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            保護 (制御優先)
          </span>
        )}
        {task.degraded && (
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              color: '#fbbf24',
              background: '#f59e0b20',
              border: '1px solid #f59e0b50',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            ⚠ デグレード中
          </span>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 14 }}>
        {TASK_DESCRIPTIONS[task.name] || ''}
      </div>

      {/* Utilization bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#94a3b8', marginBottom: 4 }}>
          <span>使用率</span>
          <span style={{ color: utilColor, fontWeight: 700 }}>
            {util.toFixed(1)}% / share {task.cpu_share}%
          </span>
        </div>
        <div style={{ width: '100%', height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
          <div
            style={{
              width: `${Math.min(util, 100)}%`,
              height: '100%',
              background: utilColor,
              transition: 'width 0.3s',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: `${Math.min(task.cpu_share, 100)}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: '#e2e8f0',
              opacity: 0.6,
            }}
            title={`cpu_share = ${task.cpu_share}%`}
          />
        </div>
      </div>

      {/* Period slider */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#94a3b8', marginBottom: 4 }}>
          <span>設定周期</span>
          <span style={{ color: '#cbd5e1' }}>{periodMs} ms</span>
        </div>
        <input
          type="range"
          min={task.name === 'viz' ? 100 : 10}
          max={task.name === 'viz' ? 2000 : 1000}
          step={10}
          value={periodMs}
          onChange={(e) => setPeriodMs(Number(e.target.value))}
          onMouseUp={() => updateResourceTask(task.name, { period_ms: periodMs })}
          onTouchEnd={() => updateResourceTask(task.name, { period_ms: periodMs })}
          style={{ width: '100%', accentColor: '#6366f1' }}
        />
      </div>

      {/* CPU share slider (disabled for control -- protected) */}
      <div style={{ marginBottom: 10, opacity: task.protected ? 0.5 : 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#94a3b8', marginBottom: 4 }}>
          <span>CPU share</span>
          <span style={{ color: '#cbd5e1' }}>{cpuShare}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={cpuShare}
          disabled={task.protected}
          onChange={(e) => setCpuShare(Number(e.target.value))}
          onMouseUp={() => !task.protected && updateResourceTask(task.name, { cpu_share: cpuShare })}
          onTouchEnd={() => !task.protected && updateResourceTask(task.name, { cpu_share: cpuShare })}
          style={{ width: '100%', accentColor: '#6366f1' }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#475569', marginTop: 12 }}>
        <span>
          実効周期:{' '}
          <span style={{ color: task.degraded ? '#fbbf24' : '#94a3b8', fontWeight: 700 }}>
            {task.effective_period_ms.toFixed(0)} ms
          </span>
        </span>
        <span>実行回数: {task.run_count}</span>
        <span>直近実行: {task.last_busy_ms.toFixed(2)} ms</span>
      </div>
    </div>
  );
}

export function ResourcesTab() {
  const resourceTasks = usePLCStore((s) => s.resourceTasks);
  const loadResources = usePLCStore((s) => s.loadResources);

  useEffect(() => {
    loadResources();
    const interval = setInterval(loadResources, 1000);
    return () => clearInterval(interval);
  }, []);

  const order = ['control', 'hmi', 'viz'];
  const sorted = [...resourceTasks].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 24, background: '#0a0f1a' }}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: 16, color: '#e2e8f0', margin: 0, marginBottom: 4 }}>リソース按分</h2>
        <p style={{ fontSize: 11.5, color: '#64748b', margin: 0, maxWidth: 720 }}>
          実PLCのタスク分割にならい、制御(スキャン)・HMI(状態配信)・見える化(トレンド)の
          3タスクにCPUリソースを按分します。周期・シェアの変更は即座に実際の動作(配信レート
          / サンプリングレート)に反映されます。過負荷時は制御タスクを保護し、HMI/見える化の
          実効周期が自動的に引き伸ばされます(デグレード)。詳細は docs/RESOURCES.md 参照。
        </p>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {sorted.map((t) => (
          <TaskCard key={t.name} task={t} />
        ))}
        {sorted.length === 0 && (
          <span style={{ color: '#475569', fontSize: 12 }}>読み込み中…</span>
        )}
      </div>
    </div>
  );
}
