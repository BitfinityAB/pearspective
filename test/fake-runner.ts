import type { ProcessResult, ProcessRunner } from '../server/gh';

type Handler = { match: (args: string[]) => boolean; reply: (args: string[]) => ProcessResult | Error };

/** Answers each command line by its shape and records every call. */
export function fakeRunner(handlers: Handler[]) {
  const calls: string[][] = [];
  const runner: ProcessRunner = async (args) => {
    calls.push(args);
    const handler = handlers.find((candidate) => candidate.match(args));
    if (!handler) throw new Error(`Unexpected command: ${args.join(' ')}`);
    const reply = handler.reply(args);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { runner, calls };
}

export const ok = (stdout: string): ProcessResult => ({ code: 0, stdout, stderr: '' });
export const fail = (stdout: string, stderr = ''): ProcessResult => ({ code: 1, stdout, stderr });
export const errno = (code: string) => Object.assign(new Error(code), { code });
