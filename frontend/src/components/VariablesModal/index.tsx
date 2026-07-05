import { useEffect, useMemo, useState } from 'react';
import { usePLCStore } from '../../store/plcStore';
import type { VariableRow, SignalUsage } from '../../types';

const SECTION_LABELS: Record<VariableRow['kind'], string> = {
  input: '入力 X',
  output: '出力 Y',
  internal: '内部変数',
};

function ValueBadge({ row }: { row: VariableRow }) {
  if (row.type === 'bool') {
    const on = row.value === true;
    return (
      <span
        style={{
          display: 'inline-block',
          minWidth: 32,
          textAlign: 'center',
          padding: '1px 8px',
          borderRadius: 4,
          fontSize: 10.5,
          fontWeight: 700,
          background: on ? 'rgba(34,197,94,0.18)' : 'rgba(100,116,139,0.18)',
          color: on ? '#22c55e' : '#94a3b8',
          border: `1px solid ${on ? '#22c55e60' : '#64748b40'}`,
        }}
      >
        {on ? 'ON' : 'OFF'}
      </span>
    );
  }
  return (
    <span style={{ fontSize: 11, color: '#f59e0b', fontFamily: 'ui-monospace, monospace' }}>
      {typeof row.value === 'number' ? row.value : String(row.value ?? '')}
    </span>
  );
}

function NameCell({ row }: { row: VariableRow }) {
  const renameVariable = usePLCStore((s) => s.renameVariable);
  const updateVariableDef = usePLCStore((s) => s.updateVariableDef);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(row.name);

  if (!row.editable_name) {
    return <span style={{ color: '#e2e8f0' }}>{row.name}</span>;
  }

  const save = () => {
    setEditing(false);
    if (val.trim() && val !== row.name) {
      if (row.kind === 'internal') updateVariableDef(row.id, { name: val.trim() });
      else renameVariable(row.id, val.trim());
    } else {
      setVal(row.name);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') { setVal(row.name); setEditing(false); }
        }}
        style={{
          background: '#0f172a',
          border: '1px solid #6366f1',
          borderRadius: 4,
          color: '#e2e8f0',
          padding: '2px 6px',
          fontSize: 11,
          width: 140,
        }}
      />
    );
  }

  return (
    <span
      onClick={() => { setVal(row.name); setEditing(true); }}
      title="クリックして編集"
      style={{ color: '#e2e8f0', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}
    >
      {row.name}
    </span>
  );
}

function CommentCell({ row }: { row: VariableRow }) {
  const updateVariableDef = usePLCStore((s) => s.updateVariableDef);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(row.comment);

  if (row.kind !== 'internal') {
    return <span style={{ color: '#475569' }}>—</span>;
  }

  const save = () => {
    setEditing(false);
    if (val !== row.comment) updateVariableDef(row.id, { comment: val });
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setVal(row.comment); setEditing(false); } }}
        style={{
          background: '#0f172a', border: '1px solid #6366f1', borderRadius: 4,
          color: '#e2e8f0', padding: '2px 6px', fontSize: 11, width: 160,
        }}
      />
    );
  }

  return (
    <span
      onClick={() => { setVal(row.comment); setEditing(true); }}
      title="クリックして編集"
      style={{ color: row.comment ? '#94a3b8' : '#475569', cursor: 'pointer', fontSize: 11 }}
    >
      {row.comment || '(コメントなし)'}
    </span>
  );
}

function InitialCell({ row }: { row: VariableRow }) {
  const updateVariableDef = usePLCStore((s) => s.updateVariableDef);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(row.initial ?? (row.type === 'bool' ? false : 0)));

  if (row.kind !== 'internal') {
    return <span style={{ color: '#475569' }}>—</span>;
  }

  const save = () => {
    setEditing(false);
    const parsed = row.type === 'bool' ? val === 'true' : parseFloat(val);
    updateVariableDef(row.id, { initial: parsed });
  };

  if (row.type === 'bool') {
    return (
      <button
        onClick={() => updateVariableDef(row.id, { initial: !(row.initial === true) })}
        style={{
          background: 'transparent', border: '1px solid #334155', borderRadius: 4,
          color: '#94a3b8', fontSize: 10, padding: '1px 6px', cursor: 'pointer',
        }}
      >
        {row.initial === true ? 'true' : 'false'}
      </button>
    );
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        style={{ background: '#0f172a', border: '1px solid #6366f1', borderRadius: 4, color: '#e2e8f0', padding: '2px 6px', fontSize: 11, width: 70 }}
      />
    );
  }
  return (
    <span onClick={() => { setVal(String(row.initial ?? 0)); setEditing(true); }} style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 11, textDecoration: 'underline dotted' }}>
      {String(row.initial ?? 0)}
    </span>
  );
}

function ForceCell({ row }: { row: VariableRow }) {
  const forceVariable = usePLCStore((s) => s.forceVariable);
  const [val, setVal] = useState('');

  if (!row.editable_value) {
    return <span style={{ color: '#475569', fontSize: 10.5 }}>読取専用</span>;
  }

  if (row.type === 'bool') {
    const on = row.value === true;
    return (
      <button
        onClick={() => forceVariable(row.id, !on)}
        style={{
          background: on ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.12)',
          border: `1px solid ${on ? '#22c55e80' : '#64748b60'}`,
          borderRadius: 5,
          color: on ? '#22c55e' : '#94a3b8',
          fontSize: 10.5,
          fontWeight: 600,
          padding: '2px 10px',
          cursor: 'pointer',
        }}
        title="強制書込 (トグル)"
      >
        {on ? 'ON → OFF' : 'OFF → ON'}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={String(row.value ?? 0)}
        type="number"
        style={{ width: 60, background: '#0f172a', border: '1px solid #334155', borderRadius: 4, color: '#e2e8f0', padding: '2px 5px', fontSize: 11 }}
      />
      <button
        onClick={() => { const n = parseFloat(val); if (!isNaN(n)) { forceVariable(row.id, n); setVal(''); } }}
        style={{ background: '#4f46e520', border: '1px solid #4f46e5', borderRadius: 4, color: '#a5b4fc', fontSize: 10.5, padding: '2px 8px', cursor: 'pointer' }}
      >
        Set
      </button>
    </div>
  );
}

/** Signal path a VariableRow resolves to in the /api/signals/usage report
 * (see plc/signal_hub.py) -- I/O rows are node output ports ("id.OUT"),
 * internal variables are "var.<id>" (same convention used everywhere else,
 * see plc/simulation.py::read_signal/write_signal). */
function usageSignalPath(row: VariableRow): string {
  return row.kind === 'internal' ? `var.${row.id}` : `${row.id}.OUT`;
}

/** Where-used badges (see docs/VARIABLES.md "6. 信号ハブ"): edge count on
 * the logic canvas, HMI screens referencing this signal, sim rigs
 * referencing it -- so a signal can be discovered from either side (logic
 * design <-> simulation rig <-> HMI screen) instead of only being
 * changeable by hand-editing JSON. */
function UsageBadges({ row }: { row: VariableRow }) {
  const signalsUsage = usePLCStore((s) => s.signalsUsage);
  const usage = useMemo(
    () => signalsUsage.signals.find((s) => s.path === usageSignalPath(row)),
    [signalsUsage, row]
  );

  if (!usage) {
    return <span style={{ color: '#475569', fontSize: 9.5 }}>—</span>;
  }

  const chips: { label: string; title: string }[] = [];
  if (usage.used_by.logic > 0) {
    chips.push({ label: `ロジック×${usage.used_by.logic}`, title: 'キャンバス上の接続数' });
  }
  for (const name of usage.used_by.hmi_screens) {
    chips.push({ label: `HMI:${name}`, title: `HMI画面「${name}」から参照` });
  }
  for (const name of usage.used_by.sim_rigs) {
    chips.push({ label: `リグ:${name}`, title: `シミュレーションリグ「${name}」から参照` });
  }

  if (chips.length === 0) {
    return <span style={{ color: '#475569', fontSize: 9.5 }}>未使用</span>;
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
      {chips.map((c, i) => (
        <span
          key={i}
          title={c.title}
          style={{
            fontSize: 9,
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: 4,
            background: 'rgba(99,102,241,0.14)',
            color: '#a5b4fc',
            border: '1px solid #6366f150',
            whiteSpace: 'nowrap',
          }}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

function VariableTable({ rows }: { rows: VariableRow[] }) {
  const deleteVariable = usePLCStore((s) => s.deleteVariable);
  if (rows.length === 0) {
    return <div style={{ color: '#475569', fontSize: 11, padding: '8px 4px' }}>(なし)</div>;
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
      <thead>
        <tr style={{ textAlign: 'left', color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <th style={th}>名前</th>
          <th style={th}>型</th>
          <th style={th}>初期値</th>
          <th style={th}>コメント</th>
          <th style={th}>現在値</th>
          <th style={th}>使用箇所</th>
          <th style={th}>強制書込</th>
          <th style={th}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} style={{ borderTop: '1px solid #1e293b' }}>
            <td style={td}>
              <NameCell row={row} />
              <span style={{ color: '#475569', fontSize: 9.5, marginLeft: 6 }}>{row.id}</span>
            </td>
            <td style={td}>
              <span style={{ color: '#64748b', fontSize: 10 }}>{row.type}</span>
            </td>
            <td style={td}><InitialCell row={row} /></td>
            <td style={td}><CommentCell row={row} /></td>
            <td style={td}><ValueBadge row={row} /></td>
            <td style={td}><UsageBadges row={row} /></td>
            <td style={td}><ForceCell row={row} /></td>
            <td style={td}>
              {row.kind === 'internal' && (
                <button
                  onClick={() => deleteVariable(row.id)}
                  title="削除"
                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}
                >
                  ✕
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = { padding: '4px 8px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '5px 8px', verticalAlign: 'middle' };

function AddVariableForm() {
  const createVariable = usePLCStore((s) => s.createVariable);
  const [name, setName] = useState('');
  const [type, setType] = useState<'bool' | 'number'>('bool');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent', border: '1px dashed #6366f180', borderRadius: 6,
          color: '#a5b4fc', fontSize: 11.5, fontWeight: 600, padding: '5px 12px', cursor: 'pointer', marginTop: 8,
        }}
      >
        + 内部変数を追加
      </button>
    );
  }

  const submit = () => {
    if (!name.trim()) return;
    createVariable({ name: name.trim(), type, initial: type === 'bool' ? false : 0 });
    setName('');
    setOpen(false);
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="変数名 (例: counter1)"
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', padding: '4px 8px', fontSize: 11.5, width: 180 }}
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as 'bool' | 'number')}
        style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', padding: '4px 6px', fontSize: 11.5 }}
      >
        <option value="bool">bool</option>
        <option value="number">number</option>
      </select>
      <button onClick={submit} style={{ background: '#4f46e5', border: 'none', borderRadius: 5, color: '#fff', fontSize: 11.5, fontWeight: 600, padding: '4px 12px', cursor: 'pointer' }}>
        追加
      </button>
      <button onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: 11.5, cursor: 'pointer' }}>
        キャンセル
      </button>
    </div>
  );
}

/** "入力ノード作成" / "変数として作成" shortcuts for one unresolved rig/HMI
 * reference -- same API calls as the simulation-tab binding panel's
 * CreateShortcut (see components/SimulationTab/BindingPanel.tsx), so a user
 * can fix a dangling reference from wherever they happen to notice it (see
 * docs/VARIABLES.md "6. 信号ハブ"). */
function UnresolvedRow({ path, referencedBy, onCreated }: {
  path: string;
  referencedBy: { kind: 'sim_rig' | 'hmi_screen'; name: string }[];
  onCreated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const isVar = path.startsWith('var.');

  const create = async () => {
    setBusy(true);
    try {
      if (isVar) {
        const id = path.slice(4);
        await fetch('/api/variables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, type: 'bool' }),
        });
      } else {
        const id = path.split('.')[0];
        await fetch('/api/program/nodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'DigitalInput', id }),
        });
      }
      onCreated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
        borderRadius: 6, background: 'rgba(239,68,68,0.08)', border: '1px solid #ef444440',
      }}
    >
      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: '#fca5a5', flexShrink: 0 }}>
        {path}
      </span>
      <span style={{ fontSize: 10, color: '#94a3b8', flex: 1 }}>
        参照元: {referencedBy.map((r) => `${r.kind === 'sim_rig' ? 'リグ' : 'HMI'}:${r.name}`).join(', ')}
      </span>
      <button
        onClick={create}
        disabled={busy}
        style={{
          background: '#6366f120', border: '1px solid #6366f1', borderRadius: 5,
          color: '#a5b4fc', fontSize: 10.5, fontWeight: 600, padding: '3px 9px',
          cursor: busy ? 'default' : 'pointer', flexShrink: 0,
        }}
      >
        {busy ? '作成中…' : isVar ? '変数として作成' : '入力ノードとして作成'}
      </button>
    </div>
  );
}

function UnresolvedSection() {
  const signalsUsage = usePLCStore((s) => s.signalsUsage);
  const loadSignalsUsage = usePLCStore((s) => s.loadSignalsUsage);
  const loadVariables = usePLCStore((s) => s.loadVariables);
  const loadSignals = usePLCStore((s) => s.loadSignals);

  const refreshAfterCreate = () => {
    loadSignalsUsage();
    loadVariables();
    loadSignals();
  };

  if (signalsUsage.unresolved.length === 0) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        未解決の参照 ({signalsUsage.unresolved.length})
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>
        シミュレーションリグやHMI画面が参照しているが、現在のプログラムに存在しない信号です。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {signalsUsage.unresolved.map((u) => (
          <UnresolvedRow key={u.path} path={u.path} referencedBy={u.referenced_by} onCreated={refreshAfterCreate} />
        ))}
      </div>
    </div>
  );
}

export function VariablesModal() {
  const open = usePLCStore((s) => s.variablesModalOpen);
  const setOpen = usePLCStore((s) => s.setVariablesModalOpen);
  const variableRows = usePLCStore((s) => s.variableRows);
  const loadVariables = usePLCStore((s) => s.loadVariables);
  const loadSignalsUsage = usePLCStore((s) => s.loadSignalsUsage);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) loadSignalsUsage();
  }, [open, loadSignalsUsage]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return variableRows;
    return variableRows.filter(
      (r) => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.comment.toLowerCase().includes(q)
    );
  }, [variableRows, search]);

  if (!open) return null;

  const byKind = (kind: VariableRow['kind']) => filtered.filter((r) => r.kind === kind);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(920px, 94vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
          background: '#0f172a', border: '1px solid #334155', borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #1e293b' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#e2e8f0' }}>変数マネージャー</span>
          <button
            onClick={() => loadVariables()}
            title="再読込"
            style={{ marginLeft: 10, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12 }}
          >
            ⟳
          </button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="検索 (名前・ID・コメント)"
            style={{
              marginLeft: 'auto', background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
              color: '#e2e8f0', padding: '5px 10px', fontSize: 11.5, width: 220,
            }}
          />
          <button
            onClick={() => setOpen(false)}
            title="閉じる (Esc)"
            style={{ marginLeft: 10, background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '12px 16px 20px' }}>
          {(['input', 'output', 'internal'] as const).map((kind) => (
            <div key={kind} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
                {SECTION_LABELS[kind]} ({byKind(kind).length})
              </div>
              <VariableTable rows={byKind(kind)} />
              {kind === 'internal' && <AddVariableForm />}
            </div>
          ))}
          <UnresolvedSection />
        </div>
      </div>
    </div>
  );
}
