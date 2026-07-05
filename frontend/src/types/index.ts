export interface PortDef {
  name: string;
  data_type: 'bool' | 'int' | 'float';
  direction?: 'input' | 'output';
  description?: string;
}

export interface NodeCatalogEntry {
  type: string;
  input_ports: PortDef[];
  output_ports: PortDef[];
  label?: string;
  description?: string;
  icon_color?: string;
  is_custom?: boolean;
  created_by?: 'human' | 'ai';
}

export interface CustomBlockDefinition {
  id: string;
  name: string;
  description: string;
  code: string;
  input_ports: PortDef[];
  output_ports: PortDef[];
  params_schema: Record<string, unknown>;
  icon_color: string;
  created_by: 'human' | 'ai';
}

export interface CustomBlockTestResult {
  outputs: Record<string, unknown>;
  new_state: Record<string, unknown>;
  error: string | null;
  exec_ms: number;
}

export interface GroupPortDef {
  id: string;
  name: string;
  data_type: 'bool' | 'int' | 'float';
}

export interface NodeDef {
  id: string;
  type: string;
  params: Record<string, unknown>;
  position: { x: number; y: number };
  label: string;

  // Group (hierarchy) fields — only meaningful when type === "group".
  kind?: string;
  inputs?: GroupPortDef[];
  outputs?: GroupPortDef[];
  children?: ProgramGraph | null;
}

export interface EdgeDef {
  id: string;
  source: string;
  source_handle: string;
  target: string;
  target_handle: string;
}

export interface ProgramGraph {
  nodes: NodeDef[];
  edges: EdgeDef[];
}

/** Reserved node id used inside a group's `children.edges` to reference the
 * group's own boundary In/Out ports (see docs/HIERARCHY.md). */
export const PARENT_REF = '$parent';

export type RuntimeState = Record<string, Record<string, unknown>>;

export interface ScanMetrics {
  cycle_time_ms: number;
  target_cycle_ms: number;
  nodes_evaluated: number;
  utilization_pct: number;
  memory_mb: number;
  history_buffer_mb: number;
  scan_index: number;
  timestamp: number;
}

export interface PendingOp {
  op: 'add_node' | 'add_edge' | 'delete_node' | 'set_parameter' | 'create_custom_block';
  payload: Record<string, unknown>;
}

export interface CustomBlockStatus {
  exec_ms: number | null;
  error: string | null;
}

export interface ResourceTask {
  name: 'control' | 'hmi' | 'viz';
  period_ms: number;
  effective_period_ms: number;
  cpu_share: number;
  protected: boolean;
  utilization_pct: number;
  run_count: number;
  last_busy_ms: number;
  degraded: boolean;
}

export interface WSMessage {
  type: 'state_update' | 'viz_update';
  runtime: RuntimeState;
  metrics: ScanMetrics;
  changes: Record<string, Record<string, unknown>>;
  pending_ops: PendingOp[];
  custom_blocks?: Record<string, CustomBlockStatus>;
  resources?: ResourceTask[];
  t_ms?: number;
  sim_state?: SimState;
}

export interface SignalInfo {
  path: string;
  node_id: string;
  port: string;
  value: unknown;
  data_type: 'bool' | 'number' | 'other';
}

// ── Signal hub (rename cascade / usage badges / unresolved refs) ──────────
// See docs/VARIABLES.md "6. 信号ハブ" -- bidirectional discovery between
// logic-design signals (node ids / internal variables) and simulation-rig /
// HMI-screen references to them.

export interface RenameNodeResult {
  id: string;
  old_id: string;
  edge_refs_updated: number;
  updated_refs: { sim_rigs: string[]; hmi_screens: string[] };
}

export interface SignalUsage {
  path: string;
  node_id: string;
  port: string;
  data_type: 'bool' | 'number' | 'other';
  used_by: {
    logic: number;
    hmi_screens: string[];
    sim_rigs: string[];
  };
}

export interface UnresolvedReference {
  path: string;
  referenced_by: { kind: 'sim_rig' | 'hmi_screen'; name: string }[];
}

export interface SignalsUsageReport {
  signals: SignalUsage[];
  unresolved: UnresolvedReference[];
}

export interface RigBinding {
  device_id: string;
  device_type: string;
  field: string;
  signal: string;
  resolved: boolean;
  /** "rig" (see docs/SIMULATION.md "リレー"): a signal the rig ITSELF
   * provides (e.g. a relay's contact_signal) while it's the currently-
   * active rig -- reported resolved rather than a false-alarm red marker
   * (BUG-009, docs/QA_LOG.md). Only appears when this rig is active. */
  kind: 'var' | 'input' | 'output' | 'rig' | 'none';
}

export type HmiWidgetType = 'button_momentary' | 'button_alternate' | 'lamp' | 'number' | 'gauge';

export interface HmiWidget {
  id: string;
  type: HmiWidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  signal: string;
  color?: string;
  options?: { min?: number; max?: number };
}

export interface HmiScreen {
  name: string;
  widgets: HmiWidget[];
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

// ── Network management / running-program monitoring ────────────────────────

export interface NetworkServiceUrls {
  localhost: string;
  lan: string;
}

export interface NetworkService {
  name: 'studio' | 'hmi' | 'viz';
  role: 'studio' | 'hmi' | 'viz';
  port: number;
  enabled: boolean;
  status: 'listening' | 'stopped';
  ws_clients: number;
  urls: NetworkServiceUrls;
}

export interface MonitoringSummary {
  program_name: string;
  running: boolean;
  scan_index: number;
  last_cycle_time_ms: number | null;
  node_count: number;
  tasks: ResourceTask[];
}

export interface DebugEvent {
  seq: number;
  t_ms: number;
  scan: number;
  signal: string;
  old: unknown;
  new: unknown;
}

export interface NetworkInfo {
  services: NetworkService[];
  monitoring: MonitoringSummary;
  recent_events: DebugEvent[];
}

export interface AIChatResponse {
  message: string;
  tool_calls: ToolCall[];
  pending_ops: PendingOp[];
}

export interface AIStatus {
  available: boolean;
  provider: 'anthropic' | 'gemini' | null;
}

// ── Variables (I/O + internal work variables) ───────────────────────────

export type VariableKind = 'input' | 'output' | 'internal';

export interface VariableRow {
  id: string;
  kind: VariableKind;
  name: string;
  type: 'bool' | 'number';
  value: unknown;
  comment: string;
  initial?: unknown;
  editable_name: boolean;
  editable_value: boolean;
}

// ── Simulation tab (mock devices + sequencer exam runner) ───────────────
// See docs/SIMULATION.md for the rig JSON format this mirrors.

export type SimDeviceType =
  | 'pushbutton'
  | 'switch'
  | 'lamp'
  | 'motor'
  | 'indicator_number'
  | 'conveyor'
  | 'jig'
  | 'position_sensor'
  | 'relay'
  | 'digit_switch';

export interface SimJigFeature {
  id: string;
  type: string;
  offset_mm: number;
  label?: string;
  /** Whether this feature (e.g. a screw) is currently attached to the jig --
   * see docs/SIMULATION.md "ネジ着脱". Defaults to true. A detached feature
   * is skipped entirely by position_sensor detection and rendered as an
   * empty hole. Toggled via `POST /api/sim/jigs/{jig}/features/{feature}`
   * or the exam-step op `set_feature`. */
  attached?: boolean;
  /** Width-wise lane index (0..N-1, see docs/SIMULATION.md "レーン") --
   * which row of screw holes (perpendicular to the conveyor's travel
   * direction) this feature sits in. Defaults to 0 when omitted (every rig
   * authored before lanes existed effectively has one implicit lane). A
   * `position_sensor` with `detect: "feature"` only detects features whose
   * `lane` matches its own. */
  lane?: number;
}

export interface SimDevice {
  id: string;
  type: SimDeviceType;
  label: string;
  signal: string;
  mode?: 'momentary' | 'toggle';
  color?: string;
  position?: { x: number; y: number };

  // conveyor
  drive_signal?: string;
  reverse_signal?: string | null;
  length_mm?: number;
  speed_mm_s?: number;
  width?: number;

  // jig
  conveyor?: string;
  home_mm?: number;
  size_mm?: number;
  features?: SimJigFeature[];
  at_end?: 'stop' | 'wrap';

  // position_sensor
  at_mm?: number;
  window_mm?: number;
  detect?: 'feature' | 'jig';
  sensor_style?: 'limit_switch' | 'proximity';
  /** Which lane (see SimJigFeature.lane) this sensor watches -- only
   * meaningful when `detect: "feature"` ("jig" detectors/limit switches see
   * the jig body and ignore lane entirely). Defaults to 0. */
  lane?: number;

  // relay (see docs/SIMULATION.md "リレー"): coil_signal drives
  // contact_signal (truthy coil -> contact True, no excitation delay).
  coil_signal?: string;
  contact_signal?: string;

  // digit_switch: an operator up/down numeric input (DSW-style thumbwheel).
  // Writes its current value to `signal` (typically a `var.<id>`).
  digits?: number;
  min?: number;
  max?: number;

  // indicator_number: `style: "seven_seg"` renders a 7-segment-style digit
  // display instead of the plain monospace readout (docs/SIMULATION.md).
  style?: 'seven_seg';
}

/** Dynamic physics state (jig positions / position_sensor detection flags /
 * relay energized flags), see docs/SIMULATION.md +
 * backend plc/simulation.py::PhysicsEngine.state(). Delivered either via
 * `GET /api/sim/state` (polling) or piggy-backed on the WS `state_update`
 * message's `sim_state` key (smoother animation). */
export interface SimState {
  jigs: Record<string, { position_mm: number; features?: Record<string, { attached: boolean; lane?: number }> }>;
  sensors: Record<string, boolean>;
  relays?: Record<string, boolean>;
}

export interface SimFeedbackRule {
  watch: string;
  equals?: unknown;
  delay_ms: number;
  set_input: string;
  value: unknown;
  revert_on_clear?: boolean;
  revert_value?: unknown;
  note?: string;
}

export interface SimExamStep {
  op: 'set' | 'expect' | 'reset_jig' | 'set_feature';
  signal?: string;
  jig?: string;
  feature?: string;
  attached?: boolean;
  value?: unknown;
  within_ms?: number;
  after_ms?: number;
  note?: string;
}

export interface SimExamDef {
  title: string;
  description?: string;
  steps: SimExamStep[];
}

export interface SimRig {
  name: string;
  title?: string;
  description?: string;
  target_program?: string;
  devices: SimDevice[];
  feedback_rules: SimFeedbackRule[];
  exam?: SimExamDef;
}

export interface SimExamStepResult {
  index: number;
  op: string;
  signal: string | null;
  note: string;
  status: 'pending' | 'running' | 'pass' | 'fail';
  actual: unknown;
  expected: unknown;
  elapsed_ms: number | null;
  error: string | null;
}

export interface SimExamStatus {
  state: 'idle' | 'running' | 'passed' | 'failed' | 'aborted';
  title: string | null;
  steps: SimExamStepResult[];
}

/** Body of the 409 response from `POST /api/sim/exam/start` when the active
 * rig's exam.steps reference signals that don't resolve against the
 * currently-loaded program (BUG-009, docs/QA_LOG.md) -- e.g. kentei_plc
 * activated while start_stop, not its target_program kentei_machine, is
 * still loaded. FastAPI wraps this under a top-level `detail` key. */
export interface SimExamUnresolvedSignalsError {
  error: 'unresolved_signals';
  signals: string[];
  target_program: string | null;
  current_program: string;
  hint: string;
}
