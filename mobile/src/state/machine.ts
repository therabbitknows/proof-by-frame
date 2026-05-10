/**
 * Submission state machine helpers.
 * Mirrors the backend workflow so the app and bot remain aligned.
 *
 * Pure logic module: no runtime side effects, no storage, no
 * navigation, no auth. Only dependency is the `SubmissionState`
 * union from `../types/submission`.
 */

import {SubmissionState} from '../types/submission';

const STATE_ORDER: SubmissionState[] = [
  'created',
  'description_added',
  'front_added',
  'back_added',
  'notes_added',
  'baselines_added',
  'pregrade_generated',
  'community_voting',
  'sealed',
  'proof_pending',
  'proof_result_received',
];

const STATE_LABELS: Record<SubmissionState, string> = {
  created: 'Start',
  description_added: 'Description',
  front_added: 'Front Image',
  back_added: 'Back Image',
  notes_added: 'Physical Notes',
  baselines_added: 'Baselines',
  pregrade_generated: 'AI Pregrade',
  community_voting: 'Community Vote',
  sealed: 'Sealed',
  proof_pending: 'Proof Pending',
  proof_result_received: 'Proof Result',
};

// States the user actively fills in during the wizard
export const WIZARD_STATES: SubmissionState[] = [
  'created',
  'description_added',
  'front_added',
  'back_added',
  'notes_added',
  'baselines_added',
];

export function getStepIndex(state: SubmissionState): number {
  return STATE_ORDER.indexOf(state);
}

export function getNextStep(
  state: SubmissionState,
): SubmissionState | null {
  const idx = getStepIndex(state);
  if (idx === -1 || idx >= STATE_ORDER.length - 1) {
    return null;
  }
  return STATE_ORDER[idx + 1];
}

export function canAdvanceTo(
  currentState: SubmissionState,
  nextState: SubmissionState,
): boolean {
  const currentIdx = getStepIndex(currentState);
  const nextIdx = getStepIndex(nextState);
  // Can only advance one step at a time, or skip baselines
  if (nextIdx === currentIdx + 1) {
    return true;
  }
  // Allow skipping baselines (from notes_added directly to pregrade_generated)
  if (
    currentState === 'notes_added' &&
    nextState === 'pregrade_generated'
  ) {
    return true;
  }
  return false;
}

export function getStepLabel(state: SubmissionState): string {
  return STATE_LABELS[state] ?? state;
}

export function isWizardStep(state: SubmissionState): boolean {
  return WIZARD_STATES.includes(state);
}

export function getWizardStepNumber(state: SubmissionState): number {
  // Returns 1-based step number for wizard display
  const idx = WIZARD_STATES.indexOf(state);
  return idx === -1 ? 0 : idx + 1;
}
