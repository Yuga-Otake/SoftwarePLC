const PALETTE_ITEMS = [
  { type: 'DigitalInput',  label: 'Input',   color: '#0ea5e9', desc: 'Digital input signal' },
  { type: 'DigitalOutput', label: 'Output',  color: '#f97316', desc: 'Digital output signal' },
  { type: 'AND',           label: 'AND',     color: '#8b5cf6', desc: 'Logical AND gate' },
  { type: 'OR',            label: 'OR',      color: '#8b5cf6', desc: 'Logical OR gate' },
  { type: 'NOT',           label: 'NOT',     color: '#8b5cf6', desc: 'Logical NOT (inverter)' },
  { type: 'TON',           label: 'TON',     color: '#f59e0b', desc: 'On-delay timer' },
  { type: 'TOFF',          label: 'TOFF',    color: '#f59e0b', desc: 'Off-delay timer' },
  { type: 'CTU',           label: 'CTU',     color: '#6366f1', desc: 'Count-up counter' },
  { type: 'SR',            label: 'SR',      color: '#22c55e', desc: 'Set-dominant flip-flop' },
  { type: 'RS',            label: 'RS',      color: '#22c55e', desc: 'Reset-dominant flip-flop' },
  { type: 'COMP',          label: 'COMP',    color: '#ec4899', desc: 'Numeric comparator' },
];

export function BlockPalette() {
  const onDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('blockType', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        padding: '6px 12px',
        background: '#1e293b',
        borderBottom: '1px solid #334155',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <span style={{ fontSize: 10, color: '#64748b', marginRight: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
        Blocks
      </span>
      {PALETTE_ITEMS.map((item) => (
        <div
          key={item.type}
          draggable
          onDragStart={(e) => onDragStart(e, item.type)}
          title={item.desc}
          style={{
            padding: '3px 10px',
            background: '#0f172a',
            border: `1px solid ${item.color}40`,
            borderRadius: 5,
            fontSize: 11,
            color: item.color,
            cursor: 'grab',
            userSelect: 'none',
            transition: 'border-color 0.15s, background 0.15s',
            fontWeight: 600,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = `${item.color}20`;
            (e.currentTarget as HTMLDivElement).style.borderColor = item.color;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = '#0f172a';
            (e.currentTarget as HTMLDivElement).style.borderColor = `${item.color}40`;
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
