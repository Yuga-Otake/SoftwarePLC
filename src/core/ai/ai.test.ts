import { DEFAULTS } from '../library';
import { describe, expect, it } from 'vitest';
import type { AIProposal, AIProvider } from '../contracts';
import { buildStandardLine } from '../demo/standardLine';
import { applyPatch, emptyLine } from '../ir';
import type { LineIR } from '../ir';
import {
  AIError,
  SYSTEM_PROMPT,
  checkProposal,
  createDemoProvider,
  createGeminiProvider,
  DEFAULT_GEMINI_MODEL,
  PROPOSE_FUNCTION,
  proposeWithRetry,
} from './index';

const demo = createDemoProvider();
const run = async (ir: LineIR, message: string) => {
  const p = await demo.propose({ ir, history: [], message });
  const r = applyPatch(ir, p.ops);
  expect(r.errors).toEqual([]);
  return { p, ir: r.ir };
};
const eq = (ir: LineIR, id: string) => ir.equipment.find((e) => e.id === id)!;

describe('デモプロバイダ', () => {
  it('メタ情報', () => {
    expect(demo.id).toBe('demo');
    expect(demo.label).toBe('デモモード（定型文のみ）');
  });

  it('シーン1: 標準ラインと同じ構造 + 仮定', async () => {
    const { p, ir } = await run(emptyLine(), '2メートルのコンベヤで箱を流して、真ん中で2秒検査するラインを作って');
    const std = buildStandardLine();
    expect(ir.equipment).toEqual(std.equipment);
    expect(ir.connections).toEqual(std.connections);
    const open = ir.assumptions.filter((a) => a.status === 'open').map((a) => `${a.equipmentId}:${a.path}`);
    expect(open).toEqual(expect.arrayContaining(['CV1:params.speedMps', 'SRC1:params.intervalS', 'ST1:params.ngRate']));
    expect(open).not.toContain('CV1:params.lengthM');
    expect(open).not.toContain('ST1:params.inspectTimeS');
    expect(open).not.toContain('ST1:mount.offsetM');
    expect(p.reply).toContain('仮定');
    expect(p.reply).toContain('デモモード');
  });

  it('全角数字・既定値の仮定・位置指定', async () => {
    const { ir } = await run(emptyLine(), '３．５ｍのコンベヤで、１ｍ地点で３秒検査するラインを作って');
    expect((eq(ir, 'CV1') as any).params.lengthM).toBe(3.5);
    expect((eq(ir, 'ST1') as any).mount.offsetM).toBe(1);
    expect((eq(ir, 'ST1') as any).params.inspectTimeS).toBe(3);
    const paths = ir.assumptions.map((a) => a.path);
    expect(paths).not.toContain('mount.offsetM');
    const { ir: ir2 } = await run(emptyLine(), 'コンベヤのラインを作って');
    expect(ir2.equipment.map((e) => e.id)).toEqual(['CV1', 'SRC1']);
    expect(ir2.assumptions.map((a) => a.path)).toContain('params.lengthM');
  });

  it('検査時間だけ指定なし・位置なしなら仮定になる', async () => {
    const { ir } = await run(emptyLine(), '4メートルのコンベヤで検査するラインを作って');
    expect((eq(ir, 'ST1') as any).mount.offsetM).toBe(2);
    const paths = ir.assumptions.map((a) => `${a.equipmentId}:${a.path}`);
    expect(paths).toEqual(expect.arrayContaining(['ST1:params.inspectTimeS', 'ST1:mount.offsetM']));
  });

  it('シーン3: 検査1.5秒・1.5倍速', async () => {
    const { ir, p } = await run(buildStandardLine(), '検査を1.5秒にして、コンベヤを1.5倍速にして');
    expect((eq(ir, 'ST1') as any).params.inspectTimeS).toBe(1.5);
    expect((eq(ir, 'CV1') as any).params.speedMps).toBe(0.3);
    expect(p.ops).toHaveLength(2);
  });

  it('全角数字の変更', async () => {
    const { ir } = await run(buildStandardLine(), '検査を３秒にして、供給間隔を５秒にして、ＮＧ率を２０％にして');
    expect((eq(ir, 'ST1') as any).params.inspectTimeS).toBe(3);
    expect((eq(ir, 'SRC1') as any).params.intervalS).toBe(5);
    expect((eq(ir, 'ST1') as any).params.ngRate).toBe(0.2);
  });

  it('速度 m/s・長さ・ストッパ', async () => {
    const { ir } = await run(buildStandardLine(), '速度を0.5 m/sにして、コンベヤの長さを3メートルにして、ストッパを0.5秒にして');
    expect((eq(ir, 'CV1') as any).params.speedMps).toBe(0.5);
    expect((eq(ir, 'CV1') as any).params.lengthM).toBe(3);
    expect((eq(ir, 'ST1_STP') as any).params.actuationTimeS).toBe(0.5);
  });

  it('センサ追加 (位置指定 / 仮定)', async () => {
    const a = await run(buildStandardLine(), 'センサを追加して');
    const s = eq(a.ir, 'S1') as any;
    expect(s.kind).toBe('sensor');
    expect(s.mount).toEqual({ conveyorId: 'CV1', offsetM: 1 });
    expect(a.ir.assumptions.some((x) => x.equipmentId === 'S1' && x.path === 'mount.offsetM')).toBe(true);
    const b = await run(buildStandardLine(), 'CV1の0.5m地点にセンサを追加して');
    expect((eq(b.ir, 'S1') as any).mount.offsetM).toBe(0.5);
    expect(b.ir.assumptions.some((x) => x.equipmentId === 'S1')).toBe(false);
  });

  it('コンベヤ延長 → 検査ステーション追加 (空きコンベヤの中央)', async () => {
    const a = await run(buildStandardLine(), 'コンベヤを3メートル延長して');
    expect(eq(a.ir, 'CV2').kind).toBe('conveyor');
    expect((eq(a.ir, 'CV2') as any).params.lengthM).toBe(3);
    expect(a.ir.connections).toHaveLength(2);
    const b = await run(a.ir, '検査ステーションをもう1台追加して');
    expect((eq(b.ir, 'ST2') as any).mount).toEqual({ conveyorId: 'CV2', offsetM: 1.5 });
    expect(b.ir.assumptions.some((x) => x.equipmentId === 'ST2' && x.path === 'mount.offsetM')).toBe(true);
  });

  it('検査ステーション追加: 空きがなければ別の位置 (仮定付き)', async () => {
    const { ir } = await run(buildStandardLine(), '検査ステーションを追加して');
    const st2 = eq(ir, 'ST2') as any;
    expect(st2.mount.offsetM).not.toBe(1);
    expect(checkProposal(buildStandardLine(), { reply: '', ops: [] }).ok).toBe(true);
  });

  it('削除・名前変更', async () => {
    const a = await run(buildStandardLine(), 'ST1を削除して');
    expect(a.ir.equipment.map((e) => e.id)).toEqual(['CV1', 'SRC1']);
    const b = await run(buildStandardLine(), 'ラインの名前を「第2ライン」にして');
    expect(b.ir.name).toBe('第2ライン');
  });

  it('適用できない節は落として報告する', async () => {
    const p = await demo.propose({ ir: buildStandardLine(), history: [], message: 'コンベヤを0.5メートルにして、検査を4秒にして' });
    expect(p.ops).toHaveLength(1);
    expect(p.reply).toContain('適用できなかった');
    expect(applyPatch(buildStandardLine(), p.ops).errors).toEqual([]);
  });

  it('未知の文は ops 空 + 例示', async () => {
    const p = await demo.propose({ ir: buildStandardLine(), history: [], message: '今日の天気は?' });
    expect(p.ops).toEqual([]);
    expect(p.reply).toContain('Gemini の API キー');
    expect(p.reply.match(/^・/gm)!.length).toBeGreaterThanOrEqual(4);
  });

  it('ライン既存で作成依頼 → ops 空', async () => {
    const p = await demo.propose({
      ir: buildStandardLine(),
      history: [],
      message: '2メートルのコンベヤで箱を流して、真ん中で2秒検査するラインを作って',
    });
    expect(p.ops).toEqual([]);
    expect(p.reply).toContain('新規');
  });
});

/* ───────── Gemini ───────── */

const okBody = (args: unknown, extra: Record<string, unknown> = {}) => ({
  candidates: [
    {
      finishReason: 'STOP',
      content: { role: 'model', parts: [{ functionCall: { name: 'propose_changes', args } }] },
      ...extra,
    },
  ],
});
const mockFetch = (status: number, body: unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
};

describe('Gemini プロバイダ', () => {
  const ir = buildStandardLine();
  const good = { reply: '速度を変更します', ops: [{ op: 'update', id: 'CV1', params: { speedMps: 0.3 } }] };

  it('メタ情報', () => {
    const p = createGeminiProvider({ apiKey: 'k' });
    expect(p.id).toBe('gemini');
    expect(p.label).toBe('Gemini');
  });

  it('リクエスト形式とパース', async () => {
    const m = mockFetch(200, okBody(good));
    const p = createGeminiProvider({ apiKey: 'AIza-secret', fetchImpl: m.fn });
    const out = await p.propose({
      ir,
      history: [
        { role: 'assistant', text: '(先頭の assistant は捨てる)' },
        { role: 'user', text: '前の依頼' },
        { role: 'assistant', text: '前の返答' },
      ],
      message: '速くして',
    });
    expect(out).toEqual(good);
    expect(m.calls).toHaveLength(1);
    const { url, init } = m.calls[0];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(url).not.toContain('AIza-secret');
    expect(init.method).toBe('POST');
    const h = init.headers as Record<string, string>;
    expect(h['x-goog-api-key']).toBe('AIza-secret');
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe(SYSTEM_PROMPT);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].functionDeclarations).toHaveLength(1);
    expect(body.tools[0].functionDeclarations[0].name).toBe('propose_changes');
    expect(body.toolConfig.functionCallingConfig).toEqual({ mode: 'ANY', allowedFunctionNames: ['propose_changes'] });
    expect(body.contents.map((x: any) => x.role)).toEqual(['user', 'model', 'user']);
    expect(body.contents[1].parts[0].text).toBe('前の返答');
    const last = body.contents[2].parts[0].text as string;
    expect(last).toContain(JSON.stringify(ir));
    expect(last).toContain('速くして');
    expect(init.body as string).not.toContain('AIza-secret');
  });

  it('モデルは設定可能', async () => {
    const m = mockFetch(200, okBody(good));
    await createGeminiProvider({ apiKey: 'k', model: 'gemini-x', fetchImpl: m.fn }).propose({ ir, history: [], message: 'x' });
    expect(m.calls[0].url).toContain('/models/gemini-x:generateContent');
  });

  it('関数宣言は union を使わない平らなスキーマ', () => {
    expect(JSON.stringify(PROPOSE_FUNCTION)).not.toMatch(/anyOf|oneOf|"const"|additionalProperties/);
  });

  it('null / 空欄を落としてから検証する', async () => {
    const messy = {
      reply: 'OK',
      ops: [
        {
          op: 'update',
          id: 'CV1',
          name: '',
          params: { speedMps: 0.3, lengthM: null },
          transform: null,
          mount: {},
          item: null,
          kind: '',
        },
      ],
    };
    const p = createGeminiProvider({ apiKey: 'k', fetchImpl: mockFetch(200, okBody(messy)).fn });
    const out = await p.propose({ ir, history: [], message: 'x' });
    expect(out.ops).toEqual([{ op: 'update', id: 'CV1', params: { speedMps: 0.3 } }]);
  });

  it('ops 省略は空配列', async () => {
    const p = createGeminiProvider({ apiKey: 'k', fetchImpl: mockFetch(200, okBody({ reply: '聞き返し' })).fn });
    expect(await p.propose({ ir, history: [], message: 'x' })).toEqual({ reply: '聞き返し', ops: [] });
  });

  it('システムプロンプトに既定値が入る', () => {
    expect(SYSTEM_PROMPT).toContain('speedMps=0.2');
    expect(SYSTEM_PROMPT).toContain(`intervalS=${DEFAULTS.source.intervalS}`);
    expect(SYSTEM_PROMPT).toContain('assume');
    expect(SYSTEM_PROMPT).toContain('propose_semantics');
  });

  it('glb の手掛かりは meta (fileName/sizeM/nodeNames) と name に限定される', () => {
    for (const k of ['visual.meta.fileName', 'visual.meta.sizeM', 'visual.meta.nodeNames', 'params.lengthM', 'params.heightM'])
      expect(SYSTEM_PROMPT).toContain(k);
  });

  const kindOf = async (status: number, body: unknown) => {
    const p = createGeminiProvider({ apiKey: 'k', fetchImpl: mockFetch(status, body).fn });
    try {
      await p.propose({ ir, history: [], message: 'x' });
    } catch (e) {
      expect(e).toBeInstanceOf(AIError);
      return (e as AIError).kind;
    }
    return 'none';
  };

  it('エラー分類', async () => {
    expect(await kindOf(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } })).toBe('auth');
    expect(await kindOf(400, { error: { message: 'x', details: [{ reason: 'API_KEY_INVALID' }] } })).toBe('auth');
    expect(await kindOf(400, { error: { status: 'INVALID_ARGUMENT', message: 'bad schema' } })).toBe('api');
    expect(await kindOf(401, { error: { message: 'unauthenticated' } })).toBe('auth');
    expect(await kindOf(403, { error: { message: 'denied' } })).toBe('auth');
    expect(await kindOf(429, { error: { message: 'slow down' } })).toBe('rate_limit');
    expect(await kindOf(500, { error: { message: 'oops' } })).toBe('api');
    expect(await kindOf(200, okBody({ reply: 'x', ops: [{ op: 'remove' }] }))).toBe('bad_output');
    expect(await kindOf(200, okBody({ ops: [] }))).toBe('bad_output');
    expect(await kindOf(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hi' }] } }] })).toBe('bad_output');
    expect(await kindOf(200, { candidates: [] })).toBe('bad_output');
    expect(await kindOf(200, okBody(good, { finishReason: 'MAX_TOKENS' }))).toBe('bad_output');
    expect(await kindOf(200, { promptFeedback: { blockReason: 'SAFETY' } })).toBe('refusal');
    expect(await kindOf(200, { candidates: [{ finishReason: 'SAFETY' }] })).toBe('refusal');
    const p = createGeminiProvider({
      apiKey: 'k',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    await expect(p.propose({ ir, history: [], message: 'x' })).rejects.toMatchObject({ kind: 'network' });
  });
});

/* ───────── checkProposal / proposeWithRetry ───────── */

describe('checkProposal / proposeWithRetry', () => {
  const ir = buildStandardLine();
  const badP: AIProposal = { reply: '削除します', ops: [{ op: 'remove', id: 'NOPE' }] };
  const goodP: AIProposal = { reply: 'OK', ops: [{ op: 'update', id: 'CV1', params: { speedMps: 0.4 } }] };

  it('checkProposal', () => {
    expect(checkProposal(ir, goodP).ok).toBe(true);
    const c = checkProposal(ir, badP);
    expect(c.ok).toBe(false);
    expect(c.result.errors.length).toBeGreaterThan(0);
  });

  const stub = (id: 'gemini' | 'demo', replies: AIProposal[]) => {
    const calls: { message: string; history: number }[] = [];
    const provider: AIProvider = {
      id,
      label: id,
      async propose(input) {
        calls.push({ message: input.message, history: input.history.length });
        return replies[Math.min(calls.length - 1, replies.length - 1)];
      },
    };
    return { provider, calls };
  };

  it('gemini は 1 回だけ再試行してエラーを伝える', async () => {
    const s = stub('gemini', [badP, goodP]);
    const r = await proposeWithRetry(s.provider, { ir, history: [], message: '消して' });
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1].message).toContain('NOPE');
    expect(s.calls[1].history).toBe(2);
    expect(r.proposal).toBe(goodP);
    expect(r.check.ok).toBe(true);
    const s2 = stub('gemini', [badP]);
    const r2 = await proposeWithRetry(s2.provider, { ir, history: [], message: '消して' });
    expect(s2.calls).toHaveLength(2);
    expect(r2.check.ok).toBe(false);
  });

  it('成功時・demo は再試行しない', async () => {
    const s = stub('gemini', [goodP]);
    await proposeWithRetry(s.provider, { ir, history: [], message: 'x' });
    expect(s.calls).toHaveLength(1);
    const d = stub('demo', [badP]);
    const r = await proposeWithRetry(d.provider, { ir, history: [], message: 'x' });
    expect(d.calls).toHaveLength(1);
    expect(r.check.ok).toBe(false);
  });
});
