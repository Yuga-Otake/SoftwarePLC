import { create } from 'zustand';
import { applyPatch, emptyLine, LineIR } from '@core/ir';
import type { PatchOp } from '@core/ir';
import type { PatchResult } from '@core/contracts';

export const STORAGE_KEY = 'cfb.line.v1';
const HISTORY_CAP = 50;

interface HistoryEntry {
  ir: LineIR;
  label?: string;
}

function loadIr(): LineIR {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const r = LineIR.safeParse(JSON.parse(raw));
      if (r.success) return r.data;
    }
  } catch {
    /* ignore */
  }
  return emptyLine();
}

export interface LineState {
  ir: LineIR;
  past: HistoryEntry[];
  future: HistoryEntry[];
  selectedId: string | null;
  /** すべての IR 変更はここを通る */
  dispatch: (ops: PatchOp[], label?: string) => PatchResult;
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
  replaceLine: (ir: LineIR, label?: string) => void;
  newLine: () => void;
}

const fixSelection = (ir: LineIR, id: string | null) => (id && ir.equipment.some((e) => e.id === id) ? id : null);

export const useLineStore = create<LineState>((set, get) => ({
  ir: loadIr(),
  past: [],
  future: [],
  selectedId: null,

  dispatch: (ops, label) => {
    const cur = get().ir;
    const result = applyPatch(cur, ops);
    if (result.errors.length === 0 && JSON.stringify(result.ir) !== JSON.stringify(cur)) {
      set((s) => ({
        ir: result.ir,
        past: [...s.past, { ir: cur, label }].slice(-HISTORY_CAP),
        future: [],
        selectedId: fixSelection(result.ir, s.selectedId),
      }));
    }
    return result;
  },

  undo: () => {
    const { past, future, ir, selectedId } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({
      ir: prev.ir,
      past: past.slice(0, -1),
      future: [...future, { ir, label: prev.label }].slice(-HISTORY_CAP),
      selectedId: fixSelection(prev.ir, selectedId),
    });
  },

  redo: () => {
    const { past, future, ir, selectedId } = get();
    const next = future[future.length - 1];
    if (!next) return;
    set({
      ir: next.ir,
      future: future.slice(0, -1),
      past: [...past, { ir, label: next.label }].slice(-HISTORY_CAP),
      selectedId: fixSelection(next.ir, selectedId),
    });
  },

  select: (id) => set({ selectedId: id }),

  replaceLine: (ir, label) =>
    set((s) => ({
      ir,
      past: [...s.past, { ir: s.ir, label }].slice(-HISTORY_CAP),
      future: [],
      selectedId: null,
    })),

  newLine: () => get().replaceLine(emptyLine(), '新規ライン'),
}));

let lastSaved: LineIR | null = null;
useLineStore.subscribe((s) => {
  if (s.ir === lastSaved) return;
  lastSaved = s.ir;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s.ir));
  } catch {
    /* ignore */
  }
});
