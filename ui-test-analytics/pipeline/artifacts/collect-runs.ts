import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface CliOptions {
  sourceRoot: string;
  outputRoot: string;
  limit: number;
  startIndex: number;
  include?: RegExp;
  exclude?: RegExp;
  cleanOutput: boolean;
}

interface SourceRun {
  name: string;
  runDir: string;
  resultsDir: string;
  modifiedTime: number;
  sourceRunId: string;
  detectedRunId?: string;
}

interface RunMapEntry {
  artifact_dir: string;
  source_run_id: string;
  source_dir: string;
  normalized_run_id: string;
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
  const sourceRoot = path.resolve(options.sourceRoot);
  const outputRoot = path.resolve(options.outputRoot);

  if (options.cleanOutput) {
    await cleanOutputRoot(outputRoot);
  }

  await mkdir(outputRoot, { recursive: true });

  const sourceRuns = await listSourceRuns(sourceRoot, options);
  const selectedRuns = options.limit > 0 ? sourceRuns.slice(-options.limit) : sourceRuns;
  const runMap: RunMapEntry[] = [];

  for (const [offset, sourceRun] of selectedRuns.entries()) {
    const normalizedIndex = options.startIndex + offset;
    const artifactDir = ordinal(normalizedIndex);
    const normalizedRunId = `pipeline-${normalizedIndex}`;
    const targetDir = path.join(outputRoot, artifactDir);

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    await cp(sourceRun.resultsDir, targetDir, { recursive: true });
    await normalizeRunArtifacts(targetDir, sourceRun.sourceRunId, sourceRun.detectedRunId, normalizedRunId);

    runMap.push({
      artifact_dir: artifactDir,
      source_run_id: sourceRun.sourceRunId,
      source_dir: sourceRun.runDir,
      normalized_run_id: normalizedRunId,
    });
  }

  await writeFile(path.join(outputRoot, 'run-map.json'), `${JSON.stringify(runMap, null, 2)}\n`, 'utf8');
  console.log(`Collected ${runMap.length} run(s) from ${sourceRoot} into ${outputRoot}.`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceRoot: path.join('results', 'runs'),
    outputRoot: 'build-artifacts',
    limit: 20,
    startIndex: 1,
    cleanOutput: false,
  };
  const positionalArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--source-root') {
      options.sourceRoot = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--source-root=')) {
      options.sourceRoot = arg.slice('--source-root='.length);
      continue;
    }

    if (arg === '--output-root') {
      options.outputRoot = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--output-root=')) {
      options.outputRoot = arg.slice('--output-root='.length);
      continue;
    }

    if (arg === '--limit') {
      options.limit = parseInteger(requireValue(args, ++index, arg), arg);
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parseInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }

    if (arg === '--start-index') {
      options.startIndex = parseInteger(requireValue(args, ++index, arg), arg);
      continue;
    }

    if (arg.startsWith('--start-index=')) {
      options.startIndex = parseInteger(arg.slice('--start-index='.length), '--start-index');
      continue;
    }

    if (arg === '--include') {
      options.include = new RegExp(requireValue(args, ++index, arg));
      continue;
    }

    if (arg.startsWith('--include=')) {
      options.include = new RegExp(arg.slice('--include='.length));
      continue;
    }

    if (arg === '--exclude') {
      options.exclude = new RegExp(requireValue(args, ++index, arg));
      continue;
    }

    if (arg.startsWith('--exclude=')) {
      options.exclude = new RegExp(arg.slice('--exclude='.length));
      continue;
    }

    if (arg === '--clean-output') {
      options.cleanOutput = true;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionalArgs.push(arg);
  }

  if (positionalArgs[0]) {
    options.sourceRoot = positionalArgs[0];
  }

  if (positionalArgs[1]) {
    options.outputRoot = positionalArgs[1];
  }

  if (positionalArgs[2]) {
    options.limit = parseInteger(positionalArgs[2], 'limit');
  }

  if (positionalArgs[3]) {
    options.startIndex = parseInteger(positionalArgs[3], 'startIndex');
  }

  if (options.startIndex < 1) {
    throw new Error('--start-index must be 1 or greater.');
  }

  if (options.limit < 0) {
    throw new Error('--limit must be 0 or greater. Use 0 for all runs.');
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

function parseInteger(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid integer for ${optionName}: ${value}`);
  }

  return parsed;
}

async function listSourceRuns(sourceRoot: string, options: CliOptions): Promise<SourceRun[]> {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const sourceRuns: SourceRun[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (options.include && !options.include.test(entry.name)) {
      continue;
    }

    if (options.exclude?.test(entry.name)) {
      continue;
    }

    const runDir = path.join(sourceRoot, entry.name);
    const resultsDir = path.join(runDir, 'results');

    if (!(await directoryExists(resultsDir))) {
      continue;
    }

    if (!(await isCompleteRun(resultsDir, entry.name))) {
      continue;
    }

    const detectedRunId = await inferRunId(resultsDir);
    const metadata = await stat(resultsDir);
    sourceRuns.push({
      name: entry.name,
      runDir,
      resultsDir,
      modifiedTime: metadata.mtimeMs,
      sourceRunId: entry.name,
      detectedRunId,
    });
  }

  return sourceRuns.sort(compareSourceRuns);
}

async function isCompleteRun(resultsDir: string, sourceRunId: string): Promise<boolean> {
  const requiredFiles = [
    'test-results.csv',
    'diff-results.csv',
    'triage-results.csv',
    'eval-results.csv',
    'false-negative-candidates.csv',
  ];

  for (const fileName of requiredFiles) {
    if (!(await fileExists(path.join(resultsDir, fileName)))) {
      return false;
    }
  }

  for (const fileName of ['test-results.csv', 'eval-results.csv']) {
    if (!(await csvHasRowsForRun(path.join(resultsDir, fileName), sourceRunId))) {
      return false;
    }
  }

  return true;
}

async function csvHasRowsForRun(filePath: string, runId: string): Promise<boolean> {
  const rows = parseCsv(await readFile(filePath, 'utf8'));
  const [header, ...dataRows] = rows;
  const runIdIndex = header?.indexOf('run_id') ?? -1;
  const nonEmptyRows = dataRows.filter((row) => row.some((value) => value.trim() !== ''));

  if (runIdIndex === -1) {
    return nonEmptyRows.length > 0;
  }

  return nonEmptyRows.some((row) => row[runIdIndex] === runId);
}

function compareSourceRuns(left: SourceRun, right: SourceRun): number {
  const leftNumber = trailingNumber(left.sourceRunId) ?? trailingNumber(left.name);
  const rightNumber = trailingNumber(right.sourceRunId) ?? trailingNumber(right.name);

  if (leftNumber !== undefined && rightNumber !== undefined && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  if (left.modifiedTime !== right.modifiedTime) {
    return left.modifiedTime - right.modifiedTime;
  }

  return left.name.localeCompare(right.name);
}

function trailingNumber(value: string): number | undefined {
  const match = value.match(/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

async function inferRunId(resultsDir: string): Promise<string | undefined> {
  for (const fileName of CSV_FILES) {
    const runId = await inferCsvRunId(path.join(resultsDir, fileName));

    if (runId) {
      return runId;
    }
  }

  for (const fileName of JSON_FILES) {
    const runId = await inferJsonRunId(path.join(resultsDir, fileName));

    if (runId) {
      return runId;
    }
  }

  return undefined;
}

async function inferCsvRunId(filePath: string): Promise<string | undefined> {
  if (!(await fileExists(filePath))) {
    return undefined;
  }

  const rows = parseCsv(await readFile(filePath, 'utf8'));
  const [header, ...dataRows] = rows;
  const runIdIndex = header?.indexOf('run_id') ?? -1;

  if (runIdIndex === -1) {
    return undefined;
  }

  return dataRows
    .slice()
    .reverse()
    .find((row) => row[runIdIndex])?.[runIdIndex];
}

async function inferJsonRunId(filePath: string): Promise<string | undefined> {
  if (!(await fileExists(filePath))) {
    return undefined;
  }

  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  return findRunId(parsed);
}

function findRunId(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const runId = findRunId(item);

      if (runId) {
        return runId;
      }
    }

    return undefined;
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;

    if (typeof record.run_id === 'string') {
      return record.run_id;
    }

    if (typeof record.runId === 'string') {
      return record.runId;
    }

    for (const item of Object.values(record)) {
      const runId = findRunId(item);

      if (runId) {
        return runId;
      }
    }
  }

  return undefined;
}

async function normalizeRunArtifacts(
  targetDir: string,
  sourceRunId: string,
  detectedRunId: string | undefined,
  normalizedRunId: string,
) {
  for (const fileName of CSV_FILES) {
    await normalizeCsvFile(path.join(targetDir, fileName), sourceRunId, detectedRunId, normalizedRunId);
  }

  await normalizeJsonFiles(targetDir, [sourceRunId, detectedRunId], normalizedRunId);
}

async function normalizeCsvFile(
  filePath: string,
  sourceRunId: string,
  detectedRunId: string | undefined,
  normalizedRunId: string,
) {
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

  const nonEmptyRows = dataRows.filter((row) => row.some((value) => value.trim() !== ''));
  const preferredRunId = nonEmptyRows.some((row) => row[runIdIndex] === sourceRunId)
    ? sourceRunId
    : detectedRunId;

  if (!preferredRunId) {
    return;
  }

  const normalizedRows = nonEmptyRows
    .filter((row) => row[runIdIndex] === preferredRunId)
    .map((row) => row.map((value, index) => replaceRunIds(
      index === runIdIndex ? normalizedRunId : value,
      [preferredRunId, sourceRunId, detectedRunId],
      normalizedRunId,
    )));

  await writeFile(filePath, `${[header, ...normalizedRows].map(toCsvLine).join('\n')}\n`, 'utf8');
}

async function normalizeJsonFiles(targetDir: string, sourceRunIds: Array<string | undefined>, normalizedRunId: string) {
  const uniqueSourceRunIds = Array.from(new Set(sourceRunIds.filter((value): value is string => Boolean(value))));

  for (const fileName of JSON_FILES) {
    const filePath = path.join(targetDir, fileName);

    if (!(await fileExists(filePath))) {
      continue;
    }

    let content = await readFile(filePath, 'utf8');

    for (const sourceRunId of uniqueSourceRunIds) {
      content = content.split(sourceRunId).join(normalizedRunId);
    }

    await writeFile(filePath, content, 'utf8');
  }
}

function replaceRunIds(value: string, sourceRunIds: Array<string | undefined>, normalizedRunId: string): string {
  let replaced = value;
  const uniqueSourceRunIds = Array.from(new Set(sourceRunIds.filter((item): item is string => Boolean(item))));

  for (const sourceRunId of uniqueSourceRunIds) {
    replaced = replaced.split(sourceRunId).join(normalizedRunId);
  }

  return replaced;
}

async function cleanOutputRoot(outputRoot: string) {
  await mkdir(outputRoot, { recursive: true });
  const entries = await readdir(outputRoot, { withFileTypes: true });

  for (const entry of entries) {
    const targetPath = path.join(outputRoot, entry.name);

    if (entry.isDirectory() && /^\d+(st|nd|rd|th)$/.test(entry.name)) {
      await rm(targetPath, { recursive: true, force: true });
      continue;
    }

    if (entry.isFile() && (entry.name === 'summary.json' || entry.name === 'run-map.json')) {
      await rm(targetPath, { force: true });
    }
  }
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function ordinal(value: number): string {
  const lastTwoDigits = value % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
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
  console.error(`artifact collection failed: ${message}`);
  process.exitCode = 1;
});
