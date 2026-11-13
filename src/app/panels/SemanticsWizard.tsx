import { useEffect, useMemo, useState } from 'react';
import { DEFAULTS } from '@core/library';
import type { Conveyor, Equipment, Generic, PatchOp, Visual } from '@core/ir';
import { useLineStore } from '../store/lineStore';
import { useUiStore } from '../store/uiStore';
import { AXIS_ROT } from '../assets/fit';
import { confidenceLabel, suggestSemantics } from '../assets/suggest';
import type { SuggestKind } from '../assets/suggest';
import { entryFromEquipment, useUserLibrary } from '../assets/userLibrary';
import { KIND_LABEL, NumberField, Row, Section } from './ui';

type GlbVisual = Extract<Visual, { type: 'glb' }>;
type Axis = keyof typeof AXIS_ROT;
const AXES: Axis[] = ['+X', '-X', '+Z', '-Z'];
const r2 = (n: number) => Math.round(n * 100) / 100;

function run(ops: PatchOp[], label: string) {
  const res = useLineStore.getState().dispatch(ops, label);
  if (res.errors.length) useUiStore.getState().toast(res.errors[0], 'error');
  return res;
}

const KINDS: { kind: SuggestKind; label: string }[] = [
  { kind: 'conveyor', label: 'コンベヤ' },
  { kind: 'sensor', label: '在荷センサ' },
  { kind: 'stopper', label: 'ストッパ' },
  { kind: 'inspection_station', label: '検査ステーション' },
];

/** 値の出所タグ */
function Source({ edited, from }: { edited: boolean; from: string }) {
  return <span className={`src-tag${edited ? ' edited' : ''}`}>{edited ? '指定済み (あなたの入力)' : `${from} (仮定)`}</span>;
}

/* ───────── ウィザード (generic + glb) ───────── */

export function SemanticsWizard({ eq }: { eq: Generic }) {
  const visual = eq.visual as GlbVisual;
  const meta = visual.meta;
  const ir = useLineStore((s) => s.ir);
  const suggestion = useMemo(
    () => (meta ? suggestSemantics(meta) : { kind: null, confidence: 0, rationale: '' }),
    [meta],
  );
  const size = meta?.sizeM ?? [0.5, 0.5, 0.5];

  const [kind, setKind] = useState<SuggestKind | null>(suggestion.kind);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const mark = (k: string) => setEdited((s) => new Set(s).add(k));

  // 搬送方向: モデルの長手方向 (+) を初期値にするが、選択は必ずユーザーが確認する
  const longAxis: Axis = size[0] >= size[2] ? '+X' : '+Z';
  const [axis, setAxis] = useState<Axis>(longAxis);
  const extentAlong = (a: Axis) => (a.endsWith('X') ? size[0] : size[2]);
  const otherExtent = (a: Axis) => (a.endsWith('X') ? size[2] : size[0]);
  const k = visual.fit.scale;
  const [length, setLength] = useState<number | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const lengthV = length ?? Math.max(0.1, r2(extentAlong(axis) * k));
  const widthV = width ?? Math.max(0.05, Math.min(r2(otherExtent(axis) * k), lengthV));
  const heightV = height ?? Math.max(0.05, r2(size[1] * k));
  const speedV = speed ?? DEFAULTS.conveyor.speedMps;

  // 取付先 (センサ / ストッパ / 検査ステーション)
  const convs = ir.equipment.filter((e): e is Conveyor => e.kind === 'conveyor' && e.semantics.status === 'confirmed');
  const [convId, setConvId] = useState<string>(convs[0]?.id ?? '');
  const conv = convs.find((c) => c.id === convId) ?? convs[0];
  const [offset, setOffset] = useState<number | null>(null);
  const offsetV = Math.min(offset ?? r2((conv?.params.lengthM ?? 0) / 2), conv?.params.lengthM ?? 0);
  const onConv = (type: 'stopper' | 'sensor') =>
    ir.equipment.filter((e) => e.kind === type && 'mount' in e && e.mount.conveyorId === conv?.id);
  const [stopperId, setStopperId] = useState('');
  const [sensorId, setSensorId] = useState('');
  const stoppers = onConv('stopper');
  const sensors = onConv('sensor');
  const stopperSel = stoppers.find((e) => e.id === stopperId)?.id ?? stoppers[0]?.id;
  const sensorSel = sensors.find((e) => e.id === sensorId)?.id ?? sensors[0]?.id;

  // 3D プレビュー (IR には入れない)
  const setPreview = useUiStore((s) => s.setPreview);
  useEffect(() => {
    if (kind === 'conveyor')
      setPreview({ id: eq.id, rotationYDeg: AXIS_ROT[axis], lengthM: lengthV, widthM: widthV, heightM: heightV });
    else setPreview(null);
  }, [kind, axis, lengthV, widthV, heightV, eq.id, setPreview]);
  useEffect(() => () => setPreview(null), [setPreview]);

  const mounted = kind !== null && kind !== 'conveyor';
  let blocker: string | null = null;
  if (!kind) blocker = '種別を選んでください';
  else if (mounted && !conv) blocker = '取り付けるコンベヤ (確認済み) がありません。先にコンベヤを配置するか、このモデルをコンベヤとして確定してください';
  else if (kind === 'inspection_station' && (!stopperSel || !sensorSel))
    blocker = '検査ステーションには、同じコンベヤ上のストッパと在荷センサが必要です。いちばん簡単なのは、ライブラリから「検査セル」を追加し、見た目をこのモデルに差し替える方法です';

  const commit = (confirm: boolean) => {
    if (!kind || blocker) return;
    const userChose = suggestion.kind === null || kind !== suggestion.kind;
    const ops: PatchOp[] = [];
    const assumed: [string, string][] = [];
    const params: Record<string, unknown> = {};
    let mount: { conveyorId: string; offsetM: number } | undefined;
    let nextVisual: GlbVisual = visual;

    if (kind === 'conveyor') {
      Object.assign(params, { lengthM: lengthV, widthM: widthV, heightM: heightV, speedMps: speedV });
      nextVisual = { ...visual, fit: { ...visual.fit, rotationYDeg: AXIS_ROT[axis] } };
      if (!edited.has('axis')) assumed.push(['visual.fit.rotationYDeg', `外形の長手方向 (モデルの ${axis}) を搬送方向と仮定`]);
      if (!edited.has('length')) assumed.push(['params.lengthM', '外形寸法から (搬送方向の外形長)']);
      if (!edited.has('width')) assumed.push(['params.widthM', '外形寸法から (搬送方向と直交する外形)']);
      if (!edited.has('height')) assumed.push(['params.heightM', '外形寸法から (モデルの高さ)']);
      if (!edited.has('speed')) assumed.push(['params.speedMps', '標準値']);
    } else {
      mount = { conveyorId: conv!.id, offsetM: offsetV };
      if (!edited.has('offset')) assumed.push(['mount.offsetM', 'コンベヤ中央を仮定']);
      if (kind === 'stopper') {
        params.actuationTimeS = DEFAULTS.stopper.actuationTimeS;
        assumed.push(['params.actuationTimeS', '標準値']);
      }
      if (kind === 'inspection_station') {
        Object.assign(params, {
          inspectTimeS: DEFAULTS.inspection_station.inspectTimeS,
          ngRate: DEFAULTS.inspection_station.ngRate,
          stopperId: stopperSel,
          sensorId: sensorSel,
        });
        assumed.push(['params.inspectTimeS', '標準値'], ['params.ngRate', '標準値']);
      }
    }

    ops.push({
      op: 'propose_semantics',
      id: eq.id,
      kind,
      params,
      ...(mount ? { mount } : {}),
      confidence: userChose ? 1 : suggestion.confidence,
      rationale: userChose ? 'ユーザーが種別を選択' : `ルールベース推定: ${suggestion.rationale}`,
      source: userChose ? 'user' : 'ai',
    });
    if (nextVisual !== visual) ops.push({ op: 'update', id: eq.id, visual: nextVisual });
    for (const [path, rationale] of assumed) ops.push({ op: 'assume', equipmentId: eq.id, path, rationale });
    if (confirm) ops.push({ op: 'confirm_semantics', id: eq.id });
    const res = run(ops, confirm ? `${eq.id} を ${KIND_LABEL[kind]} として確定` : `${eq.id} を提案として保存`);
    if (!res.errors.length) useUiStore.getState().toast(confirm ? '設備として確定しました' : '提案として保存しました (未確認・不活性)');
  };

  return (
    <Section title="設備として使う">
      <div className="wiz">
        <p className="muted">
          このモデルは今は置物 (汎用オブジェクト) です。設備として動かすには、種別と動作の向き・寸法を確認して確定します。
        </p>

        <div className="wiz-suggest" data-testid="suggestion">
          <div className="muted">推定（ルールベース・AIではありません）</div>
          {suggestion.kind ? (
            <>
              <div>
                <b>{KIND_LABEL[suggestion.kind]}</b> の可能性 (確信度: {confidenceLabel(suggestion.confidence)})
              </div>
              <div className="rationale">根拠: {suggestion.rationale}</div>
            </>
          ) : (
            <div>手掛かりがありません。種別を選んでください</div>
          )}
          <div className="wiz-warn">見た目だけでは機能を断定できません。内容を確認してください。</div>
        </div>

        <div className="chip-grid" role="radiogroup" aria-label="種別">
          {KINDS.map((o) => (
            <button
              key={o.kind}
              role="radio"
              aria-checked={kind === o.kind}
              className={`chip${kind === o.kind ? ' active' : ''}`}
              onClick={() => setKind(o.kind)}
            >
              {o.label}
              {suggestion.kind === o.kind && <small>推定</small>}
            </button>
          ))}
        </div>

        {kind === 'conveyor' && (
          <>
            <div className="muted">搬送方向 (モデルのどの軸がワークの進む向きか。3D の黄色い矢印で確認)</div>
            <div className="chip-grid" role="radiogroup" aria-label="搬送方向">
              {AXES.map((a) => (
                <button
                  key={a}
                  role="radio"
                  aria-checked={axis === a}
                  className={`chip${axis === a ? ' active' : ''}`}
                  onClick={() => {
                    setAxis(a);
                    mark('axis');
                    // 向きを変えたら長さ・幅の既定値も取り直す (手入力済みの値は保持)
                  }}
                >
                  モデルの {a}
                  <small>外形 {r2(extentAlong(a) * k)} m</small>
                </button>
              ))}
            </div>
            <Source edited={edited.has('axis')} from={axis === longAxis ? '長手方向' : '外形'} />
            <Row label="有効長">
              <NumberField label="有効長" value={lengthV} unit="m" min={0.1} decimals={2} onCommit={(v) => (setLength(v), mark('length'))} />
            </Row>
            <Source edited={edited.has('length')} from="外形から" />
            <Row label="幅">
              <NumberField label="幅" value={widthV} unit="m" min={0.05} decimals={2} onCommit={(v) => (setWidth(v), mark('width'))} />
            </Row>
            <Source edited={edited.has('width')} from="外形から" />
            <Row label="搬送面高さ">
              <NumberField label="搬送面高さ" value={heightV} unit="m" min={0.05} decimals={2} onCommit={(v) => (setHeight(v), mark('height'))} />
            </Row>
            <Source edited={edited.has('height')} from="外形から" />
            <Row label="搬送速度">
              <NumberField label="搬送速度" value={speedV} unit="m/s" min={0.01} decimals={2} onCommit={(v) => (setSpeed(v), mark('speed'))} />
            </Row>
            <Source edited={edited.has('speed')} from="標準値" />
          </>
        )}

        {mounted && conv && (
          <>
            <Row label="取付先">
              <select className="select" aria-label="取付先コンベヤ" value={conv.id} onChange={(e) => setConvId(e.target.value)}>
                {convs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} {c.name}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="取付位置">
              <NumberField
                label="取付位置"
                value={offsetV}
                unit="m"
                min={0}
                max={conv.params.lengthM}
                decimals={2}
                onCommit={(v) => (setOffset(v), mark('offset'))}
              />
            </Row>
            <input
              className="slider"
              type="range"
              aria-label="取付位置スライダ"
              min={0}
              max={conv.params.lengthM}
              step={0.01}
              value={offsetV}
              onChange={(e) => (setOffset(Number(e.target.value)), mark('offset'))}
            />
            <Source edited={edited.has('offset')} from="コンベヤ中央" />
            {kind === 'inspection_station' && stopperSel && sensorSel && (
              <p className="muted">
                参照するストッパ: {stopperSel} / 在荷センサ: {sensorSel}
              </p>
            )}
            {kind !== 'inspection_station' && <p className="muted">動作時間などは標準値で仮定されます (確定後に編集できます)。</p>}
          </>
        )}

        {blocker && kind && <p className="wiz-warn">{blocker}</p>}

        <div className="btn-row">
          <button className="btn primary" disabled={!!blocker} onClick={() => commit(true)}>
            この内容で確定
          </button>
          <button className="btn" disabled={!!blocker} onClick={() => commit(false)}>
            提案として保存（未確認）
          </button>
        </div>
        <p className="muted">確定するまでは動作しません。確定すると I/O・動作軸が付き、シミュレーションで動きます。</p>
      </div>
    </Section>
  );
}

/* ───────── 確認済み glb 設備のアクション ───────── */

export function GlbEquipmentActions({ eq }: { eq: Equipment }) {
  const ir = useLineStore((s) => s.ir);
  const addToLib = useUserLibrary((s) => s.add);
  const toast = useUiStore.getState().toast;
  if (eq.visual.type !== 'glb' || eq.kind === 'generic') return null;
  const saved = () => {
    const entry = entryFromEquipment(eq);
    if (!entry) return;
    addToLib(entry);
    toast('マイ設備に保存しました (「設備」タブ)');
  };
  const confirmedConveyor = eq.kind === 'conveyor' && eq.semantics.status === 'confirmed';
  const connected = ir.connections.some((c) => c.to.equipmentId === eq.id && c.to.portId === 'in');
  const addSource = () => {
    const used = new Set(ir.equipment.map((e) => e.id));
    let n = 1;
    while (used.has(`SRC${n}`)) n++;
    const id = `SRC${n}`;
    const res = run(
      [
        { op: 'add', item: 'source', id },
        { op: 'connect', from: { equipmentId: id, portId: 'out' }, to: { equipmentId: eq.id, portId: 'in' } },
      ],
      `${id} を接続`,
    );
    if (!res.errors.length) {
      toast(`${id} を ${eq.id} の入口につなぎました`);
      useUiStore.getState().requestFit();
    }
  };
  const addInspection = () => {
    if (eq.kind !== 'conveyor') return;
    const res = run(
      [{ op: 'add', item: 'inspection_cell', mount: { conveyorId: eq.id, offsetM: r2(eq.params.lengthM / 2) } }],
      '検査セルを追加',
    );
    if (!res.errors.length) {
      toast('検査セルを中央に載せました');
      useUiStore.getState().requestFit();
    }
  };
  return (
    <Section title="このモデルを設備として完成させる">
      <div className="btn-row">
        {confirmedConveyor && (
          <>
            <button className="btn" disabled={connected} onClick={addSource}>
              供給口をつなぐ
            </button>
            <button className="btn" onClick={addInspection}>
              検査セルを載せる
            </button>
          </>
        )}
        {eq.semantics.status === 'confirmed' && (
          <button className="btn" onClick={saved}>
            マイ設備に保存
          </button>
        )}
      </div>
    </Section>
  );
}

/* ───────── モデルの位置合わせ (fit) ───────── */

export function GlbFitEditor({ eq }: { eq: Equipment }) {
  if (eq.visual.type !== 'glb') return null;
  const v = eq.visual;
  const fit = v.fit;
  const set = (patch: Partial<typeof fit>) =>
    run([{ op: 'update', id: eq.id, visual: { ...v, fit: { ...fit, ...patch } } }], `${eq.id} モデル位置合わせ`);
  const pos = (i: 0 | 1 | 2) => (n: number) => {
    const p = [...fit.position] as typeof fit.position;
    p[i] = n;
    set({ position: p });
  };
  return (
    <Section title="モデルの位置合わせ">
      <p className="muted">
        {v.meta ? `${v.meta.fileName} / 外形 ${v.meta.sizeM.join('×')} m (X×Y×Z)。` : ''}
        自動配置への補正です。機能 (長さ・位置) は変わりません。
      </p>
      <Row label="回転 (Y 軸)">
        <NumberField label="モデル回転" value={fit.rotationYDeg} unit="°" decimals={1} onCommit={(n) => set({ rotationYDeg: n })} />
      </Row>
      <Row label="スケール">
        <NumberField label="モデルスケール" value={fit.scale} unit="倍" min={0.01} decimals={3} onCommit={(n) => set({ scale: n })} />
      </Row>
      <Row label="オフセット X">
        <NumberField label="オフセット X" value={fit.position[0]} unit="m" onCommit={pos(0)} />
      </Row>
      <Row label="オフセット Y">
        <NumberField label="オフセット Y" value={fit.position[1]} unit="m" onCommit={pos(1)} />
      </Row>
      <Row label="オフセット Z">
        <NumberField label="オフセット Z" value={fit.position[2]} unit="m" onCommit={pos(2)} />
      </Row>
    </Section>
  );
}
