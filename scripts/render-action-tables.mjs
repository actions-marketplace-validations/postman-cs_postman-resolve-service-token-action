#!/usr/bin/env node
// Renders the Inputs and Outputs tables in README.md from action.yml.
// Usage:
//   node scripts/render-action-tables.mjs           # print tables to stdout
//   node scripts/render-action-tables.mjs --write   # rewrite README between markers
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSection(lines, sectionName) {
  const entries = [];
  let inSection = false;
  let current = null;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inSection = line === `${sectionName}:`;
      current = null;
      continue;
    }
    if (!inSection) continue;
    const keyMatch = line.match(/^ {2}([A-Za-z0-9-]+):\s*$/);
    if (keyMatch) {
      current = { name: keyMatch[1], description: '', required: undefined, default: undefined };
      entries.push(current);
      continue;
    }
    const fieldMatch = line.match(/^ {4}([A-Za-z-]+):\s*(.*)$/);
    if (fieldMatch && current) {
      const [, field, raw] = fieldMatch;
      if (field === 'description') current.description = unquote(raw);
      if (field === 'required') current.required = unquote(raw) === 'true';
      if (field === 'default') current.default = unquote(raw);
    }
  }
  return entries;
}

function cell(value) {
  return String(value).replace(/\|/g, '\\|');
}

function renderInputs(inputs) {
  const rows = inputs.map((input) => {
    const required = input.required ? 'yes' : 'no';
    const def = input.default ? `\`${cell(input.default)}\`` : '';
    return `| \`${input.name}\` | ${cell(input.description)} | ${required} | ${def} |`;
  });
  return ['| Name | Description | Required | Default |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

function renderOutputs(outputs) {
  const rows = outputs.map((output) => `| \`${output.name}\` | ${cell(output.description)} |`);
  return ['| Name | Description |', '| --- | --- |', ...rows].join('\n');
}

export function renderTables() {
  const lines = readFileSync(join(root, 'action.yml'), 'utf8').split('\n');
  return {
    inputs: renderInputs(parseSection(lines, 'inputs')),
    outputs: renderOutputs(parseSection(lines, 'outputs')),
  };
}

export function applyTables(readme, tables) {
  return readme
    .replace(
      /<!-- inputs-table:start -->[\s\S]*?<!-- inputs-table:end -->/,
      `<!-- inputs-table:start -->\n${tables.inputs}\n<!-- inputs-table:end -->`,
    )
    .replace(
      /<!-- outputs-table:start -->[\s\S]*?<!-- outputs-table:end -->/,
      `<!-- outputs-table:start -->\n${tables.outputs}\n<!-- outputs-table:end -->`,
    );
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const tables = renderTables();
  if (process.argv.includes('--write')) {
    const readmePath = join(root, 'README.md');
    writeFileSync(readmePath, applyTables(readFileSync(readmePath, 'utf8'), tables));
    console.log('README.md tables updated from action.yml');
  } else {
    console.log(`${tables.inputs}\n\n${tables.outputs}`);
  }
}
