import { createScorer, evalite } from 'evalite';
import {
  isExpectedFalseNegative,
  isExpectedFalsePositive,
  loadEvalCases,
  runTriageEvalTask,
  type TriageEvalExpected,
  type TriageEvalInput,
  type TriageEvalOutput,
} from './triage-data';

const VerdictAccuracy = createScorer<TriageEvalInput, TriageEvalOutput, TriageEvalExpected>({
  name: 'verdict_accuracy',
  description: 'Scores 1 when ai_verdict matches the Ground Truth expected verdict.',
  scorer: ({ output, expected }) => (output.ai_verdict === expected?.expected_verdict ? 1 : 0),
});

const FalsePositiveDetection = createScorer<TriageEvalInput, TriageEvalOutput, TriageEvalExpected>({
  name: 'fp_detection',
  description: 'For false-positive traps, scores 1 when is_false_positive is true.',
  scorer: ({ output, expected }) => {
    if (!expected || !isExpectedFalsePositive(expected.trap_type)) {
      return 1;
    }

    return output.is_false_positive ? 1 : 0;
  },
});

const FalseNegativeDetection = createScorer<TriageEvalInput, TriageEvalOutput, TriageEvalExpected>({
  name: 'fn_detection',
  description: 'For false-negative traps, scores 1 when is_false_negative is true.',
  scorer: ({ output, expected }) => {
    if (!expected || !isExpectedFalseNegative(expected.trap_type)) {
      return 1;
    }

    return output.is_false_negative ? 1 : 0;
  },
});

evalite<TriageEvalInput, TriageEvalOutput, TriageEvalExpected>('AI triage vs Ground Truth', {
  data: async () => loadEvalCases(),
  task: async (input) => runTriageEvalTask(input),
  scorers: [VerdictAccuracy, FalsePositiveDetection, FalseNegativeDetection],
});
