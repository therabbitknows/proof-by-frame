import React, {useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  RouteProp,
} from '@react-navigation/native';
import type {RootStackParamList} from '../navigation/RootNavigator';
import {T} from '../constants/tokens';
import {useSession} from '../hooks/useSession';
import {useDiscordAuth} from '../hooks/useDiscordAuth';
import {useLocalAuth} from '../hooks/useLocalAuth';
import {ApiService} from '../services/api';
import {evaluateCaptureGuard} from '../services/captureGuard';
import {QualityCheck} from '../components/QualityCheck';
import {saveSubmission, finalizeSubmission} from '../storage/submissions';
import type {Submission} from '../types/submission';

type Nav = any;

const STEPS = [
  'Creating submission...',
  'Uploading front image...',
  'Checking quality...',
  'Uploading back image...',
  'Submitting notes...',
  'Entering community voting...',
] as const;

type QualityData = {
  scores: {label: string; value: number}[];
  overallScore: number;
  recaptureHint?: string;
};

export const SubmissionScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'Submission'>>();
  const {frontUri, backUri, condition, baselines, cardLabel} = route.params ?? {
    frontUri: '',
    backUri: '',
    condition: {corners: ''},
  };
  const submissionDescription = (cardLabel && cardLabel.trim()) || 'Mobile card submission';
  const {walletPubkey, isAuthenticated} = useSession();
  const {accessStatus, discordUserId} = useDiscordAuth();
  const {activateLocalAuth} = useLocalAuth();

  // Resolve a stable submission identity. walletPubkey is the storage/API key.
  // If no wallet is resolved yet, mint a local keypair inline so the draft +
  // submit flow has something stable to key on. Demo Mode + unverified users
  // are allowed to submit (per onboarding policy: only voting + listing
  // require World ID). Real wallets (Phantom/MWA) take priority if they
  // connect later.
  const ensurePubkey = useCallback(async (): Promise<string | null> => {
    if (walletPubkey) return walletPubkey;
    try {
      return await activateLocalAuth();
    } catch {
      return null;
    }
  }, [walletPubkey, activateLocalAuth]);
  const [submitting, setSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [qualityData, setQualityData] = useState<QualityData | null>(null);
  const [qualityPaused, setQualityPaused] = useState(false);
  const [pendingSubmissionId, setPendingSubmissionId] = useState<string | null>(null);
  const [ocrCardName, setOcrCardName] = useState<string | null>(null);

  const bothReady = frontUri.length > 0 && backUri.length > 0;

  const parseQualityFromUpload = (data: any): QualityData | null => {
    const analysis = data?.analysis;
    if (!analysis) return null;
    const scores: {label: string; value: number}[] = [];
    if (analysis.card_present != null) scores.push({label: 'Card Present', value: analysis.card_present ? 100 : 0});
    if (analysis.sharpness != null) scores.push({label: 'Sharpness', value: Math.round(analysis.sharpness * 100)});
    if (analysis.glare_detected != null) scores.push({label: 'Glare', value: analysis.glare_detected ? 30 : 100});
    if (analysis.capture_quality != null) scores.push({label: 'Quality', value: Math.round(analysis.capture_quality * 100)});
    if (scores.length === 0) return null;
    const overall = Math.round(scores.reduce((s, x) => s + x.value, 0) / scores.length);
    return {scores, overallScore: overall, recaptureHint: analysis.recapture_hint};
  };

  // Extract an OCR-identified card name from the upload-front response.
  // Backend shape varies between "card_name" at the top level and nested
  // under ocr_result.front — try both. Returns null if OCR didn't identify.
  const parseCardNameFromUpload = (data: any): string | null => {
    const top = data?.card_name;
    if (typeof top === 'string' && top.trim() && top.trim().toLowerCase() !== 'card') {
      return top.trim();
    }
    const nested = data?.ocr_result?.front?.card_name;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
    const detected = data?.ocr_result?.front?.detected_text;
    if (typeof detected === 'string' && detected.trim()) return detected.trim();
    return null;
  };

  const persistLocally = useCallback(
    async (submissionId: string, pubkey: string) => {
      const record: Submission = {
        id: submissionId,
        description: submissionDescription,
        cardName: ocrCardName ?? undefined,
        cardType: baselines?.company ? 'graded' : 'raw',
        frontImageUri: frontUri,
        backImageUri: backUri,
        notes: {
          corners: condition?.corners || '',
          edges: condition?.edges || '',
          surface: condition?.surface || '',
          centering: condition?.centering || '',
          other: condition?.other || '',
        },
        baselines: baselines?.company
          ? [
              {
                company: baselines.company,
                label: baselines.grade || '',
                certNumber: baselines.certNumber,
              },
            ]
          : [],
        currentState: 'community_voting',
        status: 'draft',
        createdAt: Date.now(),
      };
      await saveSubmission(record, pubkey);
      await finalizeSubmission(submissionId, pubkey);
    },
    [frontUri, backUri, condition, baselines, ocrCardName],
  );

  const continueAfterQuality = useCallback(async () => {
    if (!pendingSubmissionId) return;
    const pubkey = await ensurePubkey();
    if (!pubkey) {
      Alert.alert(
        'Beta access required',
        'Sign in with Discord so a PROOF operator can approve your submission.',
      );
      return;
    }
    setQualityPaused(false);
    setQualityData(null);
    try {
      // Step 3: Upload back image
      setCurrentStep(3);
      await ApiService.uploadBack(pendingSubmissionId, pubkey, backUri);

      // Step 4: Submit notes with real condition data
      setCurrentStep(4);
      await ApiService.submitNotes(pendingSubmissionId, {
        wallet_pubkey: pubkey,
        corners: condition?.corners || 'Not specified',
        edges: condition?.edges,
        surface: condition?.surface,
        centering: condition?.centering,
        other: condition?.other,
      });

      // Step 5: Submit for community voting
      setCurrentStep(5);
      await ApiService.submitForVoting(pendingSubmissionId, pubkey);

      await persistLocally(pendingSubmissionId, pubkey);
      navigation.navigate('Result', {submissionId: pendingSubmissionId});
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Unknown error';
      Alert.alert('Submission failed', detail);
    } finally {
      setSubmitting(false);
      setCurrentStep(0);
      setPendingSubmissionId(null);
    }
  }, [pendingSubmissionId, ensurePubkey, backUri, condition, navigation, persistLocally]);

  const handleSubmit = async () => {
    if (!bothReady) {
      Alert.alert('Missing images', 'Capture both front and back before submitting.');
      return;
    }
    // Beta-access gate is INFORMATIONAL for unverified users — submit/mint/bid
    // are open to demo + unverified accounts; only voting + listing require
    // World ID onboarding (per onboarding policy memo). Discord approval is
    // surfaced inside the app shell as a beta-operator approval channel, not
    // as a submission gate.
    if (accessStatus === 'rejected') {
      Alert.alert(
        'Access denied',
        'Your beta access was rejected. Contact the team on Discord if this is an error.',
      );
      return;
    }
    // Resolve a stable submission pubkey. If no wallet is connected, mint a
    // local keypair inline so the flow + draft storage have something to key
    // on. Real wallets take priority if connected later.
    const pubkey = await ensurePubkey();
    if (!pubkey) {
      Alert.alert(
        'Wallet unavailable',
        'Could not resolve a submission identity. Try Demo Mode from the home screen, or connect a wallet.',
      );
      return;
    }

    // Local pre-flight guard: quick on-device checks before upload so users
    // get immediate retake feedback instead of waiting on backend rejection.
    const guard = await evaluateCaptureGuard(frontUri, backUri, submissionDescription);
    console.log('[PROOF][guard] local preflight', guard);
    if (!guard.approved) {
      const reasonText = guard.reasons
        .map(reason => {
          switch (reason) {
            case 'front_unreadable':
              return 'Front image is too small/unclear';
            case 'back_unreadable':
              return 'Back image is too small/unclear';
            case 'possible_blur':
              return 'Capture appears blurry';
            case 'possible_non_card':
              return 'Card was not clearly detected';
            case 'possible_sensitive_text':
              return 'Possible sensitive non-card text detected';
            default:
              return reason;
          }
        })
        .join('\n• ');
      Alert.alert(
        'Retake recommended',
        `• ${reasonText}\n\nRetake both sides for best grading quality.`,
      );
      return;
    }

    setSubmitting(true);
    setCurrentStep(0);

    try {
      // Beta gate check — handled server-side. The old client-side
      // pre-check called GET /admin/allowlist/wallet-status which only
      // knows how to look up by wallet_pubkey and returned
      // status="unknown" for any wallet not explicitly whitelisted,
      // including wallets belonging to Discord-approved users whose
      // wallet hadn't been back-linked yet. That 'unknown' fired the
      // "wallet not approved" Alert and short-circuited the submit
      // before the request ever reached POST /api/submissions/create
      // — which meant Railway never saw the new Discord-primary gate
      // (backend 13e67aa). Removing the pre-check lets the real gate
      // run, auto-link the wallet on success, and surface a precise
      // error message on failure via the outer catch below.

      // Step 0: Create submission.
      // IMPORTANT: do NOT pass card_name here. The grading company+tier
      // (e.g. "PSA 9") is NOT the card's identity — it's a baseline label.
      // Backend OCR populates the real card_name ("1989 Fleer Michael
      // Jordan #57") during uploadFront below. Earlier versions sent
      // "PSA 9" as card_name which then overrode OCR's result and made
      // Vault/Result show the grading signature instead of the card.
      const createRes = await ApiService.createSubmission({
        wallet_pubkey: pubkey,
        description: submissionDescription,
        // Discord is the beta-access gatekeeper — send the user's Discord
        // ID so the backend can approve the submission based on Discord
        // allowlist status instead of requiring each new wallet to be
        // separately whitelisted.
        discord_user_id: discordUserId ?? undefined,
      });
      const submissionId = createRes.data.submission_id;
      setPendingSubmissionId(submissionId);

      // Step 1: Upload front image (triggers OCR analysis)
      setCurrentStep(1);
      const frontRes = await ApiService.uploadFront(submissionId, pubkey, frontUri);
      console.log('[PROOF][ocr] upload-front response keys', {
        keys: frontRes?.data ? Object.keys(frontRes.data) : [],
        hasAnalysis: !!frontRes?.data?.analysis,
        hasOcr: !!frontRes?.data?.ocr_result,
        cardName: frontRes?.data?.card_name,
      });
      const detectedName = parseCardNameFromUpload(frontRes.data);
      if (detectedName) {
        console.log('[PROOF][ocr] card_name detected', {cardName: detectedName});
        setOcrCardName(detectedName);
      }

      // Step 2: Quality is informational, NEVER a gate. The original
      // pause-on-low-score behavior blocked submission whenever backend
      // OCR couldn't detect a card (card_present=false → overall drops
      // below 70, recapture_hint set), forcing the user to manually tap
      // CONTINUE ANYWAY before every submission. That's the same anti-
      // pattern the identity-completeness gate had — locked card submits
      // because OCR was imperfect. Per the canonical UX: any captured
      // image goes through; OCR/assessment runs async on backend; user
      // refines on the Result screen if they want. Log the warning for
      // observability and proceed.
      setCurrentStep(2);
      const quality = parseQualityFromUpload(frontRes.data);
      if (quality && (quality.overallScore < 70 || quality.recaptureHint)) {
        console.log('[PROOF][quality] warning (non-blocking)', {
          overallScore: quality.overallScore,
          recaptureHint: quality.recaptureHint,
        });
      }
      // Continue directly to upload back — quality never blocks now
      // Step 3: Upload back image
      setCurrentStep(3);
      await ApiService.uploadBack(submissionId, pubkey, backUri);

      // Step 4: Submit notes with real condition data
      setCurrentStep(4);
      await ApiService.submitNotes(submissionId, {
        wallet_pubkey: pubkey,
        corners: condition?.corners || 'Not specified',
        edges: condition?.edges,
        surface: condition?.surface,
        centering: condition?.centering,
        other: condition?.other,
      });

      // Step 5: Submit for community voting.
      // Backend (frame-brain) no longer gates this transition on identity
      // completeness — partial OCR is acceptable; OCR async-updates the
      // submission record and the Discord thread reflects updates as they
      // land. If response includes `identity_warning`, log it for
      // observability but don't block.
      setCurrentStep(5);
      const votingRes = await ApiService.submitForVoting(submissionId, pubkey);
      if (votingRes?.data?.identity_warning) {
        console.log('[PROOF][submit] identity warning (non-blocking)', votingRes.data.identity_warning);
      }

      await persistLocally(submissionId, pubkey);
      navigation.navigate('Result', {submissionId});
    } catch (err: any) {
      // Backend HTTPException with a dict body (e.g. 409 missing_sides) lands
      // here as `detail: {message, ...}`. RN's Alert.alert crashes
      // ("ReadableNativeMap to String" UnexpectedNativeTypeException) if we
      // hand it the raw object — extract a message string defensively.
      const rawDetail = err?.response?.data?.detail;
      let detail: string;
      if (typeof rawDetail === 'string') {
        detail = rawDetail;
      } else if (rawDetail && typeof rawDetail === 'object') {
        detail =
          (typeof rawDetail.message === 'string' ? rawDetail.message : null) ||
          JSON.stringify(rawDetail);
      } else {
        detail = err?.message || 'Unknown error';
      }
      Alert.alert('Submission failed', detail);
    } finally {
      if (!qualityPaused) {
        setSubmitting(false);
        setCurrentStep(0);
        setPendingSubmissionId(null);
      }
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>FINAL REVIEW</Text>
        <Text style={styles.subtitle}>
          Ready to submit your card for community grading.
        </Text>

        {/* Thumbnail strip — signature PROOF double gold frame */}
        <View style={styles.thumbRow}>
          <View style={styles.thumbCol}>
            <Text style={styles.thumbLabel}>FRONT</Text>
            <View style={styles.thumbFrameOuter}>
              <View style={styles.thumbFrameInner}>
                <Image source={{uri: frontUri}} style={styles.thumb} resizeMode="cover" />
              </View>
            </View>
          </View>
          <View style={styles.thumbCol}>
            <Text style={styles.thumbLabel}>BACK</Text>
            <View style={styles.thumbFrameOuter}>
              <View style={styles.thumbFrameInner}>
                <Image source={{uri: backUri}} style={styles.thumb} resizeMode="cover" />
              </View>
            </View>
          </View>
        </View>

        {/* Condition summary */}
        {condition?.corners && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>CONDITION NOTES</Text>
            <Text style={styles.conditionText}>Corners: {condition.corners}</Text>
            {condition.edges && <Text style={styles.conditionText}>Edges: {condition.edges}</Text>}
            {condition.surface && <Text style={styles.conditionText}>Surface: {condition.surface}</Text>}
            {condition.centering && <Text style={styles.conditionText}>Centering: {condition.centering}</Text>}
          </View>
        )}

        {/* Quality check overlay */}
        {qualityPaused && qualityData && (
          <QualityCheck
            scores={qualityData.scores}
            overallScore={qualityData.overallScore}
            recaptureHint={qualityData.recaptureHint}
            onRetake={() => {
              setQualityPaused(false);
              setQualityData(null);
              setSubmitting(false);
              setPendingSubmissionId(null);
              navigation.navigate('Camera', {captureMode: 'front'});
            }}
            onContinue={continueAfterQuality}
          />
        )}

        {/* Progress steps */}
        {submitting && !qualityPaused && (
          <View style={styles.progressBlock}>
            {STEPS.map((label, i) => (
              <View key={i} style={styles.stepRow}>
                <Text
                  style={[
                    styles.stepText,
                    i < currentStep && styles.stepDone,
                    i === currentStep && styles.stepActive,
                    i > currentStep && styles.stepPending,
                  ]}>
                  {i < currentStep ? '\u2713 ' : i === currentStep ? '\u25B6 ' : '  '}
                  {label}
                </Text>
              </View>
            ))}
          </View>
        )}

        {!qualityPaused && (
          <>
            <TouchableOpacity
              style={[styles.submitBtn, (!bothReady || submitting) && styles.submitBtnDisabled]}
              disabled={!bothReady || submitting}
              onPress={handleSubmit}>
              {submitting ? (
                <ActivityIndicator color={T.bgApp} />
              ) : (
                <Text style={styles.submitBtnText}>SUBMIT TO PROOF</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              disabled={submitting}
              onPress={() => navigation.goBack()}>
              <Text style={styles.cancelBtnText}>GO BACK</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: T.bgApp},
  scroll: {padding: 20, paddingTop: 52, paddingBottom: 40},
  title: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 14,
    letterSpacing: 3,
    marginBottom: 8,
  },
  subtitle: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 24,
  },
  thumbRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  thumbCol: {flex: 1},
  thumbLabel: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 8,
  },
  thumbFrameOuter: {
    borderWidth: 1,
    borderColor: T.borderGoldStrong,
    borderRadius: 12,
    backgroundColor: T.bgSurface,
    padding: 3,
  },
  thumbFrameInner: {
    borderWidth: 1,
    borderColor: T.borderGold,
    borderRadius: 9,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    aspectRatio: 252 / 360,
    backgroundColor: '#222',
  },
  card: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  cardLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: 8,
  },
  conditionText: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    marginBottom: 4,
  },
  progressBlock: {
    marginTop: 8,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  stepRow: {marginBottom: 4},
  stepText: {
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
  },
  stepDone: {color: '#4CAF50'},
  stepActive: {color: T.gold},
  stepPending: {color: T.textMuted},
  submitBtn: {
    backgroundColor: T.gold,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  submitBtnDisabled: {opacity: 0.4},
  submitBtnText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 3,
    fontWeight: '700',
  },
  cancelBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelBtnText: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
  },
});
