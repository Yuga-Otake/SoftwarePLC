import { create } from 'zustand';

export type GizmoMode = 'translate' | 'rotate' | 'scale';
export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

/** 意味付けウィザードの一時プレビュー (IR には入れない) */
export interface SemanticsPreview {
  id: string;
  /** モデルをコンベヤの +X に合わせる回転 (fit.rotationYDeg 相当) */
  rotationYDeg: number;
  lengthM: number;
  widthM: number;
  heightM: number;
}

interface UiState {
  preview: SemanticsPreview | null;
  setPreview: (p: SemanticsPreview | null) => void;
  activeTab: string;
  sheetOpen: boolean;
  gizmoMode: GizmoMode;
  toasts: Toast[];
  /** 増えるたびにカメラを全体表示にする */
  fitNonce: number;
  setTab: (id: string) => void;
  setSheetOpen: (open: boolean) => void;
  toggleSheet: () => void;
  setGizmoMode: (m: GizmoMode) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  requestFit: () => void;
}

let nextToast = 1;

export const useUiStore = create<UiState>((set, get) => ({
  activeTab: 'library',
  sheetOpen: true,
  gizmoMode: 'translate',
  toasts: [],
  fitNonce: 0,
  preview: null,
  setPreview: (p) => set({ preview: p }),
  setTab: (id) => set({ activeTab: id }),
  setSheetOpen: (open) => set({ sheetOpen: open }),
  toggleSheet: () => set((s) => ({ sheetOpen: !s.sheetOpen })),
  setGizmoMode: (m) => set({ gizmoMode: m }),
  toast: (text, kind = 'info') => {
    const id = nextToast++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 4500 : 2500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
}));
