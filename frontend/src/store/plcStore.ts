import { create } from 'zustand';
import {
  Node,
  Edge,
  Connection,
  addEdge as rfAddEdge,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
} from 'reactflow';
import type {
  ProgramGraph,
  NodeDef,
  RuntimeState,
  ScanMetrics,
  PendingOp,
  NodeCatalogEntry,
  WSMessage,
  AIChatResponse,
  ToolCall,
  ResourceTask,
  SignalInfo,
  NetworkInfo,
  AIStatus,
  VariableRow,
  SimState,
  RenameNodeResult,
  SignalsUsageReport,
} from '../types';
import { PARENT_REF } from '../types';

const API = '';

// Pseudo reactflow node ids for a group's boundary In/Out ports, shown only
// while drilled into that group (see docs/HIERARCHY.md $parent convention).
export const BOUNDARY_IN_ID = '$parent_in';
export const BOUNDARY_OUT_ID = '$parent_out';

export interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

interface PLCState {
  // Reactflow
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  // Hierarchy: the full nested program tree as returned by GET /api/program,
  // and the drill-down path (group ids from root). The canvas always renders
  // the subtree at `currentPath`.
  programTree: ProgramGraph;
  currentPath: string[];
  drillDown: (groupId: string) => void;
  navigateToDepth: (depth: number) => void;

  // Runtime
  runtimeState: RuntimeState;
  metrics: ScanMetrics | null;
  pendingOps: PendingOp[];

  // Simulation tab: dynamic physics state (jig positions / position_sensor
  // flags), see docs/SIMULATION.md. Populated from the WS `sim_state` key
  // (see _applyWSUpdate) with a `GET /api/sim/state` poll as a fallback for
  // before the first WS message / while WS is disconnected.
  simState: SimState;
  loadSimState: () => Promise<void>;

  // Catalog
  catalog: Record<string, NodeCatalogEntry>;

  // IO values (for DigitalInput nodes)
  ioValues: Record<string, boolean>;

  // Per-cycle status of custom (Python) code blocks: {nodeId: {exec_ms, error}}
  customBlockStatus: Record<string, { exec_ms: number | null; error: string | null }>;

  // Runtime config (scan interval, history depth)
  runtimeConfig: { scan_interval_ms: number; history_seconds: number } | null;

  // AI chat
  chatHistory: ChatEntry[];
  aiLoading: boolean;
  aiStatus: AIStatus | null;
  loadAiStatus: () => Promise<void>;

  // WebSocket
  wsConnected: boolean;

  // Active top-level UI mode tab.
  activeTab: 'logic' | 'hmi' | 'viz' | 'resources' | 'network' | 'simulation';
  setActiveTab: (tab: 'logic' | 'hmi' | 'viz' | 'resources' | 'network' | 'simulation') => void;

  // Resources (control/hmi/viz task scheduler)
  resourceTasks: ResourceTask[];
  loadResources: () => Promise<void>;
  updateResourceTask: (name: string, patch: { period_ms?: number; cpu_share?: number }) => Promise<void>;

  // Signals (HMI binding / viz picker)
  signals: SignalInfo[];
  loadSignals: () => Promise<void>;

  // Signal hub: usage badges (logic/HMI/rig) + unresolved rig/HMI references
  // (see docs/VARIABLES.md "6. 信号ハブ"), consumed by the variable manager.
  signalsUsage: SignalsUsageReport;
  loadSignalsUsage: () => Promise<void>;

  // Node id (= signal name) rename -- the "logic side" half of binding
  // logic-design signals to simulation-rig signals (see docs/VARIABLES.md).
  // Returns null on failure (caller inspects renameError for the message).
  renameError: string | null;
  renameNode: (nodeId: string, newId: string) => Promise<RenameNodeResult | null>;
  // Last successful rename's cascade summary, shown as a transient toast by
  // the logic tab (see components/RenameNotice.tsx) then cleared.
  lastRenameNotice: RenameNodeResult | null;
  clearRenameNotice: () => void;

  // Variables (I/O + internal work variables) -- modal openable from any tab
  variablesModalOpen: boolean;
  setVariablesModalOpen: (open: boolean) => void;
  variableRows: VariableRow[];
  loadVariables: () => Promise<void>;
  createVariable: (v: { name: string; type: 'bool' | 'number'; initial: unknown; comment?: string }) => Promise<void>;
  updateVariableDef: (id: string, patch: { name?: string; type?: 'bool' | 'number'; initial?: unknown; comment?: string }) => Promise<void>;
  deleteVariable: (id: string) => Promise<void>;
  forceVariable: (id: string, value: unknown) => Promise<void>;
  renameVariable: (id: string, name: string) => Promise<void>;

  // Network management + running-program monitoring (see docs/NETWORK.md)
  networkInfo: NetworkInfo | null;
  loadNetworkInfo: () => Promise<void>;
  updateNetworkService: (name: string, patch: { port?: number; enabled?: boolean }) => Promise<{ ok: boolean; error?: string }>;

  // Example programs (examples/*.json), for switching between the flat
  // start_stop sample and the hierarchical conveyor_machine sample.
  exampleNames: string[];
  loadExampleNames: () => Promise<void>;
  loadExampleProgram: (name: string) => Promise<void>;

  // Name of the example program currently loaded server-side (see
  // GET /api/program/current-name / backend runtime.current_program_name),
  // or null if unknown (e.g. a raw PUT /api/program edit). Used by the
  // simulation tab's header display and its exam-preflight banner (BUG-009,
  // docs/QA_LOG.md) so an operator can tell at a glance whether the loaded
  // program matches a rig's target_program.
  currentProgramName: string | null;
  loadCurrentProgramName: () => Promise<void>;

  // Actions
  loadProgram: () => Promise<void>;
  loadCatalog: () => Promise<void>;
  addNodeToCanvas: (type: string, position: { x: number; y: number }) => Promise<void>;
  deleteNodeFromCanvas: (nodeId: string) => Promise<void>;
  updateNodeParams: (nodeId: string, params: Record<string, unknown>) => Promise<void>;
  persistNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  toggleIO: (nodeId: string, current: boolean) => Promise<void>;
  loadIoValues: () => Promise<void>;
  deleteCustomBlock: (blockId: string) => Promise<void>;
  updateRuntimeConfig: (scanIntervalMs: number) => Promise<void>;
  sendAIMessage: (message: string) => Promise<void>;
  applyPending: () => Promise<void>;
  rejectPending: () => Promise<void>;
  connectWS: () => void;
  _applyWSUpdate: (msg: WSMessage) => void;
}

let ws: WebSocket | null = null;

/** Resolve the ProgramGraph subtree to display for a given drill-down path.
 * Root ([]) is the tree itself. Each path segment is a group node id found
 * at the previous level; its `children` becomes the next level's graph.
 * Returns null if the path no longer resolves (e.g. the group was deleted
 * out from under an open drill-down — caller should fall back to root). */
function resolveSubtree(tree: ProgramGraph, path: string[]): { graph: ProgramGraph; groupChain: NodeDef[] } | null {
  let graph = tree;
  const groupChain: NodeDef[] = [];
  for (const groupId of path) {
    const group = graph.nodes.find((n) => n.id === groupId && n.type === 'group');
    if (!group) return null;
    groupChain.push(group);
    graph = group.children ?? { nodes: [], edges: [] };
  }
  return { graph, groupChain };
}

/** The full flattened runtime path for a node local to `path` (matches the
 * backend's `flatten_program` id-qualification scheme, see
 * backend/plc/graph.py and docs/HIERARCHY.md). */
function flatPath(path: string[], localId: string): string {
  return path.length ? `${path.join('/')}/${localId}` : localId;
}

/** Recursively collect every leaf (non-group) node's flattened runtime id
 * beneath a given node, for aggregating a group's "any output ON" indicator. */
function collectDescendantLeafIds(node: NodeDef, path: string[]): string[] {
  if (node.type !== 'group') return [flatPath(path, node.id)];
  const children = node.children ?? { nodes: [], edges: [] };
  const childPath = [...path, node.id];
  return children.nodes.flatMap((n) => collectDescendantLeafIds(n, childPath));
}

function buildReactFlowNodes(
  graph: ProgramGraph,
  path: string[],
  runtime: RuntimeState,
  groupChain: NodeDef[]
): Node[] {
  const nodes: Node[] = graph.nodes.map((n) => {
    if (n.type === 'group') {
      const leafIds = collectDescendantLeafIds(n, path);
      const anyOn = leafIds.some((id) =>
        Object.values(runtime[id] ?? {}).some((v) => v === true)
      );
      const childPath = [...path, n.id];
      const inputValues: Record<string, unknown> = {};
      const outputValues: Record<string, unknown> = {};
      for (const p of n.inputs ?? []) {
        // A group's input port's live value is read from whatever internal
        // node it passes through to, resolved the same way the backend
        // does: look up the flattened id of the first internal target.
        inputValues[p.id] = readGroupPortValue(n, childPath, p.id, 'input', runtime);
      }
      for (const p of n.outputs ?? []) {
        outputValues[p.id] = readGroupPortValue(n, childPath, p.id, 'output', runtime);
      }
      return {
        id: n.id,
        type: 'group',
        position: n.position,
        data: {
          label: n.label || n.id,
          kind: n.kind || '',
          inputs: n.inputs ?? [],
          outputs: n.outputs ?? [],
          inputValues,
          outputValues,
          anyOn,
          blockCount: leafIds.length,
        },
      };
    }
    return {
      id: n.id,
      type: n.type,
      position: n.position,
      data: {
        label: n.label || n.id,
        params: n.params,
        outputs: runtime[flatPath(path, n.id)] || {},
        nodeType: n.type,
      },
    };
  });

  // Boundary port terminal pseudo-nodes, shown only while drilled into a group.
  if (groupChain.length > 0) {
    const currentGroup = groupChain[groupChain.length - 1];
    const parentPath = path.slice(0, -1);
    const outerValues = (port: { id: string }, direction: 'input' | 'output') =>
      readGroupPortValue(currentGroup, path, port.id, direction, runtime);

    if ((currentGroup.inputs ?? []).length > 0) {
      nodes.push({
        id: BOUNDARY_IN_ID,
        type: 'boundaryIn',
        position: { x: -260, y: 40 },
        draggable: false,
        data: {
          label: 'IN (親からの入力)',
          ports: currentGroup.inputs ?? [],
          values: Object.fromEntries((currentGroup.inputs ?? []).map((p) => [p.id, outerValues(p, 'input')])),
        },
      });
    }
    if ((currentGroup.outputs ?? []).length > 0) {
      nodes.push({
        id: BOUNDARY_OUT_ID,
        type: 'boundaryOut',
        position: { x: 900, y: 40 },
        draggable: false,
        data: {
          label: 'OUT (親への出力)',
          ports: currentGroup.outputs ?? [],
          values: Object.fromEntries((currentGroup.outputs ?? []).map((p) => [p.id, outerValues(p, 'output')])),
        },
      });
    }
    void parentPath;
  }

  return nodes;
}

/** Read a group's boundary port live value by walking its internal
 * `$parent`-referencing edge(s) down to a concrete leaf node's output (for
 * "output"/pass-through-to-output ports) — mirrors (a simplified, one-hop-
 * aware version of) the backend's flatten_program port resolution, good
 * enough for a live-value display since we only need ONE representative
 * value per port, not full fan-out. */
function readGroupPortValue(
  group: NodeDef,
  childPath: string[],
  portId: string,
  direction: 'input' | 'output',
  runtime: RuntimeState
): unknown {
  const children = group.children ?? { nodes: [], edges: [] };
  if (direction === 'output') {
    const edge = children.edges.find((e) => e.target === PARENT_REF && e.target_handle === portId);
    if (!edge) return undefined;
    return readNodeHandleValue(children, childPath, edge.source, edge.source_handle, runtime, 'output');
  } else {
    const edge = children.edges.find((e) => e.source === PARENT_REF && e.source_handle === portId);
    if (!edge) return undefined;
    return readNodeHandleValue(children, childPath, edge.target, edge.target_handle, runtime, 'input');
  }
}

function readNodeHandleValue(
  graph: ProgramGraph,
  path: string[],
  nodeId: string,
  handle: string,
  runtime: RuntimeState,
  direction: 'input' | 'output'
): unknown {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return undefined;
  if (node.type === 'group') {
    return readGroupPortValue(node, [...path, node.id], handle, direction, runtime);
  }
  const outputs = runtime[flatPath(path, node.id)] || {};
  return outputs[handle];
}

function buildReactFlowEdges(graph: ProgramGraph, path: string[], runtime: RuntimeState, groupChain: NodeDef[]): Edge[] {
  const styleFor = (value: unknown) => {
    const isActive = value === true;
    const isNumeric = typeof value === 'number';
    return {
      animated: isActive,
      style: {
        stroke: isActive ? '#22c55e' : isNumeric ? '#f59e0b' : '#475569',
        strokeWidth: isActive ? 2.5 : 1.5,
        strokeDasharray: isActive ? undefined : '5,4',
      },
    };
  };

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const currentGroup = groupChain.length > 0 ? groupChain[groupChain.length - 1] : null;

  const edges: Edge[] = [];
  for (const e of graph.edges) {
    // Edges referencing $parent are rendered against the boundary pseudo-nodes.
    const source = e.source === PARENT_REF ? BOUNDARY_IN_ID : e.source;
    const target = e.target === PARENT_REF ? BOUNDARY_OUT_ID : e.target;

    let value: unknown = null;
    if (e.source === PARENT_REF && currentGroup) {
      value = readGroupPortValue(currentGroup, path, e.source_handle, 'input', runtime);
    } else {
      const srcNode = nodeById.get(e.source);
      if (srcNode?.type === 'group') {
        value = readGroupPortValue(srcNode, [...path, srcNode.id], e.source_handle, 'output', runtime);
      } else {
        const srcOutputs = runtime[flatPath(path, e.source)] || {};
        value = srcOutputs[e.source_handle] ?? null;
      }
    }

    edges.push({
      id: e.id,
      source,
      sourceHandle: e.source_handle,
      target,
      targetHandle: e.target_handle,
      type: 'plcEdge',
      data: { value, label: e.source_handle },
      ...styleFor(value),
    });
  }
  return edges;
}

export const usePLCStore = create<PLCState>((set, get) => ({
  nodes: [],
  edges: [],
  programTree: { nodes: [], edges: [] },
  currentPath: [],
  exampleNames: [],
  currentProgramName: null,
  runtimeState: {},
  metrics: null,
  pendingOps: [],
  simState: { jigs: {}, sensors: {}, relays: {} },
  catalog: {},
  ioValues: {},
  customBlockStatus: {},
  runtimeConfig: null,
  chatHistory: [],
  aiLoading: false,
  aiStatus: null,
  wsConnected: false,
  activeTab: 'logic',
  resourceTasks: [],
  signals: [],
  signalsUsage: { signals: [], unresolved: [] },
  renameError: null,
  lastRenameNotice: null,
  networkInfo: null,
  variablesModalOpen: false,
  variableRows: [],

  setActiveTab: (tab) => set({ activeTab: tab }),

  loadNetworkInfo: async () => {
    const res = await fetch(`${API}/api/network`);
    if (res.ok) set({ networkInfo: await res.json() });
  },

  updateNetworkService: async (name, patch) => {
    const res = await fetch(`${API}/api/network/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      await get().loadNetworkInfo();
      return { ok: true };
    }
    let error = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      error = body.detail || error;
    } catch {}
    return { ok: false, error };
  },

  loadResources: async () => {
    const res = await fetch(`${API}/api/resources`);
    if (res.ok) {
      const body = await res.json();
      set({ resourceTasks: body.tasks });
    }
  },

  updateResourceTask: async (name, patch) => {
    const res = await fetch(`${API}/api/resources`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: [{ name, ...patch }] }),
    });
    if (res.ok) {
      const body = await res.json();
      set({ resourceTasks: body.tasks });
    }
  },

  loadSignals: async () => {
    const res = await fetch(`${API}/api/signals`);
    if (res.ok) set({ signals: await res.json() });
  },

  loadSignalsUsage: async () => {
    const res = await fetch(`${API}/api/signals/usage`);
    if (res.ok) set({ signalsUsage: await res.json() });
  },

  clearRenameNotice: () => set({ lastRenameNotice: null }),

  renameNode: async (nodeId, newId) => {
    set({ renameError: null });
    const res = await fetch(`${API}/api/program/nodes/${encodeURIComponent(nodeId)}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_id: newId }),
    });
    if (!res.ok) {
      let error = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        error = body.detail || error;
      } catch {
        /* ignore */
      }
      set({ renameError: error });
      return null;
    }
    const result: RenameNodeResult = await res.json();
    // Reload the program (id changed -- canvas nodes/edges must reflect the
    // new id) and refresh the signal picker lists so the HMI builder / sim
    // binding editor immediately see the new name.
    await get().loadProgram();
    await get().loadSignals();
    set({ lastRenameNotice: result });
    return result;
  },

  loadAiStatus: async () => {
    const res = await fetch(`${API}/api/ai/status`);
    if (res.ok) set({ aiStatus: await res.json() });
  },

  loadSimState: async () => {
    const res = await fetch(`${API}/api/sim/state`);
    if (res.ok) set({ simState: await res.json() });
  },

  setVariablesModalOpen: (open) => {
    set({ variablesModalOpen: open });
    if (open) get().loadVariables();
  },

  loadVariables: async () => {
    const res = await fetch(`${API}/api/variables`);
    if (res.ok) set({ variableRows: await res.json() });
  },

  createVariable: async (v) => {
    const res = await fetch(`${API}/api/variables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v),
    });
    if (res.ok) await get().loadVariables();
  },

  updateVariableDef: async (id, patch) => {
    const res = await fetch(`${API}/api/variables/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) await get().loadVariables();
  },

  deleteVariable: async (id) => {
    const res = await fetch(`${API}/api/variables/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) await get().loadVariables();
  },

  forceVariable: async (id, value) => {
    const res = await fetch(`${API}/api/variables/${encodeURIComponent(id)}/force`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (res.ok) await get().loadVariables();
  },

  renameVariable: async (id, name) => {
    const res = await fetch(`${API}/api/variables/${encodeURIComponent(id)}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.ok) await get().loadVariables();
  },

  drillDown: (groupId) => {
    set((s) => {
      const nextPath = [...s.currentPath, groupId];
      const resolved = resolveSubtree(s.programTree, nextPath);
      if (!resolved) return {};
      return {
        currentPath: nextPath,
        nodes: buildReactFlowNodes(resolved.graph, nextPath, s.runtimeState, resolved.groupChain),
        edges: buildReactFlowEdges(resolved.graph, nextPath, s.runtimeState, resolved.groupChain),
      };
    });
  },

  navigateToDepth: (depth) => {
    set((s) => {
      const nextPath = s.currentPath.slice(0, depth);
      const resolved = resolveSubtree(s.programTree, nextPath);
      if (!resolved) return {};
      return {
        currentPath: nextPath,
        nodes: buildReactFlowNodes(resolved.graph, nextPath, s.runtimeState, resolved.groupChain),
        edges: buildReactFlowEdges(resolved.graph, nextPath, s.runtimeState, resolved.groupChain),
      };
    });
  },

  onNodesChange: (changes) => {
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) }));
    // Persist position changes (only meaningful for real, non-boundary nodes).
    changes.forEach((c) => {
      if (c.type === 'position' && !c.dragging && c.position) {
        if (c.id !== BOUNDARY_IN_ID && c.id !== BOUNDARY_OUT_ID) {
          get().persistNodePosition(c.id, c.position);
        }
      }
    });
  },

  onEdgesChange: (changes) => {
    // Handle deletions
    changes.forEach((c) => {
      if (c.type === 'remove') {
        fetch(`${API}/api/program/edges/${c.id}`, { method: 'DELETE' }).catch(() => {});
      }
    });
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }));
  },

  onConnect: async (connection) => {
    if (!connection.source || !connection.target) return;
    const res = await fetch(`${API}/api/program/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: connection.source,
        source_handle: connection.sourceHandle,
        target: connection.target,
        target_handle: connection.targetHandle,
      }),
    });
    if (res.ok) {
      const edge = await res.json();
      const value = null;
      set((s) => ({
        edges: rfAddEdge(
          {
            ...connection,
            id: edge.id,
            type: 'plcEdge',
            animated: false,
            data: { value, label: connection.sourceHandle },
            style: { stroke: '#475569', strokeWidth: 1.5, strokeDasharray: '5,4' },
          },
          s.edges
        ),
      }));
    }
  },

  loadCatalog: async () => {
    const res = await fetch(`${API}/api/catalog`);
    if (res.ok) set({ catalog: await res.json() });
  },

  loadExampleNames: async () => {
    const res = await fetch(`${API}/api/program/examples`);
    if (res.ok) set({ exampleNames: await res.json() });
  },

  loadExampleProgram: async (name) => {
    const res = await fetch(`${API}/api/program/examples/${name}/load`, { method: 'POST' });
    if (res.ok) {
      set({ currentPath: [], currentProgramName: name });
      await get().loadProgram();
      await get().loadIoValues();
    }
  },

  loadCurrentProgramName: async () => {
    const res = await fetch(`${API}/api/program/current-name`);
    if (res.ok) {
      const body = await res.json();
      set({ currentProgramName: body.name ?? null });
    }
  },

  loadProgram: async () => {
    const res = await fetch(`${API}/api/program`);
    if (!res.ok) return;
    const program: ProgramGraph = await res.json();
    const runtime = get().runtimeState;
    // Keep the current drill-down path if it still resolves against the
    // freshly-loaded tree (e.g. after a param edit); otherwise reset to root
    // (e.g. after switching to a different example program).
    const existingPath = get().currentPath;
    const stillValid = resolveSubtree(program, existingPath);
    const path = stillValid ? existingPath : [];
    const resolved = stillValid ?? resolveSubtree(program, [])!;
    set({
      programTree: program,
      currentPath: path,
      nodes: buildReactFlowNodes(resolved.graph, path, runtime, resolved.groupChain),
      edges: buildReactFlowEdges(resolved.graph, path, runtime, resolved.groupChain),
    });
  },

  addNodeToCanvas: async (type, position) => {
    const res = await fetch(`${API}/api/program/nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, position }),
    });
    if (res.ok) {
      const node = await res.json();
      set((s) => ({
        nodes: [
          ...s.nodes,
          {
            id: node.id,
            type: node.type,
            position: node.position,
            data: { label: node.label || node.id, params: node.params, outputs: {}, nodeType: node.type },
          },
        ],
      }));
    }
  },

  deleteNodeFromCanvas: async (nodeId) => {
    await fetch(`${API}/api/program/nodes/${nodeId}`, { method: 'DELETE' });
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    }));
  },

  updateNodeParams: async (nodeId, params) => {
    await fetch(`${API}/api/program/nodes/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
    });
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, params: { ...n.data.params, ...params } } } : n
      ),
    }));
  },

  persistNodePosition: (nodeId, position) => {
    fetch(`${API}/api/program/nodes/${nodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position }),
    }).catch(() => {});
  },

  toggleIO: async (nodeId, current) => {
    const newVal = !current;
    await fetch(`${API}/api/io/${nodeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: newVal }),
    });
    set((s) => ({ ioValues: { ...s.ioValues, [nodeId]: newVal } }));
  },

  loadIoValues: async () => {
    const res = await fetch(`${API}/api/io`);
    if (res.ok) set({ ioValues: await res.json() });
  },

  deleteCustomBlock: async (blockId) => {
    await fetch(`${API}/api/blocks/custom/${blockId}`, { method: 'DELETE' });
    await get().loadCatalog();
  },

  updateRuntimeConfig: async (scanIntervalMs) => {
    const res = await fetch(`${API}/api/runtime/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scan_interval_ms: scanIntervalMs }),
    });
    if (res.ok) set({ runtimeConfig: await res.json() });
  },

  sendAIMessage: async (message) => {
    set((s) => ({
      chatHistory: [...s.chatHistory, { role: 'user', content: message }],
      aiLoading: true,
    }));
    try {
      const res = await fetch(`${API}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: get().chatHistory
            .slice(-10)
            .filter((e) => e.role !== 'assistant' || e.content)
            .map((e) => ({ role: e.role, content: e.content })),
        }),
      });
      if (res.ok) {
        const data: AIChatResponse = await res.json();
        set((s) => ({
          chatHistory: [
            ...s.chatHistory,
            { role: 'assistant', content: data.message, toolCalls: data.tool_calls },
          ],
          pendingOps: data.pending_ops,
        }));
      }
    } finally {
      set({ aiLoading: false });
    }
  },

  applyPending: async () => {
    const res = await fetch(`${API}/api/ai/pending/apply`, { method: 'POST' });
    if (res.ok) {
      set({ pendingOps: [] });
      await get().loadProgram();
    }
  },

  rejectPending: async () => {
    await fetch(`${API}/api/ai/pending/reject`, { method: 'POST' });
    set({ pendingOps: [] });
  },

  _applyWSUpdate: (msg) => {
    // `viz_update` messages (pushed by the `viz` task at its own, possibly
    // degraded, period) only carry a resources snapshot -- no runtime state
    // diff to apply to nodes/edges.
    if (msg.type === 'viz_update') {
      if (msg.resources) set({ resourceTasks: msg.resources });
      return;
    }
    const runtime = msg.runtime;
    set((s) => {
      const path = s.currentPath;
      const resolved = resolveSubtree(s.programTree, path);
      const graph = resolved?.graph ?? { nodes: [], edges: [] };
      const groupChain = resolved?.groupChain ?? [];
      const nodeDefById = new Map(graph.nodes.map((n) => [n.id, n]));

      // Update node data (outputs / group aggregates) in place where possible
      // (cheaper than a full rebuild every scan), falling back to a full
      // rebuild for group nodes and boundary pseudo-nodes since their
      // aggregate/derived values depend on several signals at once.
      const nodes = s.nodes.map((n) => {
        if (n.id === BOUNDARY_IN_ID || n.id === BOUNDARY_OUT_ID) {
          const currentGroup = groupChain[groupChain.length - 1];
          if (!currentGroup) return n;
          const ports: { id: string }[] = n.data.ports;
          const direction = n.id === BOUNDARY_IN_ID ? 'input' : 'output';
          const values = Object.fromEntries(
            ports.map((p) => [p.id, readGroupPortValue(currentGroup, path, p.id, direction, runtime)])
          );
          return { ...n, data: { ...n.data, values } };
        }
        const def = nodeDefById.get(n.id);
        if (def?.type === 'group') {
          const childPath = [...path, def.id];
          const leafIds = collectDescendantLeafIds(def, path);
          const anyOn = leafIds.some((id) => Object.values(runtime[id] ?? {}).some((v) => v === true));
          const inputValues: Record<string, unknown> = {};
          const outputValues: Record<string, unknown> = {};
          for (const p of def.inputs ?? []) inputValues[p.id] = readGroupPortValue(def, childPath, p.id, 'input', runtime);
          for (const p of def.outputs ?? []) outputValues[p.id] = readGroupPortValue(def, childPath, p.id, 'output', runtime);
          return { ...n, data: { ...n.data, anyOn, inputValues, outputValues } };
        }
        const outputs = runtime[flatPath(path, n.id)];
        if (outputs === undefined) return n;
        return { ...n, data: { ...n.data, outputs } };
      });

      // Update edge styles based on live values
      const edges = buildReactFlowEdges(graph, path, runtime, groupChain);

      // Variable manager modal: refresh each row's live `value` in place
      // from the WS payload (cheap) instead of refetching /api/variables on
      // every scan. `runtime.var` holds internal variables (path "var.<id>",
      // see backend PLCRuntime.get_broadcast_state); I/O rows read their
      // "<node_id>.OUT" the same way the canvas does.
      const varValues = (runtime.var ?? {}) as Record<string, unknown>;
      const variableRows = s.variableRows.length
        ? s.variableRows.map((row) => {
            if (row.kind === 'internal') {
              return varValues[row.id] !== undefined ? { ...row, value: varValues[row.id] } : row;
            }
            const outputs = runtime[row.id];
            return outputs && outputs.OUT !== undefined ? { ...row, value: outputs.OUT } : row;
          })
        : s.variableRows;

      return {
        nodes,
        edges,
        runtimeState: runtime,
        metrics: msg.metrics,
        pendingOps: msg.pending_ops || s.pendingOps,
        customBlockStatus: msg.custom_blocks || s.customBlockStatus,
        resourceTasks: msg.resources || s.resourceTasks,
        variableRows,
        simState: msg.sim_state || s.simState,
      };
    });
  },

  connectWS: () => {
    if (ws) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.hostname;
    const port = import.meta.env.DEV ? '8000' : window.location.port;
    ws = new WebSocket(`${proto}://${host}:${port}/ws`);

    ws.onopen = () => set({ wsConnected: true });
    ws.onclose = () => {
      set({ wsConnected: false });
      ws = null;
      setTimeout(() => get().connectWS(), 2000);
    };
    ws.onmessage = (ev) => {
      try {
        const msg: WSMessage = JSON.parse(ev.data);
        if (msg.type === 'state_update' || msg.type === 'viz_update') get()._applyWSUpdate(msg);
      } catch {}
    };
  },
}));
