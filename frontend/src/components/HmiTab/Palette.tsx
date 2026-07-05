import { WIDGET_PALETTE } from './widgetDefs';
import type { HmiWidgetType } from '../../types';

export function Palette() {
  const onDragStart = (e: React.DragEvent, type: HmiWidgetType) => {
    e.dataTransfer.setData('hmiWidgetType', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      style={{
        width: 190,
        minWidth: 190,
        background: '#111827',
        borderRight: '1px solid #1e293b',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflow: 'auto',
      }}
    >
      <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
        ウィジェット
      </span>
      {WIDGET_PALETTE.map((w) => (
        <div
          key={w.type}
          draggable
          onDragStart={(e) => onDragStart(e, w.type)}
          style={{
            padding: '8px 10px',
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 6,
            fontSize: 11,
            color: '#cbd5e1',
            cursor: 'grab',
            userSelect: 'none',
          }}
        >
          {w.label}
        </div>
      ))}
      <div style={{ fontSize: 10, color: '#475569', marginTop: 10, lineHeight: 1.5 }}>
        ドラッグしてキャンバスへドロップ、または配置後にプロパティパネルで信号バインドを設定してください。
      </div>
    </div>
  );
}
