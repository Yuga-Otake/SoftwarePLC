/**
 * ルールベースの種別推定 (AI ではない)。ファイル名・ノード名のキーワードと外形の比率だけを根拠にする。
 * 見た目から機能は断定できないため、確信度は最大 0.7 (「中」) で、必ずユーザーが確認する。
 */
export type SuggestKind = 'conveyor' | 'sensor' | 'stopper' | 'inspection_station';

export interface SuggestInput {
  fileName: string;
  /** モデル外形 (m, X/Y/Z) */
  sizeM: [number, number, number];
  nodeNames: string[];
}

export interface Suggestion {
  kind: SuggestKind | null;
  confidence: number;
  /** 使った手掛かりを列挙した日本語の根拠。kind が null なら空 */
  rationale: string;
}

const KEYWORDS: [SuggestKind, RegExp][] = [
  ['conveyor', /conveyor|belt|コンベヤ|コンベア|搬送/i],
  ['inspection_station', /camera|inspect|vision|検査/i],
  ['stopper', /stopper|ストッパ|stop/i],
  ['sensor', /sensor|センサ|photo/i],
];

export const SHAPE_ASPECT_MIN = 2.5;
const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function confidenceLabel(c: number): string {
  return c >= 0.8 ? '高' : c >= 0.5 ? '中' : '低';
}

export function suggestSemantics(input: SuggestInput): Suggestion {
  const stem = input.fileName.replace(/\.[^.]+$/, '');
  // キーワードの手掛かり: 種別ごとに「どこで何に一致したか」
  const hits = new Map<SuggestKind, string[]>();
  for (const [kind, re] of KEYWORDS) {
    const clues: string[] = [];
    const f = stem.match(re);
    if (f) clues.push(`ファイル名に '${f[0]}'`);
    const nodes: string[] = [];
    for (const n of input.nodeNames) if (re.test(n) && nodes.length < 3) nodes.push(n);
    if (nodes.length) clues.push(`ノード名に ${nodes.map((n) => `'${n}'`).join(' / ')}`);
    if (clues.length) hits.set(kind, clues);
  }
  let kind: SuggestKind | null = null;
  let best = 0;
  for (const [k] of KEYWORDS) {
    const n = hits.get(k)?.length ?? 0;
    if (n > best) {
      best = n;
      kind = k;
    }
  }

  const [sx, sy, sz] = input.sizeM;
  const long = Math.max(sx, sz);
  const short = Math.min(sx, sz);
  const slender = short > 0 && long / short >= SHAPE_ASPECT_MIN && sy <= long;
  const shapeClue = `外形 ${fmt(sx)}×${fmt(sy)}×${fmt(sz)} m (X×Y×Z) の細長い形状`;

  if (kind === null) {
    if (!slender) return { kind: null, confidence: 0, rationale: '' };
    return { kind: 'conveyor', confidence: 0.4, rationale: shapeClue };
  }
  const clues = [...(hits.get(kind) ?? [])];
  if (kind === 'conveyor' && slender) {
    clues.push(shapeClue);
    return { kind, confidence: 0.7, rationale: clues.join(' / ') };
  }
  return { kind, confidence: 0.4, rationale: clues.join(' / ') };
}
