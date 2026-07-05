import { useState } from 'react';
import type { SimDevice, SimJigFeature } from '../../types';
import { usePLCStore } from '../../store/plcStore';

/** Read a signal's live value from the shared WS-driven store state, same
 * "node_id.port" / bare-input / "var.<id>" convention the rest of the app
 * uses (see backend plc/simulation.py::read_signal, which this mirrors on
 * the frontend so device rendering doesn't need its own polling). */
function readSignal(
  signal: string,
  runtimeState: Record<string, Record<string, unknown>>,
  ioValues: Record<string, boolean>
): unknown {
  if (!signal) return undefined;
  if (signal.startsWith('var.')) {
    return runtimeState.var?.[signal.slice(4)];
  }
  const [nodeId, port] = signal.includes('.') ? signal.split('.') : [signal, 'OUT'];
  const outputs = runtimeState[nodeId];
  if (outputs && port in outputs) return outputs[port];
  if (nodeId in ioValues) return ioValues[nodeId];
  return undefined;
}

async function writeSignal(signal: string, value: boolean | number) {
  if (signal.startsWith('var.')) {
    await fetch(`/api/variables/${encodeURIComponent(signal.slice(4))}/force`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    }).catch(() => {});
    return;
  }
  const nodeId = signal.split('.')[0];
  await fetch(`/api/io/${encodeURIComponent(nodeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  }).catch(() => {});
}

async function setJigFeatureAttached(jigId: string, featureId: string, attached: boolean) {
  await fetch(`/api/sim/jigs/${encodeURIComponent(jigId)}/features/${encodeURIComponent(featureId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attached }),
  }).catch(() => {});
}

// Pushbutton "idle color" (unpressed ring/cap tint) -- optional, purely
// cosmetic (e.g. kentei_plc.json's PB5 is styled red like a real emergency
// stop button). Pressed state always shows green regardless, matching the
// existing pushbutton/switch/lamp convention elsewhere in this file where
// "active" always reads as green.
const PUSHBUTTON_IDLE_COLOR: Record<string, string> = {
  red: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6',
};

function PushbuttonDevice({ device, active }: { device: SimDevice; active: boolean }) {
  const [pressed, setPressed] = useState(false);
  const momentary = (device.mode ?? 'momentary') === 'momentary';
  const idleColor = device.color ? PUSHBUTTON_IDLE_COLOR[device.color] : undefined;

  const handleDown = () => {
    if (momentary) {
      setPressed(true);
      writeSignal(device.signal, true);
    }
  };
  const handleUp = () => {
    if (momentary) {
      setPressed(false);
      writeSignal(device.signal, false);
    }
  };
  const handleClick = () => {
    if (!momentary) writeSignal(device.signal, !active);
  };

  const isDown = momentary ? pressed : active;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
      <button
        onMouseDown={handleDown}
        onMouseUp={handleUp}
        onMouseLeave={handleUp}
        onClick={handleClick}
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          border: `3px solid ${isDown ? '#22c55e' : idleColor ?? '#64748b'}`,
          background: isDown
            ? 'radial-gradient(circle at 35% 30%, #4ade80, #16a34a)'
            : idleColor
              ? `radial-gradient(circle at 35% 30%, ${idleColor}, ${idleColor}cc)`
              : 'radial-gradient(circle at 35% 30%, #64748b, #334155)',
          boxShadow: isDown ? '0 0 16px #22c55e90, inset 0 2px 4px #00000040' : 'inset 0 2px 4px #00000060',
          cursor: 'pointer',
          transform: isDown ? 'translateY(2px) scale(0.96)' : 'none',
          transition: 'all 0.08s',
        }}
        title={device.signal}
      />
      <span style={{ fontSize: 10.5, color: '#94a3b8', textAlign: 'center', fontWeight: 600 }}>{device.label}</span>
    </div>
  );
}

function SwitchDevice({ device, active }: { device: SimDevice; active: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
      <button
        onClick={() => writeSignal(device.signal, !active)}
        style={{
          width: 64,
          height: 32,
          borderRadius: 16,
          border: `2px solid ${active ? '#22c55e' : '#475569'}`,
          background: active ? '#22c55e30' : '#0f172a',
          position: 'relative',
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        title={device.signal}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: active ? 34 : 2,
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: active ? '#22c55e' : '#64748b',
            transition: 'left 0.15s',
            boxShadow: active ? '0 0 8px #22c55e90' : 'none',
          }}
        />
      </button>
      <span style={{ fontSize: 10.5, color: '#94a3b8', textAlign: 'center', fontWeight: 600 }}>{device.label}</span>
    </div>
  );
}

function LampDevice({ device, active }: { device: SimDevice; active: boolean }) {
  const color = device.color || 'green';
  const colorMap: Record<string, string> = {
    green: '#22c55e',
    amber: '#f59e0b',
    red: '#ef4444',
    blue: '#3b82f6',
  };
  const hex = colorMap[color] || color;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: active ? hex : '#1e293b',
          border: `3px solid ${active ? hex : '#475569'}`,
          boxShadow: active ? `0 0 20px ${hex}, 0 0 8px ${hex} inset` : 'none',
          transition: 'all 0.2s',
        }}
        title={device.signal}
      />
      <span style={{ fontSize: 10.5, color: '#94a3b8', textAlign: 'center', fontWeight: 600 }}>{device.label}</span>
    </div>
  );
}

function MotorDevice({ device, active }: { device: SimDevice; active: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 110 }}>
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          border: `3px solid ${active ? '#6366f1' : '#475569'}`,
          background: '#0f172a',
          boxShadow: active ? '0 0 18px #6366f180' : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
        title={device.signal}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          style={{
            animation: active ? 'sim-motor-spin 0.6s linear infinite' : 'none',
          }}
        >
          {/* Simple fan/gear blades so rotation is visually obvious */}
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <rect
              key={deg}
              x="22.5"
              y="4"
              width="3"
              height="16"
              rx="1.5"
              fill={active ? '#818cf8' : '#475569'}
              transform={`rotate(${deg} 24 24)`}
            />
          ))}
          <circle cx="24" cy="24" r="5" fill={active ? '#a5b4fc' : '#64748b'} />
        </svg>
      </div>
      <span style={{ fontSize: 10.5, color: '#94a3b8', textAlign: 'center', fontWeight: 600 }}>{device.label}</span>
      <span style={{ fontSize: 9.5, color: active ? '#818cf8' : '#475569', fontWeight: 700 }}>
        {active ? '運転中' : '停止'}
      </span>
    </div>
  );
}

// 7-segment glyph table (segments a,b,c,d,e,f,g -- standard naming, top going
// clockwise then the middle bar) for digits 0-9 plus a blank/dash fallback.
// Used by SevenSegDigit below to render `style: "seven_seg"` indicator_number
// devices (docs/SIMULATION.md "7セグ表示") -- KENTEI-PLC's DPL1/DPL2.
const SEVEN_SEG_MAP: Record<string, boolean[]> = {
  '0': [true, true, true, true, true, true, false],
  '1': [false, true, true, false, false, false, false],
  '2': [true, true, false, true, true, false, true],
  '3': [true, true, true, true, false, false, true],
  '4': [false, true, true, false, false, true, true],
  '5': [true, false, true, true, false, true, true],
  '6': [true, false, true, true, true, true, true],
  '7': [true, true, true, false, false, false, false],
  '8': [true, true, true, true, true, true, true],
  '9': [true, true, true, true, false, true, true],
  '-': [false, false, false, false, false, false, true],
  ' ': [false, false, false, false, false, false, false],
};

function SevenSegDigit({ char, on = '#f59e0b', off = '#2a1f0f' }: { char: string; on?: string; off?: string }) {
  const segs = SEVEN_SEG_MAP[char] ?? SEVEN_SEG_MAP[' '];
  const [a, b, c, d, e, f, g] = segs;
  // Simple 7-seg built from 7 positioned bars inside a 24x40 glyph cell.
  const seg = (lit: boolean, style: React.CSSProperties, key: string) => (
    <div
      key={key}
      style={{
        position: 'absolute',
        background: lit ? on : off,
        boxShadow: lit ? `0 0 5px ${on}a0` : 'none',
        borderRadius: 1,
        transition: 'all 0.1s',
        ...style,
      }}
    />
  );
  return (
    <div style={{ position: 'relative', width: 22, height: 38 }}>
      {seg(a, { top: 0, left: 3, width: 16, height: 3 }, 'a')}
      {seg(f, { top: 2, left: 0, width: 3, height: 16 }, 'f')}
      {seg(b, { top: 2, left: 19, width: 3, height: 16 }, 'b')}
      {seg(g, { top: 17.5, left: 3, width: 16, height: 3 }, 'g')}
      {seg(e, { top: 20, left: 0, width: 3, height: 16 }, 'e')}
      {seg(c, { top: 20, left: 19, width: 3, height: 16 }, 'c')}
      {seg(d, { top: 35, left: 3, width: 16, height: 3 }, 'd')}
    </div>
  );
}

function SevenSegDisplay({ value, digits = 2 }: { value: unknown; digits?: number }) {
  let text: string;
  if (typeof value === 'number') text = String(Math.trunc(value));
  else if (typeof value === 'boolean') text = value ? '1' : '0';
  else text = '';
  text = text.slice(-digits).padStart(digits, ' ');
  return (
    <div style={{ display: 'flex', gap: 3, padding: '6px 8px', background: '#150f05', borderRadius: 6, border: '1.5px solid #334155' }}>
      {[...text].map((ch, i) => (
        <SevenSegDigit key={i} char={ch} />
      ))}
    </div>
  );
}

function IndicatorNumberDevice({ device, value }: { device: SimDevice; value: unknown }) {
  if (device.style === 'seven_seg') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }} title={device.signal}>
        <SevenSegDisplay value={value} digits={device.digits ?? 2} />
        <span style={{ fontSize: 10.5, color: '#94a3b8', textAlign: 'center', fontWeight: 600 }}>{device.label}</span>
      </div>
    );
  }
  const display = typeof value === 'number' ? value.toFixed(1) : typeof value === 'boolean' ? String(value) : '--';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
      <div
        style={{
          width: 76,
          height: 40,
          borderRadius: 6,
          background: '#0a0f1a',
          border: '1.5px solid #334155',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
          fontSize: 16,
          color: '#4ade80',
          fontWeight: 700,
        }}
        title={device.signal}
      >
        {display}
      </div>
      <span style={{ fontSize: 10.5, color: '#94a3b8', textAlign: 'center', fontWeight: 600 }}>{device.label}</span>
    </div>
  );
}

// ── relay: coil (PLC output) energizes -> contact closes ────────────────────
// Purely a display device (the contact_signal is a real signal path other
// devices, e.g. conveyor drive_signal/reverse_signal, can read -- see
// docs/SIMULATION.md "リレー"). Shows the coil label + an energized/contact
// indicator so the "PLC output -> relay coil -> contact -> motor" wiring is
// visually obvious.
function RelayDevice({ device, energized }: { device: SimDevice; energized: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 120 }}>
      <div
        style={{
          width: 96,
          height: 68,
          borderRadius: 6,
          border: `2px solid ${energized ? '#f59e0b' : '#475569'}`,
          background: '#0f172a',
          boxShadow: energized ? '0 0 14px #f59e0b70' : 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: 6,
        }}
        title={`coil: ${device.coil_signal ?? ''} -> contact: ${device.contact_signal ?? ''}`}
      >
        {/* Coil */}
        <div
          style={{
            width: 60,
            height: 18,
            borderRadius: 4,
            background: energized ? '#f59e0b30' : '#1e293b',
            border: `1.5px solid ${energized ? '#f59e0b' : '#334155'}`,
            fontSize: 8,
            color: energized ? '#f59e0b' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
          }}
        >
          COIL
        </div>
        {/* Contact (open/closed) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontSize: 8, color: '#64748b' }}>接点</span>
          <div
            style={{
              width: 22,
              height: 8,
              borderRadius: 3,
              background: energized ? '#22c55e' : '#334155',
              boxShadow: energized ? '0 0 6px #22c55e90' : 'none',
              transition: 'all 0.1s',
            }}
          />
          <span style={{ fontSize: 8, fontWeight: 700, color: energized ? '#22c55e' : '#64748b' }}>
            {energized ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>
      <span style={{ fontSize: 10.5, color: '#94a3b8', textAlign: 'center', fontWeight: 600 }}>{device.label}</span>
    </div>
  );
}

// ── digit_switch: DSW-style thumbwheel, operator up/down input ─────────────
function DigitSwitchDevice({ device, value }: { device: SimDevice; value: unknown }) {
  const min = device.min ?? 0;
  const max = device.max ?? 9;
  const current = typeof value === 'number' ? value : min;

  const step = (delta: number) => {
    const next = Math.max(min, Math.min(max, Math.trunc(current) + delta));
    writeSignal(device.signal, next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 96 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <button
          onClick={() => step(1)}
          title="+1"
          style={{
            width: 28, height: 18, border: '1px solid #334155', background: '#1e293b',
            color: '#94a3b8', borderRadius: 4, cursor: 'pointer', fontSize: 10, lineHeight: 1,
          }}
        >
          ▲
        </button>
        <div
          style={{
            width: 44,
            height: 34,
            borderRadius: 4,
            background: '#0a0f1a',
            border: '1.5px solid #334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'monospace',
            fontSize: 18,
            color: '#e2e8f0',
            fontWeight: 700,
          }}
          title={device.signal}
        >
          {Math.trunc(current)}
        </div>
        <button
          onClick={() => step(-1)}
          title="-1"
          style={{
            width: 28, height: 18, border: '1px solid #334155', background: '#1e293b',
            color: '#94a3b8', borderRadius: 4, cursor: 'pointer', fontSize: 10, lineHeight: 1,
          }}
        >
          ▼
        </button>
      </div>
      <span style={{ fontSize: 10.5, color: '#94a3b8', textAlign: 'center', fontWeight: 600 }}>{device.label}</span>
    </div>
  );
}

// ── Conveyor + jig + position_sensor ────────────────────────────────────────
// Unlike the other device types, a conveyor is a *composite* visual: the
// belt itself, plus every jig riding on it (positioned live from
// usePLCStore's simState) and every position_sensor mounted along its
// length. jig/position_sensor devices reference their conveyor by id
// (`conveyor: "conv1"`) rather than an absolute canvas position, so they're
// rendered as part of the ConveyorDevice rather than standalone.

const CONVEYOR_HEIGHT = 64;
// Vertical spacing (px) between lanes when rendering jig features / a
// multi-lane sensor bracket as a widthwise column (see docs/SIMULATION.md
// "レーン") -- features/sensors sharing the same `at_mm`/`offset_mm` but
// different `lane` no longer overlap at a single point, they stack into a
// column that visually reads as "perpendicular to the belt's travel
// direction", matching the real KENTEI-PLC jig's row of screw holes.
const LANE_ROW_HEIGHT = 13;

/** Group a list of same-`at_mm` (or same-`offset_mm`) devices/features by
 * lane, defaulting an absent `lane` to 0 -- mirrors the backend's own
 * `sensor.get("lane", 0)` / `feat.get("lane", 0)` fallback so a rig authored
 * before lanes existed (a single lane-less sensor/feature at one position)
 * renders identically to before (one dot, not a bracket). */
function groupByLane<T extends { lane?: number }>(items: T[]): Map<number, T[]> {
  const byLane = new Map<number, T[]>();
  for (const item of items) {
    const lane = item.lane ?? 0;
    byLane.set(lane, [...(byLane.get(lane) ?? []), item]);
  }
  return byLane;
}

function ConveyorDevice({
  device,
  driving,
  reversed,
  jigs,
  sensors,
  simJigs,
  simSensors,
  featuresEditable,
}: {
  device: SimDevice;
  driving: boolean;
  reversed: boolean;
  jigs: SimDevice[];
  sensors: SimDevice[];
  simJigs: Record<string, { position_mm: number; features?: Record<string, { attached: boolean; lane?: number }> }>;
  simSensors: Record<string, boolean>;
  /** Whether jig screws can be clicked to attach/detach (see
   * docs/SIMULATION.md "ネジ着脱") -- disabled while an exam is running so an
   * operator can't invalidate an in-progress certification run. */
  featuresEditable: boolean;
}) {
  const widthPx = device.width ?? 480;
  const lengthMm = device.length_mm ?? 1000;
  const scale = (mm: number) => (mm / lengthMm) * widthPx;

  // Feature-detecting sensors that share the same at_mm form one "bracket"
  // mounted across the belt (one dot per lane, stacked vertically) --
  // exactly the KENTEI-PLC 4-connector shape. "jig"-detect sensors (limit
  // switches) are never grouped this way (lane is meaningless for them).
  const featureSensorsByAtMm = new Map<number, SimDevice[]>();
  const plainSensors: SimDevice[] = [];
  for (const s of sensors) {
    if ((s.detect ?? 'feature') === 'feature') {
      const atMm = s.at_mm ?? 0;
      featureSensorsByAtMm.set(atMm, [...(featureSensorsByAtMm.get(atMm) ?? []), s]);
    } else {
      plainSensors.push(s);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 600 }}>{device.label}</span>
      <div
        style={{
          position: 'relative',
          width: widthPx,
          height: CONVEYOR_HEIGHT,
          background: '#1e293b',
          border: '2px solid #334155',
          borderRadius: 6,
          overflow: 'visible',
        }}
        title={device.drive_signal}
      >
        {/* Belt surface with a moving stripe pattern while driving */}
        <div
          style={{
            position: 'absolute',
            inset: 4,
            borderRadius: 3,
            background:
              'repeating-linear-gradient(90deg, #0f172a 0px, #0f172a 14px, #263449 14px, #263449 28px)',
            backgroundSize: '28px 100%',
            animation: driving
              ? `sim-belt-flow ${reversed ? '-0.7s' : '0.7s'} linear infinite`
              : 'none',
          }}
        />

        {/* "jig"-detect sensors (limit switches etc.) -- single dot, lane-agnostic */}
        {plainSensors.map((s) => {
          const atMm = s.at_mm ?? 0;
          const active = !!simSensors[s.id];
          const isLimitSwitch = (s.sensor_style ?? 'limit_switch') === 'limit_switch';
          return (
            <div
              key={s.id}
              style={{
                position: 'absolute',
                left: scale(atMm) - 7,
                top: -26,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
              title={`${s.label} (${s.signal})`}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: isLimitSwitch ? 3 : '50%',
                  background: active ? '#f59e0b' : '#334155',
                  border: `1.5px solid ${active ? '#f59e0b' : '#64748b'}`,
                  boxShadow: active ? '0 0 8px #f59e0b90' : 'none',
                  transform:
                    isLimitSwitch && active ? 'rotate(25deg)' : 'none',
                  transition: 'all 0.1s',
                }}
              />
              <span style={{ fontSize: 8, color: '#64748b' }}>{atMm}mm</span>
            </div>
          );
        })}

        {/* "feature"-detect sensors, grouped into per-at_mm brackets (one dot
            per lane, stacked vertically above the belt -- see
            docs/SIMULATION.md "レーン"). A single-lane group (the common
            pre-lane case: one sensor, no `lane` field) renders exactly like
            the old single-dot layout, just via the lane=0 bucket. */}
        {[...featureSensorsByAtMm.entries()].map(([atMm, group]) => {
          const byLane = groupByLane(group);
          const lanes = [...byLane.keys()].sort((a, b) => a - b);
          return (
            <div
              key={`sensor-bracket-${atMm}`}
              style={{
                position: 'absolute',
                left: scale(atMm) - 7,
                top: -26 - (lanes.length - 1) * LANE_ROW_HEIGHT,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
              title={`${group[0]?.label ?? 'センサー'} @ ${atMm}mm (${group.length}連)`}
            >
              {/* Bracket bar spanning all lanes when there's more than one --
                  visually reads as "one mounting bracket crossing the belt". */}
              {lanes.length > 1 && (
                <div
                  style={{
                    position: 'absolute',
                    left: 6,
                    top: 7,
                    width: 2,
                    height: (lanes.length - 1) * LANE_ROW_HEIGHT,
                    background: '#475569',
                  }}
                />
              )}
              {lanes.map((lane) => {
                const s = byLane.get(lane)![0];
                const active = !!simSensors[s.id];
                return (
                  <div
                    key={s.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, zIndex: 1 }}
                    title={`${s.label} (${s.signal}) lane=${lane}`}
                  >
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: active ? '#f59e0b' : '#334155',
                        border: `1.5px solid ${active ? '#f59e0b' : '#64748b'}`,
                        boxShadow: active ? '0 0 8px #f59e0b90' : 'none',
                        transition: 'all 0.1s',
                      }}
                    />
                  </div>
                );
              })}
              <span style={{ fontSize: 8, color: '#64748b' }}>{atMm}mm</span>
            </div>
          );
        })}

        {/* Jigs riding on the belt */}
        {jigs.map((j) => {
          const posMm = simJigs[j.id]?.position_mm ?? j.home_mm ?? 0;
          const sizeMm = j.size_mm ?? 100;
          const featuresByOffset = new Map<number, SimJigFeature[]>();
          for (const f of j.features ?? []) {
            const offset = f.offset_mm;
            featuresByOffset.set(offset, [...(featuresByOffset.get(offset) ?? []), f]);
          }
          return (
            <div
              key={j.id}
              style={{
                position: 'absolute',
                left: scale(posMm),
                top: 6,
                width: Math.max(8, scale(sizeMm)),
                height: CONVEYOR_HEIGHT - 16,
                background: '#475569',
                border: '2px solid #94a3b8',
                borderRadius: 4,
                transition: 'left 0.08s linear',
              }}
              title={`${j.label} @ ${posMm.toFixed(0)}mm`}
            >
              {[...featuresByOffset.entries()].map(([offset, group]) => {
                const byLane = groupByLane(group);
                const lanes = [...byLane.keys()].sort((a, b) => a - b);
                return lanes.map((lane, rowIndex) => {
                  const f = byLane.get(lane)![0];
                  // Live attached/detached state comes from sim_state (see
                  // PhysicsEngine.state()); fall back to the rig JSON's
                  // static `attached` (default true) before the first
                  // sim_state poll arrives.
                  const liveAttached = simJigs[j.id]?.features?.[f.id]?.attached;
                  const attached = liveAttached ?? (f.attached ?? true);
                  const clickable = featuresEditable;
                  // Multiple lanes at the same offset_mm stack vertically
                  // (perpendicular to belt travel = widthwise), a single
                  // lane (the common pre-lane case) renders at the same spot
                  // the old single-dot layout used.
                  const centerRow = (lanes.length - 1) / 2;
                  return (
                    <div
                      key={f.id}
                      title={`${f.label ?? f.type}${clickable ? ' (クリックで着脱)' : ''}`}
                      onClick={
                        clickable
                          ? (e) => {
                              e.stopPropagation();
                              setJigFeatureAttached(j.id, f.id, !attached);
                            }
                          : undefined
                      }
                      style={{
                        position: 'absolute',
                        left: Math.max(0, scale(offset) - 5),
                        top: -10 - (rowIndex - centerRow) * LANE_ROW_HEIGHT,
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: attached ? '#cbd5e1' : '#0a0f1a',
                        border: attached ? '1px solid #64748b' : '1.5px dashed #475569',
                        boxShadow: attached ? '0 1px 2px #00000060' : 'inset 0 1px 3px #00000080',
                        cursor: clickable ? 'pointer' : 'default',
                      }}
                    />
                  );
                });
              })}
            </div>
          );
        })}
      </div>
      <span style={{ fontSize: 9.5, color: driving ? '#818cf8' : '#475569', fontWeight: 700 }}>
        {driving ? (reversed ? '搬送中 (逆転)' : '搬送中') : '停止'}
      </span>
    </div>
  );
}

export function DeviceCanvas({
  devices,
  examRunning = false,
  editMode = false,
  unresolvedDeviceIds,
  onDeviceClick,
  selectedDeviceId,
}: {
  devices: SimDevice[];
  /** Disables jig screw attach/detach clicks while a certification exam is
   * running (see docs/SIMULATION.md "ネジ着脱") -- the panel default is
   * "editable" so devices without an exam attached (or before the exam
   * starts) can still be configured freely. */
  examRunning?: boolean;
  /** Binding-edit mode (see docs/SIMULATION.md "リグバインド編集"): clicking
   * a device opens its binding panel instead of operating it, and devices
   * with an unresolved signal reference get a red marker. */
  editMode?: boolean;
  /** Device ids with at least one unresolved signal binding (see
   * GET /api/sim/rigs/{name}/bindings) -- rendered with a red outline. */
  unresolvedDeviceIds?: Set<string>;
  onDeviceClick?: (deviceId: string) => void;
  selectedDeviceId?: string | null;
}) {
  const runtimeState = usePLCStore((s) => s.runtimeState);
  const ioValues = usePLCStore((s) => s.ioValues);
  const simState = usePLCStore((s) => s.simState);
  const unresolved = unresolvedDeviceIds ?? new Set<string>();

  const conveyors = devices.filter((d) => d.type === 'conveyor');
  const jigsByConveyor = new Map<string, SimDevice[]>();
  const sensorsByConveyor = new Map<string, SimDevice[]>();
  for (const d of devices) {
    if (d.type === 'jig' && d.conveyor) {
      jigsByConveyor.set(d.conveyor, [...(jigsByConveyor.get(d.conveyor) ?? []), d]);
    }
    if (d.type === 'position_sensor' && d.conveyor) {
      sensorsByConveyor.set(d.conveyor, [...(sensorsByConveyor.get(d.conveyor) ?? []), d]);
    }
  }
  const renderedInConveyor = new Set<string>([
    ...conveyors.map((c) => c.id),
    ...[...jigsByConveyor.values()].flat().map((d) => d.id),
    ...[...sensorsByConveyor.values()].flat().map((d) => d.id),
  ]);
  const standaloneDevices = devices.filter((d) => !renderedInConveyor.has(d.id));

  return (
    <div
      style={{
        flex: 1,
        position: 'relative',
        background:
          'radial-gradient(circle at 20% 15%, #16213a 0%, #0a0f1a 60%)',
        overflow: 'auto',
        padding: 24,
      }}
    >
      <style>{`
        @keyframes sim-motor-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes sim-belt-flow {
          from { background-position: 0 0; }
          to { background-position: 28px 0; }
        }
      `}</style>
      {devices.length === 0 && (
        <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', marginTop: 60 }}>
          このリグにはデバイスが定義されていません。
        </div>
      )}
      <div style={{ position: 'relative', minHeight: 400 }}>
        {standaloneDevices.map((d) => {
          const value = readSignal(d.signal, runtimeState, ioValues);
          const active = value === true;
          const style: React.CSSProperties = d.position
            ? { position: 'absolute', left: d.position.x, top: d.position.y }
            : { position: 'relative', display: 'inline-block', marginRight: 24, marginBottom: 24 };
          const energized = d.type === 'relay' ? !!simState.relays?.[d.id] : false;
          const isUnresolved = unresolved.has(d.id);
          const isSelected = editMode && selectedDeviceId === d.id;
          return (
            <div key={d.id} style={style}>
              <div
                onClickCapture={
                  editMode
                    ? (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDeviceClick?.(d.id);
                      }
                    : undefined
                }
                style={{
                  position: 'relative',
                  borderRadius: 10,
                  outline: isUnresolved
                    ? '2.5px solid #ef4444'
                    : isSelected
                      ? '2.5px solid #6366f1'
                      : 'none',
                  outlineOffset: 3,
                  cursor: editMode ? 'pointer' : undefined,
                  boxShadow: isUnresolved ? '0 0 10px #ef444460' : undefined,
                }}
                title={editMode ? `${d.label} のバインドを編集` : undefined}
              >
                {d.type === 'pushbutton' && <PushbuttonDevice device={d} active={active} />}
                {d.type === 'switch' && <SwitchDevice device={d} active={active} />}
                {d.type === 'lamp' && <LampDevice device={d} active={active} />}
                {d.type === 'motor' && <MotorDevice device={d} active={active} />}
                {d.type === 'indicator_number' && <IndicatorNumberDevice device={d} value={value} />}
                {d.type === 'relay' && <RelayDevice device={d} energized={energized} />}
                {d.type === 'digit_switch' && <DigitSwitchDevice device={d} value={value} />}
                {isUnresolved && (
                  <span
                    style={{
                      position: 'absolute',
                      top: -8,
                      right: -4,
                      background: '#ef4444',
                      color: '#fff',
                      borderRadius: '50%',
                      width: 16,
                      height: 16,
                      fontSize: 10,
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 0 6px #ef444490',
                    }}
                  >
                    !
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {conveyors.map((c) => {
          const driving = readSignal(c.drive_signal ?? '', runtimeState, ioValues) === true;
          const reversed = c.reverse_signal
            ? readSignal(c.reverse_signal, runtimeState, ioValues) === true
            : false;
          const style: React.CSSProperties = c.position
            ? { position: 'absolute', left: c.position.x, top: c.position.y }
            : { position: 'relative', display: 'inline-block', marginRight: 24, marginBottom: 24 };
          const isUnresolved = unresolved.has(c.id);
          const isSelected = editMode && selectedDeviceId === c.id;
          return (
            <div key={c.id} style={style}>
              <div
                onClickCapture={
                  editMode
                    ? (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDeviceClick?.(c.id);
                      }
                    : undefined
                }
                style={{
                  position: 'relative',
                  borderRadius: 10,
                  outline: isUnresolved
                    ? '2.5px solid #ef4444'
                    : isSelected
                      ? '2.5px solid #6366f1'
                      : 'none',
                  outlineOffset: 3,
                  cursor: editMode ? 'pointer' : undefined,
                }}
                title={editMode ? `${c.label} のバインドを編集` : undefined}
              >
                <ConveyorDevice
                  device={c}
                  driving={driving}
                  reversed={reversed}
                  jigs={jigsByConveyor.get(c.id) ?? []}
                  sensors={sensorsByConveyor.get(c.id) ?? []}
                  simJigs={simState.jigs}
                  simSensors={simState.sensors}
                  featuresEditable={!examRunning && !editMode}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
