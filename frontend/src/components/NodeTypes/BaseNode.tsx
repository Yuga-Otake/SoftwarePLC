import { Handle, Position, NodeProps } from 'reactflow';
import { useState } from 'react';
import { usePLCStore } from '../../store/plcStore';

export interface PLCNodeData {
  label: string;
  nodeType: string;
  params: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

const COLORS = {
  active: '#22c55e',
  inactive: '#475569',
  activeGlow: 'rgba(34,197,94,0.25)',
  bg: '#1e293b',
  border: '#334155',
};

export function portColor(value: unknown): string {
  if (value === true) return COLORS.active;
  if (value === false) return COLORS.inactive;
  return '#f59e0b'; // numeric
}

/** Inline-editable node id (= its signal name), shown in every leaf node's
 * header. Double-click to edit; Enter/blur commits via `renameNode` (POST
 * /api/program/nodes/{id}/rename, see plc/rename.py), Escape cancels. This
 * is the "rename from the logic side" half of binding logic-design signals
 * to simulation-rig signals bidirectionally (see docs/VARIABLES.md "6. 信号
 * ハブ") -- previously there was no way to change a node's auto-generated id
 * from the UI at all. */
function SignalIdBadge({ id }: { id: string }) {
  const renameNode = usePLCStore((s) => s.renameNode);
  const renameError = usePLCStore((s) => s.renameError);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(id);
  const [busy, setBusy] = useState(false);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVal(id);
    setEditing(true);
  };

  const commit = async () => {
    const next = val.trim();
    if (!next || next === id) {
      setEditing(false);
      setVal(id);
      return;
    }
    setBusy(true);
    const result = await renameNode(id, next);
    setBusy(false);
    if (result) {
      setEditing(false);
    }
    // On failure, stay in edit mode so the user can see/fix the value;
    // renameError (surfaced by the caller-level RenameNotice) explains why.
  };

  if (editing) {
    return (
      <input
        autoFocus
        disabled={busy}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setVal(id);
            setEditing(false);
          }
        }}
        title={renameError ?? undefined}
        style={{
          background: '#0f172a',
          border: `1px solid ${renameError ? '#ef4444' : '#6366f1'}`,
          borderRadius: 4,
          color: '#e2e8f0',
          padding: '1px 5px',
          fontSize: 9.5,
          width: 90,
          fontFamily: 'ui-monospace, monospace',
        }}
      />
    );
  }

  return (
    <span
      onDoubleClick={startEdit}
      title="ダブルクリックで信号名(id)を編集"
      style={{
        color: '#64748b',
        fontSize: 9,
        fontFamily: 'ui-monospace, monospace',
        cursor: 'text',
        textDecoration: 'underline dotted',
        textUnderlineOffset: 2,
      }}
    >
      {id}
    </span>
  );
}

export function NodeWrapper({
  id,
  data,
  isActive,
  children,
  width = 120,
}: {
  id: string;
  data: PLCNodeData;
  isActive: boolean;
  children: React.ReactNode;
  width?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const deleteNode = usePLCStore((s) => s.deleteNodeFromCanvas);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width,
        background: COLORS.bg,
        border: `2px solid ${isActive ? COLORS.active : COLORS.border}`,
        borderRadius: 8,
        boxShadow: isActive ? `0 0 12px ${COLORS.activeGlow}` : '0 2px 8px rgba(0,0,0,0.4)',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        position: 'relative',
        fontSize: 11,
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          background: isActive ? 'rgba(34,197,94,0.15)' : 'rgba(71,85,105,0.3)',
          borderBottom: `1px solid ${isActive ? 'rgba(34,197,94,0.3)' : '#334155'}`,
          padding: '4px 8px',
          borderRadius: '6px 6px 0 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ color: '#94a3b8', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>
          {data.nodeType}
        </span>
        {hovered && (
          <button
            onClick={() => deleteNode(id)}
            style={{
              background: 'none',
              border: 'none',
              color: '#ef4444',
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1,
              padding: '0 2px',
            }}
            title="Delete"
          >
            ×
          </button>
        )}
      </div>

      {/* Label */}
      {data.label && (
        <div style={{ padding: '2px 8px', color: '#cbd5e1', fontSize: 10, fontWeight: 600 }}>
          {data.label}
        </div>
      )}

      {/* Signal id (rename target) */}
      <div style={{ padding: '0 8px 3px' }}>
        <SignalIdBadge id={id} />
      </div>

      {children}
    </div>
  );
}

export function InputHandle({
  id,
  top,
  value,
  label,
}: {
  id: string;
  top: number;
  value?: unknown;
  label?: string;
}) {
  return (
    <>
      {label && (
        <span
          style={{
            position: 'absolute',
            left: 12,
            top: top - 5,
            fontSize: 9,
            color: '#64748b',
            pointerEvents: 'none',
          }}
        >
          {label}
        </span>
      )}
      <Handle
        type="target"
        id={id}
        position={Position.Left}
        style={{
          top,
          background: portColor(value),
          width: 10,
          height: 10,
          border: '2px solid #1e293b',
        }}
      />
    </>
  );
}

export function OutputHandle({
  id,
  top,
  value,
  label,
}: {
  id: string;
  top: number;
  value?: unknown;
  label?: string;
}) {
  const displayVal =
    typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(0)) : null;

  return (
    <>
      {label && (
        <span
          style={{
            position: 'absolute',
            right: 12,
            top: top - 5,
            fontSize: 9,
            color: '#64748b',
            pointerEvents: 'none',
          }}
        >
          {label}
          {displayVal !== null && (
            <span style={{ color: '#f59e0b', marginLeft: 2 }}>{displayVal}</span>
          )}
        </span>
      )}
      <Handle
        type="source"
        id={id}
        position={Position.Right}
        style={{
          top,
          background: portColor(value),
          width: 10,
          height: 10,
          border: '2px solid #1e293b',
        }}
      />
    </>
  );
}
