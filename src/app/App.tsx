import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { buildStandardLine } from '@core/demo/standardLine';
import { useLineStore } from './store/lineStore';
import { useUiStore } from './store/uiStore';
import { Scene } from './scene/Scene';
import { tabs } from './panels/tabs';
import { Hud } from './panels/Hud';
import { RunBar } from './panels/RunBar';
import './styles.css';

function LineNameField() {
  const name = useLineStore((s) => s.ir.name);
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  const commit = () => {
    const t = text.trim();
    if (!t || t === name) return setText(name);
    const res = useLineStore.getState().dispatch([{ op: 'rename_line', name: t }], 'ライン名変更');
    if (res.errors.length) useUiStore.getState().toast(res.errors[0], 'error');
  };
  return (
    <input
      className="line-name"
      aria-label="ライン名"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function TopBar() {
  const canUndo = useLineStore((s) => s.past.length > 0);
  const canRedo = useLineStore((s) => s.future.length > 0);
  const undo = useLineStore((s) => s.undo);
  const redo = useLineStore((s) => s.redo);
  const isEmpty = useLineStore((s) => s.ir.equipment.length === 0);

  const loadSample = () => {
    if (!isEmpty && !window.confirm('現在のラインをサンプルで置き換えます。(取り消しで元に戻せます)')) return;
    useLineStore.getState().replaceLine(buildStandardLine(), 'サンプル読込');
    useUiStore.getState().requestFit();
  };
  const newLine = () => {
    if (!isEmpty && !window.confirm('現在のラインを破棄して新規作成します。(取り消しで元に戻せます)')) return;
    useLineStore.getState().newLine();
    useUiStore.getState().requestFit();
  };

  return (
    <header className="topbar">
      <LineNameField />
      <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="元に戻す" title="元に戻す">
        ↶
      </button>
      <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="やり直し" title="やり直し">
        ↷
      </button>
      <button className="top-btn" onClick={loadSample}>
        サンプル
      </button>
      <button className="top-btn" onClick={newLine}>
        新規
      </button>
      <RunBar />
    </header>
  );
}

function ViewTools() {
  const mode = useUiStore((s) => s.gizmoMode);
  const setMode = useUiStore((s) => s.setGizmoMode);
  const sel = useLineStore((s) => s.ir.equipment.find((e) => e.id === s.selectedId));
  const connected = useLineStore((s) =>
    sel ? s.ir.connections.some((c) => c.from.equipmentId === sel.id || c.to.equipmentId === sel.id) : false,
  );
  const gizmoable = sel && (sel.kind === 'conveyor' || sel.kind === 'generic' || (sel.kind === 'source' && !connected));
  const modes = [
    ['translate', '移動'],
    ['rotate', '回転'],
    ['scale', 'スケール'],
  ] as const;
  return (
    <div className="view-tools">
      <button className="tool-btn" onClick={() => useUiStore.getState().requestFit()}>
        全体表示
      </button>
      {gizmoable && (
        <div className="seg">
          {modes.map(([m, label]) => (
            <button key={m} className={`tool-btn${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Sheet() {
  const activeTab = useUiStore((s) => s.activeTab);
  const open = useUiStore((s) => s.sheetOpen);
  const setTab = useUiStore((s) => s.setTab);
  const setOpen = useUiStore((s) => s.setSheetOpen);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const selectedId = useLineStore((s) => s.selectedId);
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [activeTab, selectedId]);
  const Active = (tabs.find((t) => t.id === activeTab) ?? tabs[0]).component;

  return (
    <aside className={`sheet${open ? ' open' : ''}`}>
      <div
        className="sheet-handle"
        role="button"
        aria-label={open ? 'パネルを閉じる' : 'パネルを開く'}
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, moved: false };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current && Math.abs(e.clientY - drag.current.y) > 12) drag.current.moved = true;
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          const dy = e.clientY - d.y;
          if (d.moved) setOpen(dy < 0);
          else useUiStore.getState().toggleSheet();
        }}
      >
        <span className="grip" />
      </div>
      <nav className="tabbar" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === activeTab}
            className={`tab${t.id === activeTab ? ' active' : ''}`}
            onClick={() => {
              setTab(t.id);
              setOpen(true);
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="sheet-body" ref={bodyRef}>
        <Active />
      </div>
    </aside>
  );
}

function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => useUiStore.getState().dismissToast(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function App() {
  const select = useLineStore((s) => s.select);
  const sheetOpen = useUiStore((s) => s.sheetOpen);
  return (
    <div className={`app${sheetOpen ? '' : ' sheet-closed'}`}>
      <div className="canvas-wrap">
        <Canvas camera={{ position: [4, 3.5, 5], fov: 45 }} dpr={[1, 2]} onPointerMissed={() => select(null)}>
          <Scene />
        </Canvas>
      </div>
      <TopBar />
      <div className="hud-slot">
        <Hud />
      </div>
      <ViewTools />
      <Sheet />
      <Toasts />
    </div>
  );
}
