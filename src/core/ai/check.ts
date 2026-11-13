import type { AIProposal, AIProvider, ChatTurn, PatchResult, ValidationIssue } from '../contracts';
import { applyPatch, validate } from '../ir';
import type { LineIR } from '../ir';
import { AIError } from './errors';

export interface ProposalCheck {
  ok: boolean;
  result: PatchResult;
  issues: ValidationIssue[];
}

/** 提案を適用し、結果の IR を検証する。ok = パッチエラーなし かつ 検証エラーなし (警告は許容) */
export function checkProposal(ir: LineIR, proposal: AIProposal): ProposalCheck {
  const result = applyPatch(ir, proposal.ops);
  const issues = result.errors.length ? [] : validate(result.ir);
  const ok = result.errors.length === 0 && !issues.some((i) => i.severity === 'error');
  return { ok, result, issues };
}

export interface ProposeInput {
  ir: LineIR;
  history: ChatTurn[];
  message: string;
}

function errorText(check: ProposalCheck): string {
  const lines = [
    ...check.result.errors,
    ...check.issues.filter((i) => i.severity === 'error').map((i) => i.message),
  ];
  return lines.map((l) => `・${l}`).join('\n');
}

/** 提案 → 検査。anthropic のみ、失敗時に 1 回だけエラーを伝えて再提案を求める。最後の試行を返す */
export async function proposeWithRetry(
  provider: AIProvider,
  input: ProposeInput,
): Promise<{ proposal: AIProposal; check: ProposalCheck }> {
  let first: AIProposal;
  try {
    first = await provider.propose(input);
  } catch (e) {
    if (provider.id === 'anthropic' && e instanceof AIError && e.kind === 'bad_output') {
      const retry = await provider.propose({
        ...input,
        history: [...input.history, { role: 'user', text: input.message }, { role: 'assistant', text: '(出力形式が不正でした)' }],
        message: `直前の出力は形式が不正でした (${e.message})。propose_changes を正しい形式で呼び直してください。`,
      });
      return { proposal: retry, check: checkProposal(input.ir, retry) };
    }
    throw e;
  }
  const check = checkProposal(input.ir, first);
  if (check.ok || provider.id !== 'anthropic') return { proposal: first, check };

  const retry = await provider.propose({
    ir: input.ir,
    history: [
      ...input.history,
      { role: 'user', text: input.message },
      { role: 'assistant', text: `${first.reply}\n(提案した ops: ${JSON.stringify(first.ops)})` },
    ],
    message: `その ops は適用できませんでした。次のエラーを直した ops を提案し直してください。\n${errorText(check)}\n現在の IR は変わっていません。直せない場合は ops を空にして理由を reply に書いてください。`,
  });
  return { proposal: retry, check: checkProposal(input.ir, retry) };
}
