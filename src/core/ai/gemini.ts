import { z } from 'zod';
import type { AIProposal, AIProvider, ChatTurn } from '../contracts';
import { PatchOp } from '../ir/schema';
import type { LineIR } from '../ir';
import { AIError } from './errors';
import { SYSTEM_PROMPT } from './prompt';

/** 既定モデル (Gemini API の安定版 Flash)。設定画面で変更できる */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const TOOL_NAME = 'propose_changes';

type Json = Record<string, unknown>;

/* ───────── PatchOp の関数宣言スキーマ ─────────
 * Gemini は JSON Schema の部分集合しか受け付けず、union/oneOf/const は不安定なため、
 * ops の要素は「op 列挙 + 全フィールド任意」の平らな 1 つのオブジェクトにする。
 * 各フィールドがどの op で使われるかは description に書く。
 * 実際の検証は応答受信後に zod の PatchOp で行う (zod が真のゲート)。
 * 意図的な省略: visual / semantics (GLB 参照や確認状態は AI が設定しない)。 */
const str = (description: string): Json => ({ type: 'string', description });
const num = (description: string): Json => ({ type: 'number', description });
const obj = (description: string, properties: Json): Json => ({ type: 'object', description, properties });

const PARAMS_SCHEMA = obj(
  'add / update / propose_semantics: 種別ごとの params の部分指定 (指定したキーだけ)',
  {
    lengthM: num('conveyor: 長さ [m]'),
    widthM: num('conveyor: 幅 [m]'),
    heightM: num('conveyor: 搬送面の高さ [m]'),
    speedMps: num('conveyor: 搬送速度 [m/s]'),
    intervalS: num('source: 供給間隔 [s]'),
    workpiece: obj('source: ワーク寸法 [m]', {
      lengthM: num('長さ'),
      widthM: num('幅'),
      heightM: num('高さ'),
    }),
    actuationTimeS: num('stopper: 開閉時間 [s]'),
    inspectTimeS: num('inspection_station: 検査時間 [s]'),
    ngRate: num('inspection_station: NG 率 0..1'),
    stopperId: str('inspection_station: ストッパの設備 ID'),
    sensorId: str('inspection_station: 在荷センサの設備 ID'),
  },
);
const portRef = (d: string): Json => ({
  ...obj(d, { equipmentId: str('設備 ID'), portId: str('ポート ID (in / out)') }),
});

export const PATCH_OP_ITEM_SCHEMA: Json = {
  type: 'object',
  description: 'IR への変更 1 件。op ごとに使うフィールドだけを埋め、他は省略する。',
  properties: {
    op: {
      type: 'string',
      format: 'enum',
      enum: [
        'add',
        'update',
        'remove',
        'connect',
        'disconnect',
        'propose_semantics',
        'confirm_semantics',
        'reject_semantics',
        'assume',
        'accept_assumption',
        'rename_line',
      ],
      description: '操作の種類 (必須)',
    },
    item: {
      type: 'string',
      format: 'enum',
      enum: ['conveyor', 'source', 'sensor', 'stopper', 'inspection_cell', 'generic'],
      description: 'add のみ (必須): 追加する設備ライブラリ項目',
    },
    id: str(
      '設備 ID。update / remove / propose_semantics / confirm_semantics / reject_semantics は必須 (対象)、add は任意 (省略で自動採番)、accept_assumption は仮定の ID (必須)',
    ),
    name: str('add / update: 表示名 (任意)。rename_line: 新しいライン名 (必須)'),
    params: PARAMS_SCHEMA,
    transform: obj('add / update: 床置き設備の配置 (任意・指定したキーだけ)', {
      position: { type: 'array', items: { type: 'number' }, description: '[x, y, z] [m]' },
      rotationYDeg: num('Y 軸回転 [度]'),
      scale: num('拡大率 (正の数)'),
    }),
    mount: obj(
      'add (sensor/stopper 等の取付設備) / update / propose_semantics: コンベヤへの取付位置。add と propose_semantics では conveyorId と offsetM の両方を指定',
      {
        conveyorId: str('取り付け先コンベヤの ID'),
        offsetM: num('搬入端からの距離 [m] (0 以上)'),
      },
    ),
    after: str('add のみ (任意): 接続元の上流コンベヤの ID (conveyor 追加時)'),
    kind: {
      type: 'string',
      format: 'enum',
      enum: ['conveyor', 'sensor', 'stopper', 'inspection_station', 'source'],
      description: 'propose_semantics のみ (必須): 提案する種別',
    },
    confidence: num('propose_semantics のみ (必須): 確信度 0..1'),
    rationale: str('propose_semantics / assume のみ (必須): 根拠・理由'),
    from: portRef('connect のみ (必須): 接続元ポート (out 側)'),
    to: portRef('connect のみ (必須): 接続先ポート (in 側)'),
    connectionId: str('disconnect のみ (必須): 接続 ID'),
    equipmentId: str('assume のみ (必須): 仮定を置く設備の ID'),
    path: str('assume のみ (必須): 仮定した値のパス (例: params.speedMps)'),
  },
  required: ['op'],
};

export const PROPOSE_FUNCTION: Json = {
  name: TOOL_NAME,
  description:
    'ユーザーへの返答文 (reply) と、IR への変更提案 (ops: PatchOp の配列) を返す。ops は提案であり、適用は人間が行う。提案できない/聞き返す場合は ops を空配列にする。',
  parameters: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'ユーザーへの日本語の返答 (簡潔に)' },
      ops: { type: 'array', items: PATCH_OP_ITEM_SCHEMA },
    },
    required: ['reply', 'ops'],
  },
};

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  /** 既定: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent */
  apiUrl?: string;
}

export function buildUserContent(ir: LineIR, message: string): string {
  return `現在の IR (JSON):\n${JSON.stringify(ir)}\n\nユーザーの依頼:\n${message}\n\n(propose_changes 関数を 1 回だけ呼んで回答してください)`;
}

function historyContents(history: ChatTurn[]): { role: 'user' | 'model'; parts: { text: string }[] }[] {
  const out = history
    .filter((t) => t.text.trim() !== '')
    .map((t) => ({ role: (t.role === 'assistant' ? 'model' : 'user') as 'user' | 'model', parts: [{ text: t.text }] }));
  while (out.length && out[0].role !== 'user') out.shift(); // 先頭は user
  return out;
}

/** null / 空文字 / 空オブジェクト・配列を再帰的に落とす (Gemini は未指定欄を null や空で埋めることがある) */
export function stripEmpty(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripEmpty).filter((x) => x !== undefined);
  if (v && typeof v === 'object') {
    const o: Json = {};
    for (const [k, x] of Object.entries(v as Json)) {
      const s = stripEmpty(x);
      if (s !== undefined) o[k] = s;
    }
    return Object.keys(o).length ? o : undefined;
  }
  if (v === null || v === '') return undefined;
  return v;
}

function cleanOps(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  // 各 op は少なくとも op を持つので、空 object 化して消えることはない
  return raw.map((o) => stripEmpty(o) ?? o);
}

interface ApiErrorBody {
  error?: { message?: unknown; status?: unknown; details?: { reason?: unknown }[] };
}
function apiErrorInfo(body: unknown): { detail: string; keyInvalid: boolean } {
  const e = (body as ApiErrorBody | null)?.error;
  const message = typeof e?.message === 'string' ? e.message : '';
  const keyInvalid =
    !!e?.details?.some((d) => d?.reason === 'API_KEY_INVALID') || /api key not valid|API_KEY_INVALID/i.test(message);
  return { detail: message.slice(0, 200), keyInvalid };
}

const BLOCKED_FINISH = new Set(['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'RECITATION', 'IMAGE_SAFETY']);
const REFUSAL_TEXT = 'AI がこの依頼への対応を見送りました。依頼の表現を変えてお試しください。';

export function createGeminiProvider(opts: GeminiProviderOptions): AIProvider {
  const model = opts.model?.trim() || DEFAULT_GEMINI_MODEL;
  const url = opts.apiUrl ?? `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const doFetch: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));

  return {
    id: 'gemini',
    label: 'Gemini',
    async propose({ ir, history, message }): Promise<AIProposal> {
      const body = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [...historyContents(history), { role: 'user', parts: [{ text: buildUserContent(ir, message) }] }],
        tools: [{ functionDeclarations: [PROPOSE_FUNCTION] }],
        toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [TOOL_NAME] } },
      };

      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify(body),
        });
      } catch {
        throw new AIError('network', 'AI に接続できませんでした。ネットワークを確認してもう一度お試しください。');
      }

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        const { detail, keyInvalid } = apiErrorInfo(data);
        if (res.status === 401 || res.status === 403 || (res.status === 400 && keyInvalid))
          throw new AIError('auth', 'API キーが無効か、権限がありません。キーを確認してください。', res.status);
        if (res.status === 429)
          throw new AIError('rate_limit', '利用が集中しているか上限に達しました。少し待ってからもう一度お試しください。', res.status);
        throw new AIError('api', `AI サービスがエラーを返しました (${res.status})${detail ? `: ${detail}` : ''}`, res.status);
      }

      const r = data as {
        promptFeedback?: { blockReason?: string };
        candidates?: { finishReason?: string; content?: { parts?: { functionCall?: { name?: string; args?: unknown } }[] } }[];
      } | null;
      if (!r || typeof r !== 'object') throw new AIError('bad_output', 'AI の応答を読み取れませんでした。もう一度お試しください。');
      if (r.promptFeedback?.blockReason) throw new AIError('refusal', REFUSAL_TEXT);
      const cand = r.candidates?.[0];
      if (!cand) throw new AIError('bad_output', 'AI の応答を読み取れませんでした。もう一度お試しください。');
      if (cand.finishReason && BLOCKED_FINISH.has(cand.finishReason)) throw new AIError('refusal', REFUSAL_TEXT);
      if (cand.finishReason === 'MAX_TOKENS')
        throw new AIError('bad_output', 'AI の出力が途中で打ち切られました。依頼を小さく分けてお試しください。');

      const call = cand.content?.parts?.find((p) => p?.functionCall?.name === TOOL_NAME)?.functionCall;
      let args: unknown = call?.args;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          /* 下で弾く */
        }
      }
      if (!args || typeof args !== 'object')
        throw new AIError('bad_output', 'AI が提案の形式で回答しませんでした。もう一度お試しください。');
      const input = args as { reply?: unknown; ops?: unknown };
      if (typeof input.reply !== 'string')
        throw new AIError('bad_output', 'AI の返答文が不正でした。もう一度お試しください。');

      let rawOps = input.ops ?? [];
      if (typeof rawOps === 'string') {
        try {
          rawOps = JSON.parse(rawOps);
        } catch {
          /* 下で検証に失敗する */
        }
      }
      const parsed = z.array(PatchOp).safeParse(cleanOps(rawOps));
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new AIError(
          'bad_output',
          `AI の提案の形式が不正でした (${first.path.join('.')} ${first.message})。もう一度お試しください。`,
        );
      }
      return { reply: input.reply, ops: parsed.data };
    },
  };
}
