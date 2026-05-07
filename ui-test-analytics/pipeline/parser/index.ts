import { XMLParser } from 'fast-xml-parser';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { appendCsvRows } from '../lib/csv';

type TestStatus = 'passed' | 'failed' | 'error' | 'skipped';

type ErrorType =
  | ''
  | 'locator error'
  | 'assertion error'
  | 'server error'
  | 'timeout error'
  | 'unknown error';

type XmlNode = Record<string, unknown>;

interface CliOptions {
  inputs: string[];
  output?: string;
  runId?: string;
  runDate?: string;
}

interface ParsedTestCase {
  run_id: string;
  run_date: string;
  test_suite: string;
  test_case: string;
  status: TestStatus;
  error_type: ErrorType;
  error_message: string;
  duration_ms: number;
}

const CSV_HEADER = [
  'run_id',
  'run_date',
  'test_suite',
  'test_case',
  'status',
  'error_type',
  'error_message',
  'duration_ms',
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: false,
  parseAttributeValue: false,
  parseTagValue: false,
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputFiles = options.inputs.length > 0 ? options.inputs : defaultInputFiles();
  const outputFile =
    options.output ??
    process.env.TEST_RESULTS_CSV ??
    path.join(process.env.RESULTS_DIR ?? 'results', 'test-results.csv');
  const runId = options.runId ?? defaultRunId();
  const runDate = options.runDate ?? new Date().toISOString();

  if (inputFiles.length === 0) {
    throw new Error('No JUnit XML input file was specified.');
  }

  const parsedCases: ParsedTestCase[] = [];
  let parsedInputFileCount = 0;

  for (const inputFile of inputFiles) {
    const absoluteInput = path.resolve(inputFile);
    const xml = await readJUnitXmlIfExists(absoluteInput);

    if (xml === null) {
      console.warn(`JUnit XML not found. Skipping ${absoluteInput}.`);
      continue;
    }

    parsedInputFileCount += 1;
    const parsedXml = xmlParser.parse(xml) as XmlNode;
    parsedCases.push(...parseJUnitXml(parsedXml, absoluteInput, runId, runDate));
  }

  await appendCsvRows(
    outputFile,
    CSV_HEADER,
    parsedCases.map((testCase) => [
      testCase.run_id,
      testCase.run_date,
      testCase.test_suite,
      testCase.test_case,
      testCase.status,
      testCase.error_type,
      testCase.error_message,
      String(testCase.duration_ms),
    ]),
  );

  const failedCount = parsedCases.filter((testCase) => testCase.status === 'failed').length;
  const errorCount = parsedCases.filter((testCase) => testCase.status === 'error').length;
  const skippedCount = parsedCases.filter((testCase) => testCase.status === 'skipped').length;

  console.log(
    [
      `Parsed ${parsedCases.length} test case(s) from ${parsedInputFileCount}/${inputFiles.length} JUnit XML file(s).`,
      `failed=${failedCount}`,
      `error=${errorCount}`,
      `skipped=${skippedCount}`,
      `output=${path.resolve(outputFile)}`,
    ].join(' '),
  );
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { inputs: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--input' || arg === '-i') {
      options.inputs.push(requireValue(args, ++index, arg));
      continue;
    }

    if (arg.startsWith('--input=')) {
      options.inputs.push(arg.slice('--input='.length));
      continue;
    }

    if (arg === '--output' || arg === '-o') {
      options.output = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      continue;
    }

    if (arg === '--run-id') {
      options.runId = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--run-id=')) {
      options.runId = arg.slice('--run-id='.length);
      continue;
    }

    if (arg === '--run-date') {
      options.runDate = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--run-date=')) {
      options.runDate = arg.slice('--run-date='.length);
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.inputs.push(arg);
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

function defaultInputFiles(): string[] {
  const configured = process.env.TEST_RESULT_XMLS ?? process.env.TEST_RESULT_XML;
  if (configured) {
    return splitFileList(configured);
  }

  if (process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME) {
    return splitFileList(process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME);
  }

  const resultsDir = process.env.RESULTS_DIR ?? 'results';
  return [
    path.join(resultsDir, 'test-result-whitebox.xml'),
    path.join(resultsDir, 'test-result-blackbox.xml'),
    path.join(resultsDir, 'test-result-ground-truth.xml'),
  ];
}

function splitFileList(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((file) => file.trim())
    .filter(Boolean);
}

async function readJUnitXmlIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function defaultRunId(): string {
  const configured =
    process.env.EFFECTIVE_RUN_ID ??
    process.env.PIPELINE_RUN_ID ??
    process.env.BUILD_TAG ??
    process.env.BUILD_NUMBER;

  if (configured && configured.trim()) {
    return configured.trim();
  }

  return `local-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function parseJUnitXml(
  parsedXml: XmlNode,
  sourceFile: string,
  runId: string,
  runDate: string,
): ParsedTestCase[] {
  const suites = collectTestSuites(parsedXml);
  const parsedCases: ParsedTestCase[] = [];

  for (const suite of suites) {
    const suiteName = getAttribute(suite, 'name');
    const testCases = asArray(suite.testcase);

    for (const testCase of testCases) {
      if (!isObject(testCase)) {
        continue;
      }

      const status = getStatus(testCase);
      const errorMessage = getCaseMessage(testCase, status);
      const errorType = status === 'failed' || status === 'error' ? classifyError(errorMessage) : '';
      const durationMs = secondsToMilliseconds(getAttribute(testCase, 'time'));

      parsedCases.push({
        run_id: runId,
        run_date: runDate,
        test_suite: suiteName || getAttribute(testCase, 'classname') || path.basename(sourceFile),
        test_case: getAttribute(testCase, 'name') || '(unnamed test case)',
        status,
        error_type: errorType,
        error_message: errorMessage,
        duration_ms: durationMs,
      });
    }
  }

  return parsedCases;
}

function collectTestSuites(parsedXml: XmlNode): XmlNode[] {
  const suites: XmlNode[] = [];
  const rootSuites = asArray(parsedXml.testsuites);
  const rootSingleSuites = asArray(parsedXml.testsuite);

  for (const root of [...rootSuites, ...rootSingleSuites]) {
    if (isObject(root)) {
      collectTestSuitesFromNode(root, suites);
    }
  }

  return suites;
}

function collectTestSuitesFromNode(node: XmlNode, suites: XmlNode[]) {
  if (node.testcase !== undefined) {
    suites.push(node);
  }

  for (const child of asArray(node.testsuite)) {
    if (isObject(child)) {
      collectTestSuitesFromNode(child, suites);
    }
  }
}

function getStatus(testCase: XmlNode): TestStatus {
  if (asArray(testCase.error).length > 0) {
    return 'error';
  }

  if (asArray(testCase.failure).length > 0) {
    return 'failed';
  }

  if (asArray(testCase.skipped).length > 0) {
    return 'skipped';
  }

  return 'passed';
}

function getCaseMessage(testCase: XmlNode, status: TestStatus): string {
  if (status === 'error') {
    return compactMessage(extractMessages(asArray(testCase.error)));
  }

  if (status === 'failed') {
    return compactMessage(extractMessages(asArray(testCase.failure)));
  }

  if (status === 'skipped') {
    return compactMessage(extractMessages(asArray(testCase.skipped)));
  }

  return '';
}

function extractMessages(nodes: unknown[]): string {
  const parts: string[] = [];

  for (const node of nodes) {
    if (isObject(node)) {
      const type = getAttribute(node, 'type');
      const message = getAttribute(node, 'message');
      const text = extractText(node);
      parts.push(...[type, message, text].filter(Boolean));
    } else if (node !== undefined && node !== null) {
      parts.push(String(node));
    }
  }

  return parts.join(' ');
}

function extractText(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join(' ');
  }

  if (!isObject(value)) {
    return '';
  }

  return Object.entries(value)
    .filter(([key]) => !key.startsWith('@_'))
    .map(([, entryValue]) => extractText(entryValue))
    .filter(Boolean)
    .join(' ');
}

function compactMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function classifyError(errorMessage: string): ErrorType {
  const message = errorMessage.toLowerCase();

  if (/(^|[^0-9])5(?:00|03)([^0-9]|$)|econnrefused|internal server error|service unavailable|too many requests|(^|[^0-9])429([^0-9]|$)/i.test(message)) {
    return 'server error';
  }

  if (
    message.includes('element not found') ||
    message.includes('element(s) not found') ||
    message.includes('selector') ||
    message.includes('strict mode violation')
  ) {
    return 'locator error';
  }

  if (
    message.includes('expect') ||
    message.includes('assert') ||
    message.includes('tobe') ||
    message.includes('tohave') ||
    message.includes('expected')
  ) {
    return 'assertion error';
  }

  if (message.includes('timeout') || message.includes('timed out') || message.includes('exceeded')) {
    return 'timeout error';
  }

  if (message.includes('locator')) {
    return 'locator error';
  }

  return 'unknown error';
}

function secondsToMilliseconds(value: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return 0;
  }

  return Math.round(seconds * 1000);
}

function getAttribute(node: XmlNode, name: string): string {
  const value = node[`@_${name}`];
  return value === undefined || value === null ? '' : String(value);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function isObject(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`parser failed: ${message}`);
  process.exitCode = 1;
});
