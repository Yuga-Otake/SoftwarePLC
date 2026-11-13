/** IR の整合性検査。error は不整合、warning は動作しない/未完了の注意 */
import type { ValidationIssue } from '../contracts';
import type { LineIR } from './schema';

const EPS = 1e-9;

export function validate(ir: LineIR): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (message: string, equipmentId?: string) => issues.push({ severity: 'error', equipmentId, message });
  const warn = (message: string, equipmentId?: string) => issues.push({ severity: 'warning', equipmentId, message });
  const byId = new Map(ir.equipment.map((e) => [e.id, e]));

  // 重複
  const seenIds = new Set<string>();
  const seenTags = new Map<string, string>();
  const seenAddr = new Map<string, string>();
  for (const e of ir.equipment) {
    if (seenIds.has(e.id)) err(`設備 ID ${e.id} が重複しています`, e.id);
    seenIds.add(e.id);
    for (const p of e.io) {
      const t = seenTags.get(p.tag);
      if (t !== undefined) err(`タグ ${p.tag} が重複しています (${t} と ${e.id})`, e.id);
      else seenTags.set(p.tag, e.id);
      if (p.address) {
        const a = seenAddr.get(p.address);
        if (a !== undefined) err(`アドレス ${p.address} が重複しています (${a} と ${e.id})`, e.id);
        else seenAddr.set(p.address, e.id);
      }
    }
  }

  // 参照
  for (const e of ir.equipment) {
    if ('mount' in e) {
      const c = byId.get(e.mount.conveyorId);
      if (!c || c.kind !== 'conveyor') err(`${e.id} の取付先コンベヤ ${e.mount.conveyorId} が存在しません`, e.id);
      else if (e.mount.offsetM > c.params.lengthM + EPS)
        err(`${e.id} の取付位置 ${e.mount.offsetM} m が ${c.id} の長さ ${c.params.lengthM} m を超えています`, e.id);
    }
    if (e.kind === 'inspection_station') {
      if (byId.get(e.params.stopperId)?.kind !== 'stopper')
        err(`${e.id} の stopperId ${e.params.stopperId} が存在しない/ストッパではありません`, e.id);
      if (byId.get(e.params.sensorId)?.kind !== 'sensor')
        err(`${e.id} の sensorId ${e.params.sensorId} が存在しない/センサではありません`, e.id);
    }
  }
  const connIds = new Set<string>();
  for (const c of ir.connections) {
    if (connIds.has(c.id)) err(`接続 ID ${c.id} が重複しています`);
    connIds.add(c.id);
    for (const [end, role] of [[c.from, 'out'], [c.to, 'in']] as const) {
      const e = byId.get(end.equipmentId);
      const p = e?.ports.find((x) => x.id === end.portId);
      if (!e) err(`接続 ${c.id} の設備 ${end.equipmentId} が存在しません`);
      else if (!p) err(`接続 ${c.id} のポート ${end.equipmentId}.${end.portId} が存在しません`, e.id);
      else if (p.role !== role) err(`接続 ${c.id}: ${end.equipmentId}.${end.portId} は ${role} ポートではありません`, e.id);
    }
  }
  for (const a of ir.assumptions)
    if (!byId.has(a.equipmentId)) err(`仮定 ${a.id} の設備 ${a.equipmentId} が存在しません`);

  // 警告
  const conveyors = ir.equipment.filter((e) => e.kind === 'conveyor');
  if (conveyors.length === 0) warn('コンベヤがありません');
  for (const cv of conveyors) {
    const seen = new Set<string>([cv.id]);
    const queue = [cv.id];
    let hasSource = false;
    while (queue.length) {
      const cur = queue.shift()!;
      for (const c of ir.connections) {
        if (c.to.equipmentId !== cur || seen.has(c.from.equipmentId)) continue;
        seen.add(c.from.equipmentId);
        if (byId.get(c.from.equipmentId)?.kind === 'source') hasSource = true;
        queue.push(c.from.equipmentId);
      }
    }
    if (!hasSource) warn(`コンベヤ ${cv.id} の上流にワーク供給がありません`, cv.id);
  }
  for (const s of ir.equipment)
    if (s.kind === 'source' && !ir.connections.some((c) => c.from.equipmentId === s.id))
      warn(`ワーク供給 ${s.id} がコンベヤに接続されていません`, s.id);
  for (const e of ir.equipment)
    if (e.semantics.status === 'proposed') warn(`${e.id} は未確認のため動作しません`, e.id);
  const open = ir.assumptions.filter((a) => a.status === 'open').length;
  if (open > 0) warn(`未承認の仮定が ${open} 件あります`);

  return issues;
}
