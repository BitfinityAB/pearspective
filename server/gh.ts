import { spawn } from 'node:child_process';
import { ProviderError } from './providers/types';

export interface ProcessResult { code: number; stdout: string; stderr: string }
export type ProcessRunner = (args: string[], stdin?: string) => Promise<ProcessResult>;

/** A hung gh would otherwise block every refresh that shares the in-flight tick. */
export const GH_TIMEOUT_MS = 60_000;
const TIMEOUT_MESSAGE = `gh timed out after ${GH_TIMEOUT_MS / 1000} s`;

export function createCommandRunner(command: string, spawnProcess: typeof spawn = spawn, timeoutMs = GH_TIMEOUT_MS): ProcessRunner {
  return (args, stdin) =>
    new Promise((resolve, reject) => {
      const child = spawnProcess(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => {
        child.kill();
        reject(Object.assign(new Error(TIMEOUT_MESSAGE), { code: 'ETIMEDOUT' }));
      }, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout, stderr });
      });
      // EPIPE when gh exits early; the exit code and stderr already report it.
      child.stdin.on('error', () => {});
      child.stdin.end(stdin ?? '');
    });
}

export const createSpawnRunner = (spawnProcess: typeof spawn = spawn, timeoutMs = GH_TIMEOUT_MS): ProcessRunner =>
  createCommandRunner('gh', spawnProcess, timeoutMs);

export const spawnGh: ProcessRunner = createSpawnRunner();

export interface GhClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  rest<T>(path: string): Promise<T>;
}

function parseJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

const UNREADABLE_RESPONSE = 'gh returned an unreadable response';

const TOLERATED_ERROR_TYPES = new Set(['NOT_FOUND', 'FORBIDDEN']);

function classify(result: ProcessResult): ProviderError | null {
  const body = parseJson(result.stdout);
  const errors: { type?: string; message: string }[] | undefined = body?.errors;
  // One renamed repo or deleted PR in an aliased query must not fail the whole refresh; its alias is simply null.
  if (errors?.length && body?.data && errors.every((error) => TOLERATED_ERROR_TYPES.has(error.type ?? ''))) return null;
  if (errors?.length) {
    const message = errors.map((error) => error.message).join('; ');
    if (errors.some((error) => error.type === 'RATE_LIMITED') || /rate limit/i.test(message)) return new ProviderError('rate-limit', message);
    if (/resource limits/i.test(message)) return new ProviderError('too-large', message);
    return new ProviderError('failed', message);
  }
  if (result.code === 0) return null;
  const stderr = result.stderr.trim();
  if (/gh auth login|not logged in|HTTP 401|authentication required/i.test(stderr)) return new ProviderError('auth', 'gh is not logged in. Run `gh auth login`.');
  // Large GraphQL pages time out at GitHub's gateway rather than returning an error body.
  if (/HTTP 50[24]/.test(stderr)) return new ProviderError('too-large', stderr);
  if (/rate limit/i.test(stderr)) return new ProviderError('rate-limit', stderr);
  return new ProviderError('failed', stderr || `gh exited with code ${result.code}`);
}

async function run(runner: ProcessRunner, args: string[], stdin?: string): Promise<ProcessResult> {
  try {
    return await runner(args, stdin);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProviderError('missing-cli', 'The GitHub CLI (gh) is not installed or not on PATH.');
    }
    if ((error as NodeJS.ErrnoException).code === 'ETIMEDOUT') throw new ProviderError('failed', TIMEOUT_MESSAGE);
    throw error;
  }
}

export function createGhClient(runner: ProcessRunner = spawnGh): GhClient {
  return {
    async graphql<T>(query: string, variables: Record<string, unknown> = {}) {
      const result = await run(runner, ['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables }));
      const error = classify(result);
      if (error) throw error;
      const body = parseJson(result.stdout);
      if (!body?.data) throw new ProviderError('failed', UNREADABLE_RESPONSE);
      return body.data as T;
    },
    async rest<T>(path: string) {
      const result = await run(runner, ['api', path]);
      const error = classify(result);
      if (error) throw error;
      const body = parseJson(result.stdout);
      if (body === null) throw new ProviderError('failed', UNREADABLE_RESPONSE);
      return body as T;
    },
  };
}
