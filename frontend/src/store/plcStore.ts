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
  RuntimeState,
  ScanMetrics,
  PendingOp,
  NodeCatalogEntry,
  WSMessage,
  AIChatResponse,
  ToolCall,
} from '../types';

const API = '';

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

  // Runtime
  runtimeState: RuntimeState;
  metrics: ScanMetrics | null;
  pendingOps: PendingOp[];

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

  // WebSocket
  wsConnected: boolean;

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

function buildReactFlowNodes(program: ProgramGraph, runtime: RuntimeState): Node[] {
  return program.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: {
      label: n.label || n.id,
      params: n.params,
      outputs: runtime[n.id] || {},
      nodeType: n.type,
    },
  }));
}

function buildReactFlowEdges(program: ProgramGraph, runtime: RuntimeState): Edge[] {
  return program.edges.map((e) => {
    const srcOutputs = runtime[e.source] || {};
    const value = srcOutputs[e.source_handle] ?? null;
    const isActive = value === true;
    const isNumeric = typeof value === 'number';
    return {
      id: e.id,
      source: e.source,
      sourceHandle: e.source_handle,
      target: e.target,
      targetHandle: e.target_handle,
      type: 'plcEdge',
      animated: isActive,
      data: { value, label: e.source_handle },
      style: {
        stroke: isActive ? '#22c55e' : isNumeric ? '#f59e0b' : '#475569',
        strokeWidth: isActive ? 2.5 : 1.5,
        strokeDasharray: isActive ? undefined : '5,4',
      },
    };
  });
}

export const usePLCStore = create<PLCState>((set, get) => ({
  nodes: [],
  edges: [],
  runtimeState: {},
  metrics: null,
  pendingOps: [],
  catalog: {},
  ioValues: {},
  customBlockStatus: {},
  runtimeConfig: null,
  chatHistory: [],
  aiLoading: false,
  wsConnected: false,

  onNodesChange: (changes) => {
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) }));
    // Persist position changes
    changes.forEach((c) => {
      if (c.type === 'position' && !c.dragging && c.position) {
        get().persistNodePosition(c.id, c.position);
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

  loadProgram: async () => {
    const res = await fetch(`${API}/api/program`);
    if (!res.ok) return;
    const program: ProgramGraph = await res.json();
    const runtime = get().runtimeState;
    set({
      nodes: buildReactFlowNodes(program, runtime),
      edges: buildReactFlowEdges(program, runtime),
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
    const runtime = msg.runtime;
    set((s) => {
      // Update node data (outputs)
      const nodes = s.nodes.map((n) => {
        const outputs = runtime[n.id];
        if (outputs === undefined) return n;
        return { ...n, data: { ...n.data, outputs } };
      });

      // Update edge styles based on live values
      const edges = s.edges.map((e) => {
        const srcOutputs = runtime[e.source] || {};
        const value = srcOutputs[e.sourceHandle ?? ''] ?? null;
        const isActive = value === true;
        const isNumeric = typeof value === 'number';
        return {
          ...e,
          animated: isActive,
          data: { ...e.data, value },
          style: {
            stroke: isActive ? '#22c55e' : isNumeric ? '#f59e0b' : '#475569',
            strokeWidth: isActive ? 2.5 : 1.5,
            strokeDasharray: isActive ? undefined : '5,4',
          },
        };
      });

      return {
        nodes,
        edges,
        runtimeState: runtime,
        metrics: msg.metrics,
        pendingOps: msg.pending_ops || s.pendingOps,
        customBlockStatus: msg.custom_blocks || s.customBlockStatus,
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
        if (msg.type === 'state_update') get()._applyWSUpdate(msg);
      } catch {}
    };
  },
}));
