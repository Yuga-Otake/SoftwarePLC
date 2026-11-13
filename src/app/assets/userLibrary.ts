/** マイ設備: 確認済みの glb 設備を localStorage に保存して再利用する */
import { create } from 'zustand';
import type { Equipment, Visual } from '@core/ir';

export const USER_LIBRARY_KEY = 'cfb.userLibrary.v1';

export type UserLibraryKind = 'conveyor' | 'source' | 'sensor' | 'stopper' | 'inspection_station';

export interface UserLibraryEntry {
  id: string;
  label: string;
  kind: UserLibraryKind;
  params: Record<string, unknown>;
  visual: Visual;
}

function load(): UserLibraryEntry[] {
  try {
    const raw = localStorage.getItem(USER_LIBRARY_KEY);
    if (raw) {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) return j.filter((e) => e && typeof e.id === 'string' && e.visual && typeof e.kind === 'string');
    }
  } catch {
    /* ignore */
  }
  return [];
}

function persist(list: UserLibraryEntry[]) {
  try {
    localStorage.setItem(USER_LIBRARY_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

interface State {
  entries: UserLibraryEntry[];
  add: (e: UserLibraryEntry) => void;
  remove: (id: string) => void;
}

export const useUserLibrary = create<State>((set, get) => ({
  entries: load(),
  add: (e) => {
    const entries = [...get().entries, e];
    persist(entries);
    set({ entries });
  },
  remove: (id) => {
    const entries = get().entries.filter((x) => x.id !== id);
    persist(entries);
    set({ entries });
  },
}));

/** 設備からマイ設備の項目を作る (glb 視覚を持つ確認済み設備のみ) */
export function entryFromEquipment(eq: Equipment): UserLibraryEntry | null {
  if (eq.visual.type !== 'glb' || eq.kind === 'generic') return null;
  const params: Record<string, unknown> = { ...(eq.params as Record<string, unknown>) };
  if (eq.kind === 'inspection_station') {
    delete params.stopperId;
    delete params.sensorId;
  }
  return {
    id: `ul_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label: eq.name,
    kind: eq.kind,
    params,
    visual: JSON.parse(JSON.stringify(eq.visual)),
  };
}
