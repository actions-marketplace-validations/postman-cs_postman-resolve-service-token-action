import * as core from '@actions/core';

import { readInputsFromAction, runResolveServiceToken } from './index.js';

runResolveServiceToken(readInputsFromAction(core), {
  core,
  fetcher: fetch
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(message);
});
