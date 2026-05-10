import React, {useEffect, useMemo, useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
  Dimensions,
  Image,
  Share,
  TextInput,
} from 'react-native';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import type {RootStackParamList} from '../navigation/RootNavigator';
import {T} from '../constants/tokens';
import {useSession} from '../hooks/useSession';
import {useDiscordAuth} from '../hooks/useDiscordAuth';
import {ApiService} from '../services/api';
import {WalletService} from '../services/wallet';
import CONFIG from '../constants/config';
import {deleteSubmission as deleteSubmissionLocal} from '../storage/submissions';
import {
  AssessmentPage,
  type OcrIdentity,
  type AiInitialRead,
  type AiInitialReadGrade,
  type SubmissionNotes,
} from './AssessmentPage';
// SlabFrame moved to App.tsx (wraps the entire app); ResultScreen no
// longer needs its own wrapper. PAGE_WIDTH constant below still
// compensates for the 20px horizontal inset the global slab introduces.

type Nav = any;

const {width: SCREEN_WIDTH} = Dimensions.get('window');

// SlabFrame insets the content by 8px (outer pad) + 2px (gold rim) per
// side = 20px total horizontal. Pages snap inside the slab — use this
// for both layout widths and the scroll-offset → page-index calculation
// so pagingEnabled fires at the right boundaries.
const SLAB_INSET_HORIZONTAL = 20;
const PAGE_WIDTH = SCREEN_WIDTH - SLAB_INSET_HORIZONTAL;

const STATE_LABELS: Record<string, string> = {
  created: 'Created',
  front_analyzed: 'Front Analyzed',
  back_analyzed: 'Back Analyzed',
  notes_submitted: 'Notes Submitted',
  community_voting: 'Community Voting',
  review_complete: 'Review Complete',
  sealed: 'Sealed',
  proof_pending: 'Proof Pending',
  proof_received: 'Proof Received',
};

const STATE_ORDER = [
  'created',
  'front_analyzed',
  'back_analyzed',
  'notes_submitted',
  'community_voting',
  'review_complete',
  'sealed',
  'proof_pending',
  'proof_received',
];

const IMMUTABLE_STATES = new Set(['sealed', 'proof_pending', 'proof_received']);

export const ResultScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'Result'>>();
  const {submissionId} = route.params;
  const {walletPubkey} = useSession();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [deleting, setDeleting] = useState(false);
  // One-shot guard so the duplicate-card prompt fires at most once per
  // ResultScreen visit (status polls every 15s; without this we'd
  // re-Alert continuously until the user acknowledges).
  const [duplicatePromptShown, setDuplicatePromptShown] = useState(false);
  // In-flight guard for the OPEN COMMUNITY VOTING retry button (lands
  // when the identity-completeness gate refused the first submitForVoting
  // attempt; user edits identity then taps to retry).
  const [openingVoting, setOpeningVoting] = useState(false);
  // Polling management for async AI fields (centering, OCR identity)
  const [pollCount, setPollCount] = useState(0);
  const MAX_POLLS = 10; // 30s total @ 3s interval
  // Analysis timing telemetry — visible to user via the spinner
  // ("Analyzing card… 3s") and a final ("Analyzed in 5.2s") line so
  // the user knows whether the assessment is still working or stuck.
  // mountedAt = when ResultScreen first rendered (= upload completed).
  // analysisCompletedAt = first tick where centering_lr was non-null.
  const [mountedAt] = useState<number>(() => Date.now());
  const [analysisCompletedAt, setAnalysisCompletedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const fetchStatus = useCallback(async () => {
    try {
      const res = await ApiService.getSubmission(submissionId, walletPubkey ?? undefined);
      const data = res.data;
      setStatus(data);
      setError(null);

      // Redirect to SealedResult if state is immutable
      if (IMMUTABLE_STATES.has(data?.state)) {
        navigation.replace('SealedResult', {submissionId});
        return;
      }

      // Check if we should keep polling for async AI fields.
      // We stop if centering_lr lands OR we hit the max poll cap.
      // Card identity identity status 'researching' also keeps us polling.
      const hasCentering = data?.ocr_result?.front?.centering_lr != null;
      const isResearching = data?.card_identity_status === 'researching';
      const sealed = IMMUTABLE_STATES.has(data?.state);

      if (!sealed && (!hasCentering || isResearching) && pollCount < MAX_POLLS) {
        setPollCount(prev => prev + 1);
      } else {
        setPollCount(MAX_POLLS); // Stop polling
      }
    } catch (err: any) {
      // Self-heal stale local rows: if the backend says this
      // submission no longer exists (deleted server-side, or never
      // synced), purge the local AsyncStorage entry so the Vault
      // list stops showing a row that errors on tap. Only acts on
      // 404 — other errors (transient network) leave the row alone.
      const status404 =
        err?.response?.status === 404 ||
        /not found/i.test(err?.response?.data?.detail || '');
      if (status404) {
        try {
          await deleteSubmissionLocal(submissionId, walletPubkey ?? undefined);
        } catch {
          // best-effort
        }
        navigation.navigate('Vault' as never);
        return;
      }
      setError(err?.response?.data?.detail || err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [submissionId, walletPubkey, navigation]);

  useEffect(() => {
    fetchStatus();
    // Default background poll every 15s to keep UI fresh
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Fast poll for async AI fields on mount / until settled
  useEffect(() => {
    if (pollCount > 0 && pollCount < MAX_POLLS) {
      const timer = setTimeout(fetchStatus, 3000);
      return () => clearTimeout(timer);
    }
  }, [pollCount, fetchStatus]);

  // 1Hz tick to update the elapsed-time display while analysis is in
  // flight. Only ticks when analysis is pending — stops once
  // analysisCompletedAt is set, so it doesn't burn cycles forever.
  useEffect(() => {
    if (analysisCompletedAt != null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [analysisCompletedAt]);

  // Stamp completion the first time centering_lr lands. After that,
  // the spinner stops and "Analyzed in Xs" replaces it.
  useEffect(() => {
    if (analysisCompletedAt != null) return;
    if (status?.ocr_result?.front?.centering_lr != null) {
      setAnalysisCompletedAt(Date.now());
    }
  }, [status, analysisCompletedAt]);

  // Duplicate-card detection: backend's /status returns a `duplicates`
  // array when this submission shares an OCR identity tuple with prior
  // non-deleted submissions from the same wallet. Each scan still gets
  // a unique submission id (the user is right that legit-multi-copy
  // submitters need to be supported), but we surface the prior
  // submissions so the user can confirm "yes, another copy I own" vs
  // "I scanned the wrong card by mistake".
  useEffect(() => {
    if (duplicatePromptShown) return;
    if (status?.duplicate_acknowledged) return;
    const dups = status?.duplicates;
    if (!Array.isArray(dups) || dups.length === 0) return;
    if (!walletPubkey) return;

    setDuplicatePromptShown(true);
    const cardLabel = status.card_name || 'this card';
    const priors = dups
      .map((d: any) => {
        // Fall back to a generic label when both submissions have empty
        // card_name (OCR failed to populate identity on either side).
        // Without this the bullet would render "•  (date)" with a
        // visibly empty leading slot.
        const rawName = (d.card_name || '').trim() || (cardLabel === 'this card' ? '' : cardLabel);
        const name = rawName || 'Card with the same identity';
        const when = d.submitted_at
          ? new Date(d.submitted_at).toLocaleDateString()
          : 'previously';
        return `• ${name} (${when})`;
      })
      .join('\n');

    Alert.alert(
      'Possible duplicate detected',
      `You've already submitted ${dups.length === 1 ? 'a card' : 'cards'} ` +
        `with this identity:\n\n${priors}\n\n` +
        'If you legitimately own multiple copies, this is OK — each ' +
        'submission gets its own PROOF record. If you scanned the wrong ' +
        'card by mistake, you can delete this one (no credit refund).',
      [
        {
          text: 'I scanned wrong card',
          style: 'destructive',
          onPress: handleDelete,
        },
        {
          text: 'Yes — another copy I own',
          onPress: async () => {
            try {
              await ApiService.acknowledgeDuplicate(submissionId, walletPubkey);
              // Re-poll so status reflects the ack and stops returning duplicates
              await fetchStatus();
            } catch {
              // Best-effort; the prompt won't reappear this session due
              // to duplicatePromptShown, and on next ResultScreen mount
              // it'll just reappear once and the user can ack again.
            }
          },
        },
      ],
      {cancelable: false},
    );
  // handleDelete is defined later in the component; we rely on closure
  // capture rather than including it in deps to avoid the alert
  // re-firing every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, walletPubkey, duplicatePromptShown]);

  const handleDelete = () => {
    Alert.alert(
      'Delete submission?',
      'This cannot be undone. The submission and all associated data ' +
      'will be removed, and any active community voting thread will be ' +
      'closed.\n\n' +
      'Note: deleting does NOT refund the submission credit you used.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!walletPubkey) return;
            setDeleting(true);
            try {
              const resp = await ApiService.deleteSubmission(submissionId, walletPubkey);
              // After backend confirms delete, also purge the local
              // AsyncStorage entry — without this the Vault list still
              // shows a stale row that 404s on tap (next /status poll).
              try {
                await deleteSubmissionLocal(submissionId, walletPubkey);
              } catch {
                // best-effort; the 404-self-heal path catches anything
                // that slips through.
              }
              const discordNote = resp?.data?.discord_archived
                ? 'Discord voting thread archived.'
                : resp?.data?.discord_error
                  ? '(Discord thread cleanup deferred — admin can /archive-thread.)'
                  : '';
              Alert.alert(
                'Deleted',
                `Submission has been removed.${discordNote ? '\n\n' + discordNote : ''}`,
              );
              navigation.navigate('Home');
            } catch (err: any) {
              const detail = err?.response?.data?.detail || err?.message || 'Delete failed';
              Alert.alert('Error', detail);
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  const handleScroll = (e: any) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / PAGE_WIDTH);
    setCurrentPage(page);
  };

  const isVoting = status?.state === 'community_voting';
  const isSealed = IMMUTABLE_STATES.has(status?.state);
  const canDelete = status && !isSealed;
  const frontOcr = status?.ocr_result?.front;
  const threadUrl = status?.discord?.thread_url;
  const certificate = status?.certificate;
  const notes = status?.notes || {};
  const stateIdx = STATE_ORDER.indexOf(status?.state || '');

  if (loading && !status) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={T.gold} />
      </View>
    );
  }

  if (error && !status) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.homeBtn} onPress={() => navigation.navigate('Home')}>
          <Text style={styles.homeBtnText}>BACK TO HOME</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Page indicator */}
      <View style={styles.pageIndicator}>
        {['RESULT', 'ASSESSMENT', 'PIPELINE', 'SHARE'].map((label, i) => (
          <TouchableOpacity key={i} style={styles.pageTab} onPress={() => {}}>
            <Text style={[styles.pageTabText, currentPage === i && styles.pageTabActive]}>
              {label} {i + 1}/4
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={styles.pager}>
        {/* Page 1: RESULT */}
        <ScrollView style={{width: PAGE_WIDTH}} contentContainerStyle={styles.page}>
          <View style={styles.successHeader}>
            <Text style={styles.checkmark}>{'\u2713'}</Text>
            <Text style={styles.successTitle}>SUBMITTED</Text>
            <Text style={styles.successSubtitle}>Your card is in the pipeline.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>SUBMISSION</Text>
            <Text style={styles.cardValue}>{status?.card_name || 'Card'}</Text>
            <Text style={styles.idText}>ID: {submissionId.slice(0, 8)}...</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>STATUS</Text>
            <View style={[styles.badge, isVoting && styles.badgeVoting, isSealed && styles.badgeSealed]}>
              <Text style={styles.badgeText}>
                {STATE_LABELS[status?.state] || status?.state}
              </Text>
            </View>
            {isVoting && (
              <Text style={styles.votingInfo}>
                {status?.total_votes || 0} of {status?.vote_state?.threshold || 3} votes
              </Text>
            )}
          </View>

          {/* Async AI Polling Indicator with live elapsed-time
              telemetry. Spinner shows "Analyzing card… Xs" while the
              backend assessment is in flight; once centering lands,
              swaps to a static "Analyzed in X.Xs" line so the user
              has visible confirmation it actually finished. */}
          {analysisCompletedAt == null && pollCount < MAX_POLLS && !isSealed && (
            <View style={styles.analysisPending}>
              <ActivityIndicator size="small" color={T.gold} />
              <Text style={styles.analysisPendingText}>
                Analyzing card… {Math.max(0, Math.floor((now - mountedAt) / 1000))}s
              </Text>
            </View>
          )}
          {analysisCompletedAt != null && !isSealed && (
            <View style={styles.analysisPending}>
              <Text style={[styles.analysisPendingText, {color: T.gold}]}>
                ✓ Analyzed in {((analysisCompletedAt - mountedAt) / 1000).toFixed(1)}s
              </Text>
            </View>
          )}

          {frontOcr?.centering_lr != null && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>CENTERING</Text>
              <Text style={styles.analysisRow}>L/R: {frontOcr.centering_lr}</Text>
              {frontOcr.centering_tb != null && (
                <Text style={styles.analysisRow}>T/B: {frontOcr.centering_tb}</Text>
              )}
            </View>
          )}

          {/* Card identity — status-aware:
              "researching" → spinner ("Identifying card…")
              "partial"/"empty" → editable form so user can fill OCR gaps
              "complete" → display-only
              "locked"   → display-only with 🔒 note (post-seal) */}
          <CardIdentitySection
            status={status}
            onIdentityUpdated={fetchStatus}
          />

          {/* Post-seal actions — state-driven:
              sealed          → "LIST ON MARKETPLACE" + "SEND TO GRADER"
              proof_pending   → grader tracking display + "ENTER GRADING RESULT"
              proof_received  → final grade + card journey summary */}
          <PostSealActions status={status} onStateChanged={fetchStatus} />
        </ScrollView>

        {/* Page 2: ASSESSMENT — adapter wraps status into the canonical
            AssessmentPage component which renders per-house grade rows
            (PSA / BGS / CGC / TAG) + card identity + the locked-vocab
            legal disclosure. Replaces the prior inline mini-renderer
            that only showed grades concatenated on one line. */}
        <View style={{width: PAGE_WIDTH}}>
          <AssessmentPage
            identity={
              status?.card_identity
                ? ({
                    // Backend stores `player`/`set`; AssessmentPage's
                    // OcrIdentity uses `player_name`/`set_name` per the
                    // ocr_result.extracted_fields shape — translate at
                    // the boundary.
                    player_name: status.card_identity.player ?? null,
                    year: status.card_identity.year ?? null,
                    manufacturer: status.card_identity.manufacturer ?? null,
                    set_name: status.card_identity.set ?? null,
                    card_number: status.card_identity.card_number ?? null,
                    variation: null,
                    rarity_flag: null,
                    printing_uuid: null,
                    confidence: null,
                  } as OcrIdentity)
                : null
            }
            initialRead={
              frontOcr
                ? ({
                    grades: ([
                      frontOcr.psa_estimate && {
                        company: 'PSA',
                        value: String(frontOcr.psa_estimate),
                      },
                      frontOcr.bgs_estimate && {
                        company: 'BGS',
                        value: String(frontOcr.bgs_estimate),
                      },
                      frontOcr.cgc_estimate && {
                        company: 'CGC',
                        value: String(frontOcr.cgc_estimate),
                      },
                      frontOcr.tag_estimate && {
                        company: 'TAG',
                        value: String(frontOcr.tag_estimate),
                      },
                    ].filter(Boolean) as AiInitialReadGrade[]),
                    centering_lr: frontOcr.centering_lr ?? null,
                    centering_tb: frontOcr.centering_tb ?? null,
                  } as AiInitialRead)
                : null
            }
            notes={({
              card: status?.card_name || 'Card',
              type: status?.card_type || 'Card',
              stage: STATE_LABELS[status?.state] || status?.state || '—',
              corners: notes.corners ?? null,
              edges: notes.edges ?? null,
              surface: notes.surface ?? null,
              centering: notes.centering ?? null,
              other_notes: notes.other_notes ?? null,
            } as SubmissionNotes)}
            ocrPending={status?.card_identity_status === 'researching'}
          />
        </View>

        {/* Page 3: PIPELINE */}
        <ScrollView style={{width: PAGE_WIDTH}} contentContainerStyle={styles.page}>
          <Text style={styles.pageTitle}>PIPELINE</Text>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>STATE TIMELINE</Text>
            {STATE_ORDER.map((state, i) => {
              const isComplete = i <= stateIdx;
              const isCurrent = state === status?.state;
              return (
                <View key={state} style={styles.timelineRow}>
                  <View style={[styles.timelineDot, isComplete && styles.timelineDotComplete, isCurrent && styles.timelineDotCurrent]} />
                  {i < STATE_ORDER.length - 1 && (
                    <View style={[styles.timelineLine, isComplete && styles.timelineLineComplete]} />
                  )}
                  <Text style={[styles.timelineLabel, isComplete && styles.timelineLabelComplete, isCurrent && styles.timelineLabelCurrent]}>
                    {STATE_LABELS[state]}
                  </Text>
                </View>
              );
            })}
          </View>

          {threadUrl && (
            <TouchableOpacity
              style={styles.discordBtn}
              onPress={() => Linking.openURL(threadUrl)}>
              <Text style={styles.discordBtnText}>VIEW IN DISCORD</Text>
            </TouchableOpacity>
          )}

          {/* Open-voting retry surface. Lands when the backend's
              identity-completeness gate refused submitForVoting on the
              first try (state stays at notes_submitted). User edits
              missing fields via CardIdentitySection above, then taps
              this button — backend re-validates the gate. */}
          {status?.state === 'notes_submitted' && walletPubkey && (
            <TouchableOpacity
              style={styles.discordBtn}
              disabled={openingVoting}
              onPress={async () => {
                setOpeningVoting(true);
                try {
                  await ApiService.submitForVoting(submissionId, walletPubkey);
                  await fetchStatus();
                  Alert.alert(
                    'Voting opened',
                    'Discord voting thread is being created. Pull to refresh in a moment.',
                  );
                } catch (err: any) {
                  const respDetail = err?.response?.data?.detail;
                  const missing: string[] | undefined =
                    respDetail && typeof respDetail === 'object'
                      ? respDetail.missing_fields
                      : undefined;
                  if (Array.isArray(missing) && missing.length > 0) {
                    Alert.alert(
                      'Identity still incomplete',
                      `Missing: ${missing.join(', ')}.\n\n` +
                        'Fill these fields in the identity section above, ' +
                        'then tap OPEN COMMUNITY VOTING again.',
                    );
                  } else {
                    Alert.alert(
                      'Could not open voting',
                      respDetail?.message ||
                        respDetail ||
                        err?.message ||
                        'Unknown error',
                    );
                  }
                } finally {
                  setOpeningVoting(false);
                }
              }}>
              <Text style={styles.discordBtnText}>
                {openingVoting ? 'OPENING…' : 'OPEN COMMUNITY VOTING'}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Page 4: SHARE */}
        <ScrollView style={{width: PAGE_WIDTH}} contentContainerStyle={styles.page}>
          <Text style={styles.pageTitle}>SHARE</Text>

          {/* QR + social share. Primary payload is the Discord thread URL
              while voting is live (lets anyone scan + go vote). After seal,
              swap in the certificate explorer URL so the QR becomes the
              proof-of-grade link for social posts. */}
          {(threadUrl || certificate?.explorer_url) ? (
            <View style={styles.shareCard}>
              <Text style={styles.cardLabel}>
                {certificate?.explorer_url ? 'PROOF CERTIFICATE' : 'COMMUNITY VOTE LIVE'}
              </Text>
              <View style={styles.qrWrap}>
                <QRCode
                  value={certificate?.explorer_url || threadUrl || ''}
                  size={180}
                  backgroundColor="#FFFFFF"
                  color="#0E0E0E"
                />
              </View>
              <Text style={styles.shareHint}>
                {certificate?.explorer_url
                  ? 'Scan to view this card\u2019s permanent PROOF certificate.'
                  : 'Scan to jump into the Discord thread and vote on this card\u2019s condition.'}
              </Text>
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={async () => {
                  const url = certificate?.explorer_url || threadUrl || '';
                  if (!url) return;
                  const cardLabel =
                    status?.card_name && status.card_name !== 'Card'
                      ? status.card_name
                      : 'my card';
                  const message = certificate?.explorer_url
                    ? `PROOF grading is in for ${cardLabel}. See the certificate: ${url}`
                    : `Help me grade ${cardLabel} on PROOF \u2014 vote on its condition: ${url}`;
                  try {
                    await Share.share({message, url});
                  } catch (err: any) {
                    Alert.alert('Share failed', err?.message || 'Unknown error');
                  }
                }}>
                <Text style={styles.shareBtnText}>SHARE TO SOCIAL</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>QR CODE</Text>
              <Text style={styles.mutedText}>
                A share-ready QR code appears here once the Discord voting
                thread is created. If it\u2019s taking a while, pull to refresh.
              </Text>
            </View>
          )}

          {certificate?.cnft_address ? (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>CERTIFICATE</Text>
              <TouchableOpacity
                onPress={() => certificate.explorer_url && Linking.openURL(certificate.explorer_url)}>
                <Text style={[styles.analysisRow, {color: T.gold}]}>
                  {certificate.cnft_address.slice(0, 16)}...
                </Text>
                <Text style={styles.analysisRow}>Tap to view on explorer</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardLabel}>SUBMISSION ID</Text>
            <Text style={styles.monoSmall}>{submissionId}</Text>
          </View>

          {/* Delete button */}
          {canDelete && (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={handleDelete}
              disabled={deleting}>
              {deleting ? (
                <ActivityIndicator color={T.red} />
              ) : (
                <Text style={styles.deleteBtnText}>DELETE SUBMISSION</Text>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      </ScrollView>

      {/* Bottom page dots */}
      <View style={styles.dotsRow}>
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={[styles.dot, currentPage === i && styles.dotActive]} />
        ))}
      </View>

      {/* Bottom actions */}
      <View style={styles.bottomActions}>
        <TouchableOpacity style={styles.homeBtn} onPress={() => navigation.navigate('Home')}>
          <Text style={styles.homeBtnText}>BACK TO HOME</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ── Card Identity Section ────────────────────────────────────────
// Four display modes driven by `status.card_identity_status` from the
// backend:
//   researching — OCR hasn't landed a result yet. Show a spinner +
//                 "Identifying card…" so the user doesn't assume it
//                 failed while the back-side pass is still running.
//   partial     — some fields present, at least one missing. Show the
//                 current identity, plus an EDIT button that opens an
//                 inline form so the user can fill gaps (e.g. a year
//                 that OCR couldn't read).
//   complete    — year + manufacturer + set + player + card_number all
//                 present. Show the final name only.
//   locked      — submission is sealed or further along. Display-only
//                 with a 🔒 line so the user knows the record is frozen.
// A literal 'empty' state also surfaces from the backend as 'partial'
// since the UX is identical — show the edit form with nothing prefilled.

type CardIdentity = {
  player?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  set?: string | null;
  card_number?: string | null;
};

type CardIdentityStatus = 'researching' | 'partial' | 'complete' | 'locked';

interface CardIdentitySectionProps {
  status: any;
  onIdentityUpdated: () => Promise<void> | void;
}

const CardIdentitySection: React.FC<CardIdentitySectionProps> = ({
  status,
  onIdentityUpdated,
}) => {
  const route = useRoute<RouteProp<RootStackParamList, 'Result'>>();
  const {submissionId} = route.params;
  const identity: CardIdentity = status?.card_identity || {};
  const identityStatus: CardIdentityStatus =
    (status?.card_identity_status as CardIdentityStatus) || 'partial';
  const editable: boolean = status?.card_identity_editable !== false;

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Local draft starts from the current identity. Blank strings stand in for
  // nulls so TextInput is happy.
  const [draft, setDraft] = useState<CardIdentity>({
    year: identity.year || '',
    manufacturer: identity.manufacturer || '',
    set: identity.set || '',
    player: identity.player || '',
    card_number: identity.card_number || '',
  });

  // Refresh the draft when the upstream identity changes (e.g. after a save
  // or a concurrent OCR update). Only reset when NOT actively editing so we
  // don't clobber in-progress user input.
  useEffect(() => {
    if (editing) return;
    setDraft({
      year: identity.year || '',
      manufacturer: identity.manufacturer || '',
      set: identity.set || '',
      player: identity.player || '',
      card_number: identity.card_number || '',
    });
  }, [
    editing,
    identity.year,
    identity.manufacturer,
    identity.set,
    identity.player,
    identity.card_number,
  ]);

  const displayName = useMemo(() => {
    if (status?.card_name && status.card_name !== 'Card') return status.card_name;
    const parts = [
      identity.year,
      identity.manufacturer,
      identity.set,
      identity.player,
    ].filter(Boolean);
    const base = parts.join(' ');
    return identity.card_number ? `${base}${base ? ' ' : ''}#${identity.card_number}` : base;
  }, [status?.card_name, identity]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch: Record<string, string> = {};
      for (const key of ['year', 'manufacturer', 'set', 'player', 'card_number'] as const) {
        const value = (draft[key] || '').trim();
        if (value) patch[key] = value;
      }
      await ApiService.updateCardIdentity(submissionId, patch);
      await onIdentityUpdated();
      setEditing(false);
    } catch (err: any) {
      const detail =
        err?.response?.data?.detail ||
        err?.message ||
        'Failed to update card identity';
      Alert.alert('Could not save', detail);
    } finally {
      setSaving(false);
    }
  };

  if (identityStatus === 'researching') {
    return (
      <View style={identityStyles.card}>
        <Text style={identityStyles.label}>CARD IDENTITY</Text>
        <View style={identityStyles.researchingRow}>
          <ActivityIndicator color={T.gold} size="small" />
          <Text style={identityStyles.researchingText}>
            Identifying card…
          </Text>
        </View>
        <Text style={identityStyles.researchingHint}>
          OCR is still reading your card. This usually finishes within a few
          seconds of both sides uploading.
        </Text>
      </View>
    );
  }

  if (identityStatus === 'locked' || (identityStatus === 'complete' && !editing)) {
    return (
      <View style={identityStyles.card}>
        <Text style={identityStyles.label}>CARD IDENTITY</Text>
        <Text style={identityStyles.displayName}>
          {displayName || '—'}
        </Text>
        {identityStatus === 'locked' && (
          <Text style={identityStyles.lockedNote}>
            🔒 Sealed — identity is frozen on the record
          </Text>
        )}
      </View>
    );
  }

  // partial (or empty, or complete-while-editing) — show editable form
  return (
    <View style={identityStyles.card}>
      <Text style={identityStyles.label}>CARD IDENTITY</Text>
      {!!displayName && !editing && (
        <Text style={identityStyles.displayName}>{displayName}</Text>
      )}
      {!editing ? (
        <>
          {identityStatus === 'partial' && (
            <Text style={identityStyles.hint}>
              Some details are missing. Edit to fill them in before your
              card is sealed.
            </Text>
          )}
          {editable && (
            <TouchableOpacity
              style={identityStyles.editBtn}
              onPress={() => setEditing(true)}
              activeOpacity={0.7}>
              <Text style={identityStyles.editBtnText}>EDIT CARD DETAILS</Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        <>
          <IdentityField
            label="YEAR"
            value={draft.year || ''}
            onChange={v => setDraft(d => ({...d, year: v}))}
            placeholder="e.g. 1993"
            keyboardType="number-pad"
            maxLength={4}
          />
          <IdentityField
            label="MANUFACTURER"
            value={draft.manufacturer || ''}
            onChange={v => setDraft(d => ({...d, manufacturer: v}))}
            placeholder="e.g. Topps"
          />
          <IdentityField
            label="SET"
            value={draft.set || ''}
            onChange={v => setDraft(d => ({...d, set: v}))}
            placeholder="e.g. Stadium Club"
          />
          <IdentityField
            label="PLAYER"
            value={draft.player || ''}
            onChange={v => setDraft(d => ({...d, player: v}))}
            placeholder="e.g. Sammy Sosa"
            autoCapitalize="words"
          />
          <IdentityField
            label="CARD #"
            value={draft.card_number || ''}
            onChange={v => setDraft(d => ({...d, card_number: v}))}
            placeholder="e.g. 46"
          />
          <View style={identityStyles.formActions}>
            <TouchableOpacity
              style={identityStyles.cancelBtn}
              onPress={() => setEditing(false)}
              disabled={saving}
              activeOpacity={0.7}>
              <Text style={identityStyles.cancelBtnText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={identityStyles.saveBtn}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.7}>
              {saving ? (
                <ActivityIndicator color={T.bgApp} />
              ) : (
                <Text style={identityStyles.saveBtnText}>SAVE</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
};

interface IdentityFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
}

const IdentityField: React.FC<IdentityFieldProps> = ({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  autoCapitalize,
  maxLength,
}) => (
  <View style={identityStyles.field}>
    <Text style={identityStyles.fieldLabel}>{label}</Text>
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={T.textDisabled}
      keyboardType={keyboardType || 'default'}
      autoCapitalize={autoCapitalize || 'none'}
      maxLength={maxLength}
      style={identityStyles.fieldInput}
    />
  </View>
);

// ── Post-Seal Actions ────────────────────────────────────────────
// Two mutually-exclusive routes once a card is sealed, selected by
// the holder on the Result screen:
//
//   Route A — LIST ON MARKETPLACE (Solana Pay / Blinks)
//     User types an ask price in SOL, taps "Generate Listing". App
//     calls /marketplace-blinks, receives a dial.to Blink URL, opens
//     the system Share sheet so the user can post it to Twitter,
//     Discord, SMS, etc. cNFT stays in the holder's wallet until
//     someone executes the listing Action.
//
//   Route B — SEND TO GRADER (PSA / BGS / CGC / TAG)
//     User picks a grader, optionally enters cert#, service level,
//     tracking#. App calls /send-to-grader → state flips to
//     proof_pending. The grader-tracking record becomes visible on
//     the status screen. Later, when the grader returns a result,
//     user taps "Enter grading result" → /record-grade → state flips
//     to proof_received. Full card journey preserved on-chain.
//
// proof_received state is terminal — we display the complete
// journey (community consensus → grader → final grade) with no
// further CTAs.

type PostSealProps = {
  status: any;
  onStateChanged: () => Promise<void> | void;
};

const PostSealActions: React.FC<PostSealProps> = ({status, onStateChanged}) => {
  const {walletPubkey, authMode} = useSession();
  const {discordUserId} = useDiscordAuth();
  const submissionId: string = status?.submission_id;
  const state: string = status?.state;
  const proofTracking = status?.proof_tracking as
    | {grader?: string; cert_number?: string; service_level?: string; tracking_number?: string; submitted_at?: string; notes?: string}
    | null
    | undefined;
  const proofResult = status?.proof_result as
    | {grade?: string; grader?: string; cert_number?: string; received_at?: string; notes?: string}
    | null
    | undefined;

  const [mode, setMode] = useState<'idle' | 'listing' | 'grading' | 'result' | 'listing-generated'>('idle');
  const [busy, setBusy] = useState(false);

  // LIST ON MARKETPLACE state — USDC only per 2026-04-24 directive
  // (stablecoin pricing removes SOL volatility exposure for seller+buyer).
  // Two URL shapes: actionUrl (HTTPS, for social share / copy into
  // Blinks-aware surfaces) and walletUri (solana-action: scheme, for
  // one-tap mobile deep-link into Phantom / Solflare). dial.to is
  // owner-paused as of 2026-04-24 so the prior "blink_url" field also
  // now returns solana_action_uri from the backend.
  const [askUsdc, setAskUsdc] = useState('');
  const [generatedActionUrl, setGeneratedActionUrl] = useState<string | null>(null);
  const [generatedWalletUri, setGeneratedWalletUri] = useState<string | null>(null);
  // Buyer-facing URL for the share message. Different from
  // generatedActionUrl (the seller's listing-memo URL) — when the seller
  // pastes a listing-URL into Discord, buyers tapping it land on a
  // seller-side "List for sale" Blink that 403s them at POST. The buyer
  // share URL is the bid-side action so buyers see "Bid X USDC" they
  // can actually sign.
  const [generatedShareActionUrl, setGeneratedShareActionUrl] = useState<string | null>(null);
  const [generatedAskUsdc, setGeneratedAskUsdc] = useState<string>('');
  // SEND TO GRADER state
  const [grader, setGrader] = useState<'PSA' | 'BGS' | 'CGC' | 'TAG' | 'OTHER'>('PSA');
  const [graderCustom, setGraderCustom] = useState('');
  const [certNumber, setCertNumber] = useState('');
  const [serviceLevel, setServiceLevel] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [graderNotes, setGraderNotes] = useState('');
  // RECORD GRADE state
  const [finalGrade, setFinalGrade] = useState('');
  const [resultCert, setResultCert] = useState('');
  const [resultNotes, setResultNotes] = useState('');

  const authFields = () => ({
    wallet_pubkey: walletPubkey ?? undefined,
    discord_user_id: discordUserId ?? undefined,
  });

  const handleGenerateListing = async () => {
    const ask = askUsdc.trim();
    if (!ask || Number.isNaN(Number(ask)) || Number(ask) <= 0) {
      Alert.alert('Invalid ask', 'Enter a positive USDC amount (e.g. 12.50).');
      return;
    }
    setBusy(true);
    try {
      // Request BOTH listing (seller-side memo) AND bid (buyer-side
      // memo) URLs at the same ask amount. Seller's "Open in Wallet"
      // button uses the listing URL to sign their commit; the share
      // message uses the bid URL so buyers tapping the link from
      // Discord/X actually see a "Bid X USDC" Blink they can sign
      // (instead of a seller-only "List for sale" form that 403s
      // them at POST because they're not the cNFT holder).
      const res = await ApiService.getMarketplaceBlinks(submissionId, ask, ask);
      const actionUrl =
        res.data?.listing_action_url || res.data?.action_url;
      const walletUri =
        res.data?.listing_solana_action_uri ||
        res.data?.listing_blink_url ||
        (actionUrl ? `solana-action:${actionUrl}` : null);
      const shareActionUrl =
        res.data?.bid_action_url || actionUrl; // fallback to listing if backend didn't return bid
      if (!actionUrl) {
        throw new Error('Backend did not return a listing URL');
      }
      setGeneratedActionUrl(actionUrl);
      setGeneratedWalletUri(walletUri);
      setGeneratedShareActionUrl(shareActionUrl);
      setGeneratedAskUsdc(ask);
      setMode('listing-generated');
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to generate listing';
      Alert.alert('Listing failed', detail);
    } finally {
      setBusy(false);
    }
  };

  const handleShareListing = async () => {
    const buyerBlinkUrl = generatedShareActionUrl || generatedActionUrl;
    if (!buyerBlinkUrl) return;
    const cardName = status?.card_name || 'my PROOF-sealed card';
    // Share the on-brand reveal page that wraps the Buy intent. The page
    // unfurls with og:image (front photo) on Twitter / Discord / iMessage,
    // and provides Phantom / Solflare / Solana Pay QR buttons inline. The
    // raw Blink URL is passed as ?buy= so the page can deep-link wallets.
    const revealUrl =
      `https://proofbyframe.com/reveal/${submissionId}` +
      `?ask=${encodeURIComponent(generatedAskUsdc)}` +
      `&buy=${encodeURIComponent(buyerBlinkUrl)}`;
    try {
      await Share.share({
        message:
          `I sealed ${cardName} on PROOF and listed it for ${generatedAskUsdc} USDC.\n\n` +
          `Tap to buy: ${revealUrl}\n\n` +
          `(USDC-denominated — opens an on-brand PROOF reveal page with ` +
          `Phantom, Solflare, and Solana Pay buttons.)`,
        url: revealUrl,
      });
    } catch (err: any) {
      // Share.share throws on user-cancel on Android; swallow.
    }
  };

  const handleOpenInWallet = async () => {
    // solana-action: scheme deep-links directly into Phantom / Solflare
    // mobile's Blinks handler. Falls back to HTTPS URL if the scheme
    // isn't registered (unlikely on a device that has a Blinks-aware
    // wallet installed).
    const target = generatedWalletUri || generatedActionUrl;
    if (!target) return;
    try {
      const canOpen = await Linking.canOpenURL(target);
      if (!canOpen && generatedActionUrl) {
        await Linking.openURL(generatedActionUrl);
        return;
      }
      await Linking.openURL(target);
    } catch (err: any) {
      Alert.alert(
        'No wallet handler',
        'Install Phantom or Solflare to render this as a Blink. ' +
        'Meanwhile you can Share the URL on Discord/Twitter for buyers.',
      );
    }
  };

  // Listing sign+send dispatches on the active auth mode:
  //
  //   - 'mwa': in-app MWA sign+send via WalletService.signAndSendActionTx.
  //     This is the existing path. It now only works for wallets where
  //     MWA still functions (Solflare / Backpack / Ultimate); Phantom
  //     26.6.0 + MWA 2.2.7 force-closes after authorize.
  //
  //   - 'solana-pay': Solana Pay transaction-request handoff. The wallet
  //     handles GET-metadata / POST-{account} / sign-and-broadcast in
  //     its own UI via the `solana:` URL-scheme. Phantom 26.6.0 handles
  //     this without going through the broken MWA path. No signature is
  //     returned via the deeplink; we surface a "submitted, refresh in
  //     a moment" CTA and call onStateChanged() so the caller can poll
  //     /status for the resulting state transition.
  //
  //   - 'demo': can't sign on-chain — instruct the user to connect a
  //     real wallet (Solana Pay path is the easiest).
  const handleListNow = async () => {
    if (!walletPubkey) {
      Alert.alert(
        'Wallet not connected',
        'Connect a wallet first — listing requires the cNFT holder to sign.',
      );
      return;
    }
    if (!generatedAskUsdc) {
      Alert.alert('No ask set', 'Generate the listing first, then sign.');
      return;
    }
    if (authMode === 'demo') {
      Alert.alert(
        "Demo mode can't sign on-chain",
        'Connect a wallet via the Wallet screen to list this cNFT for sale.',
      );
      return;
    }
    setBusy(true);
    try {
      // CONFIG.API_BASE_URL is the canonical `${backend}/api` form;
      // the action endpoint is at /api/actions/marketplace/list/{id},
      // so we append /actions/... to reach it.
      const postUrl =
        `${CONFIG.API_BASE_URL}/actions/marketplace/list/${submissionId}` +
        `?ask=${encodeURIComponent(generatedAskUsdc)}`;

      // MWA path — wallet-agnostic in-app signing. Once Solana Pay
      // checkout lands as the buyer-side payment surface, the seller-
      // side listing tx still uses MWA: it's the cNFT holder
      // authorizing the listing memo, not a payment.
      const {signature, message, error} = await WalletService.signAndSendActionTx(
        postUrl,
        walletPubkey,
      );
      if (error || !signature) {
        Alert.alert('Listing failed', error || 'Wallet did not return a signature');
        return;
      }
      Alert.alert(
        'Listing signed',
        `${message || 'Your listing is on-chain.'}\n\n` +
        `Signature: ${signature.slice(0, 8)}…${signature.slice(-8)}\n\n` +
        'Share the listing URL on Discord/Twitter so buyers can bid via Blink.',
      );
      await onStateChanged();
    } catch (err: any) {
      Alert.alert('Listing failed', err?.message || 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleListingDone = () => {
    setMode('idle');
    setAskUsdc('');
    setGeneratedActionUrl(null);
    setGeneratedWalletUri(null);
    setGeneratedAskUsdc('');
  };

  const handleSendToGrader = async () => {
    const graderName = grader === 'OTHER' ? graderCustom.trim() : grader;
    if (!graderName) {
      Alert.alert('Grader required', 'Pick a grader or enter a custom name.');
      return;
    }
    setBusy(true);
    try {
      await ApiService.sendToGrader(submissionId, {
        ...authFields(),
        grader: graderName,
        cert_number: certNumber.trim() || undefined,
        service_level: serviceLevel.trim() || undefined,
        tracking_number: trackingNumber.trim() || undefined,
        notes: graderNotes.trim() || undefined,
      });
      await onStateChanged();
      setMode('idle');
      setCertNumber('');
      setServiceLevel('');
      setTrackingNumber('');
      setGraderNotes('');
      setGraderCustom('');
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to send to grader';
      Alert.alert('Send failed', detail);
    } finally {
      setBusy(false);
    }
  };

  const handleRecordGrade = async () => {
    const grade = finalGrade.trim();
    if (!grade) {
      Alert.alert('Grade required', 'Enter the grader’s result (e.g. "PSA 9").');
      return;
    }
    setBusy(true);
    try {
      await ApiService.recordGrade(submissionId, {
        ...authFields(),
        grade,
        cert_number: resultCert.trim() || undefined,
        notes: resultNotes.trim() || undefined,
      });
      await onStateChanged();
      setMode('idle');
      setFinalGrade('');
      setResultCert('');
      setResultNotes('');
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to record grade';
      Alert.alert('Record failed', detail);
    } finally {
      setBusy(false);
    }
  };

  // ── State-driven render ─────────────────────────────────────────

  if (state === 'proof_received') {
    return (
      <View style={postSealStyles.card}>
        <Text style={postSealStyles.label}>FINAL GRADE</Text>
        <Text style={postSealStyles.finalGradeText}>
          {proofResult?.grade || '—'}
        </Text>
        {proofResult?.grader && (
          <Text style={postSealStyles.grader}>by {proofResult.grader}</Text>
        )}
        {proofResult?.cert_number && (
          <Text style={postSealStyles.certLine}>
            Cert #{proofResult.cert_number}
          </Text>
        )}
        <View style={postSealStyles.journeySection}>
          <Text style={postSealStyles.journeyLabel}>CARD JOURNEY</Text>
          <Text style={postSealStyles.journeyRow}>
            1. Sealed on PROOF (community consensus)
          </Text>
          {proofTracking?.submitted_at && (
            <Text style={postSealStyles.journeyRow}>
              2. Sent to {proofTracking.grader} on{' '}
              {new Date(proofTracking.submitted_at).toLocaleDateString()}
            </Text>
          )}
          {proofResult?.received_at && (
            <Text style={postSealStyles.journeyRow}>
              3. Graded {proofResult.grade} on{' '}
              {new Date(proofResult.received_at).toLocaleDateString()}
            </Text>
          )}
        </View>
      </View>
    );
  }

  if (state === 'proof_pending') {
    // Display grader tracking + "Enter grading result" CTA
    return (
      <View style={postSealStyles.card}>
        <Text style={postSealStyles.label}>SENT TO GRADER</Text>
        <Text style={postSealStyles.graderName}>
          {proofTracking?.grader || 'Grader'}
        </Text>
        {proofTracking?.cert_number && (
          <Text style={postSealStyles.certLine}>
            Cert #{proofTracking.cert_number}
          </Text>
        )}
        {proofTracking?.tracking_number && (
          <Text style={postSealStyles.trackLine}>
            Tracking: {proofTracking.tracking_number}
          </Text>
        )}
        {proofTracking?.submitted_at && (
          <Text style={postSealStyles.submittedLine}>
            Submitted {new Date(proofTracking.submitted_at).toLocaleDateString()}
          </Text>
        )}

        {mode !== 'result' ? (
          <TouchableOpacity
            style={postSealStyles.primaryBtn}
            onPress={() => setMode('result')}
            disabled={busy}
            activeOpacity={0.7}>
            <Text style={postSealStyles.primaryBtnText}>ENTER GRADING RESULT</Text>
          </TouchableOpacity>
        ) : (
          <>
            <IdentityField
              label="FINAL GRADE *"
              value={finalGrade}
              onChange={setFinalGrade}
              placeholder='e.g. "PSA 9" or "BGS 9.5"'
              autoCapitalize="characters"
            />
            <IdentityField
              label="CERT # (optional)"
              value={resultCert}
              onChange={setResultCert}
              placeholder="Final issued cert number"
            />
            <IdentityField
              label="NOTES (optional)"
              value={resultNotes}
              onChange={setResultNotes}
              placeholder="Sub-grades, surface notes, etc."
              autoCapitalize="sentences"
            />
            <View style={postSealStyles.formActions}>
              <TouchableOpacity
                style={postSealStyles.cancelBtn}
                onPress={() => setMode('idle')}
                disabled={busy}
                activeOpacity={0.7}>
                <Text style={postSealStyles.cancelBtnText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={postSealStyles.saveBtn}
                onPress={handleRecordGrade}
                disabled={busy}
                activeOpacity={0.7}>
                {busy ? (
                  <ActivityIndicator color={T.bgApp} />
                ) : (
                  <Text style={postSealStyles.saveBtnText}>SUBMIT RESULT</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    );
  }

  if (state !== 'sealed') {
    // Pre-seal states — nothing to show here (card capture / voting is
    // handled elsewhere in the flow).
    return null;
  }

  // state === 'sealed' — two CTAs side-by-side
  return (
    <View style={postSealStyles.card}>
      <Text style={postSealStyles.label}>WHAT'S NEXT</Text>
      <Text style={postSealStyles.body}>
        Your card is sealed on-chain. Pick one:
      </Text>

      {mode === 'listing' && (
        <>
          <Text style={postSealStyles.subheading}>LIST ON MARKETPLACE</Text>
          <Text style={postSealStyles.subbody}>
            USDC-only pricing — no SOL volatility. Generate a Blink URL
            you can open in dial.to (renders the buy button inline) or
            share on Twitter / Discord, where Blinks unfurl into a
            one-tap purchase card.
          </Text>
          <IdentityField
            label="ASK (USDC)"
            value={askUsdc}
            onChange={setAskUsdc}
            placeholder="e.g. 12.50"
            keyboardType="default"
          />
          <View style={postSealStyles.formActions}>
            <TouchableOpacity
              style={postSealStyles.cancelBtn}
              onPress={() => {
                setMode('idle');
                setAskUsdc('');
              }}
              disabled={busy}
              activeOpacity={0.7}>
              <Text style={postSealStyles.cancelBtnText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={postSealStyles.saveBtn}
              onPress={handleGenerateListing}
              disabled={busy}
              activeOpacity={0.7}>
              {busy ? (
                <ActivityIndicator color={T.bgApp} />
              ) : (
                <Text style={postSealStyles.saveBtnText}>GENERATE LISTING</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}

      {mode === 'listing-generated' && generatedActionUrl && (
        <>
          <Text style={postSealStyles.subheading}>LISTING READY</Text>
          <Text style={postSealStyles.subbody}>
            Listing generated for {generatedAskUsdc} USDC. Tap
            LIST NOW to sign the listing transaction in your wallet —
            the listing is recorded on-chain. Then SHARE TO SOCIALS so
            buyers can bid via Blink (any Blinks-aware wallet renders
            the URL as a one-tap purchase card).
          </Text>
          <View style={postSealStyles.urlPreview}>
            <Text style={postSealStyles.urlPreviewLabel}>LISTING URL</Text>
            <Text style={postSealStyles.urlPreviewText} numberOfLines={3}>
              {generatedActionUrl}
            </Text>
          </View>
          <TouchableOpacity
            style={[postSealStyles.primaryBtn, busy && {opacity: 0.5}]}
            onPress={handleListNow}
            disabled={busy}
            activeOpacity={0.7}>
            <Text style={postSealStyles.primaryBtnText}>
              {busy ? 'WAITING FOR WALLET…' : 'LIST NOW'}
            </Text>
          </TouchableOpacity>
          {/* Fallback path: open the listing Blink URL externally so
              the device's system router resolves it (Phantom mobile's
              Blinks browser, dial.to, system browser, whichever the
              user has registered). Useful when in-app MWA hits a
              wallet-specific protocol mismatch (e.g., Phantom 26.6.0
              + @solana-mobile 2.2.7 legacy-session fallback). */}
          <TouchableOpacity
            style={postSealStyles.secondaryBtn}
            onPress={() => {
              if (!generatedActionUrl) return;
              Linking.openURL(generatedActionUrl).catch(err => {
                Alert.alert(
                  'Could not open',
                  err?.message || 'No app handler for this Blink URL.',
                );
              });
            }}
            activeOpacity={0.7}>
            <Text style={postSealStyles.secondaryBtnText}>OPEN IN BROWSER</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={postSealStyles.secondaryBtn}
            onPress={handleShareListing}
            activeOpacity={0.7}>
            <Text style={postSealStyles.secondaryBtnText}>SHARE TO SOCIALS</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[postSealStyles.secondaryBtn, {borderColor: T.border}]}
            onPress={handleListingDone}
            activeOpacity={0.7}>
            <Text style={[postSealStyles.secondaryBtnText, {color: T.textSecondary}]}>
              DONE
            </Text>
          </TouchableOpacity>
        </>
      )}

      {mode === 'grading' && (
        <>
          <Text style={postSealStyles.subheading}>SEND TO GRADER</Text>
          <Text style={postSealStyles.subbody}>
            Track your card through PSA / BGS / CGC / TAG. When results
            come back, enter them here for a full on-chain journey.
          </Text>
          <Text style={postSealStyles.fieldLabel}>GRADER *</Text>
          <View style={postSealStyles.graderRow}>
            {(['PSA', 'BGS', 'CGC', 'TAG', 'OTHER'] as const).map(g => (
              <TouchableOpacity
                key={g}
                style={[
                  postSealStyles.graderChip,
                  grader === g && postSealStyles.graderChipActive,
                ]}
                onPress={() => setGrader(g)}
                activeOpacity={0.7}>
                <Text
                  style={[
                    postSealStyles.graderChipText,
                    grader === g && postSealStyles.graderChipTextActive,
                  ]}>
                  {g}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {grader === 'OTHER' && (
            <IdentityField
              label="GRADER NAME *"
              value={graderCustom}
              onChange={setGraderCustom}
              placeholder="e.g. HGA, SGC"
              autoCapitalize="characters"
            />
          )}
          <IdentityField
            label="CERT # (optional)"
            value={certNumber}
            onChange={setCertNumber}
            placeholder="If the grader has issued one already"
          />
          <IdentityField
            label="SERVICE LEVEL (optional)"
            value={serviceLevel}
            onChange={setServiceLevel}
            placeholder="e.g. Regular, Express, Super Express"
            autoCapitalize="words"
          />
          <IdentityField
            label="TRACKING # (optional)"
            value={trackingNumber}
            onChange={setTrackingNumber}
            placeholder="Shipping tracking # to the grader"
          />
          <IdentityField
            label="NOTES (optional)"
            value={graderNotes}
            onChange={setGraderNotes}
            placeholder="Anything you want to remember about this submission"
            autoCapitalize="sentences"
          />
          <View style={postSealStyles.formActions}>
            <TouchableOpacity
              style={postSealStyles.cancelBtn}
              onPress={() => setMode('idle')}
              disabled={busy}
              activeOpacity={0.7}>
              <Text style={postSealStyles.cancelBtnText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={postSealStyles.saveBtn}
              onPress={handleSendToGrader}
              disabled={busy}
              activeOpacity={0.7}>
              {busy ? (
                <ActivityIndicator color={T.bgApp} />
              ) : (
                <Text style={postSealStyles.saveBtnText}>SEND TO GRADER</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}

      {mode === 'idle' && (
        <View style={postSealStyles.ctaRow}>
          <TouchableOpacity
            style={postSealStyles.primaryBtn}
            onPress={() => setMode('listing')}
            activeOpacity={0.7}>
            <Text style={postSealStyles.primaryBtnText}>LIST ON MARKETPLACE</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={postSealStyles.secondaryBtn}
            onPress={() => setMode('grading')}
            activeOpacity={0.7}>
            <Text style={postSealStyles.secondaryBtnText}>SEND TO GRADER</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const postSealStyles = StyleSheet.create({
  card: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.borderGold,
  },
  label: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: 8,
  },
  body: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 1,
    marginBottom: 16,
  },
  subheading: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 2,
    marginTop: 12,
    marginBottom: 6,
    fontWeight: '700',
  },
  subbody: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 12,
    lineHeight: 16,
  },
  ctaRow: {
    flexDirection: 'column',
    gap: 10,
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: T.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  primaryBtnText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 3,
    fontWeight: '700',
  },
  secondaryBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.borderGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 3,
    fontWeight: '700',
  },
  fieldLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 4,
    marginTop: 10,
  },
  graderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  graderChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: T.bgInput,
  },
  graderChipActive: {
    backgroundColor: T.gold,
    borderColor: T.gold,
  },
  graderChipText: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
  },
  graderChipTextActive: {
    color: T.bgApp,
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  saveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: T.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 3,
    fontWeight: '700',
  },
  graderName: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 16,
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 8,
  },
  certLine: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 2,
  },
  trackLine: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 2,
  },
  submittedLine: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 4,
    marginBottom: 16,
  },
  finalGradeText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 28,
    letterSpacing: 4,
    fontWeight: '900',
    marginBottom: 4,
  },
  grader: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 12,
  },
  journeySection: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.border,
  },
  journeyLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 3,
    marginBottom: 8,
  },
  journeyRow: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 4,
    lineHeight: 16,
  },
  urlPreview: {
    marginTop: 10,
    marginBottom: 4,
    padding: 12,
    borderRadius: 8,
    backgroundColor: T.bgInput,
    borderWidth: 1,
    borderColor: T.border,
  },
  urlPreviewLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 4,
  },
  urlPreviewText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 0,
    lineHeight: 14,
  },
});

const identityStyles = StyleSheet.create({
  card: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  label: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: 8,
  },
  displayName: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 14,
    letterSpacing: 1,
  },
  hint: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 10,
  },
  researchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  researchingText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 2,
  },
  researchingHint: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 8,
  },
  lockedNote: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 8,
  },
  editBtn: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
  },
  editBtnText: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
  },
  field: {marginTop: 10},
  fieldLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 4,
  },
  fieldInput: {
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 13,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: T.bgInput,
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  saveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: T.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 3,
    fontWeight: '700',
  },
});

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: T.bgApp},
  center: {alignItems: 'center', justifyContent: 'center'},
  pager: {flex: 1},
  page: {padding: 20, paddingTop: 12, paddingBottom: 40},
  pageIndicator: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 12,
    gap: 12,
  },
  pageTab: {},
  pageTabText: {
    color: T.textDisabled,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1,
  },
  pageTabActive: {
    color: T.gold,
    fontWeight: '700',
  },
  pageTitle: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 14,
    letterSpacing: 3,
    marginBottom: 20,
  },
  successHeader: {alignItems: 'center', marginBottom: 24},
  checkmark: {
    color: '#4CAF50',
    fontSize: 48,
    marginBottom: 12,
  },
  successTitle: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 16,
    letterSpacing: 4,
    fontWeight: '700',
  },
  successSubtitle: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 8,
  },
  errorText: {
    color: '#F44336',
    fontFamily: 'monospace',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 16,
  },
  card: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.borderGold,
    overflow: 'hidden',
  },
  shareCard: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.borderGold,
    alignItems: 'center',
  },
  qrWrap: {
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginTop: 12,
    marginBottom: 12,
  },
  shareHint: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    paddingHorizontal: 8,
    marginBottom: 14,
  },
  shareBtn: {
    backgroundColor: T.gold,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  shareBtnText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 3,
    fontWeight: '700',
  },
  cardLabel: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: 8,
    fontWeight: '700',
  },
  cardValue: {
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '600',
  },
  idText: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    marginTop: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    backgroundColor: '#333',
  },
  badgeVoting: {backgroundColor: '#1B5E20'},
  badgeSealed: {backgroundColor: '#E65100'},
  badgeText: {
    color: '#FFF',
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '600',
  },
  votingInfo: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    marginTop: 8,
  },
  analysisRow: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    marginBottom: 4,
  },
  gradeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
  },
  gradeLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
  },
  gradeValue: {
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '600',
  },
  mutedText: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 15,
  },
  monoSmall: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 10,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    position: 'relative',
    minHeight: 28,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#333',
    marginRight: 12,
    zIndex: 1,
  },
  timelineDotComplete: {backgroundColor: '#4CAF50'},
  timelineDotCurrent: {backgroundColor: T.gold},
  timelineLine: {
    position: 'absolute',
    left: 4,
    top: 10,
    width: 2,
    height: 18,
    backgroundColor: '#333',
  },
  timelineLineComplete: {backgroundColor: '#4CAF5066'},
  timelineLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1,
  },
  timelineLabelComplete: {color: T.textSecondary},
  timelineLabelCurrent: {color: T.gold, fontWeight: '700'},
  discordBtn: {
    borderWidth: 1,
    borderColor: '#5865F2',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  discordBtnText: {
    color: '#5865F2',
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '600',
  },
  deleteBtn: {
    borderWidth: 1,
    borderColor: `${T.red}88`,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  deleteBtnText: {
    color: T.red,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '600',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#333',
  },
  dotActive: {backgroundColor: T.gold},
  bottomActions: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  homeBtn: {
    backgroundColor: T.gold,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  homeBtnText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 3,
    fontWeight: '700',
  },
  analysisPending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  analysisPendingText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 1,
  },
});
