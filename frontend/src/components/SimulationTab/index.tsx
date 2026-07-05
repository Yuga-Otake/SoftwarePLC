import { useEffect, useState } from 'react';
import type { SimRig, SimExamStatus, RigBinding, SimExamUnresolvedSignalsError } from '../../types';
import { DeviceCanvas } from './DeviceCanvas';
import { ExamPanel } from './ExamPanel';
import { BindingPanel } from './BindingPanel';
import { usePLCStore } from '../../store/plcStore';

/** Simulation tab: mock-device panel + sequencer exam runner (see
 * docs/SIMULATION.md). Deliberately generic -- the tool only knows how to
 * render devices/run exam steps; the actual "exam machine" (which devices,
 * which steps) comes entirely from the selected rig's JSON
 * (`backend/sim_rigs/*.json`, CRUD'd via `/api/sim/rigs*`). */
export function SimulationTab() {
  const [rigNames, setRigNames] = useState<string[]>([]);
  const [selectedName, setSelectedName] = useState<string>('');
  const [activeRig, setActiveRig] = useState<SimRig | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [examStatus, setExamStatus] = useState<SimExamStatus | null>(null);
  const [status, setStatus] = useState('');
  const loadSimState = usePLCStore((s) => s.loadSimState);
  const wsConnected = usePLCStore((s) => s.wsConnected);
  const currentProgramName = usePLCStore((s) => s.currentProgramName);
  const loadCurrentProgramName = usePLCStore((s) => s.loadCurrentProgramName);
  const loadExampleProgram = usePLCStore((s) => s.loadExampleProgram);

  // ── Exam-start preflight (BUG-009, docs/QA_LOG.md) ──────────────────────
  // POST /api/sim/exam/start returns 409 when the active rig's exam steps
  // reference signals that don't resolve against the currently-loaded
  // program (e.g. kentei_plc activated on top of start_stop instead of its
  // target_program kentei_machine) -- surfaced here as a dismissable dialog
  // with "load the right program and retry" / "start anyway" actions.
  const [preflightError, setPreflightError] = useState<SimExamUnresolvedSignalsError | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);

  // ── Binding-edit mode (see docs/SIMULATION.md "リグバインド編集") ────────
  const [bindEditMode, setBindEditMode] = useState(false);
  const [bindings, setBindings] = useState<RigBinding[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const loadSignals = usePLCStore((s) => s.loadSignals);

  const loadBindings = async (name: string) => {
    const res = await fetch(`/api/sim/rigs/${encodeURIComponent(name)}/bindings`);
    if (res.ok) {
      const body = await res.json();
      setBindings(body.bindings);
    }
  };

  const loadRigNames = async () => {
    const res = await fetch('/api/sim/rigs');
    if (res.ok) setRigNames(await res.json());
  };

  const loadActive = async () => {
    const res = await fetch('/api/sim/active');
    if (!res.ok) return;
    const body = await res.json();
    setActiveName(body.active_rig);
    setActiveRig(body.rig);
    if (body.active_rig) setSelectedName(body.active_rig);
  };

  useEffect(() => {
    loadRigNames();
    loadActive();
    loadSignals();
    loadCurrentProgramName();
  }, []);

  // Refresh bindings whenever the active rig changes, edit mode toggles on,
  // or the loaded program changes (a fresh read matters if the program
  // changed underneath -- e.g. after a node rename on the logic tab, see
  // docs/VARIABLES.md "6. 信号ハブ", or after "load target program and
  // start" swaps in the rig's target_program, see BUG-009 in
  // docs/QA_LOG.md -- otherwise a relay's contact_signal/coil_signal stay
  // shown with a stale red "!" marker from before the program was loaded).
  useEffect(() => {
    if (!activeName) {
      setBindings([]);
      return;
    }
    loadBindings(activeName);
  }, [activeName, bindEditMode, currentProgramName]);

  // Exiting edit mode (or switching rigs) closes any open device panel.
  useEffect(() => {
    setSelectedDeviceId(null);
  }, [bindEditMode, activeName]);

  // Poll exam status while a rig is active (cheap GET, same 2s-class polling
  // pattern as ResourcesTab's 1s resource poll) -- covers both "watching an
  // in-progress exam" and picking up state after a page reload.
  useEffect(() => {
    const tick = async () => {
      const res = await fetch('/api/sim/exam/status');
      if (res.ok) setExamStatus(await res.json());
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [activeName]);

  // Fallback poll for jig/sensor positions (conveyor/jig/position_sensor
  // devices, see docs/SIMULATION.md) when the WS connection is down --
  // normally `sim_state` rides along on the WS `state_update` broadcast for
  // smoother animation (see plcStore._applyWSUpdate), but a disconnected WS
  // shouldn't leave the conveyor visualization frozen.
  useEffect(() => {
    if (wsConnected || !activeRig) return;
    loadSimState();
    const interval = setInterval(loadSimState, 200);
    return () => clearInterval(interval);
  }, [wsConnected, activeRig, loadSimState]);

  const jigIds = (activeRig?.devices || []).filter((d) => d.type === 'jig').map((d) => d.id);

  const resetJigs = async () => {
    await Promise.all(
      jigIds.map((id) => fetch(`/api/sim/jigs/${encodeURIComponent(id)}/reset`, { method: 'POST' }))
    );
    setStatus('ジグを原点へ戻しました');
    setTimeout(() => setStatus(''), 2000);
  };

  const activate = async (name: string) => {
    if (!name) return;
    const res = await fetch(`/api/sim/rigs/${encodeURIComponent(name)}/activate`, { method: 'POST' });
    if (res.ok) {
      const body = await res.json();
      setActiveName(body.active_rig);
      setActiveRig(body.rig);
      setStatus(`アクティブ化しました: ${name}`);
    } else {
      setStatus('アクティブ化に失敗しました');
    }
    setTimeout(() => setStatus(''), 2500);
  };

  const deactivate = async () => {
    await fetch('/api/sim/deactivate', { method: 'POST' });
    setActiveName(null);
    setActiveRig(null);
    setExamStatus(null);
    setPreflightError(null);
  };

  const startExam = async (force = false) => {
    const res = await fetch('/api/sim/exam/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    if (res.ok) {
      const body = await res.json();
      setExamStatus((prev) => (prev ? { ...prev, state: body.state } : prev));
      setPreflightError(null);
    } else if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      setPreflightError(body.detail as SimExamUnresolvedSignalsError);
    } else {
      const body = await res.json().catch(() => ({}));
      setStatus((typeof body.detail === 'string' ? body.detail : null) || '検定を開始できませんでした');
      setTimeout(() => setStatus(''), 2500);
    }
  };

  const abortExam = async () => {
    await fetch('/api/sim/exam/abort', { method: 'POST' });
  };

  // "<target_program> をロードして開始" -- loads the rig's target_program,
  // then immediately retries the exam start (which should now pass the
  // preflight check, since the whole point of target_program is that it's
  // the program the rig's signals were authored against). Takes the target
  // program name explicitly rather than reading it off `preflightError`
  // alone -- the PREVENTIVE banner (shown before any 409 has happened, see
  // `targetProgramMismatch` below) needs to trigger the same load+retry flow
  // using `activeRig.target_program`, since `preflightError` is still null
  // at that point.
  const loadTargetProgramAndStart = async (targetProgram: string | null | undefined) => {
    if (!targetProgram) return;
    setPreflightBusy(true);
    try {
      await loadExampleProgram(targetProgram);
      setPreflightError(null);
      await startExam(false);
    } finally {
      setPreflightBusy(false);
    }
  };

  const forceStartExam = async () => {
    setPreflightBusy(true);
    try {
      await startExam(true);
    } finally {
      setPreflightBusy(false);
    }
  };

  // Preventive banner (shown even before the operator tries to start the
  // exam): the active rig declares a target_program that isn't the one
  // currently loaded, AND at least one of its own binding fields doesn't
  // resolve against the current program either -- a cheap early warning
  // using data already fetched for the binding-edit red markers, so it
  // doesn't require a second signal-by-signal preflight round-trip just to
  // decide whether to show a banner.
  const targetProgramMismatch =
    !!activeRig?.target_program &&
    activeRig.target_program !== currentProgramName &&
    bindings.some((b) => !b.resolved);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          background: '#111827',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>リグ:</span>
        <select
          value={selectedName}
          onChange={(e) => setSelectedName(e.target.value)}
          style={{
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 5,
            color: '#e2e8f0',
            padding: '5px 8px',
            fontSize: 12,
            minWidth: 160,
          }}
        >
          <option value="" disabled>
            リグを選択…
          </option>
          {rigNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        {activeName === selectedName && activeName ? (
          <button
            onClick={deactivate}
            style={{
              background: '#22c55e20',
              border: '1px solid #22c55e',
              borderRadius: 6,
              color: '#22c55e',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
              padding: '5px 12px',
            }}
          >
            ● アクティブ (解除する)
          </button>
        ) : (
          <button
            onClick={() => activate(selectedName)}
            disabled={!selectedName}
            style={{
              background: selectedName ? '#6366f120' : '#1e293b',
              border: `1px solid ${selectedName ? '#6366f1' : '#334155'}`,
              borderRadius: 6,
              color: selectedName ? '#a5b4fc' : '#64748b',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: selectedName ? 'pointer' : 'default',
              padding: '5px 12px',
            }}
          >
            ○ アクティブ化
          </button>
        )}

        <button
          onClick={loadRigNames}
          title="リグ一覧を再読込"
          style={{
            background: 'transparent',
            border: '1px solid #33415580',
            borderRadius: 6,
            color: '#94a3b8',
            fontSize: 11,
            cursor: 'pointer',
            padding: '5px 10px',
          }}
        >
          ↻ 再読込
        </button>

        {jigIds.length > 0 && (
          <button
            onClick={resetJigs}
            title="全ジグを原点(home_mm)へ戻す"
            style={{
              background: 'transparent',
              border: '1px solid #33415580',
              borderRadius: 6,
              color: '#94a3b8',
              fontSize: 11,
              cursor: 'pointer',
              padding: '5px 10px',
            }}
          >
            ⟲ ジグ原点復帰
          </button>
        )}

        {activeRig && (
          <button
            onClick={() => setBindEditMode((v) => !v)}
            disabled={examStatus?.state === 'running'}
            title={
              examStatus?.state === 'running'
                ? '検定実行中はバインド編集できません'
                : 'デバイスの信号バインドを編集します'
            }
            style={{
              background: bindEditMode ? '#f59e0b20' : 'transparent',
              border: `1px solid ${bindEditMode ? '#f59e0b' : '#33415580'}`,
              borderRadius: 6,
              color: examStatus?.state === 'running' ? '#475569' : bindEditMode ? '#f59e0b' : '#94a3b8',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: examStatus?.state === 'running' ? 'default' : 'pointer',
              padding: '5px 12px',
            }}
          >
            {bindEditMode ? '✎ バインド編集中 (終了する)' : '✎ バインド編集'}
          </button>
        )}

        {status && <span style={{ fontSize: 11, color: '#22c55e' }}>{status}</span>}

        {/* Currently-loaded program name (small, for at-a-glance matching
         * against a rig's target_program -- see docs/SIMULATION.md, BUG-009
         * in docs/QA_LOG.md) */}
        <span
          style={{
            marginLeft: activeRig ? undefined : 'auto',
            fontSize: 10.5,
            color: '#475569',
            border: '1px solid #1e293b',
            borderRadius: 5,
            padding: '3px 8px',
            whiteSpace: 'nowrap',
          }}
          title="現在ロード中のプログラム"
        >
          プログラム: {currentProgramName ?? '不明'}
        </span>

        {activeRig && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>
            {activeRig.title || activeRig.name}
          </span>
        )}
      </div>

      {/* Preventive warning banner (see docs/SIMULATION.md, BUG-009 in
       * docs/QA_LOG.md): shown as soon as the active rig's target_program
       * doesn't match what's loaded, BEFORE the operator even tries to
       * start the exam. */}
      {targetProgramMismatch && !preflightError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            background: '#f59e0b14',
            borderBottom: '1px solid #f59e0b60',
            color: '#fbbf24',
            fontSize: 11.5,
          }}
        >
          <span>⚠ 対象プログラム: {activeRig!.target_program}(未ロード。現在: {currentProgramName ?? '不明'})</span>
          <button
            onClick={() => loadTargetProgramAndStart(activeRig!.target_program)}
            disabled={preflightBusy}
            style={{
              background: '#f59e0b20',
              border: '1px solid #f59e0b',
              borderRadius: 6,
              color: '#fbbf24',
              fontSize: 11,
              fontWeight: 700,
              cursor: preflightBusy ? 'default' : 'pointer',
              padding: '4px 10px',
              marginLeft: 'auto',
            }}
          >
            {activeRig!.target_program} をロード
          </button>
        </div>
      )}

      {/* Exam-start preflight rejection (409, see startExam()) -- shown as a
       * dismissable dialog with concrete next actions instead of the
       * previous confusing "timeout: expected True, got None" many steps
       * into a run against the wrong program. */}
      {preflightError && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: '#00000080',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          role="dialog"
          aria-label="検定を開始できません"
        >
          <div
            style={{
              background: '#111827',
              border: '1px solid #ef444480',
              borderRadius: 10,
              padding: 20,
              width: 420,
              maxWidth: '90vw',
              boxShadow: '0 8px 30px #00000060',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 800, color: '#ef4444', marginBottom: 10 }}>
              ⚠ このリグの検定には対象プログラムが必要です
            </div>
            <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.7, marginBottom: 10 }}>
              このリグの検定には <b>{preflightError.target_program ?? '(target_program未設定)'}</b> が必要です。
              <br />
              現在のプログラム: <b>{preflightError.current_program}</b>
              <br />
              未解決の信号: <b>{preflightError.signals.length}件</b>
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: '#64748b',
                background: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: 6,
                padding: 8,
                marginBottom: 14,
                maxHeight: 100,
                overflow: 'auto',
                fontFamily: 'monospace',
              }}
            >
              {preflightError.signals.join(', ')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {preflightError.target_program && (
                <button
                  onClick={() => loadTargetProgramAndStart(preflightError.target_program)}
                  disabled={preflightBusy}
                  style={{
                    flex: 1,
                    background: '#22c55e20',
                    border: '1px solid #22c55e',
                    borderRadius: 6,
                    color: '#22c55e',
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '8px 10px',
                    cursor: preflightBusy ? 'default' : 'pointer',
                  }}
                >
                  {preflightError.target_program} をロードして開始
                </button>
              )}
              <button
                onClick={forceStartExam}
                disabled={preflightBusy}
                style={{
                  flex: 1,
                  background: '#f59e0b20',
                  border: '1px solid #f59e0b',
                  borderRadius: 6,
                  color: '#f59e0b',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '8px 10px',
                  cursor: preflightBusy ? 'default' : 'pointer',
                }}
              >
                このまま強制実行
              </button>
              <button
                onClick={() => setPreflightError(null)}
                style={{
                  background: 'transparent',
                  border: '1px solid #33415580',
                  borderRadius: 6,
                  color: '#94a3b8',
                  fontSize: 12,
                  padding: '8px 10px',
                  cursor: 'pointer',
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {activeRig ? (
          <>
            <DeviceCanvas
              devices={activeRig.devices || []}
              examRunning={examStatus?.state === 'running'}
              editMode={bindEditMode}
              unresolvedDeviceIds={
                new Set(bindings.filter((b) => !b.resolved).map((b) => b.device_id))
              }
              selectedDeviceId={selectedDeviceId}
              onDeviceClick={(id) => setSelectedDeviceId(id)}
            />
            {bindEditMode && selectedDeviceId ? (
              <BindingPanel
                rigName={activeName!}
                rig={activeRig}
                deviceId={selectedDeviceId}
                bindings={bindings}
                onClose={() => setSelectedDeviceId(null)}
                onSaved={(updatedRig) => {
                  setActiveRig(updatedRig);
                  loadBindings(activeName!);
                  loadSignals();
                  setStatus('バインドを保存しました');
                  setTimeout(() => setStatus(''), 2000);
                }}
              />
            ) : (
              <ExamPanel
                exam={activeRig.exam}
                status={examStatus}
                onStart={() => startExam(false)}
                onAbort={abortExam}
                canStart={!!activeRig.exam?.steps?.length}
              />
            )}
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 13 }}>
            リグを選択してアクティブ化してください。(サンプル: motor_exam, lamp_practice)
          </div>
        )}
      </div>
    </div>
  );
}
