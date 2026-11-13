import { useEffect, useMemo, useRef, useState } from 'react';
import type { Equipment } from '@core/ir';
import type { FaultType } from '@core/contracts';
import { FAULTS_BY_KIND, FAULT_LABEL, useSimStore, useThrottledSim } from '../store/simStore';
import { useLineStore } from '../store/lineStore';
import { useUiStore } from '../store/uiStore';
import { KIND_LABEL } from './ui';

function Collapsible({ title, defaultOpen = false, right, children }: { title: string; defaultOpen?: boolean; right?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="coll">
      <button className="coll-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="coll-caret">{open ? '▾' : '▸'}</span>
        <span className="coll-title">{title}</span>
        {right && <span className="coll-right">{right}</span>}
      </button>
      {open && <div className="coll-body">{children}</div>}
    </section>
  );
}

const selectEquipment = (id?: string) => {
  if (id && useLineStore.getState().ir.equipment.some((e) => e.id === id)) useLineStore.getState().select(id);
};

/* ───────── ST コード ───────── */

const KEYWORDS = /\b(PROGRAM|END_PROGRAM|VAR|END_VAR|IF|THEN|ELSIF|ELSE|END_IF|CASE|OF|END_CASE|AND|OR|NOT|TRUE|FALSE|BOOL|INT|STRING|TON|AT)\b/g;

function highlight(line: string): React.ReactNode {
  const ci = line.indexOf('(*');
  const code = ci >= 0 ? line.slice(0, ci) : line;
  const comment = ci >= 0 ? line.slice(ci) : '';
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of code.matchAll(KEYWORDS)) {
    if (m.index! > last) parts.push(code.slice(last, m.index));
    parts.push(
      <span key={m.index} className="st-kw">
        {m[0]}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  parts.push(code.slice(last));
  if (comment)
    parts.push(
      <span key="c" className="st-cm">
        {comment}
      </span>,
    );
  return parts;
}

function StSection() {
  const st = useSimStore((s) => s.st);
  const program = useSimStore((s) => s.program);
  const status = useSimStore((s) => s.status);
  const active = useThrottledSim((s) => s.snapshot?.control.activeSteps ?? null, 150);
  const lines = useMemo(() => st.code.split('\n'), [st.code]);
  const boxRef = useRef<HTMLDivElement>(null);
  const userScrollAt = useRef(0);

  // 活性ステップ → ハイライト行の範囲
  const hi = useMemo(() => {
    const set = new Set<number>();
    let first = Infinity;
    if (!active || status === 'idle') return { set, first: 0 };
    const starts = Object.values(st.stepLines).sort((a, b) => a - b);
    for (const [seq, step] of Object.entries(active)) {
      const start = st.stepLines[`${seq}.${step}`];
      if (!start) continue;
      const nextStart = starts.find((l) => l > start);
      let end = nextStart ? nextStart - 1 : lines.length;
      for (let i = start; i < end; i++) if (/^\s*END_CASE/.test(lines[i])) { end = i; break; }
      for (let l = start; l <= end; l++) set.add(l);
      first = Math.min(first, start);
    }
    return { set, first: first === Infinity ? 0 : first };
  }, [active, status, st, lines]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || status !== 'running' || !hi.first) return;
    if (Date.now() - userScrollAt.current < 4000) return;
    const el = box.querySelector<HTMLElement>(`[data-ln="${hi.first}"]`);
    if (!el) return;
    box.scrollTop = Math.max(0, el.offsetTop - box.clientHeight / 3);
  }, [hi.first, status]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(st.code);
      useUiStore.getState().toast('ST コードをコピーしました');
    } catch {
      useUiStore.getState().toast('コピーできませんでした', 'error');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([st.code], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(useLineStore.getState().ir.name || 'line').replace(/[\\/:*?"<>|\s]+/g, '_')}.st`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      {program.notes.length > 0 && (
        <ul className="st-notes" aria-label="生成時の注意">
          {program.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      <div className="btn-row st-actions">
        <button className="btn small" onClick={copy}>
          コピー
        </button>
        <button className="btn small" onClick={download}>
          .st をダウンロード
        </button>
      </div>
      <div
        className="st-box"
        ref={boxRef}
        onWheel={() => (userScrollAt.current = Date.now())}
        onTouchMove={() => (userScrollAt.current = Date.now())}
        onPointerDown={() => (userScrollAt.current = Date.now())}
      >
        <div className="st-code">
          {lines.map((l, i) => (
            <div key={i} data-ln={i + 1} className={`st-line${hi.set.has(i + 1) ? ' active' : ''}`}>
              <span className="st-no">{i + 1}</span>
              <span className="st-text">{highlight(l) || ' '}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ───────── シーケンス ───────── */

function SequenceSection() {
  const program = useSimStore((s) => s.program);
  const status = useSimStore((s) => s.status);
  const active = useThrottledSim((s) => s.snapshot?.control.activeSteps ?? null, 150);
  if (program.sequences.length === 0) return <p className="muted">シーケンスがありません。</p>;
  return (
    <div className="seqs">
      {program.sequences.map((q) => (
        <div key={q.id} className="seq">
          <button className="seq-title" onClick={() => selectEquipment(q.equipmentId)}>
            {q.label}
          </button>
          <ol className="steps">
            {q.steps.map((s) => {
              const on = status !== 'idle' && active?.[q.id] === s.id;
              return (
                <li key={s.id} className={on ? 'on' : ''}>
                  <span className="step-id">{s.id}</span>
                  <span>{s.label}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

/* ───────── I/O モニタ ───────── */

function IoSection() {
  const program = useSimStore((s) => s.program);
  const io = useThrottledSim((s) => s.snapshot?.io ?? null, 150);
  const rows = program.vars.filter((v) => v.kind !== 'internal');
  if (rows.length === 0) return <p className="muted">I/O 点がありません。</p>;
  return (
    <table className="table io-table">
      <thead>
        <tr>
          <th>状態</th>
          <th>タグ</th>
          <th>アドレス</th>
          <th>区分</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((v) => {
          const on = !!io?.[v.name];
          return (
            <tr key={v.name} className="io-row" onClick={() => selectEquipment(v.equipmentId)}>
              <td>
                <span className={`lamp${on ? ' on' : ''}`} aria-label={on ? 'ON' : 'OFF'} />
                <span className="lamp-text">{on ? 'ON' : 'OFF'}</span>
              </td>
              <td>
                <span className="mono">{v.name}</span>
                {v.comment && <div className="muted io-comment">{v.comment}</div>}
              </td>
              <td className="mono">{v.address}</td>
              <td>{v.kind === 'input' ? 'DI' : 'DO'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ───────── 異常注入 ───────── */

function FaultSection() {
  const ir = useLineStore((s) => s.ir);
  const faults = useSimStore((s) => s.faults);
  const status = useSimStore((s) => s.status);
  const inject = useSimStore((s) => s.injectFault);
  const clear = useSimStore((s) => s.clearFaults);
  const targets = ir.equipment.filter((e: Equipment) => e.semantics.status === 'confirmed' && FAULTS_BY_KIND[e.kind]);
  const has = (type: FaultType, id: string) => faults.some((f) => f.type === type && f.equipmentId === id);

  return (
    <>
      {status === 'idle' && <p className="muted">異常は「▶ 実行」を押すと有効になります（注入内容は保持されます）。</p>}
      {targets.length === 0 && <p className="muted">注入できる設備がありません。</p>}
      {targets.map((e) => (
        <div key={e.id} className="fault-eq">
          <button className="fault-name" onClick={() => selectEquipment(e.id)}>
            <b>{e.id}</b> <span className="muted">{e.name !== e.id ? e.name : KIND_LABEL[e.kind]}</span>
          </button>
          <div className="fault-btns">
            {FAULTS_BY_KIND[e.kind].map((t) => (
              <button
                key={t}
                className={`btn small fault-btn${has(t, e.id) ? ' on' : ''}`}
                onClick={() => inject({ type: t, equipmentId: e.id })}
                disabled={has(t, e.id)}
              >
                {FAULT_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="fault-active">
        <h4>注入中の異常 ({faults.length})</h4>
        {faults.length === 0 ? (
          <p className="muted">なし</p>
        ) : (
          <>
            <ul>
              {faults.map((f) => (
                <li key={f.type + f.equipmentId}>
                  <button className="link" onClick={() => selectEquipment(f.equipmentId)}>
                    {f.equipmentId} {FAULT_LABEL[f.type]}
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn danger" onClick={clear}>
              すべて解除
            </button>
          </>
        )}
      </div>
    </>
  );
}

export function ControlPanel() {
  return (
    <div className="ctl">
      <Collapsible title="ST コード" defaultOpen>
        <StSection />
      </Collapsible>
      <Collapsible title="シーケンス">
        <SequenceSection />
      </Collapsible>
      <Collapsible title="I/O モニタ">
        <IoSection />
      </Collapsible>
      <Collapsible title="異常注入" defaultOpen>
        <FaultSection />
      </Collapsible>
    </div>
  );
}
