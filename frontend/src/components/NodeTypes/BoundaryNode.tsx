import { Handle, Position, NodeProps } from 'reactflow';
import { portColor } from './BaseNode';
import type { GroupPortDef } from '../../types';

export interface BoundaryNodeData {
  label: string;
  ports: GroupPortDef[];
  values: Record<string, unknown>;
}

/** Pseudo-node rendered while drilled into a group, representing the
 * group's own boundary In ports (i.e. signals flowing in from the parent
 * level). Referenced from `children.edges` via the reserved node id
 * `$parent` (source side) — see docs/HIERARCHY.md. */
export function BoundaryInNode({ data }: NodeProps<BoundaryNodeData>) {
  const rowHeight = 24;
  return (
    <div
      style={{
        width: 150,
        background: '#0f1f2e',
        border: '2px dashed #38bdf8',
        borderRadius: 10,
        padding: '8px 0',
        position: 'relative',
        fontSize: 10,
      }}
    >
      <div style={{ color: '#38bdf8', fontWeight: 700, fontSize: 9, textAlign: 'center', marginBottom: 6 }}>
        {data.label}
      </div>
      <div style={{ position: 'relative', height: Math.max(data.ports.length, 1) * rowHeight }}>
        {data.ports.map((p, i) => {
          const val = data.values[p.id];
          const top = 12 + i * rowHeight;
          const numeric = typeof val === 'number';
          return (
            <div key={p.id}>
              <span style={{ position: 'absolute', left: 12, top: top - 5, fontSize: 9.5, color: '#cbd5e1' }}>
                {p.name || p.id}
                {numeric && <span style={{ color: '#f59e0b', marginLeft: 3 }}>{Math.round(val as number)}</span>}
              </span>
              <Handle
                type="source"
                id={p.id}
                position={Position.Right}
                style={{ top, background: portColor(val), width: 11, height: 11, border: '2px solid #0f1f2e' }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Pseudo-node for the group's boundary Out ports (signals flowing out to
 * the parent level). Referenced via `$parent` as an edge target. */
export function BoundaryOutNode({ data }: NodeProps<BoundaryNodeData>) {
  const rowHeight = 24;
  return (
    <div
      style={{
        width: 150,
        background: '#1f150f',
        border: '2px dashed #fb923c',
        borderRadius: 10,
        padding: '8px 0',
        position: 'relative',
        fontSize: 10,
      }}
    >
      <div style={{ color: '#fb923c', fontWeight: 700, fontSize: 9, textAlign: 'center', marginBottom: 6 }}>
        {data.label}
      </div>
      <div style={{ position: 'relative', height: Math.max(data.ports.length, 1) * rowHeight }}>
        {data.ports.map((p, i) => {
          const val = data.values[p.id];
          const top = 12 + i * rowHeight;
          const numeric = typeof val === 'number';
          return (
            <div key={p.id}>
              <span style={{ position: 'absolute', right: 12, top: top - 5, fontSize: 9.5, color: '#cbd5e1' }}>
                {p.name || p.id}
                {numeric && <span style={{ color: '#f59e0b', marginLeft: 3 }}>{Math.round(val as number)}</span>}
              </span>
              <Handle
                type="target"
                id={p.id}
                position={Position.Left}
                style={{ top, background: portColor(val), width: 11, height: 11, border: '2px solid #1f150f' }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
