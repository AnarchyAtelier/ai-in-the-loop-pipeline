import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface CliOptions {
  summary: string;
  output: string;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summaryPath = path.resolve(options.summary);
  const outputPath = path.resolve(options.output);
  const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as unknown;
  const content = [
    'window.__UI_TEST_ANALYTICS_SUMMARY__ = ',
    JSON.stringify(summary, null, 2),
    ';\n',
  ].join('');

  await writeFile(outputPath, content, 'utf8');
  console.log(`Wrote dashboard data to ${outputPath}.`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    summary: path.join('build-artifacts', 'summary.json'),
    output: path.join('dashboard', 'summary-data.js'),
  };
  const positionalArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--summary') {
      options.summary = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--summary=')) {
      options.summary = arg.slice('--summary='.length);
      continue;
    }

    if (arg === '--output') {
      options.output = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionalArgs.push(arg);
  }

  if (positionalArgs[0]) {
    options.summary = positionalArgs[0];
  }

  if (positionalArgs[1]) {
    options.output = positionalArgs[1];
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`dashboard data generation failed: ${message}`);
  process.exitCode = 1;
});
