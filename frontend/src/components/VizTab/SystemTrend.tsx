import { useEffect, useRef, useState } from 'react';
import { usePLCStore } from '../../store/plcStore';

interface Point {
  t: number;
  scanMs: number;
  controlUtil: number;
  hmiUtil: number;
  vizUtil: number;
}

const WINDOW_SECONDS = 60;

/** Self-drawn trend of scan cycle time + per-task utilization, sampled
 * client-side from the live store (metrics come from the scan cycle itself;
 * resourceTasks are refreshed by ResourcesTab's poll / WS viz_update
 * messages already flowing into the store). */
export function SystemTrend() {
  const metrics = usePLCStore((s) => s.metrics);
  const resourceTasks = usePLCStore((s) => s.resourceTasks);
  const [points, setPoints] = useState<Point[]>([]);
  const lastSampleRef = useRef(0);

  useEffect(() => {
    const now = Date.now() / 1000;
    if (now - lastSampleRef.current < 0.5) return; // throttle sampling
    lastSampleRef.current = now;
    const control = resourceTasks.find((t) => t.name === 'control');
    const hmi = resourceTasks.find((t) => t.name === 'hmi');
    const viz = resourceTasks.find((t) => t.name === 'viz');
    setPoints((prev) => {
      const next = [
        ...prev,
        {
          t: now,
          scanMs: metrics?.cycle_time_ms ?? 0,
          controlUtil: control?.utilization_pct ?? 0,
          hmiUtil: hmi?.utilization_pct ?? 0,
          vizUtil: viz?.utilization_pct ?? 0,
        },
      ];
      return next.filter((p) => p.t >= now - WINDOW_SECONDS - 2);
    });
  }, [metrics, resourceTasks]);

  const width = 640;
  const height = 200;
  const padding = { left: 44, right: 12, top: 10, bottom: 20 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const nowSec = Date.now() / 1000;
  const tMin = nowSec - WINDOW_SECONDS;

  const maxUtil = 100;
  const xFor = (t: number) => padding.left + ((t - tMin) / WINDOW_SECONDS) * plotW;
  const yForPct = (v: number) => padding.top + plotH - (Math.min(v, maxUtil) / maxUtil) * plotH;

  const series: { key: keyof Point; color: string; label: string }[] = [
    { key: 'controlUtil', color: '#6366f1', label: '制御 使用率%' },
    { key: 'hmiUtil', color: '#0ea5e9', label: 'HMI 使用率%' },
    { key: 'vizUtil', color: '#f59e0b', label: '見える化 使用率%' },
  ];

  const pathFor = (key: keyof Point) => {
    const visible = points.filter((p) => p.t >= tMin - 2);
    if (visible.length === 0) return '';
    return visible
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.t)} ${yForPct(p[key] as number)}`)
      .join(' ');
  };

  return (
    <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 12 }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={padding.left} x2={width - padding.right} y1={padding.top + f * plotH} y2={padding.top + f * plotH} stroke="#1e293b" strokeWidth={1} />
        ))}
        <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} stroke="#334155" />
        <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} stroke="#334155" />
        <text x={4} y={padding.top + 4} fontSize={9} fill="#64748b">100%</text>
        <text x={4} y={height - padding.bottom} fontSize={9} fill="#64748b">0%</text>
        <text x={padding.left} y={height - 4} fontSize={9} fill="#64748b">-{WINDOW_SECONDS}s</text>
        <text x={width - padding.right - 14} y={height - 4} fontSize={9} fill="#64748b">now</text>

        {series.map((s) => (
          <path key={s.key} d={pathFor(s.key)} fill="none" stroke={s.color} strokeWidth={1.8} />
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
        {series.map((s) => (
          <span key={s.key} style={{ fontSize: 10.5, color: s.color, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 2, background: s.color, display: 'inline-block' }} />
            {s.label}
          </span>
        ))}
        <span style={{ fontSize: 10.5, color: '#94a3b8', marginLeft: 'auto' }}>
          スキャン時間: {metrics?.cycle_time_ms.toFixed(2) ?? '-'} ms
        </span>
      </div>
    </div>
  );
}
