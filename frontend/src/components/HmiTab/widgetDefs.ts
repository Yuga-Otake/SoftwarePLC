import type { HmiWidgetType } from '../../types';

export const WIDGET_PALETTE: { type: HmiWidgetType; label: string; defaultW: number; defaultH: number }[] = [
  { type: 'button_momentary', label: 'ボタン (モーメンタリ)', defaultW: 110, defaultH: 44 },
  { type: 'button_alternate', label: 'ボタン (オルタネイト)', defaultW: 110, defaultH: 44 },
  { type: 'lamp', label: 'ランプ', defaultW: 60, defaultH: 60 },
  { type: 'number', label: '数値表示', defaultW: 110, defaultH: 44 },
  { type: 'gauge', label: 'ゲージ', defaultW: 140, defaultH: 60 },
];

export function widgetTypeLabel(type: HmiWidgetType): string {
  return WIDGET_PALETTE.find((w) => w.type === type)?.label ?? type;
}
