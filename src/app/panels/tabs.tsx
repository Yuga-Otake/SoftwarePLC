import type { ComponentType } from 'react';
import { LibraryPanel } from './LibraryPanel';
import { PropertyPanel } from './PropertyPanel';
import { ChatPanel } from './ChatPanel';
import { ControlPanel } from './ControlPanel';
import { ComparePanel } from './ComparePanel';

export interface TabDef {
  id: string;
  label: string;
  component: ComponentType;
}

/** 下部シートのタブ。後続のマイルストーンはここへ追記する */
export const tabs: TabDef[] = [
  { id: 'library', label: '設備', component: LibraryPanel },
  { id: 'properties', label: 'プロパティ', component: PropertyPanel },
  { id: 'chat', label: 'チャット', component: ChatPanel },
  { id: 'control', label: '制御', component: ControlPanel },
  { id: 'compare', label: '比較', component: ComparePanel },
];
