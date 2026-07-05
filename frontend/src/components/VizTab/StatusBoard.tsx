import { usePLCStore } from '../../store/plcStore';
import type { NodeDef, ProgramGraph, RuntimeState } from '../../types';

const KIND_COLORS: Record<string, string> = {
  '装置': '#6366f1',
  '工程': '#0ea5e9',
  '動作': '#f59e0b',
  '機能': '#22c55e',
};
const DEFAULT_KIND_COLOR = '#a78bfa';

function flatPath(path: string[], localId: string): string {
  return path.length ? `${path.join('/')}/${localId}` : localId;
}

function collectDescendantLeafIds(node: NodeDef, path: string[]): string[] {
  if (node.type !== 'group') return [flatPath(path, node.id)];
  const children = node.children ?? { nodes: [], edges: [] };
  const childPath = [...path, node.id];
  return children.nodes.flatMap((n) => collectDescendantLeafIds(n, childPath));
}

interface GroupCard {
  id: string;
  label: string;
  kind: string;
  path: string[];
  anyOn: boolean;
  leafCount: number;
}

/** Recursively collect every group (device/process/action) node in the
 * program tree, at any depth, with a live "running/stopped" aggregate --
 * mirrors the same aggregation logic used by GroupNode on the logic canvas
 * (see components/NodeTypes/GroupNode.tsx), reimplemented here since the
 * store doesn't export those helpers directly. */
function collectGroups(graph: ProgramGraph, path: string[], runtime: RuntimeState): GroupCard[] {
  const cards: GroupCard[] = [];
  for (const n of graph.nodes) {
    if (n.type !== 'group') continue;
    const leafIds = collectDescendantLeafIds(n, path);
    const anyOn = leafIds.some((id) => Object.values(runtime[id] ?? {}).some((v) => v === true));
    cards.push({
      id: flatPath(path, n.id),
      label: n.label || n.id,
      kind: n.kind || '',
      path: [...path, n.id],
      anyOn,
      leafCount: leafIds.length,
    });
    const children = n.children ?? { nodes: [], edges: [] };
    cards.push(...collectGroups(children, [...path, n.id], runtime));
  }
  return cards;
}

export function StatusBoard() {
  const programTree = usePLCStore((s) => s.programTree);
  const runtimeState = usePLCStore((s) => s.runtimeState);
  const drillDown = usePLCStore((s) => s.drillDown);
  const navigateToDepth = usePLCStore((s) => s.navigateToDepth);
  const setActiveTab = usePLCStore((s) => s.setActiveTab);

  const groups = collectGroups(programTree, [], runtimeState);

  const goToLogic = (path: string[]) => {
    navigateToDepth(0);
    for (let i = 0; i < path.length; i++) {
      drillDown(path[i]);
    }
    setActiveTab('logic');
  };

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: 11.5, color: '#475569', padding: 12 }}>
        階層グループ(装置/工程/動作)がまだ定義されていません。ロジック設計タブでグループ
        ノードを作成すると、ここに稼働状況カードが表示されます。
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {groups.map((g) => {
        const kindColor = KIND_COLORS[g.kind] || DEFAULT_KIND_COLOR;
        return (
          <button
            key={g.id}
            onClick={() => goToLogic(g.path)}
            title="ロジック設計タブでこのグループを開く"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minWidth: 150,
              background: '#111827',
              border: `1.5px solid ${g.anyOn ? '#22c55e70' : '#1e293b'}`,
              borderRadius: 10,
              padding: '10px 14px',
              cursor: 'pointer',
              textAlign: 'left',
              boxShadow: g.anyOn ? '0 0 12px rgba(34,197,94,0.2)' : 'none',
            }}
          >
            <span
              style={{
                alignSelf: 'flex-start',
                background: kindColor,
                color: '#0f172a',
                fontSize: 9,
                fontWeight: 800,
                padding: '2px 7px',
                borderRadius: 999,
              }}
            >
              {g.kind || 'グループ'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{g.label}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: g.anyOn ? '#22c55e' : '#64748b' }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: g.anyOn ? '#22c55e' : '#475569',
                  boxShadow: g.anyOn ? '0 0 6px #22c55e' : 'none',
                }}
              />
              {g.anyOn ? '稼働中' : '停止中'}
            </span>
            <span style={{ fontSize: 9.5, color: '#475569' }}>{g.leafCount} ブロック</span>
          </button>
        );
      })}
    </div>
  );
}
