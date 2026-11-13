import { describe, expect, it } from 'vitest';
import { confidenceLabel, suggestSemantics } from './suggest';

describe('suggestSemantics', () => {
  it('keyword + slender shape agree -> conveyor 0.7 (中) with exact clues', () => {
    const s = suggestSemantics({ fileName: 'belt_conveyor.glb', sizeM: [0.7, 0.5, 1.8], nodeNames: ['Frame_L', 'Belt'] });
    expect(s.kind).toBe('conveyor');
    expect(s.confidence).toBe(0.7);
    expect(confidenceLabel(s.confidence)).toBe('中');
    expect(s.rationale).toContain("ファイル名に 'belt'");
    expect(s.rationale).toContain("ノード名に 'Belt'");
    expect(s.rationale).toContain('0.7×0.5×1.8 m');
  });
  it('keyword only -> 0.4 (低)', () => {
    const s = suggestSemantics({ fileName: 'Conveyor.glb', sizeM: [1, 1, 1], nodeNames: [] });
    expect(s).toMatchObject({ kind: 'conveyor', confidence: 0.4 });
    expect(s.rationale).not.toContain('外形');
  });
  it('shape only -> weak conveyor hint', () => {
    const s = suggestSemantics({ fileName: 'thing.glb', sizeM: [3, 0.5, 1], nodeNames: [] });
    expect(s).toMatchObject({ kind: 'conveyor', confidence: 0.4 });
    expect(s.rationale).toContain('外形');
  });
  it('no clues -> null', () => {
    expect(suggestSemantics({ fileName: 'box.glb', sizeM: [1, 1, 1], nodeNames: ['Cube'] })).toEqual({ kind: null, confidence: 0, rationale: '' });
  });
  it('other kinds by keyword, never above 0.7', () => {
    expect(suggestSemantics({ fileName: 'センサ.glb', sizeM: [0.1, 0.1, 0.1], nodeNames: [] }).kind).toBe('sensor');
    expect(suggestSemantics({ fileName: 'x.glb', sizeM: [0.1, 0.1, 0.1], nodeNames: ['Stopper_arm'] }).kind).toBe('stopper');
    expect(suggestSemantics({ fileName: 'vision_cam.glb', sizeM: [0.1, 0.1, 0.1], nodeNames: [] }).kind).toBe('inspection_station');
    expect(suggestSemantics({ fileName: 'conveyor.glb', sizeM: [0.5, 0.2, 5], nodeNames: ['Belt'] }).confidence).toBeLessThanOrEqual(0.7);
  });
});
