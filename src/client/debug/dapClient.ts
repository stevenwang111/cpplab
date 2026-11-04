import type { DapMessage } from '../../shared/types';
import { wsUrl } from '../api';
import { t } from '../i18n';

export type DebugState = 'idle' | 'starting' | 'running' | 'paused' | 'terminated';

export interface DapStackFrame {
  id: number;
  name: string;
  line: number;
  column: number;
  source?: { name?: string; path?: string };
  instructionPointerReference?: string;
}

export interface DapScope {
  name: string;
  variablesReference: number;
  expensive?: boolean;
  presentationHint?: string;
}

export interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  evaluateName?: string;
  memoryReference?: string;
}

export interface DapBreakpoint {
  id?: number;
  verified: boolean;
  line?: number;
  column?: number;
  source?: { name?: string; path?: string };
  message?: string;
}

export interface DapCapabilities {
  supportsRestartRequest?: boolean;
  supportsConfigurationDoneRequest?: boolean;
  supportsEvaluateForHovers?: boolean;
  [key: string]: unknown;
}

export interface DapHandlers {
  onState: (state: DebugState) => void;
  onStopped: (body: { threadId: number; reason: string; description?: string; allThreadsStopped?: boolean }) => void;
  onContinued: (body: { threadId: number; allThreadsContinued?: boolean }) => void;
  onOutput: (body: { category?: string; output: string }) => void;
  onTerminated: (message?: string) => void;
  onExited: (exitCode: number) => void;
  onLog: (message: string) => void;
  onBreakpoint: (breakpoint: DapBreakpoint) => void;
  onBreakpoints?: (file: string, breakpoints: DapBreakpoint[]) => void;
  onCapabilities: (capabilities: DapCapabilities) => void;
  onError: (message: string) => void;
}

interface PendingRequest {
  resolve: (message: Extract<DapMessage, { type: 'response' }>) => void;
  reject: (error: Error) => void;
  timer: number;
}

export class DapClient {
  private socket?: WebSocket;
  private sequence = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private state: DebugState = 'idle';
  private adapterCapabilities: DapCapabilities = {};
  private breakpoints: Record<string, number[]> = {};
  private launchSent = false;
  private initializedEventSeen = false;
  private configurationDoneSent = false;
  private terminatedNotified = false;
  private readonly handlers: DapHandlers;
  private readonly program: string;
  private readonly cwd: string;

  constructor(
    private readonly sessionId: string,
    options: { program: string; cwd: string; breakpoints: Record<string, number[]>; handlers: DapHandlers },
  ) {
    this.program = options.program;
    this.cwd = options.cwd;
    this.breakpoints = options.breakpoints;
    this.handlers = options.handlers;
  }

  get currentState(): DebugState {
    return this.state;
  }

  connect(): void {
    if (this.socket) return;
    const socket = new WebSocket(wsUrl(`/ws/debug/${this.sessionId}`));
    this.socket = socket;
    socket.onopen = () => {
      this.setState('starting');
      this.initialize().catch((error) => this.fail(error));
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let message: DapMessage | { type: 'ide-log'; level: string; message: string } | { type: 'ide-event'; event: string; body: unknown };
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'ide-log') {
        this.handlers.onLog(message.message);
        return;
      }
      if (message.type === 'ide-event') {
        return;
      }
      this.handleMessage(message);
    };
    socket.onerror = () => {
      this.handlers.onError(t('debug.error.ws'));
    };
    socket.onclose = (event) => {
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(t('debug.error.connectionClosed')));
      }
      this.pending.clear();
      if (!this.terminatedNotified) {
        this.terminatedNotified = true;
        this.setState('terminated');
        const reason = event.reason || t('debug.error.connectionClosed');
        this.handlers.onTerminated(reason);
      }
    };
  }

  private async initialize(): Promise<void> {
    const response = await this.sendRequest('initialize', {
      adapterID: 'lldb-dap',
      clientID: 'cpplab',
      clientName: 'CppLab',
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsVariableType: true,
      supportsVariablePaging: false,
    });
    this.adapterCapabilities = (response.body as DapCapabilities | undefined) ?? {};
    this.handlers.onCapabilities(this.adapterCapabilities);
    await this.syncAllBreakpoints();
    this.launchSent = true;
    const launchResponse = await this.sendRequest('launch', {
      program: this.program,
      cwd: this.cwd,
      stopOnEntry: false,
      sourceMap: [],
      console: 'internalConsole',
      disableASLR: false,
      initCommands: [],
    });
    if (!launchResponse.success) {
      throw new Error(launchResponse.message ?? t('debug.error.launchRejected'));
    }
    this.maybeSendConfigurationDone();
  }

  private maybeSendConfigurationDone(): void {
    if (!this.launchSent || !this.initializedEventSeen || this.configurationDoneSent) return;
    this.configurationDoneSent = true;
    this.sendRequest('configurationDone', {})
      .then(() => { if (this.state === 'starting') this.setState('running'); })
      .catch((error) => this.fail(error));
  }

  private handleMessage(message: DapMessage): void {
    if (message.type === 'response') {
      const pending = this.pending.get(message.request_seq);
      if (pending) {
        this.pending.delete(message.request_seq);
        clearTimeout(pending.timer);
        if (message.success) pending.resolve(message);
        else pending.reject(new Error(message.message ?? t('debug.error.requestFailed', { command: message.command })));
      }
      return;
    }
    if (message.type !== 'event') return;
    switch (message.event) {
      case 'initialized':
        this.initializedEventSeen = true;
        this.maybeSendConfigurationDone();
        break;
      case 'stopped': {
        const body = message.body as { threadId: number; reason: string; description?: string; allThreadsStopped?: boolean };
        this.setState('paused');
        this.handlers.onStopped(body);
        break;
      }
      case 'continued': {
        const body = message.body as { threadId: number; allThreadsContinued?: boolean };
        this.setState('running');
        this.handlers.onContinued(body);
        break;
      }
      case 'output': {
        const body = message.body as { category?: string; output: string };
        this.handlers.onOutput(body);
        break;
      }
      case 'terminated':
        this.notifyTerminated(t('debug.terminated.program'));
        break;
      case 'exited':
        this.handlers.onExited(Number((message.body as { exitCode?: number } | undefined)?.exitCode ?? 0));
        break;
      case 'breakpoint':
        this.handlers.onBreakpoint((message.body as { breakpoint: DapBreakpoint }).breakpoint);
        break;
      case 'capabilities':
        this.handlers.onCapabilities(
          ((message.body as { capabilities?: DapCapabilities } | undefined)?.capabilities ?? {}) as DapCapabilities,
        );
        break;
      case 'process':
      case 'thread':
      case 'module':
      case 'loadedSource':
        break;
      default:
        break;
    }
  }

  private notifyTerminated(message: string): void {
    if (this.terminatedNotified) return;
    this.terminatedNotified = true;
    this.setState('terminated');
    this.handlers.onTerminated(message);
  }

  private setState(state: DebugState): void {
    if (this.state === state) return;
    this.state = state;
    this.handlers.onState(state);
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.handlers.onError(message);
    if (this.state === 'starting') {
      this.setState('terminated');
      this.handlers.onTerminated(message);
      this.close();
    }
  }

  sendRequest(command: string, args?: Record<string, unknown>, timeoutMs = 20_000): Promise<Extract<DapMessage, { type: 'response' }>> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error(t('debug.error.notConnected')));
        return;
      }
      this.sequence += 1;
      const seq = this.sequence;
      const timer = window.setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(t('debug.error.timeout', { command })));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ seq, type: 'request', command, arguments: args }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(seq);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async setBreakpoints(file: string, lines: number[]): Promise<DapBreakpoint[]> {
    this.breakpoints[file] = [...lines];
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return [];
    const response = await this.sendRequest('setBreakpoints', {
      source: { path: `/workspace/${file}`, name: file.split('/').pop() ?? file },
      breakpoints: lines.map((line) => ({ line })),
      sourceModified: false,
    });
    return ((response.body as { breakpoints?: DapBreakpoint[] } | undefined)?.breakpoints ?? []) as DapBreakpoint[];
  }

  async syncAllBreakpoints(): Promise<void> {
    const files = Object.keys(this.breakpoints);
    for (const file of files) {
      const lines = this.breakpoints[file] ?? [];
      try {
        const result = await this.setBreakpoints(file, lines);
        this.handlers.onBreakpoints?.(file, result);
        for (const breakpoint of result) this.handlers.onBreakpoint(breakpoint);
      } catch (error) {
        this.handlers.onLog(error instanceof Error ? error.message : String(error));
      }
    }
  }

  updateBreakpoints(breakpoints: Record<string, number[]>): void {
    this.breakpoints = breakpoints;
  }

  async stackTrace(threadId: number, levels = 50): Promise<DapStackFrame[]> {
    this.assertPaused();
    const response = await this.sendRequest('stackTrace', { threadId, startFrame: 0, levels });
    return ((response.body as { stackFrames?: DapStackFrame[] } | undefined)?.stackFrames ?? []) as DapStackFrame[];
  }

  async scopes(frameId: number): Promise<DapScope[]> {
    this.assertPaused();
    const response = await this.sendRequest('scopes', { frameId });
    return ((response.body as { scopes?: DapScope[] } | undefined)?.scopes ?? []) as DapScope[];
  }

  async variables(reference: number): Promise<DapVariable[]> {
    this.assertPaused();
    const response = await this.sendRequest('variables', { variablesReference: reference });
    return ((response.body as { variables?: DapVariable[] } | undefined)?.variables ?? []) as DapVariable[];
  }

  async evaluate(expression: string, frameId: number | undefined, context: 'watch' | 'repl' | 'hover' | 'variables'): Promise<{ result: string; type?: string; variablesReference: number }> {
    this.assertPaused();
    const response = await this.sendRequest('evaluate', { expression, frameId, context });
    const body = (response.body ?? {}) as { result?: string; type?: string; variablesReference?: number };
    return { result: body.result ?? '', type: body.type, variablesReference: body.variablesReference ?? 0 };
  }

  async continue(threadId: number): Promise<void> {
    await this.sendRequest('continue', { threadId, singleThread: false });
  }

  async pause(threadId: number): Promise<void> {
    await this.sendRequest('pause', { threadId });
  }

  async next(threadId: number): Promise<void> {
    await this.sendRequest('next', { threadId, singleThread: true });
  }

  async stepIn(threadId: number): Promise<void> {
    await this.sendRequest('stepIn', { threadId, singleThread: true });
  }

  async stepOut(threadId: number): Promise<void> {
    await this.sendRequest('stepOut', { threadId, singleThread: true });
  }

  async restart(): Promise<void> {
    await this.sendRequest('restart', {});
  }

  async disconnect(): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.close();
      return;
    }
    try {
      await this.sendRequest('disconnect', { terminateDebuggee: true }, 5000);
    } catch {
      // The adapter may terminate the connection before responding.
    }
    this.close();
  }

  close(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close(1000, 'client closed');
    }
    this.socket = undefined;
  }

  private assertPaused(): void {
    if (this.state !== 'paused') throw new Error('program is not stopped');
  }
}
