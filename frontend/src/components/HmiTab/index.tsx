import { useEffect, useState } from 'react';
import { usePLCStore } from '../../store/plcStore';
import type { HmiWidget } from '../../types';
import { Palette } from './Palette';
import { Canvas } from './Canvas';
import { PropertiesPanel } from './PropertiesPanel';

export function HmiTab() {
  const loadSignals = usePLCStore((s) => s.loadSignals);
  const [widgets, setWidgetsState] = useState<HmiWidget[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [screenNames, setScreenNames] = useState<string[]>([]);
  const [screenName, setScreenName] = useState('main');
  const [status, setStatus] = useState('');

  useEffect(() => {
    loadSignals();
    fetch('/api/hmi/screens')
      .then((r) => r.json())
      .then(setScreenNames)
      .catch(() => {});
  }, []);

  const setWidgets = (updater: (prev: HmiWidget[]) => HmiWidget[]) => setWidgetsState(updater);

  const selected = widgets.find((w) => w.id === selectedId) || null;

  const updateSelected = (patch: Partial<HmiWidget>) => {
    if (!selectedId) return;
    setWidgetsState((prev) => prev.map((w) => (w.id === selectedId ? { ...w, ...patch } : w)));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setWidgetsState((prev) => prev.filter((w) => w.id !== selectedId));
    setSelectedId(null);
  };

  const save = async () => {
    if (!screenName.trim()) return;
    const res = await fetch(`/api/hmi/screens/${encodeURIComponent(screenName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: screenName, widgets }),
    });
    if (res.ok) {
      setStatus(`保存しました: ${screenName}`);
      const names = await fetch('/api/hmi/screens').then((r) => r.json());
      setScreenNames(names);
    } else {
      setStatus('保存に失敗しました');
    }
    setTimeout(() => setStatus(''), 2500);
  };

  const load = async (name: string) => {
    if (!name) return;
    const res = await fetch(`/api/hmi/screens/${encodeURIComponent(name)}`);
    if (res.ok) {
      const data = await res.json();
      // Defensive: a hand-edited/corrupted screen file could have a
      // non-array `widgets` (e.g. a string or object) which would otherwise
      // reach Canvas.tsx's `.map()`/`.length` and throw (BUG-003, see
      // docs/QA_LOG.md). The API now rejects this shape on save, but old
      // files written before that validation existed may still have it.
      setWidgetsState(Array.isArray(data.widgets) ? data.widgets : []);
      setScreenName(name);
      setSelectedId(null);
      setStatus(`読み込みました: ${name}`);
      setTimeout(() => setStatus(''), 2500);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          background: '#111827',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <button
          onClick={() => setRunning((r) => !r)}
          style={{
            background: running ? '#22c55e20' : '#6366f120',
            border: `1px solid ${running ? '#22c55e' : '#6366f1'}`,
            borderRadius: 6,
            color: running ? '#22c55e' : '#a5b4fc',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            padding: '5px 14px',
          }}
        >
          {running ? '● 運転モード' : '✎ 編集モード'}
        </button>

        <span style={{ width: 1, height: 20, background: '#334155' }} />

        <input
          value={screenName}
          onChange={(e) => setScreenName(e.target.value)}
          placeholder="画面名"
          style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#e2e8f0', padding: '5px 8px', fontSize: 12, width: 140 }}
        />
        <button
          onClick={save}
          style={{ background: '#0f172a', border: '1px solid #475569', borderRadius: 5, color: '#cbd5e1', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: '5px 10px' }}
        >
          保存
        </button>
        <select
          onChange={(e) => load(e.target.value)}
          value=""
          style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#94a3b8', fontSize: 11.5, padding: '5px 8px' }}
        >
          <option value="" disabled>
            画面を読み込む…
          </option>
          {screenNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        {status && <span style={{ fontSize: 11, color: '#22c55e' }}>{status}</span>}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {!running && <Palette />}
        <Canvas widgets={widgets} setWidgets={setWidgets} running={running} selectedId={selectedId} setSelectedId={setSelectedId} />
        {!running && <PropertiesPanel widget={selected} onChange={updateSelected} onDelete={deleteSelected} />}
      </div>
    </div>
  );
}
