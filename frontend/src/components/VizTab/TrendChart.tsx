import { useEffect, useRef, useState } from 'react';
import { usePLCStore } from '../../store/plcStore';

interface Sample {
  t: number; // seconds
  value: number | boolean;
}

const COLORS = ['#22c55e', '#0ea5e9', '#f59e0b', '#ec4899', '#a78bfa', '#f43f5e'];

/** Lightweight self-drawn SVG polyline trend chart -- no charting library
 * dependency. Booleans are drawn as a step waveform (0/1 rail); numerics are
 * scaled to the chart's min/max. Fetches ring-buffer history from
 * `/api/viz/history` on mount/signal change, then keeps appending live
 * samples as `runtimeState` changes via the WS-fed store. */
export function TrendChart({ signals, height = 220 }: { signals: string[]; height?: number }) {
  const runtimeState = usePLCStore((s) => s.runtimeState);
  const [seriesBySignal, setSeriesBySignal] = useState<Record<string, Sample[]>>({});
  const windowSeconds = 60;
  const lastFetchedRef = useRef<Record<string, number>>({});

  // Initial + periodic backfill from the server ring buffer (covers cases
  // where the tab was just opened and missed earlier live updates).
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      for (const sig of signals) {
        try {
          const res = await fetch(`/api/viz/history?signal=${encodeURIComponent(sig)}&since_ms=0`);
          if (!res.ok) continue;
          const body = await res.json();
          if (cancelled) return;
          setSeriesBySignal((prev) => ({ ...prev, [sig]: body.samples }));
          lastFetchedRef.current[sig] = Date.now();
        } catch {
          /* ignore */
        }
      }
    };
    fetchAll();
    const interval = setInterval(fetchAll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [signals.join(',')]);

  // Append live samples as scan-driven runtime state changes (finer-grained
  // than the viz task's own sampling, giving a responsive live edge).
  useEffect(() => {
    const now = Date.now() / 1000;
    setSeriesBySignal((prev) => {
      const next = { ...prev };
      for (const sig of signals) {
        const [nodeId, port] = sig.split('.');
        const val = runtimeState[nodeId]?.[port];
        if (typeof val !== 'boolean' && typeof val !== 'number') continue;
        const arr = next[sig] ? [...next[sig]] : [];
        const last = arr[arr.length - 1];
        if (!last || last.value !== val) {
          arr.push({ t: now, value: val });
          if (arr.length > 3000) arr.shift();
          next[sig] = arr;
        }
      }
      return next;
    });
  }, [runtimeState, signals.join(',')]);

  const width = 640;
  const padding = { left: 44, right: 12, top: 10, bottom: 20 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;
  const nowSec = Date.now() / 1000;
  const tMin = nowSec - windowSeconds;

  return (
    <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 10, padding: 12 }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: 'block' }}>
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + f * plotH}
            y2={padding.top + f * plotH}
            stroke="#1e293b"
            strokeWidth={1}
          />
        ))}
        <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} stroke="#334155" />
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={height - padding.bottom}
          y2={height - padding.bottom}
          stroke="#334155"
        />
        <text x={4} y={padding.top + 4} fontSize={9} fill="#64748b">1</text>
        <text x={4} y={height - padding.bottom} fontSize={9} fill="#64748b">0</text>
        <text x={padding.left} y={height - 4} fontSize={9} fill="#64748b">-{windowSeconds}s</text>
        <text x={width - padding.right - 14} y={height - 4} fontSize={9} fill="#64748b">now</text>

        {signals.map((sig, idx) => {
          const color = COLORS[idx % COLORS.length];
          const samples = (seriesBySignal[sig] || []).filter((s) => s.t >= tMin - 2);
          if (samples.length === 0) return null;

          const isBool = typeof samples[0].value === 'boolean';
          const numeric = samples.map((s) => (typeof s.value === 'boolean' ? (s.value ? 1 : 0) : s.value));
          const vMin = isBool ? 0 : Math.min(...numeric, 0);
          const vMax = isBool ? 1 : Math.max(...numeric, 1);
          const range = vMax - vMin || 1;

          const xFor = (t: number) => padding.left + ((t - tMin) / windowSeconds) * plotW;
          const yFor = (v: number) => padding.top + plotH - ((v - vMin) / range) * plotH;

          // Step waveform for bool, linear for numeric.
          let d = '';
          samples.forEach((s, i) => {
            const x = xFor(s.t);
            const v = typeof s.value === 'boolean' ? (s.value ? 1 : 0) : s.value;
            const y = yFor(v);
            if (i === 0) {
              d += `M ${x} ${y}`;
            } else if (isBool) {
              const prevV = typeof samples[i - 1].value === 'boolean' ? (samples[i - 1].value ? 1 : 0) : (samples[i - 1].value as number);
              d += ` L ${x} ${yFor(prevV)} L ${x} ${y}`;
            } else {
              d += ` L ${x} ${y}`;
            }
          });
          // Extend the last value to "now".
          const lastV = typeof samples[samples.length - 1].value === 'boolean'
            ? (samples[samples.length - 1].value ? 1 : 0)
            : (samples[samples.length - 1].value as number);
          d += ` L ${xFor(nowSec)} ${yFor(lastV)}`;

          return <path key={sig} d={d} fill="none" stroke={color} strokeWidth={1.8} />;
        })}
      </svg>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
        {signals.map((sig, idx) => (
          <span key={sig} style={{ fontSize: 10.5, color: COLORS[idx % COLORS.length], display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 2, background: COLORS[idx % COLORS.length], display: 'inline-block' }} />
            {sig}
          </span>
        ))}
      </div>
    </div>
  );
}
