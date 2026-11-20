import { createCommandRunner, type ProcessResult, type ProcessRunner } from '../../../gh';
import type { StatusCategory, Ticket } from '../../../../shared/types';
import { ProviderError, type IssueTrackerProvider, type TrackerAuthResult } from '../../types';

export const CHUNK_SIZE = 50;
const CATEGORY: Record<string, StatusCategory> = { new: 'todo', indeterminate: 'inProgress', done: 'done' };
const NOT_FOUND = /An issue with key '([^']+)' does not exist/g;
const NO_RESULT = /No result found/;

export const projectOf = (key: string) => key.slice(0, key.lastIndexOf('-'));
const firstLine = (text: string) => text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';

/** Reads tickets through jira-cli, which owns authentication (env var, .netrc or keychain). */
export class JiraCliTracker implements IssueTrackerProvider {
  readonly id = 'jira';

  /** Status name → category; jira-cli's list output carries only the name. */
  private readonly categories = new Map<string, StatusCategory>();

  constructor(private readonly baseUrl: string, private readonly runner: ProcessRunner = createCommandRunner('jira')) {}

  ticketUrl(key: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/browse/${encodeURIComponent(key)}`;
  }

  async checkAuth(): Promise<TrackerAuthResult> {
    try {
      const result = await this.exec(['me']);
      if (result.code !== 0) throw this.failure(result);
      return { ok: true, login: result.stdout.trim() };
    } catch (error) {
      if (error instanceof ProviderError) return { ok: false, reason: error.kind === 'missing-cli' || error.kind === 'auth' ? error.kind : 'failed', message: error.message };
      return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async getTickets(keys: string[]): Promise<{ tickets: Ticket[]; notFound: string[] }> {
    const byProject = new Map<string, string[]>();
    for (const key of new Set(keys)) byProject.set(projectOf(key), [...(byProject.get(projectOf(key)) ?? []), key]);
    const tickets: Ticket[] = [];
    const notFound: string[] = [];
    for (const [project, projectKeys] of byProject) {
      for (let start = 0; start < projectKeys.length; start += CHUNK_SIZE) {
        const chunk = await this.listChunk(project, projectKeys.slice(start, start + CHUNK_SIZE));
        tickets.push(...chunk.tickets);
        notFound.push(...chunk.notFound);
      }
    }
    await this.learnCategories(tickets);
    return { tickets: tickets.map((ticket) => ({ ...ticket, status: { ...ticket.status, category: this.categories.get(ticket.status.name) ?? null } })), notFound };
  }

  // One `issue view` per unseen status name: its full response includes the status category.
  private async learnCategories(tickets: Ticket[]): Promise<void> {
    const samples = new Map<string, string>();
    for (const ticket of tickets) {
      if (ticket.status.name && !this.categories.has(ticket.status.name) && !samples.has(ticket.status.name)) samples.set(ticket.status.name, ticket.key);
    }
    for (const [name, key] of samples) {
      try {
        const result = await this.exec(['issue', 'view', key, '--raw']);
        if (result.code !== 0) continue;
        const category = CATEGORY[JSON.parse(result.stdout)?.fields?.status?.statusCategory?.key];
        if (category) this.categories.set(name, category);
      } catch (error) {
        // An unlearned category only makes the verdict "unknown"; a missing CLI or lost login must still surface.
        if (error instanceof ProviderError && error.kind !== 'failed') throw error;
      }
    }
  }

  private async listChunk(project: string, keys: string[]): Promise<{ tickets: Ticket[]; notFound: string[] }> {
    if (keys.length === 0) return { tickets: [], notFound: [] };
    // --project is required: without it jira-cli silently limits the query to the default project.
    // No ORDER BY: jira-cli appends its own and rejects a second one.
    const result = await this.exec(['issue', 'list', '--project', project, '-q', `key in (${keys.join(', ')})`, '--paginate', String(CHUNK_SIZE), '--raw']);
    if (result.code === 0) return { tickets: this.parseList(result.stdout), notFound: [] };
    const output = `${result.stdout}\n${result.stderr}`;
    // jira-cli exits non-zero when a query matches nothing.
    if (NO_RESULT.test(output)) return { tickets: [], notFound: [] };
    // One unknown key fails the whole query; the error names it, so it can be dropped and the rest retried.
    const named = [...output.matchAll(NOT_FOUND)].map((match) => match[1]!).filter((key) => keys.includes(key));
    if (named.length) {
      const rest = await this.listChunk(project, keys.filter((key) => !named.includes(key)));
      return { tickets: rest.tickets, notFound: [...named, ...rest.notFound] };
    }
    if (/'400/.test(output)) {
      // A 400 that names no key may be transient, so the key stays unanswered and is retried later instead of becoming "not a ticket".
      if (keys.length === 1) return { tickets: [], notFound: [] };
      const middle = Math.ceil(keys.length / 2);
      const [left, right] = [await this.listChunk(project, keys.slice(0, middle)), await this.listChunk(project, keys.slice(middle))];
      return { tickets: [...left.tickets, ...right.tickets], notFound: [...left.notFound, ...right.notFound] };
    }
    throw this.failure(result);
  }

  private parseList(stdout: string): Ticket[] {
    let body: any;
    try { body = JSON.parse(stdout); } catch { throw new ProviderError('failed', 'jira-cli returned unreadable output'); }
    const issues: any[] = Array.isArray(body) ? body : body?.issues ?? [];
    return issues.map((raw) => this.toTicket(raw));
  }

  private toTicket(raw: any): Ticket {
    const fields = raw.fields ?? {};
    const ticket: Ticket = {
      key: raw.key,
      summary: fields.summary ?? '',
      type: fields.issueType?.name ?? fields.issuetype?.name ?? '',
      status: { name: fields.status?.name ?? '', category: null },
      url: this.ticketUrl(raw.key),
    };
    const assignee = fields.assignee;
    if (assignee?.displayName || assignee?.name) ticket.assignee = { login: assignee.name ?? assignee.displayName, name: assignee.displayName, kind: 'human' };
    return ticket;
  }

  private async exec(args: string[]): Promise<ProcessResult> {
    try {
      return await this.runner(args);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new ProviderError('missing-cli', 'Ticket status needs jira-cli: install it and run `jira init`.');
      if (code === 'ETIMEDOUT') throw new ProviderError('failed', 'jira-cli timed out');
      throw error;
    }
  }

  // jira-cli prints its errors on stdout, so both streams are inspected.
  private failure(result: ProcessResult): ProviderError {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (/needs a Jira API token|'40[13]/i.test(output)) return new ProviderError('auth', `jira-cli is not logged in: ${firstLine(output)}`);
    return new ProviderError('failed', firstLine(output) || `jira-cli exited with code ${result.code}`);
  }
}
