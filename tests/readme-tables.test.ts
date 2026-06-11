import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error plain .mjs module without type declarations
import { applyTables, renderTables } from '../scripts/render-action-tables.mjs';

describe('README action tables', () => {
  it('match the inputs and outputs declared in action.yml', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    expect(readme).toContain('<!-- inputs-table:start -->');
    expect(readme).toContain('<!-- outputs-table:start -->');
    const regenerated = applyTables(readme, renderTables());
    expect(readme).toBe(regenerated);
  });
});
