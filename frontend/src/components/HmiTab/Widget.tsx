import { useState } from 'react';
import type { HmiWidget } from '../../types';
import { usePLCStore } from '../../store/plcStore';

function signalValue(signal: string, runtimeState: Record<string, Record<string, unknown>>): unknown {
  if (!signal) return undefined;
  const [nodeId, port] = signal.split('.');
  return runtimeState[nodeId]?.[port];
}

/** Writes to a signal's underlying I/O node via the same `/api/io/{node_id}`
 * endpoint the logic tab's IOPanel uses -- run-mode buttons act exactly like
 * flipping that I/O from the logic canvas. */
async function writeIo(signal: string, value: boolean) {
  const nodeId = signal.split('.')[0];
  await fetch(`/api/io/${nodeId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  }).catch(() => {});
}

export function Widget({
  widget,
  running,
  selected,
  onSelect,
}: {
  widget: HmiWidget;
  running: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const runtimeState = usePLCStore((s) => s.runtimeState);
  const ioValues = usePLCStore((s) => s.ioValues);
  const [pressed, setPressed] = useState(false);

  const raw = signalValue(widget.signal, runtimeState);
  const ioVal = widget.signal ? ioValues[widget.signal.split('.')[0]] : undefined;
  const boolVal = typeof raw === 'boolean' ? raw : ioVal ?? false;
  const numVal = typeof raw === 'number' ? raw : 0;
  const color = widget.color || '#22c55e';

  const commonBoxStyle: React.CSSProperties = {
    position: 'absolute',
    left: widget.x,
    top: widget.y,
    width: widget.w,
    height: widget.h,
    outline: selected ? '2px solid #6366f1' : 'none',
    outlineOffset: 2,
    cursor: running ? undefined : 'grab',
  };

  const handleClick = () => {
    if (!running || !widget.signal) return;
    if (widget.type === 'button_alternate') {
      writeIo(widget.signal, !boolVal);
    }
  };
  const handleDown = () => {
    if (!running || !widget.signal || widget.type !== 'button_momentary') return;
    setPressed(true);
    writeIo(widget.signal, true);
  };
  const handleUp = () => {
    if (!running || !widget.signal || widget.type !== 'button_momentary') return;
    setPressed(false);
    writeIo(widget.signal, false);
  };

  if (widget.type === 'button_momentary' || widget.type === 'button_alternate') {
    const active = widget.type === 'button_momentary' ? pressed : boolVal;
    return (
      <div
        style={commonBoxStyle}
        onClick={!running ? onSelect : undefined}
        onMouseDown={running ? handleDown : undefined}
        onMouseUp={running ? handleUp : undefined}
        onMouseLeave={running ? handleUp : undefined}
        onClickCapture={running && widget.type === 'button_alternate' ? handleClick : undefined}
      >
        <button
          disabled={!running}
          style={{
            width: '100%',
            height: '100%',
            background: active ? `${color}30` : '#0f172a',
            border: `1.5px solid ${active ? color : '#475569'}`,
            borderRadius: 8,
            color: active ? color : '#94a3b8',
            fontSize: 12,
            fontWeight: 700,
            cursor: running ? 'pointer' : 'inherit',
          }}
        >
          {widget.label || (widget.type === 'button_momentary' ? 'Momentary' : 'Alternate')}
        </button>
      </div>
    );
  }

  if (widget.type === 'lamp') {
    return (
      <div style={commonBoxStyle} onClick={!running ? onSelect : undefined}>
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: boolVal ? color : '#1e293b',
            border: `2px solid ${boolVal ? color : '#475569'}`,
            boxShadow: boolVal ? `0 0 14px ${color}` : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9.5,
            color: boolVal ? '#0f172a' : '#64748b',
            fontWeight: 700,
            textAlign: 'center',
            padding: 4,
          }}
        >
          {widget.label}
        </div>
      </div>
    );
  }

  if (widget.type === 'number') {
    return (
      <div style={commonBoxStyle} onClick={!running ? onSelect : undefined}>
        <div
          style={{
            width: '100%',
            height: '100%',
            background: '#0f172a',
            border: '1.5px solid #334155',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 9, color: '#64748b' }}>{widget.label}</span>
          <span style={{ fontSize: 16, color: '#e2e8f0', fontWeight: 700 }}>
            {typeof raw === 'number' ? raw : typeof raw === 'boolean' ? String(raw) : '--'}
          </span>
        </div>
      </div>
    );
  }

  // gauge
  const min = widget.options?.min ?? 0;
  const max = widget.options?.max ?? 100;
  const pct = Math.max(0, Math.min(1, (numVal - min) / (max - min || 1)));
  return (
    <div style={commonBoxStyle} onClick={!running ? onSelect : undefined}>
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0f172a',
          border: '1.5px solid #334155',
          borderRadius: 8,
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        <span style={{ fontSize: 9, color: '#64748b' }}>
          {widget.label} ({numVal.toFixed?.(1) ?? numVal})
        </span>
        <div style={{ width: '100%', height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct * 100}%`, height: '100%', background: color, transition: 'width 0.2s' }} />
        </div>
      </div>
    </div>
  );
}
