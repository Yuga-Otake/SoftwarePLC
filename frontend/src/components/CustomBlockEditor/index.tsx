import { useState } from 'react';
import { usePLCStore } from '../../store/plcStore';
import type { PortDef, CustomBlockTestResult } from '../../types';

const DEFAULT_CODE = `def execute(inputs, state, params):
    # inputs:  values arriving on this block's input ports
    # state:   persists between scan cycles (your block's memory)
    # params:  configurable parameters (see "Params" below)
    # returns: (outputs, new_state)
    out = inputs.get("IN", False)
    return {"OUT": out}, state
`;

const DATA_TYPES: PortDef['data_type'][] = ['bool', 'int', 'float'];

function samplePortValue(dt: PortDef['data_type']) {
  if (dt === 'bool') return true;
  if (dt === 'int') return 1;
  return 1.0;
}

function PortListEditor({
  title,
  ports,
  onChange,
}: {
  title: string;
  ports: PortDef[];
  onChange: (ports: PortDef[]) => void;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </div>
      {ports.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
          <input
            value={p.name}
            onChange={(e) => {
              const next = [...ports];
              next[i] = { ...p, name: e.target.value };
              onChange(next);
            }}
            placeholder="name"
            style={inputStyle(70)}
          />
          <select
            value={p.data_type}
            onChange={(e) => {
              const next = [...ports];
              next[i] = { ...p, data_type: e.target.value as PortDef['data_type'] };
              onChange(next);
            }}
            style={{ ...inputStyle(64), cursor: 'pointer' }}
          >
            {DATA_TYPES.map((dt) => (
              <option key={dt} value={dt}>{dt}</option>
            ))}
          </select>
          <button onClick={() => onChange(ports.filter((_, j) => j !== i))} style={removeBtnStyle}>
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...ports, { name: ports.length === 0 ? 'IN' : `IN${ports.length + 1}`, data_type: 'bool' }])}
        style={addBtnStyle}
      >
        + ポートを追加
      </button>
    </div>
  );
}

const inputStyle = (width: number): React.CSSProperties => ({
  width,
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 4,
  color: '#e2e8f0',
  fontSize: 11,
  padding: '4px 6px',
  fontFamily: 'inherit',
});

const removeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #334155',
  borderRadius: 4,
  color: '#94a3b8',
  fontSize: 10,
  cursor: 'pointer',
  width: 24,
};

const addBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px dashed #475569',
  borderRadius: 4,
  color: '#64748b',
  fontSize: 10,
  cursor: 'pointer',
  padding: '3px 8px',
};

export function CustomBlockEditor({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState(DEFAULT_CODE);
  const [inputPorts, setInputPorts] = useState<PortDef[]>([{ name: 'IN', data_type: 'bool' }]);
  const [outputPorts, setOutputPorts] = useState<PortDef[]>([{ name: 'OUT', data_type: 'bool' }]);
  const [testResult, setTestResult] = useState<CustomBlockTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const sampleInputs: Record<string, unknown> = {};
      inputPorts.forEach((p) => {
        if (p.name) sampleInputs[p.name] = samplePortValue(p.data_type);
      });
      const res = await fetch('/api/blocks/custom/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, inputs: sampleInputs, state: {}, params: {} }),
      });
      if (res.ok) setTestResult(await res.json());
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      setSaveError('ブロック名を入力してください');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/blocks/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          code,
          input_ports: inputPorts.filter((p) => p.name),
          output_ports: outputPorts.filter((p) => p.name),
        }),
      });
      if (res.ok) {
        await usePLCStore.getState().loadCatalog();
        onClose();
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveError((err as { detail?: string }).detail || '保存に失敗しました');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2,6,23,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxWidth: '92vw',
          maxHeight: '88vh',
          overflow: 'auto',
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: 10,
          padding: 16,
          color: '#e2e8f0',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#a78bfa' }}>
            🐍 カスタムコードブロック（Python）
          </div>
          <button onClick={onClose} style={{ ...removeBtnStyle, width: 28, height: 28 }}>✕</button>
        </div>

        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12, lineHeight: 1.5 }}>
          ブロックの動作を Python の <code style={codeInlineStyle}>execute(inputs, state, params)</code> 関数として書けます。
          組み込みブロックと全く同じ仕組みで、毎スキャンサイクルごとに <strong>分離されたプロセス内</strong>で安全に実行されます
          （無限ループや例外がPLC本体に影響しません）。利用できるモジュールは
          <code style={codeInlineStyle}>math / statistics / random / re / json / datetime / time / collections / itertools / functools / string</code> のみです。
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ブロック名 (例: 摂氏→華氏変換)"
            style={{ ...inputStyle(0), flex: 1 }}
          />
        </div>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="説明 (任意)"
          style={{ ...inputStyle(0), width: '100%', marginBottom: 12, boxSizing: 'border-box' }}
        />

        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <PortListEditor title="入力ポート" ports={inputPorts} onChange={setInputPorts} />
          </div>
          <div style={{ flex: 1 }}>
            <PortListEditor title="出力ポート" ports={outputPorts} onChange={setOutputPorts} />
          </div>
        </div>

        <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          コード
        </div>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          style={{
            width: '100%',
            height: 200,
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 6,
            color: '#e2e8f0',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            padding: 10,
            boxSizing: 'border-box',
            resize: 'vertical',
            lineHeight: 1.5,
          }}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <button onClick={runTest} disabled={testing} style={testBtnStyle}>
            {testing ? '実行中…' : '▶ テスト実行'}
          </button>
          <span style={{ fontSize: 10, color: '#64748b' }}>
            入力ポートにサンプル値（{inputPorts.map((p) => `${p.name}=${String(samplePortValue(p.data_type))}`).join(', ') || '-'}）を与えて1回実行します
          </span>
        </div>

        {testResult && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              borderRadius: 6,
              background: testResult.error ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
              border: `1px solid ${testResult.error ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
              fontSize: 11,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {testResult.error ? (
              <div style={{ color: '#fca5a5', whiteSpace: 'pre-wrap' }}>✗ エラー: {testResult.error}</div>
            ) : (
              <div style={{ color: '#86efac' }}>✓ outputs: {JSON.stringify(testResult.outputs)}</div>
            )}
            <div style={{ color: '#94a3b8', marginTop: 4 }}>実行時間: {testResult.exec_ms.toFixed(2)} ms</div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          {saveError && <span style={{ fontSize: 11, color: '#fca5a5', alignSelf: 'center' }}>{saveError}</span>}
          <button onClick={onClose} style={{ ...addBtnStyle, padding: '7px 16px' }}>キャンセル</button>
          <button onClick={save} disabled={saving} style={saveBtnStyle}>
            {saving ? '保存中…' : 'パレットに追加'}
          </button>
        </div>
      </div>
    </div>
  );
}

const codeInlineStyle: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 3,
  padding: '1px 4px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10.5,
};

const testBtnStyle: React.CSSProperties = {
  background: 'rgba(99,102,241,0.15)',
  border: '1px solid #6366f1',
  borderRadius: 6,
  color: '#a5b4fc',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '6px 14px',
};

const saveBtnStyle: React.CSSProperties = {
  background: '#7c3aed',
  border: '1px solid #8b5cf6',
  borderRadius: 6,
  color: 'white',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '7px 16px',
};
