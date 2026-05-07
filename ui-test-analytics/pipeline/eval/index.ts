import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  appendEvalMetrics,
  calculateEvalMetrics,
  defaultEvalResultsFile,
  defaultEvalUnmatchedFile,
  defaultGroundTruthFile,
  defaultObservedLabelsFile,
  defaultTriageResultsFile,
  loadEvalDataset,
  writeEvalUnmatched,
} from '../../evals/triage-data';

interface CliOptions {
  triageResults?: string;
  groundTruth?: string;
  observedLabels?: string;
  output?: string;
  runId?: string;
  evaliteOutput?: string;
  evalUnmatchedOutput?: string;
  includeProvisionalLabels: boolean;
  skipEvalite: boolean;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const triageResultsFile = options.triageResults ?? defaultTriageResultsFile();
  const groundTruthFile = options.groundTruth ?? defaultGroundTruthFile();
  const observedLabelsFile = options.observedLabels ?? defaultObservedLabelsFile();
  const outputFile = options.output ?? defaultEvalResultsFile();
  const evalUnmatchedOutput = options.evalUnmatchedOutput ?? defaultEvalUnmatchedFile();
  const evaliteOutput =
    options.evaliteOutput ??
    process.env.EVALITE_OUTPUT_JSON ??
    path.join(process.env.RESULTS_DIR ?? 'results', 'evalite-results.json');

  const { cases, unmatched } = await loadEvalDataset({
    triageResultsFile,
    groundTruthFile,
    observedLabelsFile,
    runId: options.runId,
    includeProvisionalLabels: options.includeProvisionalLabels,
  });
  const metrics = calculateEvalMetrics(cases);

  await appendEvalMetrics(outputFile, metrics);
  await writeEvalUnmatched(evalUnmatchedOutput, unmatched);

  let evaliteStatus = 'evalite=skipped';

  if (!options.skipEvalite && cases.length > 0) {
    await mkdir(path.dirname(evaliteOutput), { recursive: true });
    await runEvaliteCli(evaliteOutput, {
      ...process.env,
      TRIAGE_RESULTS_CSV: triageResultsFile,
      GROUND_TRUTH_JSON: groundTruthFile,
      OBSERVED_LABELS_JSON: observedLabelsFile,
      EFFECTIVE_RUN_ID: options.runId ?? process.env.EFFECTIVE_RUN_ID ?? process.env.PIPELINE_RUN_ID ?? '',
      EVAL_INCLUDE_PROVISIONAL_LABELS: options.includeProvisionalLabels ? '1' : '0',
    });
    evaliteStatus = `evalite_output=${path.resolve(evaliteOutput)}`;
  } else if (!options.skipEvalite) {
    evaliteStatus = 'evalite=no_matched_cases';
  }

  console.log(
    [
      `Evaluated ${metrics.totalCases} triage result(s) against Ground Truth.`,
      `accuracy=${formatPercent(metrics.accuracy)}`,
      `fp_detection_rate=${formatPercent(metrics.fpDetectionRate)}`,
      `fn_detection_rate=${formatPercent(metrics.fnDetectionRate)}`,
      `output=${path.resolve(outputFile)}`,
      `unmatched=${unmatched.length}`,
      `unmatched_output=${path.resolve(evalUnmatchedOutput)}`,
      evaliteStatus,
    ].join(' '),
  );
}

function runEvaliteCli(outputPath: string, env: NodeJS.ProcessEnv): Promise<void> {
  const args = ['evalite', 'evals/triage.eval.ts', `--outputPath=${outputPath}`];
  const useShell = process.platform === 'win32';
  const command = useShell
    ? `npx evalite evals/triage.eval.ts --outputPath=${quoteForWindowsShell(outputPath)}`
    : 'npx';

  return new Promise((resolve, reject) => {
    const child = spawn(command, useShell ? [] : args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
      shell: useShell,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Evalite CLI exited with code ${code ?? 1}.`));
    });
  });
}

function quoteForWindowsShell(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    includeProvisionalLabels: process.env.EVAL_INCLUDE_PROVISIONAL_LABELS === '1',
    skipEvalite: process.env.EVALITE_SKIP_RUN === '1',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--triage-results') {
      options.triageResults = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--triage-results=')) {
      options.triageResults = arg.slice('--triage-results='.length);
      continue;
    }

    if (arg === '--ground-truth') {
      options.groundTruth = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--ground-truth=')) {
      options.groundTruth = arg.slice('--ground-truth='.length);
      continue;
    }

    if (arg === '--observed-labels') {
      options.observedLabels = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--observed-labels=')) {
      options.observedLabels = arg.slice('--observed-labels='.length);
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

    if (arg === '--eval-unmatched-output') {
      options.evalUnmatchedOutput = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--eval-unmatched-output=')) {
      options.evalUnmatchedOutput = arg.slice('--eval-unmatched-output='.length);
      continue;
    }

    if (arg === '--evalite-output') {
      options.evaliteOutput = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--evalite-output=')) {
      options.evaliteOutput = arg.slice('--evalite-output='.length);
      continue;
    }

    if (arg === '--skip-evalite') {
      options.skipEvalite = true;
      continue;
    }

    if (arg === '--include-provisional-labels') {
      options.includeProvisionalLabels = true;
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

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`eval failed: ${message}`);
  process.exitCode = 1;
});
