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
