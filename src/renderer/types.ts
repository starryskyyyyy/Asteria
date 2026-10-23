/**
 * Shared shapes for the renderer. These mirror exactly what the main process
 * sends over `window.asteria`; nothing here is invented, so the IPC contract
 * stays the single source of truth.
 */

export type Cli = 'codex' | 'dsh';

export type Route = { cli: Cli; model: string; provider?: string | null; effort?: string };

export type Message = {
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
  text: string;
  route?: Route;
  status?: string;
  at: string;
};

export type ToolEvent = {
  id: string;
  turnId: string;
  at: string;
  type: string;
  text?: string;
  conversationId?: string;
  agentId?: string;
  status?: string;
  task?: string;
  output?: string;
  error?: string;
  requestId?: string | number;
  route?: Partial<Route>;
  provider?: string;
  raw?: unknown;
};

export type Conversation = {
  id: string;
  title: string;
  cwd: string;
  route: Route;
  status: string;
  updatedAt: string;
  messages: Message[];
  error?: string;
  archived?: boolean;
  events?: ToolEvent[];
};

export type CatalogModel = {
  id: string;
  name: string;
  cli: Cli | string;
  provider?: string;
  reasoningEfforts?: string[];
  effortIds?: string[];
};

export type ConnectionInfo = {
  connected?: boolean;
  diagnostic?: string;
  entryPath?: string;
  defaultRoute?: { model: string; provider?: string | null };
};

export type Connections = Record<string, ConnectionInfo>;

export type Catalogs = Record<string, CatalogModel[]>;

export type ApprovalOption = { optionId?: string | number; kind?: string; name?: string };

export type ApprovalRequest = {
  conversationId: string;
  requestId: string | number;
  cli: Cli;
  prompt?: string;
  options?: ApprovalOption[];
};

export type LegacyItem = { id: string; title: string; status: string; cwd: string; summary?: string };

export type BootstrapResult = {
  conversations?: Conversation[];
  legacyArchive?: LegacyItem[];
  connections?: Connections;
};

export type ConnectionsResult = { connections?: Connections; catalogs?: Catalogs };

export type ChildRecord = {
  id: string;
  cli: Cli;
  route?: Partial<Route>;
  task?: string;
  status?: string;
  output?: string;
  error?: string;
  at?: string;
};

/** Every event the main process can push through `onEvent`. */
export type AsteriaEvent =
  | { kind: 'connections'; connections?: Connections; catalogs?: Catalogs }
  | { kind: 'conversation'; conversation: Conversation }
  | { kind: 'message'; conversationId: string; message: Message }
  | { kind: 'event'; conversationId: string; event: ToolEvent }
  | { kind: 'child'; conversationId: string; turnId: string; child: ChildRecord }
  | { kind: 'approval'; conversationId: string; requestId: string | number; cli: Cli; prompt?: string; options?: ApprovalOption[] }
  | { kind: 'approval_expired'; conversationId: string; requestId: string | number }
  | { kind: 'turn_complete'; conversationId: string; turnId: string; status: string; error: string };

/** The frozen preload bridge. `openExternal` never navigates the shell itself. */
export type AsteriaApi = {
  bootstrap(): Promise<BootstrapResult>;
  getConnections(paths: { codex?: string; dsh?: string }): Promise<ConnectionsResult>;
  pickFolder(): Promise<string | null>;
  listConversations(): Promise<Conversation[]>;
  getConversation(id: string): Promise<(Conversation & { events?: ToolEvent[] }) | null>;
  createConversation(request: { cwd: string; cli: Cli; model: string; provider?: string | null; effort?: string }): Promise<string>;
  setRoute(id: string, route: Route): Promise<Conversation>;
  sendMessage(id: string, text: string): Promise<{ turnId: string }>;
  cancel(id: string): Promise<boolean>;
  archive(id: string, archived?: boolean): Promise<boolean>;
  resolveApproval(id: string, requestId: string | number, choice: boolean | string | number): Promise<boolean>;
  legacyArchive(): Promise<LegacyItem[]>;
  openExternal(url: string): Promise<boolean>;
  setTheme(theme: string): void;
  onEvent(listener: (event: AsteriaEvent) => void): () => void;
};

declare global {
  interface Window { asteria: AsteriaApi }
}
