import { usePLCStore } from '../../store/plcStore';
import type { HmiWidget } from '../../types';
import { widgetTypeLabel } from './widgetDefs';

export function PropertiesPanel({
  widget,
  onChange,
  onDelete,
}: {
  widget: HmiWidget | null;
  onChange: (patch: Partial<HmiWidget>) => void;
  onDelete: () => void;
}) {
  const signals = usePLCStore((s) => s.signals);

  const isButton = widget?.type === 'button_momentary' || widget?.type === 'button_alternate';
  const relevantSignals = isButton
    ? signals.filter((s) => s.data_type === 'bool')
    : widget?.type === 'lamp'
    ? signals.filter((s) => s.data_type === 'bool')
    : signals;

  return (
    <div
      style={{
        width: 260,
        minWidth: 240,
        background: '#111827',
        borderLeft: '1px solid #1e293b',
        padding: 14,
        overflow: 'auto',
      }}
    >
      <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
        プロパティ
      </span>
      {!widget ? (
        <div style={{ fontSize: 11.5, color: '#475569', marginTop: 10 }}>
          ウィジェットを選択するとここで編集できます。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 700 }}>{widgetTypeLabel(widget.type)}</div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#64748b' }}>ラベル</span>
            <input
              value={widget.label}
              onChange={(e) => onChange({ label: e.target.value })}
              style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#64748b' }}>信号バインド</span>
            <select
              value={widget.signal}
              onChange={(e) => onChange({ signal: e.target.value })}
              style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}
            >
              <option value="">(未設定)</option>
              {relevantSignals.map((s) => (
                <option key={s.path} value={s.path}>
                  {s.path} ({s.data_type})
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#64748b' }}>色</span>
            <input
              type="color"
              value={widget.color || '#22c55e'}
              onChange={(e) => onChange({ color: e.target.value })}
              style={{ width: '100%', height: 28, background: '#0f172a', border: '1px solid #334155', borderRadius: 5 }}
            />
          </label>

          {widget.type === 'gauge' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                <span style={{ fontSize: 10, color: '#64748b' }}>最小値</span>
                <input
                  type="number"
                  value={widget.options?.min ?? 0}
                  onChange={(e) => onChange({ options: { ...widget.options, min: Number(e.target.value) } })}
                  style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                <span style={{ fontSize: 10, color: '#64748b' }}>最大値</span>
                <input
                  type="number"
                  value={widget.options?.max ?? 100}
                  onChange={(e) => onChange({ options: { ...widget.options, max: Number(e.target.value) } })}
                  style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}
                />
              </label>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              <span style={{ fontSize: 10, color: '#64748b' }}>幅</span>
              <input
                type="number"
                value={widget.w}
                onChange={(e) => onChange({ w: Number(e.target.value) })}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              <span style={{ fontSize: 10, color: '#64748b' }}>高さ</span>
              <input
                type="number"
                value={widget.h}
                onChange={(e) => onChange({ h: Number(e.target.value) })}
                style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}
              />
            </label>
          </div>

          <button
            onClick={onDelete}
            style={{
              background: '#ef444420',
              border: '1px solid #ef4444',
              borderRadius: 6,
              color: '#fca5a5',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
              padding: '6px 10px',
              marginTop: 8,
            }}
          >
            ウィジェットを削除
          </button>
        </div>
      )}
    </div>
  );
}
