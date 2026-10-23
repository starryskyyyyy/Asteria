import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export const PROTOCOL_VERSION = '2025-06-18';

export const DELEGATION_TOOLS = [
  { name: 'asteria_list_models', description: 'List the currently available Codex and DSH models and supported effort values. Use before dispatching if the route is uncertain.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'asteria_delegate', description: 'Dispatch a bounded task to a real child CLI model, wait for its result, then continue your own reasoning. The child cannot delegate further. The workspace is fixed to this conversation. readOnly is supported only for Codex; DSH cannot enforce read-only execution.', inputSchema: { type: 'object', properties: { cli: { type: 'string', enum: ['codex', 'dsh'] }, provider: { type: 'string', description: 'Required for DSH, ignored for Codex.' }, model: { type: 'string', description: 'A model ID from asteria_list_models.' }, effort: { type: 'string', description: 'A supported effort ID, if offered by that model.' }, task: { type: 'string', minLength: 1, maxLength: 20000 }, readOnly: { type: 'boolean', default: false, description: 'Codex only. DSH read-only requests are rejected because ACP cannot enforce a sandbox.' } }, required: ['cli', 'task'], additionalProperties: false } },
];

const MAX_BODY_BYTES = 1_000_000;

/**
 * Per-session MCP endpoint consumed by the *parent* CLI agent.
 *
 * Security model: bound to 127.0.0.1 on an ephemeral port, every path carries a 32-byte random
 * capability token, the body size is capped, and only the two asteria_* tools are reachable. The
 * endpoint exposes no filesystem or shell primitive of its own — the handlers do.
 */
export class DelegateBroker {
  constructor({ handlers }) { this.handlers = handlers; this.token = randomBytes(32).toString('hex'); this.server = null; this.url = null; }

  async start() {
    if (this.server) return this.url;
    this.server = createServer((request, response) => {
      this.#handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        if (!response.writableEnded) response.end();
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => { this.server.removeListener('error', reject); resolve(); });
    });
    const { port } = this.server.address();
    this.url = `http://127.0.0.1:${port}/${this.token}`;
    return this.url;
  }

  async close() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.url = null;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  async #handle(req, res) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    if (req.method !== 'POST' || req.url !== `/${this.token}`) { res.writeHead(404).end(JSON.stringify({ error: 'Not found' })); return; }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) { res.writeHead(413).end(JSON.stringify({ error: 'Payload too large' })); return; }
    }
    let rpc;
    try { rpc = JSON.parse(body); } catch { res.writeHead(400).end(JSON.stringify({ error: 'Invalid JSON' })); return; }
    if (!rpc || typeof rpc !== 'object' || Array.isArray(rpc) || typeof rpc.method !== 'string' || (rpc.params !== undefined && (!rpc.params || typeof rpc.params !== 'object' || Array.isArray(rpc.params)))) {
      res.writeHead(400).end(JSON.stringify({ jsonrpc: '2.0', id: rpc?.id ?? null, error: { code: -32600, message: 'Invalid JSON-RPC request' } }));
      return;
    }
    // Notifications never carry a response body.
    if (rpc.id === undefined || rpc.method.startsWith('notifications/')) { res.writeHead(202).end(); return; }
    try {
      const result = await this.#dispatch(rpc);
      res.writeHead(200).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
    } catch (error) {
      res.writeHead(200).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, error: { code: error?.rpcCode ?? -32000, message: String(error?.message || error).slice(0, 2000) } }));
    }
  }

  async #dispatch(rpc) {
    const { method, params = {} } = rpc;
    if (method === 'initialize') return { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'asteria-delegation', version: '2.0.0' } };
    if (method === 'ping') return {};
    if (method === 'tools/list') return { tools: DELEGATION_TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) };
    if (method !== 'tools/call') { const error = new Error(`Unsupported MCP method: ${String(method)}`); error.rpcCode = -32601; throw error; }
    const { name, arguments: args = {} } = params;
    // Tool *execution* failures are reported in-band (isError) per the MCP spec, so the model can read them.
    try {
      let output;
      if (name === 'asteria_list_models') output = await this.handlers.listModels();
      else if (name === 'asteria_delegate') output = await this.handlers.delegate(args);
      else { const error = new Error(`Unsupported Asteria tool: ${String(name)}`); error.rpcCode = -32601; throw error; }
      return { content: [{ type: 'text', text: JSON.stringify(output ?? null) }] };
    } catch (error) {
      if (error?.rpcCode) throw error;
      return { content: [{ type: 'text', text: `asteria_${name} failed: ${String(error?.message || error).slice(0, 2000)}` }], isError: true };
    }
  }
}
