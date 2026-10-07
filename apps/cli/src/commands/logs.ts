/**
 * `astra logs` command — tail a scan's live log.
 *
 * The log file is streamed for its content and ends the tail on its own terminal marker
 * (`Scan COMPLETED/PARTIAL/FAILED/CANCELLED`) or Ctrl-C. Temporal's workflow status is a backstop
 * that also closes the tail when a worker dies without writing a marker — for interactive `logs` a
 * Temporal outage is never fatal (it keeps tailing); only `start --follow` (CI) treats a sustained
 * outage as a failure. Uses chokidar for reliable cross-platform file watching and bounded
 * synchronous reads to prevent duplicate output.
 */

import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as sleep } from 'node:timers/promises';
import { watch } from 'chokidar';
import { fail } from '../errors.js';
import { getWorkspacesDir } from '../home.js';
import { resolveRunFile } from '../paths.js';
import { resolveWorkflowId } from '../session.js';
import { waitForWorkflowClose } from '../temporal-client.js';
import { stdoutIsTerminal } from '../tty.js';
import chalk from 'chalk';

const TERMINAL_HEADINGS = new Set(['Scan COMPLETED', 'Scan PARTIAL', 'Scan FAILED', 'Scan CANCELLED']);

// The combined log resets completion on the bare `RESUMED` heading; a per-agent file carries the
// distinct `--- RESUMED (<workflow id>) ---` boundary that WorkflowLogger.logResumeBoundary writes
// (kept distinct per resume so it stays idempotent per file). Both mean a new execution began, so a
// `--agent` tail must clear a stale terminal marker on either, matching the combined tail.
const AGENT_RESUME_BOUNDARY = /^--- RESUMED \(.+\) ---$/u;

function isResumeBoundary(line: string): boolean {
  return line === 'RESUMED' || AGENT_RESUME_BOUNDARY.test(line);
}

/** Extract and truncate a JSON string field value for display. */
function extractJsonField(line: string, field: string): string | undefined {
  const rx = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'u');
  const m = rx.exec(line);
  return m ? m[1]!.replace(/\"/g, '"').replace(/\\n/g, ' ').slice(0, 160) : undefined;
}

/** Extract a JSON text field (possibly multi-sentence) for display. */
function extractTextField(line: string, field: string): string | undefined {
  return extractJsonField(line, field);
}

function colorizeLogLine(line: string): string | null {
  // --- Structural markers: always show ---
  if (!line.trim() || line.startsWith('=')) return line;
  if (line.includes('[PHASE]')) return chalk.blueBright(line);
  if (line.includes('RESUMED')) return chalk.cyan(line);

  // --- Agent status lines: always show ---
  if (line.includes('[AGENT]')) {
    if (line.includes('Completed (')) return chalk.greenBright(line);
    if (line.includes('Failed (')) return chalk.redBright(line);
    if (line.includes('Starting (')) return chalk.yellow(line);
    return line;
  }

  // --- Error markers: always show ---
  if (line.includes('[ERROR]')) return chalk.redBright(line);
  if (line.includes('failed (') || line.includes('slow (')) return chalk.red(`  !  ${line.trim()}`);

  // --- Key rotation / rate limit notices: hide ---
  if (line.includes('rotated to key') || line.includes('All keys exhausted')) return null;

  // --- pre-recon deliverables ---
  if (line.includes('] set_executive_summary:')) {
    const text = extractTextField(line, 'text');
    if (text) return chalk.greenBright(`  Summary: ${text}`);
    return null;
  }
  if (line.includes('] set_application_intelligence:')) {
    const m = /"framework_and_language"\s*:\s*"((?:[^"\\]|\\.)*)"/u.exec(line);
    if (m) return chalk.dim(`  Stack: ${m[1]!.slice(0, 120)}`);
    return null;
  }

  // --- recon deliverables ---
  if (line.includes('] add_endpoints:')) {
      const endpoints: RegExpMatchArray | null = line.match(/"path"\s*:\s*"([^"]+)"/gu);
    if (endpoints && endpoints.length > 0) {
      const paths = endpoints.map(e => e.replace(/"path"\s*:\s*"/u, '').replace(/"$/u, ''));
      return chalk.cyan(`  Endpoints: ${paths.join(', ')}`);
    }
    return chalk.cyan('  Endpoints: (added)');
  }
  if (line.includes('] set_injection_sources:')) {
    const hasCmdi = line.includes('"command_injection":[{');
    const hasSqli = line.includes('"sql_injection":[{');
    const hasLfi  = line.includes('"lfi_rfi":[{');
    const hasSsti = line.includes('"ssti":[{');
    const parts = [];
    if (hasCmdi) parts.push('CmdI');
    if (hasSqli) parts.push('SQLi');
    if (hasLfi)  parts.push('LFI/RFI');
    if (hasSsti) parts.push('SSTI');
    return chalk.cyan(`  Injection sources: ${parts.length > 0 ? parts.join(', ') : 'none detected'}`);
  }
  if (line.includes('] set_input_vectors:')) {
    const postFields = line.match(/"post_body_fields"\s*:\s*\[(.*?)\]/su)?.[1];
    const urlParams = line.match(/"url_parameters"\s*:\s*\[(.*?)\]/su)?.[1];
    const parts: string[] = [];
    if (postFields && postFields.includes('"')) parts.push(`POST: ${postFields.replace(/"/gu,'').slice(0,80)}`);
    if (urlParams && urlParams.includes('"')) parts.push(`URL: ${urlParams.replace(/"/gu,'').slice(0,60)}`);
    if (parts.length > 0) return chalk.dim(`  Inputs: ${parts.join(' | ')}`);
    return null;
  }

  // --- injection-vuln deliverables ---
  if (line.includes('] submit_exploitation_queue:')) {
    if (line.includes('submitted')) {
      const m = /submitted (\d+) finding/u.exec(line);
      return chalk.greenBright(`  Exploitation queue: ${m ? m[1] + ' vulnerabilities queued' : 'submitted'}`);
    }
    const ids = [...line.matchAll(/"ID"\s*:\s*"([^"]+)"/gu)].map(m => m[1]);
    if (ids.length > 0) return chalk.greenBright(`  Vulnerabilities found: ${ids.join(', ')}`);
    return null;
  }

  // --- injection-exploit deliverables ---
  if (line.includes('] report_finding:') || line.includes('] add_finding:')) {
    const title = extractJsonField(line, 'title') ?? extractJsonField(line, 'vulnerability_type');
    const sev = extractJsonField(line, 'severity') ?? extractJsonField(line, 'risk');
    if (title) return chalk.greenBright(`  Finding: ${title}${sev ? ` [${sev}]` : ''}`);
    return null;
  }
  if (line.includes('] mark_not_exploitable:')) {
    const id = extractJsonField(line, 'id') ?? extractJsonField(line, 'ID');
    return chalk.dim(`  Not exploitable: ${id ?? '(see log)'}`);
  }

  // --- Flag: hide ---
  if (line.includes('] set_flag:') || line.includes('"flag"')) return null;

  // --- todo_write: show current active task ---
  if (line.includes('] todo_write:')) {
    const m = /"activeForm"\s*:\s*"([^"]+)"[^}]*"status"\s*:\s*"in_progress"/u.exec(line);
    if (m) return chalk.dim(`  > ${m[1]}`);
    return null;
  }

  // --- Hide low-level noise ---
  if (
    line.includes('] read: ')   ||
    line.includes('] ls: ')     ||
    line.includes('] bash: ')   ||
    line.includes('] grep: ')   ||
    line.includes('] find: ')   ||
    line.includes('] set_technology_stack:') ||
    line.includes('] set_executive_') ||
    line.includes('] set_') ||
    line.includes('] add_')
  ) {
    return null;
  }

  return line;
}


/** Tracks only complete structural lines while output remains byte-for-byte unchanged. */
export class LogCompletionState {
  private pendingLine = '';
  private terminalIsLastMarker = false;
  private failureIsLastMarker = false;

  ingest(chunk: string): void {
    const lines = `${this.pendingLine}${chunk}`.split('\n');
    this.pendingLine = lines.pop() ?? '';
    for (const line of lines) {
      if (isResumeBoundary(line)) {
        this.terminalIsLastMarker = false;
        this.failureIsLastMarker = false;
      } else if (TERMINAL_HEADINGS.has(line)) {
        this.terminalIsLastMarker = true;
        this.failureIsLastMarker = line === 'Scan FAILED';
      }
    }
  }

  isComplete(): boolean {
    return this.terminalIsLastMarker;
  }

  hasFailureMarker(): boolean {
    return this.failureIsLastMarker;
  }
}

/** Append the forced-stop marker after the worker has exited, unless this execution already ended. */
export function appendCancellationFallback(logFile: string): void {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const state = new LogCompletionState();
  try {
    state.ingest(fs.readFileSync(logFile, 'utf8'));
  } catch {
    // A pre-registration stop may not have created the file yet.
  }
  if (state.isComplete()) return;

  const descriptor = fs.openSync(logFile, 'a', 0o600);
  try {
    fs.writeSync(descriptor, '\nScan CANCELLED\n');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Read a byte range without decoding across an arbitrary live-write boundary. */
function readRange(filePath: string, start: number, end: number): Buffer {
  const length = end - start;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  return buffer;
}

/** Resolve a workspace ID to its workflow.log path, or exit with an error. */
export function resolveLogFile(workspaceId: string): string {
  const workspacesDir = getWorkspacesDir();

  // 1. Direct match
  const directPath = resolveRunFile(path.join(workspacesDir, workspaceId), 'workflow.log');
  if (fs.existsSync(directPath)) return directPath;

  // 2. Resume workflow ID (e.g. workspace_resume_123)
  const resumeBase = workspaceId.replace(/_resume_\d+$/, '');
  if (resumeBase !== workspaceId) {
    const resumePath = resolveRunFile(path.join(workspacesDir, resumeBase), 'workflow.log');
    if (fs.existsSync(resumePath)) return resumePath;
  }

  // 3. Named workspace ID (e.g. workspace_astra-123)
  const namedBase = workspaceId.replace(/_astra-\d+$/, '');
  if (namedBase !== workspaceId) {
    const namedPath = resolveRunFile(path.join(workspacesDir, namedBase), 'workflow.log');
    if (fs.existsSync(namedPath)) return namedPath;
  }

  fail(
    `No scan found named: ${workspaceId}`,
    '',
    'Possible causes:',
    "  - The scan hasn't started yet",
    '  - The workspace name is incorrect',
    '',
    'Check the dashboard at http://localhost:8233 for scan details',
  );
}

export interface TailOptions {
  /** Workflow whose Temporal status can end the tail (alongside the file's own terminal marker). */
  readonly workflowId?: string;
  /** Called if the tail ends because Temporal became unreachable, with the captured error. */
  readonly onUnreachable?: (lastError: string) => void;
  /**
   * Consecutive Temporal-outage polls before the watch gives up. Interactive `logs` passes
   * Infinity so a blip never ends the tail (the file marker or Ctrl-C do); `start --follow` (CI)
   * leaves it bounded so a genuinely dead Temporal fails the run instead of hanging.
   */
  readonly maxConnectFailures?: number;
}

/** Outcome of a tail: whether the streamed log already contained the worker's `Scan FAILED` block. */
export interface TailResult {
  readonly sawFailure: boolean;
}

/**
 * Stream a scan's log to the terminal until the file shows a terminal marker, the workflow closes,
 * or Ctrl-C. A Temporal outage is warned about; if it reaches `maxConnectFailures` the tail ends
 * with a diagnostic (bounded for `start --follow`), but interactive `logs` sets that to Infinity so
 * an outage keeps tailing. Never exits the process itself. Reports whether the log already showed
 * the failure, so a caller need not print it a second time.
 */
export function tailUntilComplete(logFile: string, opts: TailOptions = {}): Promise<TailResult> {
  return new Promise((resolve) => {
    let position = 0;
    const completion = new LogCompletionState();
    const completionDecoder = new StringDecoder('utf8');
    let done = false;
    const controller = new AbortController();
    let watcher: ReturnType<typeof watch> | undefined;

    /** Output any new content appended since the last read. */
    function flush(): boolean {
      try {
        const { size } = fs.statSync(logFile);
        if (size <= position) return completion.isComplete();
        const data = readRange(logFile, position, size);
        
        // Convert to string and process line by line to add color
        const textChunk = data.toString('utf8');
        const formattedChunk = textChunk.split('\n').map((line) => {
          // don't colorize empty lines or dividers
          if (!line.trim() || line.startsWith('=')) return line;
          return colorizeLogLine(line);
        }).filter(line => line !== null).join('\n');
        
        process.stdout.write(formattedChunk);
        
        position = size;
        completion.ingest(completionDecoder.write(data));
        return completion.isComplete();
      } catch {
        // File not present yet or transiently unreadable — nothing to flush this round.
        return false;
      }
    }

    function finish(): void {
      if (done) return;
      done = true;
      controller.abort();
      process.off('SIGINT', finish);
      const result = { sawFailure: completion.hasFailureMarker() };
      if (watcher) {
        watcher.close().finally(() => resolve(result));
        // Safety net — resolve anyway if watcher.close() stalls.
        setTimeout(() => resolve(result), 1000).unref();
      } else {
        resolve(result);
      }
    }

    // 1. Output existing content, then stream anything appended. A per-agent file can be created
    //    after the watcher starts, so `add` is handled too and streams it from its first line.
    //    The file's own `Scan COMPLETED/PARTIAL/FAILED/CANCELLED` marker ends the tail on its own —
    //    a Temporal round-trip is a backstop for a worker that dies without writing one, not the
    //    only way to stop.
    watcher = watch(logFile, { persistent: true });
    const onFsEvent = (): void => {
      if (flush()) finish();
    };
    watcher.on('change', onFsEvent);
    watcher.on('add', onFsEvent);
    if (flush()) {
      finish();
      return;
    }

    // 2. Ctrl-C stops watching.
    process.once('SIGINT', finish);

    // 3. Temporal backstops completion for a worker that dies without a marker. Without a workflow
    //    id, the tail relies on the file marker or Ctrl-C alone.
    if (opts.workflowId) {
      waitForWorkflowClose(opts.workflowId, {
        signal: controller.signal,
        ...(opts.maxConnectFailures !== undefined ? { maxConnectFailures: opts.maxConnectFailures } : {}),
        onConnectionTrouble: (lastError) => {
          if (!done) console.error(`\n⚠ Lost contact with Temporal, retrying… (${lastError})`);
        },
        onReconnected: () => {
          if (!done) console.error('  Reconnected to Temporal.');
        },
      })
        .then(async (end) => {
          if (done) return;
          // Flush, let a just-written final summary land, then flush the tail once more.
          flush();
          await sleep(750).catch(() => {});
          flush();
          if (end.reason === 'unreachable') {
            console.error('\nScan watch aborted: lost contact with Temporal.');
            console.error(`  Last error: ${end.lastError}`);
            console.error('  Temporal may have crashed — check `docker compose logs temporal`.');
            opts.onUnreachable?.(end.lastError);
          }
          finish();
        })
        .catch(() => {
          // waitForWorkflowClose never rejects; guard only against an aborted race.
        });
    }
  });
}

/** The `.astra/agents/` directory that sits beside a scan's combined workflow.log. */
function agentsDirFor(logFile: string): string {
  return path.join(path.dirname(logFile), 'agents');
}

/** List the per-agent log names available for a scan (filename stems, sorted), or an empty list. */
export function listAgentLogNames(logFile: string): string[] {
  try {
    return fs
      .readdirSync(agentsDirFor(logFile))
      .filter((entry) => entry.endsWith('.log'))
      .map((entry) => entry.slice(0, -'.log'.length))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Resolve an agent name to its per-agent log path. The name must be a closed-charset basename, and
 * the resolved file must stay inside the agents directory: traversal and symlink escapes are
 * rejected. Returns undefined when the name is structurally invalid or escapes the directory.
 */
export function resolveAgentLogFile(logFile: string, agentName: string): string | undefined {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(agentName)) return undefined;
  const agentsDir = agentsDirFor(logFile);
  const target = path.join(agentsDir, `${agentName}.log`);
  try {
    const realDir = fs.realpathSync(agentsDir);
    const realTarget = fs.realpathSync(target);
    if (realTarget !== path.join(realDir, `${agentName}.log`)) return undefined;
  } catch {
    // The file does not exist yet (scan still starting); the closed-charset check already proved
    // the path cannot traverse out of the agents directory, so it is safe to watch for creation.
  }
  return target;
}

export interface LogsOptions {
  readonly agent?: string;
  readonly listAgents?: boolean;
}

function tailFileToExit(logFile: string, workflowId: string | undefined, label: string): void {
  console.error(stdoutIsTerminal() ? `${label}: ${logFile}` : label);
  tailUntilComplete(logFile, {
    ...(workflowId ? { workflowId } : {}),
    // Interactive tail: a Temporal outage must never end the session. The file's terminal marker or
    // Ctrl-C stop it; Temporal stays a soft backstop that reconnects and closes the tail on a
    // silent worker death, but its unreachability is never fatal here.
    maxConnectFailures: Number.POSITIVE_INFINITY,
  }).finally(() => process.exit(0));
}

export function logs(workspaceId: string, options: LogsOptions = {}): void {
  const logFile = resolveLogFile(workspaceId);

  if (options.listAgents) {
    const names = listAgentLogNames(logFile);
    if (names.length === 0) {
      console.error('No per-agent logs for this scan yet.');
      process.exit(0);
    }
    for (const name of names) console.log(name);
    process.exit(0);
  }

  const workflowId = resolveWorkflowId(workspaceId);

  if (options.agent !== undefined) {
    const agentFile = resolveAgentLogFile(logFile, options.agent);
    if (agentFile === undefined) {
      fail(`No agent log named: ${options.agent}`, '', 'Available agents:', ...withBullets(listAgentLogNames(logFile)));
    }
    const known = listAgentLogNames(logFile);
    // If the directory already lists agents, a name not among them is a typo, not a not-yet-created
    // file; fail loudly rather than tailing a path that will never appear.
    if (known.length > 0 && !known.includes(options.agent)) {
      fail(`No agent log named: ${options.agent}`, '', 'Available agents:', ...withBullets(known));
    }
    tailFileToExit(agentFile, workflowId, `Tailing ${options.agent} log`);
    return;
  }

  tailFileToExit(logFile, workflowId, 'Tailing scan log');
}

function withBullets(names: readonly string[]): string[] {
  return names.length === 0 ? ['  (none yet)'] : names.map((name) => `  - ${name}`);
}
