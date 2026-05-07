import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface CliOptions {
  artifactsDir: string;
  fromRun?: string;
  toRun?: string;
}

const CSV_FILES = [
  'test-results.csv',
  'diff-results.csv',
  'false-negative-candidates.csv',
  'triage-results.csv',
  'eval-results.csv',
];

const JSON_FILES = [
  'action-summary.json',
  'dashboard-summary.json',
  'eval-unmatched.json',
  'evalite-results.json',
];

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.fromRun || !options.toRun) {
    throw new Error('--from-run and --to-run are required.');
  }

  const artifactsDir = path.resolve(options.artifactsDir);

  for (const fileName of CSV_FILES) {
    await normalizeCsvFile(path.join(artifactsDir, fileName), options.fromRun, options.toRun);
  }

  for (const fileName of JSON_FILES) {
    await normalizeJsonFile(path.join(artifactsDir, fileName), options.fromRun, options.toRun);
  }

  console.log(`Normalized ${artifactsDir}: ${options.fromRun} -> ${options.toRun}`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    artifactsDir: path.join('build-artifacts', '1st'),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--artifacts-dir') {
      options.artifactsDir = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--artifacts-dir=')) {
      options.artifactsDir = arg.slice('--artifacts-dir='.length);
      continue;
    }

    if (arg === '--from-run') {
      options.fromRun = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--from-run=')) {
      options.fromRun = arg.slice('--from-run='.length);
      continue;
    }

    if (arg === '--to-run') {
      options.toRun = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--to-run=')) {
      options.toRun = arg.slice('--to-run='.length);
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireValue(args: string[], index: number, optionName: string): string {
  const value = args[index];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${optionName}.`);
  }

  return value;
}

async function normalizeCsvFile(filePath: string, fromRun: string, toRun: string) {
  if (!(await fileExists(filePath))) {
    return;
  }

  const rows = parseCsv(await readFile(filePath, 'utf8'));

  if (rows.length === 0) {
    return;
  }

  const [header, ...dataRows] = rows;
  const runIdIndex = header.indexOf('run_id');

  if (runIdIndex === -1) {
    return;
  }

  const normalizedRows = dataRows
    .filter((row) => row.some((value) => value.trim() !== ''))
    .filter((row) => row[runIdIndex] === fromRun)
    .map((row) => row.map((value, index) => replaceRunId(index === runIdIndex ? toRun : value, fromRun, toRun)));

  await writeFile(filePath, `${[header, ...normalizedRows].map(toCsvLine).join('\n')}\n`, 'utf8');
}

async function normalizeJsonFile(filePath: string, fromRun: string, toRun: string) {
  if (!(await fileExists(filePath))) {
    return;
  }

  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  await writeFile(filePath, `${JSON.stringify(replaceJsonRunId(parsed, fromRun, toRun), null, 2)}\n`, 'utf8');
}

function replaceJsonRunId(value: unknown, fromRun: string, toRun: string): unknown {
  if (typeof value === 'string') {
    return replaceRunId(value, fromRun, toRun);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => replaceJsonRunId(entry, fromRun, toRun));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, replaceJsonRunId(entryValue, fromRun, toRun)]),
    );
  }

  return value;
}

function replaceRunId(value: string, fromRun: string, toRun: string): string {
  return value.split(fromRun).join(toRun);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        value += '"';
        index += 1;
        continue;
      }

      if (char === '"') {
        inQuotes = false;
        continue;
      }

      value += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(value);
      value = '';
      continue;
    }

    if (char === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      continue;
    }

    if (char === '\r') {
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function toCsvLine(values: readonly string[]): string {
  return values.map(escapeCsvValue).join(',');
}

function escapeCsvValue(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`artifact normalization failed: ${message}`);
  process.exitCode = 1;
});
