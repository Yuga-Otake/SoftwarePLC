import { create } from 'zustand';
import {
  AIError,
  checkProposal,
  createDemoProvider,
  createGeminiProvider,
  DEFAULT_GEMINI_MODEL,
  proposeWithRetry,
} from '@core/ai';
import type { AIProvider, ChatTurn, IRChange, ValidationIssue } from '@core/contracts';
import type { LineIR, PatchOp } from '@core/ir';
import { useLineStore } from './lineStore';
import { useUiStore } from './uiStore';

export const CHAT_KEY = 'cfb.chat.v1';
export const API_KEY_KEY = 'cfb.geminiKey';
const OLD_API_KEY_KEY = 'cfb.apiKey'; // 旧 AI プロバイダ時代のキー。読み込み時に削除
export const MODEL_KEY = 'cfb.model';
const MESSAGE_CAP = 50;

/* ───────── メッセージ型 (JSON 化して localStorage に保存する) ───────── */

export interface AssumptionRef {
  id: string;
  equipmentId: string;
  path: string;
}
export interface AssumptionView extends AssumptionRef {
  eqName: string;
  value: unknown;
  rationale: string;
}
export interface ProposedEqView {
  id: string;
  name: string;
  kind: string;
  rationale?: string;
  confidence?: number;
}
export type ProposalState = 'pending' | 'applied' | 'discarded' | 'stale';

export type ChatMessage =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'error'; text: string; retryOf: string }
  | {
      id: string;
      kind: 'proposal';
      userText: string;
      reply: string;
      ops: PatchOp[];
      ok: boolean;
      changes: IRChange[];
      issues: ValidationIssue[];
      errors: string[];
      newAssumptions: AssumptionView[];
      proposedEq: ProposedEqView[];
      state: ProposalState;
      /** 適用で実際に作られた仮定 (カード内で承認/修正する) */
      created?: AssumptionRef[];
    };
export type ProposalMessage = Extract<ChatMessage, { kind: 'proposal' }>;

/* ───────── 永続化 ───────── */

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function loadMessages(): ChatMessage[] {
  try {
    const raw = lsGet(CHAT_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    return j.filter((m) => m && typeof m.id === 'string' && typeof m.kind === 'string').slice(-MESSAGE_CAP);
  } catch {
    return [];
  }
}

/* ───────── ストア ───────── */

/** 提案時点の IR (メモリのみ)。適用時に「ラインが変わったか」を参照比較する */
const baseIrs = new Map<string, LineIR>();

let seq = 0;
const newId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  apiKey: string;
  model: string;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  setApiKey: (k: string) => void;
  setModel: (m: string) => void;
  send: (text: string) => Promise<void>;
  retry: (errorId: string) => Promise<void>;
  clear: () => void;
  applyProposal: (id: string) => void;
  discardProposal: (id: string) => void;
}

export function makeProvider(apiKey: string, model: string): AIProvider {
  return apiKey ? createGeminiProvider({ apiKey, model: model.trim() || DEFAULT_GEMINI_MODEL }) : createDemoProvider();
}

const patchMsg = (id: string, patch: Partial<ProposalMessage>) =>
  useChatStore.setState((s) => ({
    messages: s.messages.map((m) => (m.id === id && m.kind === 'proposal' ? { ...m, ...patch } : m)),
  }));

function historyBefore(messages: ChatMessage[], index: number): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (let i = 0; i < index; i++) {
    const m = messages[i];
    if (m.kind === 'user') {
      if (messages[i + 1]?.kind === 'error') continue; // 応答が得られなかった発話
      out.push({ role: 'user', text: m.text });
    } else if (m.kind === 'assistant') out.push({ role: 'assistant', text: m.text });
    else if (m.kind === 'proposal') out.push({ role: 'assistant', text: m.reply });
  }
  return out.filter((t) => t.text.trim() !== '');
}

const sameAssumption = (a: AssumptionRef, b: AssumptionRef) =>
  a.id === b.id && a.equipmentId === b.equipmentId && a.path === b.path;

export const useChatStore = create<ChatState>((set, get) => {
  lsSet(OLD_API_KEY_KEY, null);
  if (!(lsGet(MODEL_KEY) ?? 'gemini').startsWith('gemini')) lsSet(MODEL_KEY, null); // 旧モデル名を捨てる
  async function run(userId: string) {
    const { messages, apiKey, model } = get();
    const idx = messages.findIndex((m) => m.id === userId);
    const userMsg = messages[idx];
    if (idx < 0 || userMsg.kind !== 'user') return;
    const provider = makeProvider(apiKey, model);
    const ir = useLineStore.getState().ir;
    set({ busy: true });
    try {
      const { proposal, check } = await proposeWithRetry(provider, {
        ir,
        history: historyBefore(messages, idx),
        message: userMsg.text,
      });
      let next: ChatMessage;
      if (proposal.ops.length === 0) {
        next = { id: newId(), kind: 'assistant', text: proposal.reply };
      } else {
        const after = check.result.ir;
        const newAssumptions: AssumptionView[] = after.assumptions
          .filter((a) => !ir.assumptions.some((b) => sameAssumption(a, b)))
          .map((a) => ({
            id: a.id,
            equipmentId: a.equipmentId,
            path: a.path,
            value: a.value,
            rationale: a.rationale,
            eqName: after.equipment.find((e) => e.id === a.equipmentId)?.name ?? a.equipmentId,
          }));
        const proposedEq: ProposedEqView[] = after.equipment
          .filter((e) => {
            if (e.semantics.status !== 'proposed') return false;
            const old = ir.equipment.find((o) => o.id === e.id);
            return !(old && old.semantics.status === 'proposed' && old.semantics.rationale === e.semantics.rationale);
          })
          .map((e) => ({
            id: e.id,
            name: e.name,
            kind: e.kind,
            rationale: e.semantics.rationale,
            confidence: e.semantics.confidence,
          }));
        next = {
          id: newId(),
          kind: 'proposal',
          userText: userMsg.text,
          reply: proposal.reply,
          ops: proposal.ops,
          ok: check.ok,
          changes: check.result.changes,
          issues: check.issues,
          errors: check.result.errors,
          newAssumptions,
          proposedEq,
          state: 'pending',
        };
        baseIrs.set(next.id, ir);
      }
      set((s) => ({ messages: [...s.messages, next].slice(-MESSAGE_CAP), busy: false }));
    } catch (e) {
      const text =
        e instanceof AIError ? e.message : 'うまく処理できませんでした。もう一度お試しください。';
      set((s) => ({
        messages: [...s.messages, { id: newId(), kind: 'error' as const, text, retryOf: userId }].slice(-MESSAGE_CAP),
        busy: false,
      }));
    }
  }

  return {
    messages: loadMessages(),
    busy: false,
    apiKey: lsGet(API_KEY_KEY) ?? '',
    model: lsGet(MODEL_KEY) || DEFAULT_GEMINI_MODEL,
    settingsOpen: false,
    setSettingsOpen: (v) => set({ settingsOpen: v }),
    setApiKey: (k) => {
      const key = k.trim();
      lsSet(API_KEY_KEY, key || null);
      set({ apiKey: key });
    },
    setModel: (m) => {
      const model = m.trim() || DEFAULT_GEMINI_MODEL;
      lsSet(MODEL_KEY, model === DEFAULT_GEMINI_MODEL ? null : model);
      set({ model });
    },

    send: async (text) => {
      const t = text.trim();
      if (!t || get().busy) return;
      const id = newId();
      set((s) => ({ messages: [...s.messages, { id, kind: 'user' as const, text: t }].slice(-MESSAGE_CAP) }));
      await run(id);
    },

    retry: async (errorId) => {
      if (get().busy) return;
      const err = get().messages.find((m) => m.id === errorId);
      if (!err || err.kind !== 'error') return;
      set((s) => ({ messages: s.messages.filter((m) => m.id !== errorId) }));
      await run(err.retryOf);
    },

    clear: () => {
      baseIrs.clear();
      set({ messages: [] });
    },

    discardProposal: (id) => patchMsg(id, { state: 'discarded' }),

    applyProposal: (id) => {
      const msg = get().messages.find((m) => m.id === id);
      if (!msg || msg.kind !== 'proposal' || msg.state !== 'pending') return;
      const line = useLineStore.getState();
      const before = line.ir;
      // 提案後にラインが変わっていたら、現在の IR に対して検査し直す
      if (baseIrs.get(id) !== before) {
        const c = checkProposal(before, { reply: msg.reply, ops: msg.ops });
        if (!c.ok) {
          patchMsg(id, { state: 'stale' });
          return;
        }
      } else if (!msg.ok) return;
      const label = `AI: ${msg.userText.slice(0, 20)}`;
      const res = line.dispatch(msg.ops, label, { markBaseline: true });
      if (res.errors.length) {
        patchMsg(id, { state: 'stale' });
        return;
      }
      const created: AssumptionRef[] = res.ir.assumptions
        .filter((a) => !before.assumptions.some((b) => sameAssumption(a, b)))
        .map((a) => ({ id: a.id, equipmentId: a.equipmentId, path: a.path }));
      patchMsg(id, { state: 'applied', created });
      baseIrs.delete(id);
      useUiStore.getState().requestFit();
    },
  };
});

let lastSaved: ChatMessage[] | null = null;
useChatStore.subscribe((s) => {
  if (s.messages === lastSaved) return;
  lastSaved = s.messages;
  try {
    lsSet(CHAT_KEY, JSON.stringify(s.messages.slice(-MESSAGE_CAP)));
  } catch {
    /* ignore */
  }
});
