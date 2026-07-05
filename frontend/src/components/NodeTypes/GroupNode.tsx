import { Handle, Position, NodeProps } from 'reactflow';
import { useState } from 'react';
import { usePLCStore } from '../../store/plcStore';
import { portColor } from './BaseNode';
import type { GroupPortDef } from '../../types';

const KIND_COLORS: Record<string, string> = {
  '装置': '#6366f1',
  '工程': '#0ea5e9',
  '動作': '#f59e0b',
  '機能': '#22c55e',
};
const DEFAULT_KIND_COLOR = '#a78bfa';

export interface GroupNodeData {
  label: string;
  kind: string;
  inputs: GroupPortDef[];
  outputs: GroupPortDef[];
  inputValues: Record<string, unknown>;
  outputValues: Record<string, unknown>;
  anyOn: boolean;
  blockCount: number;
}

export function GroupNode({ id, data }: NodeProps<GroupNodeData>) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(id);
  const drillDown = usePLCStore((s) => s.drillDown);
  const deleteNode = usePLCStore((s) => s.deleteNodeFromCanvas);
  const renameNode = usePLCStore((s) => s.renameNode);

  const commitRename = async () => {
    const next = renameVal.trim();
    setRenaming(false);
    if (next && next !== id) await renameNode(id, next);
    else setRenameVal(id);
  };

  const kindColor = KIND_COLORS[data.kind] || DEFAULT_KIND_COLOR;
  const portRowHeight = 22;
  const portCount = Math.max(data.inputs.length, data.outputs.length, 1);
  const bodyHeight = Math.max(64, portCount * portRowHeight + 16);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={() => drillDown(id)}
      title="ダブルクリックで中に入る"
      style={{
        width: 220,
        background: '#152033',
        border: `2.5px solid ${data.anyOn ? '#22c55e' : kindColor}`,
        borderRadius: 12,
        boxShadow: data.anyOn
          ? '0 0 18px rgba(34,197,94,0.35)'
          : '0 4px 14px rgba(0,0,0,0.45)',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        position: 'relative',
        fontSize: 11,
        userSelect: 'none',
        cursor: 'pointer',
      }}
    >
      {/* Header */}
      <div
        style={{
          background: `${kindColor}22`,
          borderBottom: `1px solid ${kindColor}55`,
          padding: '6px 10px',
          borderRadius: '10px 10px 0 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span
          style={{
            background: kindColor,
            color: '#0f172a',
            fontSize: 9,
            fontWeight: 800,
            padding: '2px 7px',
            borderRadius: 999,
            letterSpacing: 0.5,
          }}
        >
          {data.kind || 'グループ'}
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 9,
            color: data.anyOn ? '#22c55e' : '#64748b',
            fontWeight: 700,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: data.anyOn ? '#22c55e' : '#475569',
              boxShadow: data.anyOn ? '0 0 6px #22c55e' : 'none',
              display: 'inline-block',
            }}
          />
          {data.anyOn ? '稼働中' : '停止中'}
        </span>
        {hovered && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); setRenameVal(id); setRenaming(true); }}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: 11,
                lineHeight: 1,
                padding: '0 2px',
              }}
              title="信号名(id)を編集"
            >
              ✎
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); deleteNode(id); }}
              style={{
                background: 'none',
                border: 'none',
                color: '#ef4444',
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: 1,
                padding: '0 2px',
              }}
              title="Delete"
            >
              ×
            </button>
          </>
        )}
      </div>

      {/* Label + id + block count */}
      <div style={{ padding: '8px 10px 4px' }}>
        <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 700 }}>{data.label}</div>
        {renaming ? (
          <input
            autoFocus
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setRenameVal(id); setRenaming(false); }
            }}
            style={{
              marginTop: 3, background: '#0f172a', border: '1px solid #6366f1', borderRadius: 4,
              color: '#e2e8f0', padding: '1px 5px', fontSize: 9.5, width: 120, fontFamily: 'ui-monospace, monospace',
            }}
          />
        ) : (
          <div style={{ color: '#64748b', fontSize: 9, marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>{id}</div>
        )}
        <div style={{ color: '#64748b', fontSize: 9.5, marginTop: 2 }}>
          内部ブロック数: {data.blockCount}
        </div>
      </div>

      {/* Port area */}
      <div style={{ position: 'relative', height: bodyHeight, padding: '6px 0' }}>
        {data.inputs.map((p, i) => {
          const val = data.inputValues[p.id];
          const top = 12 + i * portRowHeight;
          return (
            <div key={p.id}>
              <span
                style={{
                  position: 'absolute',
                  left: 14,
                  top: top - 5,
                  fontSize: 9,
                  color: '#94a3b8',
                  pointerEvents: 'none',
                }}
              >
                {p.name || p.id}
              </span>
              <Handle
                type="target"
                id={p.id}
                position={Position.Left}
                style={{
                  top,
                  background: portColor(val),
                  width: 11,
                  height: 11,
                  border: '2px solid #152033',
                }}
              />
            </div>
          );
        })}

        {data.outputs.map((p, i) => {
          const val = data.outputValues[p.id];
          const top = 12 + i * portRowHeight;
          const numeric = typeof val === 'number';
          return (
            <div key={p.id}>
              <span
                style={{
                  position: 'absolute',
                  right: 14,
                  top: top - 5,
                  fontSize: 9,
                  color: '#94a3b8',
                  pointerEvents: 'none',
                }}
              >
                {p.name || p.id}
                {numeric && <span style={{ color: '#f59e0b', marginLeft: 3 }}>{Math.round(val as number)}</span>}
              </span>
              <Handle
                type="source"
                id={p.id}
                position={Position.Right}
                style={{
                  top,
                  background: portColor(val),
                  width: 11,
                  height: 11,
                  border: '2px solid #152033',
                }}
              />
            </div>
          );
        })}
      </div>

      <div
        style={{
          padding: '3px 10px 7px',
          color: '#475569',
          fontSize: 9,
          textAlign: 'center',
        }}
      >
        ダブルクリックで展開 ▸
      </div>
    </div>
  );
}
