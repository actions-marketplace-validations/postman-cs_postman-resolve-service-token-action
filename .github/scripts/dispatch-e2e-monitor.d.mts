export interface DispatchE2eMonitorResult {
  status: number;
  url: string;
  payload: { ref: string; inputs: Record<string, string> };
  correlationId: string;
}

export function dispatchE2eMonitor(options?: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  log?: (message: string) => void;
}): Promise<DispatchE2eMonitorResult>;
