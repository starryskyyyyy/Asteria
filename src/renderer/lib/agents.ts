import type { AgentInfo } from '../types';

/**
 * The agent registry is written once, right after bootstrap, and only read afterwards. Keeping it in
 * a module lets leaf components (message bubbles, sidebar rows) label a route without threading the
 * whole registry through every prop list.
 */
let registry: AgentInfo[] = [];

export function setAgentRegistry(list: AgentInfo[] | undefined) {
  registry = Array.isArray(list) ? list : [];
}

export function agentList(): AgentInfo[] {
  return registry;
}

export function agentFor(id?: string | null): AgentInfo | undefined {
  return registry.find((agent) => agent.id === id);
}

/** Human label for a CLI id; falls back to the raw id so an unknown route still renders. */
export function agentName(id?: string | null): string {
  if (!id) return 'CLI';
  return agentFor(id)?.name || id;
}

export function isAcpAgent(id?: string | null): boolean {
  return agentFor(id)?.channel === 'acp';
}

/** Unverified integrations stay hidden until the user turns on developer mode. */
export function visibleAgents(developerMode: boolean): AgentInfo[] {
  return registry.filter((agent) => agent.verified || developerMode);
}

export function pathKey(id: string) {
  return `asteria.cliPath.${id}`;
}

export function readStoredPaths(agents: AgentInfo[]): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const agent of agents) paths[agent.id] = localStorage.getItem(pathKey(agent.id)) || '';
  return paths;
}
