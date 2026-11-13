import { z } from 'zod';
import type { AIProposal, AIProvider, ChatTurn } from '../contracts';
import { PatchOp } from '../ir/schema';
import type { LineIR } from '../ir';
import { AIError } from './errors';
import { SYSTEM_PROMPT } from './prompt';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const TOOL_NAME = 'propose_changes';

type Json = Record<string, unknown>;

/* ───────── PatchOp の JSON Schema (schema.ts の PatchOp を手で写したもの) ─────────
 * 意図的な省略: add.visual / add.semantics / update.visual (GLB 参照や確認状態は AI が設定しない)。
 * 実際の検証は応答受信後に zod の PatchOp で行う。 */
const str = { type: 'string' };
const num = { type: 'number' };
const vec3 = { type: 'array', items: num, minItems: 3, maxItems: 3 };
const mountProps = { conveyorId: str, offsetM: { type: 'number', minimum: 0, description: '搬入端からの距離 [m]' } };
const mount = { type: 'object', properties: mountProps, required: ['conveyorId', 'offsetM'], additionalProperties: false };
const mountPartial = { type: 'object', properties: mountProps, additionalProperties: false };
const transformPartial = {
  type: 'object',
  properties: { position: vec3, rotationYDeg: num, scale: { type: 'number', exclusiveMinimum: 0 } },
  additionalProperties: false,
};
const portRef = {
  type: 'object',
  properties: { equipmentId: str, portId: str },
  required: ['equipmentId', 'portId'],
  additionalProperties: false,
};
const params = { type: 'object', additionalProperties: true, description: '種別ごとの params の部分指定' };
const op = (name: string, properties: Json, required: string[] = []): Json => ({
  type: 'object',
  properties: { op: { const: name }, ...properties },
  required: ['op', ...required],
  additionalProperties: false,
});

export const PATCH_OP_JSON_SCHEMA: Json = {
  anyOf: [
    op(
      'add',
      {
        item: { enum: ['conveyor', 'source', 'sensor', 'stopper', 'inspection_cell', 'generic'] },
        id: str,
        name: str,
        params,
        transform: transformPartial,
        mount,
        after: { type: 'string', description: '上流コンベヤの ID (conveyor のみ)' },
      },
      ['item'],
    ),
    op('update', { id: str, name: str, params, transform: transformPartial, mount: mountPartial }, ['id']),
    op('remove', { id: str }, ['id']),
    op('connect', { from: portRef, to: portRef }, ['from', 'to']),
    op('disconnect', { connectionId: str }, ['connectionId']),
    op(
      'propose_semantics',
      {
        id: str,
        kind: { enum: ['conveyor', 'sensor', 'stopper', 'inspection_station', 'source'] },
        params,
        mount,
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        rationale: str,
      },
      ['id', 'kind', 'confidence', 'rationale'],
    ),
    op('confirm_semantics', { id: str }, ['id']),
    op('reject_semantics', { id: str }, ['id']),
    op('assume', { equipmentId: str, path: str, rationale: str }, ['equipmentId', 'path', 'rationale']),
    op('accept_assumption', { id: str }, ['id']),
    op('rename_line', { name: str }, ['name']),
  ],
};

export const PROPOSE_TOOL: Json = {
  name: TOOL_NAME,
  description:
    'ユーザーへの返答文 (reply) と、IR への変更提案 (ops: PatchOp の配列) を返す。ops は提案であり、適用は人間が行う。提案できない/聞き返す場合は ops を空配列にする。',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'ユーザーへの日本語の返答 (簡潔に)' },
      ops: { type: 'array', items: PATCH_OP_JSON_SCHEMA },
    },
    required: ['reply', 'ops'],
    additionalProperties: false,
  },
};

/** 強制 tool_choice (any / tool) を 400 で拒否するモデル。これらは tool_choice:auto + 指示文で呼ばせる */
export function rejectsForcedToolChoice(model: string): boolean {
  return /^claude-(sonnet-5-5|opus-5-5|fable|mythos)/.test(model);
}

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  /** 既定: https://api.anthropic.com/v1/messages */
  apiUrl?: string;
}

function historyMessages(history: ChatTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  const out = history.filter((t) => t.text.trim() !== '').map((t) => ({ role: t.role, content: t.text }));
  while (out.length && out[0].role !== 'user') out.shift(); // 先頭は user
  return out;
}

export function buildUserContent(ir: LineIR, message: string): string {
  return `現在の IR (JSON):\n${JSON.stringify(ir)}\n\nユーザーの依頼:\n${message}\n\n(propose_changes ツールを 1 回だけ呼んで回答してください)`;
}

function apiErrorDetail(body: unknown): string {
  const m = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof m === 'string' ? m.slice(0, 200) : '';
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): AIProvider {
  const model = opts.model ?? DEFAULT_ANTHROPIC_MODEL;
  const url = opts.apiUrl ?? ANTHROPIC_API_URL;
  const doFetch: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));

  return {
    id: 'anthropic',
    label: `Claude (${model})`,
    async propose({ ir, history, message }): Promise<AIProposal> {
      const forced = !rejectsForcedToolChoice(model);
      const body = {
        model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: [PROPOSE_TOOL],
        tool_choice: forced ? { type: 'tool', name: TOOL_NAME } : { type: 'auto' },
        messages: [...historyMessages(history), { role: 'user', content: buildUserContent(ir, message) }],
      };

      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': opts.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            // ブラウザから直接呼ぶためのオプトイン
            'anthropic-dangerous-direct-browser-access': 'true',
          },
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
        const detail = apiErrorDetail(data);
        if (res.status === 401 || res.status === 403)
          throw new AIError('auth', 'API キーが無効か、権限がありません。キーを確認してください。', res.status);
        if (res.status === 429)
          throw new AIError('rate_limit', '利用が集中しているか上限に達しました。少し待ってからもう一度お試しください。', res.status);
        throw new AIError(
          'api',
          `AI サービスがエラーを返しました (${res.status})${detail ? `: ${detail}` : ''}`,
          res.status,
        );
      }

      const msg = data as { stop_reason?: string; stop_details?: { explanation?: string }; content?: unknown } | null;
      if (!msg || !Array.isArray(msg.content))
        throw new AIError('bad_output', 'AI の応答を読み取れませんでした。もう一度お試しください。');
      if (msg.stop_reason === 'refusal')
        throw new AIError('refusal', 'AI がこの依頼への対応を見送りました。依頼の表現を変えてお試しください。');
      if (msg.stop_reason === 'max_tokens')
        throw new AIError('bad_output', 'AI の出力が途中で打ち切られました。依頼を小さく分けてお試しください。');

      const block = (msg.content as { type?: string; name?: string; input?: unknown }[]).find(
        (b) => b?.type === 'tool_use' && b.name === TOOL_NAME,
      );
      const input = block?.input as { reply?: unknown; ops?: unknown } | undefined;
      if (!input || typeof input !== 'object')
        throw new AIError('bad_output', 'AI が提案の形式で回答しませんでした。もう一度お試しください。');
      if (typeof input.reply !== 'string')
        throw new AIError('bad_output', 'AI の返答文が不正でした。もう一度お試しください。');

      let rawOps = input.ops;
      if (typeof rawOps === 'string') {
        try {
          rawOps = JSON.parse(rawOps);
        } catch {
          /* 下で検証に失敗する */
        }
      }
      const parsed = z.array(PatchOp).safeParse(rawOps);
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
