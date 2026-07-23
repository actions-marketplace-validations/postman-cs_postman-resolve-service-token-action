export function dispatchLiveMonitor(options?: {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  abortSignal?: AbortSignal;
}): Promise<void>;
