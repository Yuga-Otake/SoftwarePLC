import { useEffect, useRef, useState } from 'react';
import type { Equipment } from '@core/ir';
import { useChatStore } from '../../store/chatStore';
import type { AssumptionRef, ProposalMessage } from '../../store/chatStore';
import { useLineStore } from '../../store/lineStore';
import { useUiStore } from '../../store/uiStore';
import { KIND_LABEL, NumberField } from '../ui';
import { confidenceLabel, formatValue, getByPath, isEditablePath, nestedPatch, pathLabel } from './labels';

const GROUPS = [
  ['added', '追加', 'add'],
  ['updated', '変更', 'upd'],
  ['removed', '削除', 'del'],
] as const;

function Changes({ msg }: { msg: ProposalMessage }) {
  // 仮定の記録は「AIの仮定」欄に出すので、変更欄からは省く
  const changes = msg.changes.filter((c) => !c.summary.includes('仮定として記録'));
  if (changes.length === 0) return null;
  return (
    <div className="pc-section">
      <h4>変更内容</h4>
      {GROUPS.map(([type, label, cls]) => {
        const items = changes.filter((c) => c.type === type);
        if (!items.length) return null;
        return (
          <div key={type} className="pc-group">
            <div className={`pc-group-head ${cls}`}>
              <span className="pc-marker" />
              {label} <span className="pc-count">{items.length}</span>
            </div>
            <ul className="pc-list">
              {items.map((c, i) => (
                <li key={i} className={cls}>
                  {c.summary}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Preview({ msg }: { msg: ProposalMessage }) {
  return (
    <>
      <Changes msg={msg} />
      {msg.newAssumptions.length > 0 && (
        <div className="pc-section">
          <h4>AIの仮定</h4>
          <p className="muted">指定がなかったため AI が置いた値です。適用後に承認・修正できます。</p>
          <ul className="pc-list plain">
            {msg.newAssumptions.map((a) => (
              <li key={a.id} className="pc-asm">
                <div>
                  <span className="pc-eq">{a.equipmentId}</span> {pathLabel(a.path).label}
                  <span className="pc-val">{formatValue(a.path, a.value)}</span>
                </div>
                <div className="rationale">{a.rationale}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {msg.proposedEq.length > 0 && (
        <div className="pc-section">
          <h4>要確認の推定</h4>
          <ul className="pc-list plain">
            {msg.proposedEq.map((e) => (
              <li key={e.id} className="pc-asm">
                <div>
                  <span className="pc-eq">{e.id}</span> は {KIND_LABEL[e.kind] ?? e.kind} と推定{' '}
                  <span className="pill proposed">確信度: {confidenceLabel(e.confidence)}</span>
                </div>
                {e.rationale && <div className="rationale">根拠: {e.rationale}</div>}
              </li>
            ))}
          </ul>
          <p className="muted">確認するまで不活性（シミュレーション・制御の対象外）のままです。</p>
        </div>
      )}
    </>
  );
}

/** 適用済みカード内の、仮定1件 (値は常にライブの IR から読む) */
function AppliedAssumption({ r }: { r: AssumptionRef }) {
  const ir = useLineStore((s) => s.ir);
  const [editing, setEditing] = useState(false);
  const a = ir.assumptions.find((x) => x.id === r.id && x.equipmentId === r.equipmentId && x.path === r.path);
  const eq: Equipment | undefined = ir.equipment.find((e) => e.id === r.equipmentId);
  const { label, unit, scale } = pathLabel(r.path);
  const live = eq ? getByPath(eq, r.path) : undefined;
  const run = (ops: Parameters<ReturnType<typeof useLineStore.getState>['dispatch']>[0], l: string) => {
    const res = useLineStore.getState().dispatch(ops, l);
    if (res.errors.length) useUiStore.getState().toast(res.errors[0], 'error');
    return res;
  };

  if (!eq) return null;
  return (
    <li className="pc-asm">
      <div className="pc-asm-top">
        <div className="pc-asm-text">
          <span className="pc-eq">{r.equipmentId}</span> {label}
          <span className="pc-val">{formatValue(r.path, live ?? a?.value)}</span>
          {a?.rationale && <div className="rationale">{a.rationale}</div>}
        </div>
        {a?.status === 'open' && !editing && (
          <div className="pc-asm-btns">
            <button className="btn small" onClick={() => run([{ op: 'accept_assumption', id: a.id }], '仮定を承認')}>
              承認
            </button>
            {isEditablePath(r.path, live) && (
              <button className="btn small" onClick={() => setEditing(true)}>
                修正
              </button>
            )}
          </div>
        )}
        {a?.status === 'accepted' && <span className="pill confirmed">承認済み</span>}
        {!a && <span className="pill confirmed">修正済み</span>}
      </div>
      {editing && typeof live === 'number' && (
        <div className="pc-edit">
          <NumberField
            label={`${label}を修正`}
            value={live * scale}
            unit={unit}
            decimals={4}
            onCommit={(v) => {
              const res = run([{ op: 'update', id: r.equipmentId, ...nestedPatch(r.path, v / scale) }], `${r.equipmentId} ${label}を修正`);
              if (!res.errors.length) setEditing(false);
            }}
          />
          <button className="btn small" onClick={() => setEditing(false)}>
            キャンセル
          </button>
        </div>
      )}
    </li>
  );
}

export function ProposalCard({ msg }: { msg: ProposalMessage }) {
  const apply = useChatStore((s) => s.applyProposal);
  const discard = useChatStore((s) => s.discardProposal);
  const hasProblems = msg.errors.length > 0 || msg.issues.length > 0;
  const statusRef = useRef<HTMLDivElement>(null);
  const prevState = useRef(msg.state);
  const liveEquipment = useLineStore((s) => s.ir.equipment);
  useEffect(() => {
    // 適用した瞬間は、適用済みの表示 (仮定の承認欄) が見えるようにスクロールする
    if (prevState.current === 'pending' && msg.state === 'applied') {
      const el = statusRef.current;
      const box = el?.closest<HTMLElement>('.chat-messages');
      if (el && box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
    }
    prevState.current = msg.state;
  }, [msg.state]);

  return (
    <div className={`pc ${msg.state}`} data-testid="proposal-card">
      <div className="pc-reply">{msg.reply}</div>

      {msg.state === 'discarded' && <div className="pc-status muted">破棄済み</div>}
      {msg.state === 'stale' && (
        <div className="pc-banner error" role="alert">
          ラインが変更されたため適用できません。もう一度依頼してください
        </div>
      )}

      {msg.state !== 'discarded' && msg.state !== 'stale' && <Preview msg={msg} />}

      {msg.state === 'pending' && hasProblems && (
        <div className="pc-section">
          {msg.errors.map((e, i) => (
            <div key={`e${i}`} className="pc-banner error">
              エラー: {e}
            </div>
          ))}
          {msg.issues.map((i, k) => (
            <div key={`i${k}`} className={`pc-banner ${i.severity === 'error' ? 'error' : 'warn'}`}>
              {i.severity === 'error' ? 'エラー' : '注意'}: {i.message}
            </div>
          ))}
        </div>
      )}

      {msg.state === 'pending' && (
        <div className="pc-actions">
          <button className="btn primary" onClick={() => apply(msg.id)} disabled={!msg.ok}>
            適用
          </button>
          <button className="btn" onClick={() => discard(msg.id)}>
            破棄
          </button>
        </div>
      )}

      {msg.state === 'applied' && (
        <>
          <div className="pc-status ok" ref={statusRef}>✔ 適用済み</div>
          {msg.created && msg.created.some((r) => liveEquipment.some((e) => e.id === r.equipmentId)) && (
            <div className="pc-section">
              <h4>AIの仮定を確認</h4>
              <ul className="pc-list plain">
                {msg.created.map((r) => (
                  <AppliedAssumption key={r.id} r={r} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
