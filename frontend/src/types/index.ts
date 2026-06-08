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

export interface NodeDef {
  id: string;
  type: string;
  params: Record<string, unknown>;
  position: { x: number; y: number };
  label: string;
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

export interface WSMessage {
  type: 'state_update';
  runtime: RuntimeState;
  metrics: ScanMetrics;
  changes: Record<string, Record<string, unknown>>;
  pending_ops: PendingOp[];
  custom_blocks?: Record<string, CustomBlockStatus>;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

export interface AIChatResponse {
  message: string;
  tool_calls: ToolCall[];
  pending_ops: PendingOp[];
}
