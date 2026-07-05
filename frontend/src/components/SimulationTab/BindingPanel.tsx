import { useState } from 'react';
import type { RigBinding, SimDevice, SimRig } from '../../types';
import { usePLCStore } from '../../store/plcStore';

/** Every signal-path field a rig device type may declare, in display order
 * -- mirrors plc/simulation.py::DEVICE_SIGNAL_FIELDS (the same set the
 * rename cascade / bindings endpoint scan), plus a human label for each. */
const FIELD_LABELS: Record<string, string> = {
  signal: '信号 (signal)',
  drive_signal: '駆動信号 (drive_signal)',
  reverse_signal: '逆転信号 (reverse_signal)',
  coil_signal: 'コイル信号 (coil_signal)',
  contact_signal: '接点信号 (contact_signal)',
};

const FIELD_ORDER = ['signal', 'drive_signal', 'reverse_signal', 'coil_signal', 'contact_signal'];

/** One device field's signal picker: a dropdown of every known signal (+
 * internal variable) plus free-text entry (an operator may want to bind to
 * a signal that doesn't exist yet, then use the "create" shortcut below). */
function SignalFieldEditor({
  field,
  value,
  binding,
  onChange,
}: {
  field: string;
  value: string;
  binding: RigBinding | undefined;
  onChange: (next: string) => void;
}) {
  const signals = usePLCStore((s) => s.signals);
  const [freeText, setFreeText] = useState(false);

  const isKnownOption = signals.some((s) => s.path === value) || value.startsWith('var.') || value === '';
  const useFreeText = freeText || (!!value && !isKnownOption);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: '#64748b', flex: 1 }}>{FIELD_LABELS[field] ?? field}</span>
        {binding && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 4,
              color: binding.resolved ? '#22c55e' : '#ef4444',
              background: binding.resolved ? '#22c55e18' : '#ef444418',
              border: `1px solid ${binding.resolved ? '#22c55e60' : '#ef444460'}`,
            }}
          >
            {binding.resolved ? `解決済み (${binding.kind})` : '未解決'}
          </span>
        )}
      </div>
      {useFreeText ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="信号パス (例: x_start, y_motor.OUT, var.counter1)"
          style={{
            background: '#0f172a', border: '1px solid #334155', borderRadius: 5,
            color: '#e2e8f0', padding: '5px 8px', fontSize: 11.5, fontFamily: 'ui-monospace, monospace',
          }}
        />
      ) : (
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === '__free__') {
              setFreeText(true);
              return;
            }
            onChange(e.target.value);
          }}
          style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', padding: '5px 8px', fontSize: 11.5 }}
        >
          <option value="">(未設定)</option>
          {signals.map((s) => (
            <option key={s.path} value={s.path}>
              {s.path} ({s.data_type})
            </option>
          ))}
          <option value="__free__">自由入力…</option>
        </select>
      )}
      {!binding?.resolved && value && (
        <CreateShortcut path={value} />
      )}
    </div>
  );
}

/** "Create as input node" / "create as variable" shortcuts for an unresolved
 * signal path -- see docs/VARIABLES.md "6. 信号ハブ". `var.<id>` paths only
 * offer the variable shortcut; everything else only offers the input-node
 * shortcut (a rig device signal is virtually always either a DigitalInput
 * the operator writes to, or an output/var it reads -- creating an OUTPUT
 * node on the fly wouldn't make sense since outputs are driven by logic). */
function CreateShortcut({ path }: { path: string }) {
  const loadSignals = usePLCStore((s) => s.loadSignals);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

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
      await loadSignals();
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return <span style={{ fontSize: 10, color: '#22c55e' }}>作成しました ✓</span>;
  }

  return (
    <button
      onClick={create}
      disabled={busy}
      style={{
        alignSelf: 'flex-start',
        background: '#6366f120',
        border: '1px solid #6366f1',
        borderRadius: 5,
        color: '#a5b4fc',
        fontSize: 10,
        fontWeight: 600,
        padding: '3px 8px',
        cursor: busy ? 'default' : 'pointer',
      }}
    >
      {busy ? '作成中…' : isVar ? `変数として作成 (${path})` : `入力ノードとして作成 (${path.split('.')[0]})`}
    </button>
  );
}

export function BindingPanel({
  rigName,
  rig,
  deviceId,
  bindings,
  onClose,
  onSaved,
}: {
  rigName: string;
  rig: SimRig;
  deviceId: string;
  bindings: RigBinding[];
  onClose: () => void;
  onSaved: (updatedRig: SimRig) => void;
}) {
  const device = rig.devices.find((d) => d.id === deviceId) as (SimDevice & Record<string, unknown>) | undefined;
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    if (device) {
      for (const field of FIELD_ORDER) {
        const v = (device as Record<string, unknown>)[field];
        if (typeof v === 'string') initial[field] = v;
      }
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!device) return null;

  const deviceBindings = bindings.filter((b) => b.device_id === deviceId);
  const presentFields = FIELD_ORDER.filter((f) => f in draft || deviceBindings.some((b) => b.field === f));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const updatedDevices = rig.devices.map((d) => {
      if (d.id !== deviceId) return d;
      const updated: Record<string, unknown> = { ...d };
      for (const field of FIELD_ORDER) {
        if (field in draft) {
          updated[field] = draft[field] || null;
        }
      }
      return updated as unknown as SimDevice;
    });
    const updatedRig: SimRig = { ...rig, devices: updatedDevices };
    const res = await fetch(`/api/sim/rigs/${encodeURIComponent(rigName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedRig),
    });
    setSaving(false);
    if (res.ok) {
      onSaved(updatedRig);
    } else {
      setSaveError('保存に失敗しました');
    }
  };

  return (
    <div
      style={{
        width: 320,
        minWidth: 300,
        flexShrink: 0,
        borderLeft: '1px solid #1e293b',
        background: '#0d1526',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>{device.label || device.id}</div>
          <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>
            {device.id} ({device.type})
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {presentFields.length === 0 && (
          <span style={{ fontSize: 11, color: '#475569' }}>このデバイスには編集可能な信号フィールドがありません。</span>
        )}
        {presentFields.map((field) => (
          <SignalFieldEditor
            key={field}
            field={field}
            value={draft[field] ?? ''}
            binding={deviceBindings.find((b) => b.field === field)}
            onChange={(next) => setDraft((d) => ({ ...d, [field]: next }))}
          />
        ))}
      </div>

      <div style={{ padding: 14, borderTop: '1px solid #1e293b', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            flex: 1,
            background: '#22c55e20',
            border: '1px solid #22c55e',
            borderRadius: 6,
            color: '#22c55e',
            fontSize: 12,
            fontWeight: 700,
            padding: '7px 10px',
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {saveError && <span style={{ fontSize: 10.5, color: '#ef4444' }}>{saveError}</span>}
      </div>
    </div>
  );
}
