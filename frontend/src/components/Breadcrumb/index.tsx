import { usePLCStore } from '../../store/plcStore';

/** Drill-down breadcrumb bar: "ルート > 搬送装置 > 供給工程". Each crumb (and
 * the root button) jumps back to that depth in `currentPath` via
 * `navigateToDepth`. Only rendered content — resolution of labels comes from
 * walking `programTree` down `currentPath` (mirrors `resolveSubtree` in the
 * store, kept local here since it's presentation-only). */
export function Breadcrumb() {
  const programTree = usePLCStore((s) => s.programTree);
  const currentPath = usePLCStore((s) => s.currentPath);
  const navigateToDepth = usePLCStore((s) => s.navigateToDepth);

  if (currentPath.length === 0) return null;

  const crumbs: { id: string; label: string }[] = [];
  let graph = programTree;
  for (const groupId of currentPath) {
    const group = graph.nodes.find((n) => n.id === groupId && n.type === 'group');
    if (!group) break;
    crumbs.push({ id: group.id, label: group.label || group.id });
    graph = group.children ?? { nodes: [], edges: [] };
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 14px',
        background: '#141d2e',
        borderBottom: '1px solid #263248',
        fontSize: 11.5,
        flexWrap: 'wrap',
      }}
    >
      <button
        onClick={() => navigateToDepth(0)}
        style={{
          background: 'none',
          border: 'none',
          color: '#94a3b8',
          cursor: 'pointer',
          fontSize: 11.5,
          fontWeight: 700,
          padding: '2px 4px',
        }}
        title="ルートへ戻る"
      >
        ⌂ ルート
      </button>
      {crumbs.map((c, i) => (
        <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#475569' }}>›</span>
          <button
            onClick={() => navigateToDepth(i + 1)}
            disabled={i === crumbs.length - 1}
            style={{
              background: i === crumbs.length - 1 ? 'rgba(99,102,241,0.15)' : 'none',
              border: 'none',
              color: i === crumbs.length - 1 ? '#a5b4fc' : '#cbd5e1',
              cursor: i === crumbs.length - 1 ? 'default' : 'pointer',
              fontSize: 11.5,
              fontWeight: i === crumbs.length - 1 ? 700 : 500,
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            {c.label}
          </button>
        </span>
      ))}
    </div>
  );
}
