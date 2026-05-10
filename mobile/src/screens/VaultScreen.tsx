import React, {useCallback, useEffect, useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import {T} from '../constants/tokens';
import {BackButton} from '../components/BackButton';
import {useSession} from '../hooks/useSession';
import {ApiService} from '../services/api';
import {
  deleteSubmission as deleteSubmissionLocal,
  isSubmissionDeletable,
  isSubmissionEditable,
  readAllBuckets,
  rehydrateFromBackend,
  saveSubmission,
} from '../storage/submissions';
import type {Submission, SubmissionState} from '../types/submission';

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function humanizeState(state: string): string {
  return state
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function describeSubmission(s: Submission): string {
  if (s.cardName && s.cardName.trim()) return s.cardName.trim();
  if (s.baselines[0]?.company) {
    return `${s.baselines[0].company} ${s.baselines[0].label || ''}`.trim();
  }
  if (s.description && s.description !== 'Mobile card submission') {
    return s.description;
  }
  return 'Raw card submission';
}

const IMMUTABLE_STATES = new Set(['sealed', 'proof_pending', 'proof_received']);

export const VaultScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const {walletPubkey} = useSession();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Pull fresh OCR / state data from the backend for each locally-known
  // submission and merge it back into AsyncStorage. Without this, cards
  // submitted before OCR completes show as "Raw card submission" in Vault
  // forever — ResultScreen polls the backend for the card being viewed but
  // never writes the fresh card_name / state back to the local record.
  const syncFromBackend = useCallback(
    async (subs: Submission[]): Promise<Submission[]> => {
      const scope = walletPubkey ?? undefined;
      // Serialize the per-submission /status fetches. Promise.all here
      // launched N parallel requests which combined with the per-call
      // db_pool acquire on the backend (and Neon's own connection-pool
      // cold-start cost) saturated the pool — symptom: tapping a sealed
      // or proof_pending submission "loops" because the first /status
      // call hits an exhausted pool and times out, mobile retries,
      // pool stays under load. One-at-a-time keeps total time bounded
      // (~N * 700ms warm) without ever spiking pool pressure.
      const merged: Submission[] = [];
      for (const s of subs) {
        try {
          const res = await ApiService.getSubmission(s.id, scope);
          const data = res?.data;
          if (!data) {
            merged.push(s);
            continue;
          }
          const backendName: string | undefined =
            data.card_name ?? data.ocr_result?.front?.card_name ?? undefined;
          const backendState: string | undefined = data.state;
          const next: Submission = {
            ...s,
            cardName:
              backendName && backendName.toLowerCase() !== 'card'
                ? backendName
                : s.cardName,
            currentState:
              (backendState as SubmissionState | undefined) ?? s.currentState,
          };
          if (
            next.cardName !== s.cardName ||
            next.currentState !== s.currentState
          ) {
            await saveSubmission(next, scope);
          }
          merged.push(next);
        } catch {
          merged.push(s);
        }
      }
      return merged;
    },
    [walletPubkey],
  );

  const load = useCallback(async () => {
    // Read across ALL pubkey buckets so drafts/submitted records from prior
    // wallet identities (Phantom disconnect, Demo Mode re-provision, etc.)
    // still surface. Without this, a churned wallet makes drafts appear lost.
    const all = await readAllBuckets();
    // Editable drafts first, then submitted; within each, newest first.
    const sortSubs = (subs: Submission[]) =>
      [...subs].sort((a, b) => {
        const aEditable = isSubmissionEditable(a);
        const bEditable = isSubmissionEditable(b);
        if (aEditable && !bEditable) return -1;
        if (!aEditable && bEditable) return 1;
        return b.createdAt - a.createdAt;
      });
    // Paint local first so the user sees something immediately, then reconcile
    // with backend and re-paint with the OCR-updated records.
    setSubmissions(sortSubs(all));
    setLoading(false);

    // Rehydration path: when local AsyncStorage has nothing for the
    // active wallet but the backend does (typical after an APK
    // reinstall — uninstall wipes /data/data/com.proofbyframe), pull
    // the server's list and seed the local index. Idempotent — if
    // local already has rows, the helper merges (server wins on state
    // and card name; locally-only fields like image URIs survive).
    if (walletPubkey) {
      try {
        const resp = await ApiService.listSubmissionsByWallet(walletPubkey);
        const rows = resp?.data?.submissions ?? [];
        if (rows.length > 0) {
          await rehydrateFromBackend(walletPubkey, rows);
          // Re-read after rehydrate so the UI reflects newly-seeded rows.
          const rehydrated = await readAllBuckets();
          setSubmissions(sortSubs(rehydrated));
        }
      } catch {
        // Rehydration is best-effort — if the backend is unreachable
        // or the endpoint isn't deployed yet, fall through to the
        // existing per-id syncFromBackend path below.
      }
    }

    const merged = await syncFromBackend(await readAllBuckets());
    setSubmissions(sortSubs(merged));
    setRefreshing(false);
  }, [walletPubkey, syncFromBackend]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleDelete = useCallback(
    (sub: Submission) => {
      if (!isSubmissionDeletable(sub)) return;
      // State-aware copy: pre-voting drafts have no Discord thread
      // and no community impact; community_voting/review_complete/
      // voting_reopened rows have an active voting thread that gets
      // archived server-side as part of the delete. Either way: no
      // credit refund (anti-abuse — prevents spam-submit-then-spam-
      // delete).
      // Cast to string because the mobile SubmissionState type only
      // covers a subset of the backend state machine — review_complete
      // and voting_reopened are real runtime values that arrive via
      // the rehydrate path but aren't in the union.
      const VOTING_ACTIVE_STATES = new Set<string>([
        'community_voting',
        'review_complete',
        'voting_reopened',
      ]);
      const isPreVoting = !VOTING_ACTIVE_STATES.has(
        String(sub.currentState),
      );
      const body = isPreVoting
        ? 'This removes the submission from PROOF entirely.\n\n' +
          'Note: deleting does NOT refund the submission credit you used.'
        : 'This removes the submission from PROOF and closes the ' +
          'active community voting thread on Discord.\n\n' +
          'Note: deleting does NOT refund the submission credit you used.';
      Alert.alert('Delete submission?', body, [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!walletPubkey) {
              Alert.alert(
                'Wallet not connected',
                'Connect a wallet first — delete needs the owner to authorize.',
              );
              return;
            }
            try {
              const resp = await ApiService.deleteSubmission(
                sub.id,
                walletPubkey,
              );
              // Backend confirmed soft-delete + (when applicable)
              // archived the Discord thread. Now purge the local
              // AsyncStorage entry so the row disappears from the
              // Vault list. Without this the row would 404 on next
              // tap (the 404 self-heal in ResultScreen would catch
              // it on entry, but cleaner to purge up-front).
              await deleteSubmissionLocal(sub.id, walletPubkey);
              const discordNote = resp?.data?.discord_archived
                ? '\n\nDiscord voting thread archived.'
                : resp?.data?.discord_error
                  ? '\n\n(Discord archive deferred — admin can /archive-thread.)'
                  : '';
              Alert.alert('Deleted', `Submission removed.${discordNote}`);
            } catch (err: any) {
              const detail =
                err?.response?.data?.detail ||
                err?.message ||
                'Delete failed';
              Alert.alert('Error', String(detail));
            } finally {
              await load();
            }
          },
        },
      ]);
    },
    [walletPubkey, load],
  );

  const renderEmpty = () => (
    <View style={styles.body}>
      <Text style={styles.emptyIcon}>📦</Text>
      <Text style={styles.emptyTitle}>No submissions yet</Text>
      <Text style={styles.emptyBody}>
        Your graded card submissions will appear here.
      </Text>
      <TouchableOpacity
        style={styles.startBtn}
        onPress={() => navigation.navigate('Camera', {captureMode: 'front'})}>
        <Text style={styles.startBtnText}>START SUBMISSION →</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.backBtn}>
          <BackButton />
        </View>
        <Text style={styles.title}>MY SUBMISSIONS</Text>
        <View style={styles.headerRight} />
      </View>

      {loading ? (
        <View style={styles.body}>
          <ActivityIndicator color={T.gold} />
        </View>
      ) : submissions.length === 0 ? (
        renderEmpty()
      ) : (
        <FlatList
          data={submissions}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={T.gold}
            />
          }
          renderItem={({item}) => {
            const isDraft = item.status === 'draft';
            const editable = isSubmissionEditable(item);
            const deletable = isSubmissionDeletable(item);
            return (
              <View
                style={[
                  styles.row,
                  editable && styles.rowEditable,
                ]}>
                <TouchableOpacity
                  style={styles.rowTap}
                  activeOpacity={0.7}
                  onPress={() =>
                    navigation.navigate(
                      IMMUTABLE_STATES.has(item.currentState) ? 'SealedResult' : 'Result',
                      {submissionId: item.id}
                    )
                  }>
                  {/* Gold frame around thumbnail — signature PROOF element */}
                  <View style={styles.thumbFrameOuter}>
                    <View style={styles.thumbFrameInner}>
                      {item.frontImageUri ? (
                        <Image
                          source={{uri: item.frontImageUri}}
                          style={styles.thumb}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={[styles.thumb, styles.thumbEmpty]}>
                          <Text style={styles.thumbPlaceholder}>PROOF</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {describeSubmission(item)}
                    </Text>
                    <Text style={styles.rowDate}>{formatDate(item.createdAt)}</Text>
                    <View style={styles.rowChipRow}>
                      <View
                        style={
                          isDraft ? styles.chipAmber : styles.chipGold
                        }>
                        <Text
                          style={
                            isDraft ? styles.chipAmberText : styles.chipGoldText
                          }>
                          {isDraft ? 'DRAFT' : 'SUBMITTED'}
                        </Text>
                      </View>
                      <Text style={styles.rowState} numberOfLines={1}>
                        {humanizeState(item.currentState)}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionPrimary]}
                    onPress={() =>
                      navigation.navigate(
                        IMMUTABLE_STATES.has(item.currentState) ? 'SealedResult' : 'Result',
                        {submissionId: item.id}
                      )
                    }>
                    <Text style={styles.actionPrimaryText}>
                      {editable ? 'CONTINUE EDITING' : 'VIEW SUBMISSION'}
                    </Text>
                  </TouchableOpacity>
                  {deletable && (
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => handleDelete(item)}>
                      <Text style={styles.deleteText}>DELETE</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: T.bgApp},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 16,
  },
  backBtn: {flex: 1},
  title: {
    flex: 2,
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 4,
    textAlign: 'center',
  },
  headerRight: {flex: 1},
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {fontSize: 40, marginBottom: 16},
  emptyTitle: {
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
  },
  emptyBody: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 24,
  },
  startBtn: {
    borderWidth: 1,
    borderColor: T.gold,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  startBtnText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
  },
  list: {padding: 16, paddingBottom: 40},
  row: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  rowEditable: {
    borderColor: T.borderGold,
  },
  rowTap: {
    flexDirection: 'row',
  },
  thumbFrameOuter: {
    borderWidth: 1,
    borderColor: T.borderGoldStrong,
    borderRadius: 10,
    backgroundColor: T.bgSurface,
    padding: 2,
    marginRight: 12,
  },
  thumbFrameInner: {
    borderWidth: 1,
    borderColor: T.borderGold,
    borderRadius: 7,
    overflow: 'hidden',
  },
  thumb: {
    width: 64,
    height: 92,
    backgroundColor: '#222',
  },
  thumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlaceholder: {
    color: T.borderGoldStrong,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  rowBody: {flex: 1, justifyContent: 'center', gap: 4},
  rowTitle: {
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 13,
    marginBottom: 2,
  },
  rowDate: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1,
  },
  rowChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  chipGold: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.borderGoldStrong,
    backgroundColor: 'rgba(232,196,74,0.1)',
  },
  chipGoldText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  chipAmber: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(232,160,0,0.5)',
    backgroundColor: 'rgba(232,160,0,0.08)',
  },
  chipAmberText: {
    color: T.amber,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  rowState: {
    flex: 1,
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: T.border,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  actionPrimary: {
    borderWidth: 1,
    borderColor: T.borderGoldStrong,
    backgroundColor: 'rgba(232,196,74,0.08)',
  },
  actionPrimaryText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700',
  },
  deleteText: {
    color: '#C8102E',
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700',
  },
});
