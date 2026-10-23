import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENTS, agentIds, getAgent, publicAgent } from '../src/main/agents.js';

test('every agent ships the metadata the UI and the manager both rely on', () => {
  for (const agent of AGENTS) {
    assert.ok(agent.id, 'id is required');
    assert.ok(agent.name, `${agent.id} needs a display name`);
    assert.ok(agent.vendor, `${agent.id} needs a vendor`);
    assert.ok(['app-server', 'acp', 'stream-json'].includes(agent.channel), `${agent.id} has an unknown channel`);
    assert.ok(agent.home, `${agent.id} needs a docs link`);
    assert.ok(agent.install, `${agent.id} needs an install hint`);
    assert.equal(typeof agent.verified, 'boolean');
    for (const flag of ['models', 'approvals', 'resume', 'delegates', 'effort']) {
      assert.equal(typeof agent.supports?.[flag], 'boolean', `${agent.id}.supports.${flag} must be a boolean`);
    }
    assert.ok(Array.isArray(agent.executables) && agent.executables.length > 0, `${agent.id} needs executable candidates`);
    assert.ok(Array.isArray(agent.entries()) && agent.entries().length > 0, `${agent.id} needs entry candidates`);
  }
});

test('agent ids are unique and the shipped set matches the README promise', () => {
  assert.equal(new Set(agentIds()).size, AGENTS.length);
  assert.deepEqual(agentIds().sort(), ['claude', 'codebuddy', 'codex', 'dsh', 'gemini', 'kiro', 'qwen']);
  assert.equal(getAgent('nope'), null);
  assert.equal(getAgent('codex')?.channel, 'app-server');
  assert.equal(getAgent('dsh')?.channel, 'acp');
  assert.equal(getAgent('codebuddy')?.channel, 'stream-json');
});

test('verified agents are exactly the ones with a real protocol contract', () => {
  const verified = AGENTS.filter((agent) => agent.verified).map((agent) => agent.id).sort();
  assert.deepEqual(verified, ['claude', 'codebuddy', 'codex', 'dsh']);
});

test('channel-specific capabilities are declared honestly', () => {
  // Delegation needs a host-owned tool channel: an ACP session can expose one, a one-shot CLI cannot.
  for (const agent of AGENTS) {
    if (agent.channel === 'stream-json') assert.equal(agent.supports.delegates, false, `${agent.id} cannot delegate`);
    if (agent.channel === 'stream-json') assert.equal(agent.supports.approvals, false, `${agent.id} has no in-flight approvals`);
  }
  assert.equal(getAgent('codex')?.supports.delegates, true);
  assert.equal(getAgent('dsh')?.supports.delegates, true);
  assert.equal(getAgent('dsh')?.acp?.multiProvider, true);
  assert.equal(getAgent('codebuddy')?.streamJson?.env?.CODEBUDDY_FORCE_LITE_WB_BUNDLE, '1');
  assert.equal(getAgent('gemini')?.acp?.acpArgs?.[0], '--acp');
});

test('publicAgent strips functions so the payload survives IPC and JSON', () => {
  const publicShape = publicAgent(getAgent('codex'));
  assert.equal(publicShape.id, 'codex');
  assert.equal(typeof publicShape.entries, 'undefined');
  assert.doesNotThrow(() => JSON.stringify(publicShape));
});
