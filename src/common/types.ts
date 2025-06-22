// Core Types
export type StateName = string;
export type ActionName = string;
export type GuardPrompt = string;

export interface State {
  name: string;
  enterGuard?: GuardPrompt;
  exitGuard?: GuardPrompt;
  actions?: Map<ActionName, Action>;
}

export interface Action {
  name: ActionName;
  targetState: StateName;
}

// MCP types
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
}

export interface ToolsListResult {
  tools: ToolDefinition[];
}

export interface ToolsListJsonResponse extends JsonRpcResponse {
  id: number;
  result: ToolsListResult;
}

export interface ToolCallResult {
  content: { type: string; text: string }[];
}

export interface ToolCallJsonResponse extends JsonRpcResponse {
  id: number;
  result: ToolCallResult;
}
