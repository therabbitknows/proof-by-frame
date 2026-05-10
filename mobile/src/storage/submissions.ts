/**
 * Local persistence for PROOF submissions.
 * Uses AsyncStorage with JSON serialization.
 *
 * Identity model:
 *   Mobile identity = Phantom wallet pubkey.
 *   Storage buckets are keyed per wallet:
 *     PROOF_SUBMISSIONS:<walletPubkey>   — authenticated user
 *     PROOF_SUBMISSIONS:guest            — pre-auth / anonymous
 *
 *   Every exported async function takes an optional `walletPubkey`
 *   parameter. Callers pass the connected wallet's base58 pubkey;
 *   omitting it defaults to the `guest` scope.
 *
 * State-machine import: editability and migration logic use
 *   `getStepIndex` from `../state/machine` (canonical source).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {Submission, SubmissionState} from '../types/submission';
import {getStepIndex} from '../state/machine';

const STORAGE_KEY = 'PROOF_SUBMISSIONS';

function getStorageKey(walletPubkey?: string): string {
  return `${STORAGE_KEY}:${walletPubkey ?? 'guest'}`;
}

const COMMUNITY_VOTING_INDEX = getStepIndex('community_voting');

export function isSubmissionEditable(submission: Submission): boolean {
  const currentIdx = getStepIndex(submission.currentState);
  if (currentIdx === -1) {
    return submission.status === 'draft';
  }
  return currentIdx < COMMUNITY_VOTING_INDEX;
}

/**
 * "Deletable" is broader than "editable" — the backend's delete
 * endpoint refuses only sealed / proof_pending / proof_received
 * (immutable states; the on-chain seal commits the row), so the
 * mobile gating should match. Previously this aliased
 * isSubmissionEditable, which was too tight: community_voting and
 * review_complete rows couldn't be deleted from the Vault list at
 * all even though the backend would accept the call. Symptom user
 * reported 2026-04-28: a Michael Jordan submission stuck in the
 * Vault list with no DELETE affordance.
 *
 * Editable still means "can the user change identity fields" — that
 * locks at community_voting (voters need a stable identity to vote
 * on). Deletable means "can the user remove the entire submission"
 * — that locks at sealed (on-chain commitment is irreversible).
 */
const SERVER_IMMUTABLE_STATES = new Set<string>([
  'sealed',
  'proof_pending',
  'proof_received',
]);

export function isSubmissionDeletable(submission: Submission): boolean {
  return !SERVER_IMMUTABLE_STATES.has(submission.currentState);
}

/**
 * Migrate / self-heal a submission's status field on read.
 *
 * Rule: status is DERIVED from currentState. The state machine is the
 * source of truth — at any point past `pregrade_generated`, the row is
 * "submitted"; before, it's "draft". A persisted `s.status` that
 * disagrees with the state-derived value is treated as stale and
 * overwritten (this happens when an earlier write encoded the wrong
 * status — e.g., a buggy backend-rehydrate that mapped from the
 * server's legacy `status` column instead of from `state`).
 *
 * Both directions self-heal:
 *   - draft → submitted: state has advanced past pregrade_generated
 *     (sealed, community_voting, proof_*) but the cached status says
 *     draft. Upgrade.
 *   - submitted → draft: status says submitted but state is still
 *     editable (created..baselines_added). Demote — the prior value
 *     was an over-eager finalize, never reached the immutable stage.
 */
function migrateSubmission(s: Submission): Submission {
  const pregradedIdx = getStepIndex('pregrade_generated');
  const currentIdx = getStepIndex(s.currentState);
  const stateDerived: 'draft' | 'submitted' =
    currentIdx >= pregradedIdx ? 'submitted' : 'draft';

  // Trust state over a possibly-stale persisted status. The previous
  // implementation used `s.status ?? <derived>`, which let a wrong
  // cached value win — e.g., rehydrated rows where the server-side
  // legacy `status` column ("created"/"approved") was mistakenly
  // used as the draft/submitted source.
  let status: 'draft' | 'submitted' = stateDerived;

  // Edge: if state somehow says submitted-tier but the row still
  // looks editable, fall back to draft (paranoid — shouldn't happen
  // with the state-derived source, but keeps prior behavior).
  if (status === 'submitted' && isSubmissionEditable({...s, status})) {
    status = 'draft';
  }

  return {...s, status};
}

async function readAll(walletPubkey?: string): Promise<Submission[]> {
  try {
    const raw = await AsyncStorage.getItem(getStorageKey(walletPubkey));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Submission[];
    return parsed.map(migrateSubmission);
  } catch {
    return [];
  }
}

/**
 * Read EVERY submission the device has ever stored, regardless of which
 * walletPubkey bucket it lives in. Dedupe by submission id (newest createdAt
 * wins on collision). Used by Vault's list view so a user whose active wallet
 * has churned (Phantom auto-disconnect, Demo Mode re-provision, MWA session
 * expired) doesn't see "no submissions" when their drafts still exist under
 * a stale pubkey bucket.
 *
 * Write path is unchanged — new submissions land in the current active
 * pubkey's bucket. Only the read/list path is broadened.
 */
export async function readAllBuckets(): Promise<Submission[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const submissionKeys = keys.filter(k => k.startsWith(`${STORAGE_KEY}:`));
    if (submissionKeys.length === 0) return [];
    const entries = await AsyncStorage.multiGet(submissionKeys);
    const merged = new Map<string, Submission>();
    for (const [, raw] of entries) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Submission[];
        for (const sub of parsed.map(migrateSubmission)) {
          const existing = merged.get(sub.id);
          if (!existing || existing.createdAt < sub.createdAt) {
            merged.set(sub.id, sub);
          }
        }
      } catch {
        // skip malformed bucket
      }
    }
    return Array.from(merged.values());
  } catch {
    return [];
  }
}

async function writeAll(
  submissions: Submission[],
  walletPubkey?: string,
): Promise<void> {
  await AsyncStorage.setItem(
    getStorageKey(walletPubkey),
    JSON.stringify(submissions),
  );
}

export async function saveSubmission(
  submission: Submission,
  walletPubkey?: string,
): Promise<void> {
  // Ensure new submissions always start as draft
  const toSave: Submission = submission.status
    ? submission
    : {...submission, status: 'draft'};
  const all = await readAll(walletPubkey);
  const existing = all.findIndex(s => s.id === toSave.id);
  if (existing >= 0) {
    all[existing] = toSave;
  } else {
    all.unshift(toSave); // newest first
  }
  await writeAll(all, walletPubkey);
}

export async function getSubmission(
  id: string,
  walletPubkey?: string,
): Promise<Submission | null> {
  const all = await readAll(walletPubkey);
  return all.find(s => s.id === id) ?? null;
}

export async function getAllSubmissions(
  walletPubkey?: string,
): Promise<Submission[]> {
  return readAll(walletPubkey);
}

export async function updateSubmission(
  submission: Submission,
  walletPubkey?: string,
): Promise<void> {
  // updateSubmission must NEVER set status to 'submitted' — only updates draft content
  const safeSub: Submission = {...submission, status: 'draft'};
  return saveSubmission(safeSub, walletPubkey);
}

/**
 * Finalize a submission — the ONLY function that sets status to 'submitted'.
 * Sets status: 'submitted' and submittedAt timestamp.
 */
export async function finalizeSubmission(
  id: string,
  walletPubkey?: string,
): Promise<void> {
  const all = await readAll(walletPubkey);
  const idx = all.findIndex(s => s.id === id);
  if (idx < 0) {
    return;
  }
  all[idx] = {
    ...all[idx],
    status: 'submitted',
    submittedAt: new Date().toISOString(),
  };
  await writeAll(all, walletPubkey);
}

/**
 * Filter submissions by status field.
 * Used by history screen for sectioning.
 */
export async function getSubmissionsByStatus(
  status: 'draft' | 'submitted',
  walletPubkey?: string,
): Promise<Submission[]> {
  const all = await readAll(walletPubkey);
  return all.filter(s => s.status === status);
}

/**
 * Delete a submission entirely from AsyncStorage.
 * Only deletes if status is 'draft' — refuses to delete submitted items.
 */
export async function deleteSubmission(
  id: string,
  walletPubkey?: string,
): Promise<void> {
  const all = await readAll(walletPubkey);
  const target = all.find(s => s.id === id);
  if (!target || !isSubmissionDeletable(target)) {
    return; // Refuse to delete locked submissions
  }
  const filtered = all.filter(s => s.id !== id);
  await writeAll(filtered, walletPubkey);
}

/**
 * Re-seed AsyncStorage from the backend list-by-wallet endpoint.
 *
 * The local index is canonical for the UI (VaultScreen reads it via
 * `readAllBuckets`), but it's only populated as the user creates
 * submissions on the device. If the install is fresh (or AsyncStorage
 * was wiped — e.g., uninstall/reinstall), the device has no record of
 * server-side submissions even though they're still owned by this
 * wallet. This function fetches the backend's list and writes each
 * row into the wallet's bucket.
 *
 * Local rows that are NOT in the backend list are preserved (drafts
 * never sent up). Backend rows that overlap by id are merged: the
 * backend wins on `currentState`, `cardName` (when non-empty), and
 * `submittedAt`; locally-only fields (image URIs, baselines, captures,
 * notes) survive. This is conservative — we never destroy local-only
 * data even on a hard rehydrate.
 */
export async function rehydrateFromBackend(
  walletPubkey: string,
  serverSubmissions: ReadonlyArray<{
    id: string;
    state: string;
    status?: string | null;
    card_name?: string;
    card_type?: string;
    description?: string;
    created_at?: string | null;
    submitted_at?: string | null;
  }>,
): Promise<{added: number; merged: number; total: number}> {
  const local = await readAll(walletPubkey);
  const localById = new Map<string, Submission>(local.map(s => [s.id, s]));
  let added = 0;
  let merged = 0;

  // Derive draft/submitted from the state-machine position — the
  // backend's `row.status` column is a legacy, separately-meaning'd
  // field (values like "created"/"approved"), NOT the mobile's
  // draft/submitted concept. Using row.status here was the bug that
  // marked all rehydrated rows as draft.
  const pregradedIdx = getStepIndex('pregrade_generated');

  for (const row of serverSubmissions) {
    const existing = localById.get(row.id);
    const createdAtMs = row.created_at
      ? new Date(row.created_at).getTime()
      : Date.now();
    if (!existing) {
      // Server-only row — synthesize a minimal Submission. Image URIs
      // are empty (we don't have them locally); ResultScreen + status
      // fetch will fill remaining fields. The currentState comes from
      // the server so the row classifies correctly (draft vs sealed).
      const stateIdx = getStepIndex(row.state as SubmissionState);
      const derivedStatus: 'draft' | 'submitted' =
        stateIdx >= pregradedIdx ? 'submitted' : 'draft';
      const synthesized: Submission = {
        id: row.id,
        description: row.description || '',
        cardName: row.card_name || undefined,
        cardType: row.card_type || 'Card',
        frontImageUri: '',
        backImageUri: '',
        notes: {corners: '', edges: '', surface: '', centering: '', other: ''},
        baselines: [],
        currentState: row.state as SubmissionState,
        status: derivedStatus,
        createdAt: createdAtMs,
        submittedAt: row.submitted_at || undefined,
      };
      localById.set(row.id, synthesized);
      added += 1;
    } else {
      // Merge: server wins on state + cardName (when present) +
      // submittedAt; everything else local wins (image URIs, notes,
      // baselines, captures).
      const next: Submission = {
        ...existing,
        currentState:
          (row.state as SubmissionState | undefined) ?? existing.currentState,
        cardName:
          row.card_name && row.card_name.trim()
            ? row.card_name
            : existing.cardName,
        submittedAt: row.submitted_at || existing.submittedAt,
      };
      if (
        next.currentState !== existing.currentState ||
        next.cardName !== existing.cardName ||
        next.submittedAt !== existing.submittedAt
      ) {
        localById.set(row.id, next);
        merged += 1;
      }
    }
  }

  const all = Array.from(localById.values()).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  await writeAll(all, walletPubkey);
  return {added, merged, total: all.length};
}
