import logger from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getSandbox } from './sandboxManager.js';

export class ExecutionSandbox {
  private static instance: ExecutionSandbox;
  private stateHashes: string[] = [];

  private constructor() {}

  public static getInstance(): ExecutionSandbox {
    if (!ExecutionSandbox.instance) {
      ExecutionSandbox.instance = new ExecutionSandbox();
    }
    return ExecutionSandbox.instance;
  }

  /**
   * MCP-Compliant Tool Execution (JSON-RPC)
   * Decouples the reasoning from the technical action.
   */
  public async callMcpTool(method: string, params: any) {
    logger.info(`MCP: Calling tool method [${method}]`);

    const request = {
        jsonrpc: "2.0",
        method,
        params,
        id: crypto.randomUUID()
    };

    try {
      const sandbox = await getSandbox('default-research');

      switch (method) {
        case 'python/execute':
          logger.info('Sandbox: Executing Python code via E2B');
          const res = await sandbox.commands.run(`python3 -c "${params.code.replace(/"/g, '\\"')}"`);
          return {
              jsonrpc: "2.0",
              result: { output: res.stdout || res.stderr },
              id: request.id
          };

        case 'fs/list':
          const files = await sandbox.files.list(params.dir || '/home/user/project');
          return { jsonrpc: "2.0", result: { files }, id: request.id };

        case 'fs/read':
          const content = await sandbox.files.read(params.path);
          return { jsonrpc: "2.0", result: { content }, id: request.id };

        case 'workspace/search':
          const searchRes = await sandbox.commands.run(`grep -r "${params.pattern}" ${params.dir || '/home/user/project'}`);
          return { jsonrpc: "2.0", result: { matches: searchRes.stdout }, id: request.id };

        default:
          return {
              jsonrpc: "2.0",
              error: { code: -32601, message: "Method not found" },
              id: request.id
          };
      }
    } catch (err: any) {
      return {
          jsonrpc: "2.0",
          error: { code: -32603, message: err.message },
          id: request.id
      };
    }
  }

  /**
   * Safe Tool Execution Interceptor
   * Dispatches real function calls and catches errors.
   */
  public async dispatchTool(toolName: string, args: any) {
    logger.info(`Sandbox: Executing tool [${toolName}]`);

    try {
      const LOCAL_ROOT = process.cwd();
      switch (toolName) {
        case 'ls':
          return await fs.readdir(path.resolve(LOCAL_ROOT, args.dir || '.'));
        case 'cat':
          return await fs.readFile(path.resolve(LOCAL_ROOT, args.path), 'utf-8');
        case 'grep':
          const content = await fs.readFile(path.resolve(LOCAL_ROOT, args.path), 'utf-8');
          return content.includes(args.pattern);
        case 'parse_csv':
          const csvData = await fs.readFile(path.resolve(LOCAL_ROOT, args.path), 'utf-8');
          return csvData.split('\n').map(row => row.split(','));
        default:
          return { error: `Tool ${toolName} is restricted or not found.` };
      }
    } catch (err: any) {
      logger.error(`Sandbox Tool Error [${toolName}]:`, err.message);
      return { error: err.message };
    }
  }

  /**
   * Convergence Checker (Infinite Loop Mitigation)
   * Calculates the hash of the current environmental state (e.g., file list).
   */
  public async detectInfiniteLoop(workspacePath: string): Promise<boolean> {
    const files = await fs.readdir(workspacePath, { recursive: true });
    const stateString = JSON.stringify(files.sort());
    const hash = crypto.createHash('md5').update(stateString).digest('hex');

    this.stateHashes.push(hash);

    // Keep only the last 5 hashes
    if (this.stateHashes.length > 5) this.stateHashes.shift();

    if (this.stateHashes.length >= 3) {
      const lastThree = this.stateHashes.slice(-3);
      const isStalled = lastThree.every(h => h === hash);

      if (isStalled) {
        logger.warn('CONVERGENCE TRAP: Environment state delta is 0 over 3 iterations.');
        return true;
      }
    }

    return false;
  }
}
