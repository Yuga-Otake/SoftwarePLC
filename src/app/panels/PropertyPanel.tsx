import { useMemo, useState } from 'react';
import { validate } from '@core/ir';
import type { Equipment, PatchOp } from '@core/ir';
import { useLineStore } from '../store/lineStore';
import { useUiStore } from '../store/uiStore';
import { GlbEquipmentActions, GlbFitEditor, SemanticsWizard } from './SemanticsWizard';
import { AXIS_LABEL, KIND_LABEL, NumberField, ROLE_LABEL, Row, Section } from './ui';

function run(ops: PatchOp[], label: string) {
  const res = useLineStore.getState().dispatch(ops, label);
  if (res.errors.length) useUiStore.getState().toast(res.errors[0], 'error');
  return res;
}

export function PropertyPanel() {
  const ir = useLineStore((s) => s.ir);
  const selectedId = useLineStore((s) => s.selectedId);
  const eq = ir.equipment.find((e) => e.id === selectedId);
  return eq ? <EquipmentProps key={eq.id} eq={eq} /> : <LineSummary />;
}

/* ───────── 未選択: ライン概要 + 検証 ───────── */

function LineSummary() {
  const ir = useLineStore((s) => s.ir);
  const select = useLineStore((s) => s.select);
  const issues = useMemo(() => validate(ir), [ir]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of ir.equipment) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return [...m.entries()];
  }, [ir]);
  const openAssumptions = ir.assumptions.filter((a) => a.status === 'open').length;

  return (
    <div className="props">
      <Section title="ライン概要">
        <Row label="ライン名">{ir.name}</Row>
        <Row label="設備数">{ir.equipment.length}</Row>
        {counts.map(([k, n]) => (
          <Row key={k} label={KIND_LABEL[k] ?? k}>
            {n}
          </Row>
        ))}
        <Row label="接続数">{ir.connections.length}</Row>
        <Row label="未承認の仮定">{openAssumptions}</Row>
      </Section>
      <Section title={`検証結果 (${issues.length})`}>
        {issues.length === 0 ? (
          <p className="muted">問題は見つかりませんでした。</p>
        ) : (
          <ul className="issues">
            {issues.map((i, n) => (
              <li key={n}>
                <button
                  className={`issue ${i.severity}`}
                  disabled={!i.equipmentId}
                  onClick={() => i.equipmentId && select(i.equipmentId)}
                >
                  <span className="issue-tag">{i.severity === 'error' ? 'エラー' : '注意'}</span>
                  <span>{i.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {ir.equipment.length === 0 && <p className="muted">3D ビューの設備をタップするとここに詳細が表示されます。</p>}
    </div>
  );
}

/* ───────── 選択中設備 ───────── */

function NameField({ eq }: { eq: Equipment }) {
  const [text, setText] = useState(eq.name);
  const commit = () => {
    const t = text.trim();
    if (!t || t === eq.name) return setText(eq.name);
    run([{ op: 'update', id: eq.id, name: t }], '名称変更');
  };
  return (
    <input
      className="text-input"
      aria-label="名称"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ParamsEditor({ eq }: { eq: Equipment }) {
  const set = (params: Record<string, unknown>) => run([{ op: 'update', id: eq.id, params }], `${eq.id} パラメータ`);
  switch (eq.kind) {
    case 'conveyor':
      return (
        <>
          <Row label="長さ">
            <NumberField label="長さ" value={eq.params.lengthM} unit="m" min={0.1} onCommit={(v) => set({ lengthM: v })} />
          </Row>
          <Row label="幅">
            <NumberField label="幅" value={eq.params.widthM} unit="m" min={0.05} onCommit={(v) => set({ widthM: v })} />
          </Row>
          <Row label="搬送面高さ">
            <NumberField label="搬送面高さ" value={eq.params.heightM} unit="m" min={0.05} onCommit={(v) => set({ heightM: v })} />
          </Row>
          <Row label="搬送速度">
            <NumberField label="搬送速度" value={eq.params.speedMps} unit="m/s" min={0.01} onCommit={(v) => set({ speedMps: v })} />
          </Row>
        </>
      );
    case 'source': {
      const wp = eq.params.workpiece;
      const setWp = (k: 'lengthM' | 'widthM' | 'heightM', v: number) => set({ workpiece: { ...wp, [k]: v } });
      return (
        <>
          <Row label="投入間隔">
            <NumberField label="投入間隔" value={eq.params.intervalS} unit="s" min={0.1} onCommit={(v) => set({ intervalS: v })} />
          </Row>
          <Row label="ワーク長さ">
            <NumberField label="ワーク長さ" value={wp.lengthM} unit="m" min={0.01} onCommit={(v) => setWp('lengthM', v)} />
          </Row>
          <Row label="ワーク幅">
            <NumberField label="ワーク幅" value={wp.widthM} unit="m" min={0.01} onCommit={(v) => setWp('widthM', v)} />
          </Row>
          <Row label="ワーク高さ">
            <NumberField label="ワーク高さ" value={wp.heightM} unit="m" min={0.01} onCommit={(v) => setWp('heightM', v)} />
          </Row>
        </>
      );
    }
    case 'stopper':
      return (
        <Row label="動作時間">
          <NumberField label="動作時間" value={eq.params.actuationTimeS} unit="s" min={0} onCommit={(v) => set({ actuationTimeS: v })} />
        </Row>
      );
    case 'inspection_station':
      return (
        <>
          <Row label="検査時間">
            <NumberField label="検査時間" value={eq.params.inspectTimeS} unit="s" min={0.1} onCommit={(v) => set({ inspectTimeS: v })} />
          </Row>
          <Row label="NG 発生率">
            <NumberField
              label="NG 発生率"
              value={eq.params.ngRate * 100}
              unit="%"
              min={0}
              max={100}
              decimals={1}
              onCommit={(v) => set({ ngRate: Math.round(v * 10) / 1000 })}
            />
          </Row>
          <Row label="ストッパ">
            <RefLink id={eq.params.stopperId} />
          </Row>
          <Row label="在荷センサ">
            <RefLink id={eq.params.sensorId} />
          </Row>
        </>
      );
    default:
      return null;
  }
}

function RefLink({ id }: { id: string }) {
  const select = useLineStore((s) => s.select);
  return (
    <button className="link" onClick={() => select(id)}>
      {id}
    </button>
  );
}

function MountEditor({ eq }: { eq: Extract<Equipment, { mount: unknown }> }) {
  const ir = useLineStore((s) => s.ir);
  const convs = ir.equipment.filter((e) => e.kind === 'conveyor');
  const conv = convs.find((c) => c.id === eq.mount.conveyorId);
  const max = conv && conv.kind === 'conveyor' ? conv.params.lengthM : 0;
  const [local, setLocal] = useState<number | null>(null);
  const shown = local ?? eq.mount.offsetM;
  const commit = (v: number) => {
    setLocal(null);
    if (Math.abs(v - eq.mount.offsetM) > 1e-9) run([{ op: 'update', id: eq.id, mount: { offsetM: v } }], `${eq.id} 取付位置`);
  };
  return (
    <>
      <Row label="取付先">
        <select
          className="select"
          value={eq.mount.conveyorId}
          onChange={(e) => run([{ op: 'update', id: eq.id, mount: { conveyorId: e.target.value } }], `${eq.id} 取付先`)}
        >
          {!conv && <option value={eq.mount.conveyorId}>{eq.mount.conveyorId || '(未設定)'}</option>}
          {convs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} {c.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="取付位置">
        <NumberField label="取付位置" value={shown} unit="m" min={0} max={max} decimals={2} onCommit={commit} />
      </Row>
      <input
        className="slider"
        type="range"
        aria-label="取付位置スライダ"
        min={0}
        max={max}
        step={0.01}
        value={Math.min(shown, max)}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onBlur={(e) => local !== null && commit(Number(e.target.value))}
      />
      <div className="slider-scale">
        <span>0</span>
        <span>{max} m</span>
      </div>
    </>
  );
}

function TransformEditor({ eq }: { eq: Extract<Equipment, { transform: unknown }> }) {
  const t = eq.transform;
  const set = (patch: Partial<typeof t>) => run([{ op: 'update', id: eq.id, transform: patch }], `${eq.id} 配置`);
  const pos = (i: 0 | 1 | 2) => (v: number) => {
    const p = [...t.position] as typeof t.position;
    p[i] = v;
    set({ position: p });
  };
  return (
    <>
      <Row label="位置 X">
        <NumberField label="位置 X" value={t.position[0]} unit="m" onCommit={pos(0)} />
      </Row>
      <Row label="位置 Y (高さ)">
        <NumberField label="位置 Y" value={t.position[1]} unit="m" onCommit={pos(1)} />
      </Row>
      <Row label="位置 Z">
        <NumberField label="位置 Z" value={t.position[2]} unit="m" onCommit={pos(2)} />
      </Row>
      <Row label="回転 (Y 軸)">
        <NumberField label="回転" value={t.rotationYDeg} unit="°" decimals={1} onCommit={(v) => set({ rotationYDeg: v })} />
      </Row>
      <Row label="スケール">
        <NumberField label="スケール" value={t.scale} unit="倍" min={0.01} decimals={2} onCommit={(v) => set({ scale: v })} />
      </Row>
    </>
  );
}

function EquipmentProps({ eq }: { eq: Equipment }) {
  const ir = useLineStore((s) => s.ir);
  const select = useLineStore((s) => s.select);
  const sem = eq.semantics;
  const assumptions = ir.assumptions.filter((a) => a.equipmentId === eq.id);

  const portInfo = (portId: string) => {
    const out: string[] = [];
    for (const c of ir.connections) {
      if (c.from.equipmentId === eq.id && c.from.portId === portId) out.push(`→ ${c.to.equipmentId}.${c.to.portId}`);
      if (c.to.equipmentId === eq.id && c.to.portId === portId) out.push(`← ${c.from.equipmentId}.${c.from.portId}`);
    }
    return out.length ? out.join(', ') : '未接続';
  };

  const remove = () => {
    if (!window.confirm(`${eq.name} (${eq.id}) を削除しますか？\n取付けた設備や接続も一緒に削除される場合があります。`)) return;
    const res = run([{ op: 'remove', id: eq.id }], `${eq.id} 削除`);
    if (!res.errors.length) select(null);
  };

  return (
    <div className="props">
      <div className="props-head">
        <button className="link back" onClick={() => select(null)}>
          ← ライン概要
        </button>
        <span className="kind-pill">{KIND_LABEL[eq.kind]}</span>
        <span className="muted">{eq.id}</span>
      </div>
      <Section title="名称">
        <NameField eq={eq} />
      </Section>

      <Section title="意味付け">
        <Row label="状態">
          <span className={`pill ${sem.status}`}>{sem.status === 'confirmed' ? '確認済み' : '提案中 (不活性)'}</span>
        </Row>
        <Row label="出所">{{ library: 'ライブラリ', user: 'ユーザー', ai: 'AI' }[sem.source]}</Row>
        {sem.confidence !== undefined && <Row label="確信度">{Math.round(sem.confidence * 100)}%</Row>}
        {sem.rationale && <p className="rationale">{sem.rationale}</p>}
        {sem.status === 'proposed' && (
          <div className="btn-row">
            <button className="btn primary" onClick={() => run([{ op: 'confirm_semantics', id: eq.id }], '意味付けを確認')}>
              確認して有効化
            </button>
            <button className="btn" onClick={() => run([{ op: 'reject_semantics', id: eq.id }], '意味付けを却下')}>
              却下
            </button>
          </div>
        )}
      </Section>

      {eq.kind === 'generic' && eq.visual.type === 'glb' && <SemanticsWizard eq={eq} />}
      {eq.kind !== 'generic' && eq.visual.type === 'glb' && <GlbEquipmentActions eq={eq} />}

      {(eq.kind !== 'sensor' && eq.kind !== 'generic') && (
        <Section title="パラメータ">
          <ParamsEditor eq={eq} />
        </Section>
      )}

      {'mount' in eq ? (
        <Section title="取付位置">
          <MountEditor eq={eq} />
        </Section>
      ) : (
        <Section title="配置">
          <TransformEditor eq={eq} />
        </Section>
      )}

      {eq.visual.type === 'glb' && <GlbFitEditor eq={eq} />}

      <Section title={`I/O (${eq.io.length})`}>
        {eq.io.length === 0 ? (
          <p className="muted">なし</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>タグ</th>
                <th>種別</th>
                <th>役割</th>
                <th>アドレス</th>
              </tr>
            </thead>
            <tbody>
              {eq.io.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.tag}</td>
                  <td>{p.dir}</td>
                  <td>{ROLE_LABEL[p.role] ?? p.role}</td>
                  <td className="mono">{p.address ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`動作軸 (${eq.axes.length})`}>
        {eq.axes.length === 0 ? (
          <p className="muted">なし</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>軸</th>
                <th>種類</th>
                <th>方向</th>
                <th>駆動 I/O</th>
              </tr>
            </thead>
            <tbody>
              {eq.axes.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{a.id}</td>
                  <td>
                    {AXIS_LABEL[a.type] ?? a.type}
                    {a.strokeM !== undefined ? ` ${a.strokeM}m` : ''}
                  </td>
                  <td className="mono">({a.direction.join(', ')})</td>
                  <td>{a.drivenByIo ? (ROLE_LABEL[a.drivenByIo] ?? a.drivenByIo) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`接続点 (${eq.ports.length})`}>
        {eq.ports.length === 0 ? (
          <p className="muted">なし</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>ポート</th>
                <th>向き</th>
                <th>接続先</th>
              </tr>
            </thead>
            <tbody>
              {eq.ports.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.id}</td>
                  <td>{p.role === 'in' ? '入口' : '出口'}</td>
                  <td>{portInfo(p.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title={`仮定 (${assumptions.length})`}>
        {assumptions.length === 0 ? (
          <p className="muted">なし</p>
        ) : (
          <ul className="assumptions">
            {assumptions.map((a) => (
              <li key={a.id}>
                <div>
                  <span className="mono">{a.path}</span> = <span className="mono">{JSON.stringify(a.value)}</span>
                  <p className="rationale">{a.rationale}</p>
                </div>
                {a.status === 'open' ? (
                  <button className="btn small" onClick={() => run([{ op: 'accept_assumption', id: a.id }], '仮定を承認')}>
                    承認
                  </button>
                ) : (
                  <span className="pill confirmed">承認済み</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="danger-zone">
        <button className="btn danger" onClick={remove}>
          削除
        </button>
      </div>
    </div>
  );
}
