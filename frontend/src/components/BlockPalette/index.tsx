import { useState } from 'react';
import { usePLCStore } from '../../store/plcStore';
import { CustomBlockEditor } from '../CustomBlockEditor';
import type { NodeCatalogEntry } from '../../types';

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

function PaletteChip({
  type, label, color, desc, onDragStart,
}: { type: string; label: string; color: string; desc: string; onDragStart: (e: React.DragEvent, type: string) => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, type)}
      title={desc}
      style={{
        padding: '3px 10px',
        background: '#0f172a',
        border: `1px solid ${color}40`,
        borderRadius: 5,
        fontSize: 11,
        color,
        cursor: 'grab',
        userSelect: 'none',
        transition: 'border-color 0.15s, background 0.15s',
        fontWeight: 600,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = `${color}20`;
        (e.currentTarget as HTMLDivElement).style.borderColor = color;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = '#0f172a';
        (e.currentTarget as HTMLDivElement).style.borderColor = `${color}40`;
      }}
    >
      {label}
    </div>
  );
}

function CustomChip({
  entry,
  onDragStart,
  onDelete,
}: {
  entry: NodeCatalogEntry;
  onDragStart: (e: React.DragEvent, type: string) => void;
  onDelete: (type: string) => void;
}) {
  const color = entry.icon_color || '#a78bfa';
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        draggable
        onDragStart={(e) => onDragStart(e, entry.type)}
        title={`${entry.description || ''}${entry.created_by === 'ai' ? ' (AI生成)' : ''}`}
        style={{
          padding: '3px 22px 3px 10px',
          background: hover ? `${color}20` : '#0f172a',
          border: `1px solid ${hover ? color : color + '40'}`,
          borderRadius: 5,
          fontSize: 11,
          color,
          cursor: 'grab',
          userSelect: 'none',
          fontWeight: 600,
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        {entry.label || entry.type}
      </div>
      {hover && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(entry.type); }}
          title="カスタムブロックを削除"
          style={{
            position: 'absolute',
            right: 3,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 14,
            height: 14,
            background: '#ef444430',
            border: '1px solid #ef4444',
            borderRadius: 3,
            color: '#fca5a5',
            cursor: 'pointer',
            fontSize: 9,
            lineHeight: 1,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function BlockPalette() {
  const catalog = usePLCStore((s) => s.catalog);
  const deleteCustomBlock = usePLCStore((s) => s.deleteCustomBlock);
  const [editorOpen, setEditorOpen] = useState(false);

  const onDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('blockType', type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const customEntries = Object.values(catalog).filter((c) => c.is_custom);

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
        <PaletteChip key={item.type} {...item} onDragStart={onDragStart} />
      ))}

      {customEntries.length > 0 && (
        <>
          <span style={{ width: 1, height: 16, background: '#334155', margin: '0 4px' }} />
          <span style={{ fontSize: 9, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 1 }}>
            🐍 Custom
          </span>
          {customEntries.map((c) => (
            <CustomChip
              key={c.type}
              entry={c}
              onDragStart={onDragStart}
              onDelete={deleteCustomBlock}
            />
          ))}
        </>
      )}

      <button
        onClick={() => setEditorOpen(true)}
        title="Pythonコードでブロックを自作する"
        style={{
          marginLeft: 'auto',
          background: 'transparent',
          border: '1px dashed #7c3aed80',
          borderRadius: 5,
          color: '#a78bfa',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          padding: '3px 10px',
        }}
      >
        + コードでブロックを作る
      </button>

      {editorOpen && <CustomBlockEditor onClose={() => setEditorOpen(false)} />}
    </div>
  );
}
