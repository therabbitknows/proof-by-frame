// ShareCard.tsx
// Page 4 — SHARE — branded snapshot card.
//
// Renders all the metadata a Discord/X/Twitter share needs in one
// captureable View:
//   • PROOF centering-mark logo + PROOF wordmark + BY FRAME
//   • Status pill (COMMUNITY VOTING OPEN / SEALED / etc.)
//   • Live Capture / Uploaded badge
//   • Submission ID (first 8 chars)
//   • FRONT / BACK card image grid
//   • Card name + type
//   • PROOF Grade Assessment (per-house) + CENTERING side-by-side
//   • Submitter note callout (≤120 chars)
//   • Tagline (locked: "Community consensus. Before the slab.")
//   • QR code → vote Blink URL — "scan to vote" (was Discord thread URL
//     in the pre-Blinks design; the Blink unfurls the vote action
//     directly in any wallet)
//   • BETA TESTER badge
//   • COMPACT vs FULL layout variants
//
// Capture: this component exposes a ref. Caller does:
//   const ref = useRef<View>(null);
//   const uri = await captureRef(ref, { format: 'png', result: 'tmpfile', quality: 1 });
//   await Share.open({ url: 'file://' + uri, type: 'image/png' });
//
// Vocabulary: locked per OCR_CONDITION_PIPELINE_KB v2.1 +
// proof_copy_rules.md. PROOF Grade Assessment / Estimated Equivalent
// Range. Never "official grade" / "guaranteed grade" — those create
// legal exposure and are explicitly disallowed.

import React, {forwardRef} from 'react';
import {View, Text, Image, StyleSheet} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {T} from '../constants/tokens';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export type ShareCardVariant = 'compact' | 'full';

export type SubmissionStage =
  | 'pre_vote'
  | 'community_voting'
  | 'review_complete'
  | 'sealed'
  | 'archived';

export type CaptureSource = 'live_capture' | 'uploaded';

export interface ShareCardGrade {
  company: 'PSA' | 'BGS' | 'CGC' | 'TAG';
  value: string; // e.g. "10", "9.5 Gem Mint", "10 Gem Mint"
}

export interface ShareCardProps {
  variant: ShareCardVariant;
  submissionId: string;            // full UUID; first 8 chars rendered
  stage: SubmissionStage;
  captureSource: CaptureSource;

  cardName: string;                // user description, e.g. "Test"
  cardType: string;                // e.g. "Card"

  frontImageUri: string;
  backImageUri: string;

  initialRead: ShareCardGrade[];   // already deduped per ShareCard spec
  centeringLR?: number | string | null;
  centeringTB?: number | string | null;

  submitterNote?: string | null;
  isBetaTester?: boolean;

  /**
   * Vote Blink URL for the embedded QR code. Canonical shape:
   *   `https://proofbyframe.com/blinkitem/vote/<submission_id>`
   *
   * Anyone who scans the QR off a shared image opens the vote action in
   * their Solana wallet — one-tap social voting from a Twitter / X / DM
   * share. If null, the QR code is hidden (e.g. for sealed submissions
   * where voting is closed).
   *
   * Pre-Blinks this prop pointed at a Discord thread URL. Both URLs are
   * accepted for backwards compatibility — but the Blink form is the
   * one that unfurls into a signing UI in Phantom / Solflare / Backpack.
   */
  qrUrl?: string | null;
}

// ──────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────

const TAGLINE = 'Community consensus. Before the slab.';
const SUBMITTER_NOTE_MAX = 120;
const SUBMISSION_ID_LEN = 8;

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

const formatGradeLine = (grades: ShareCardGrade[]): string =>
  grades.map(g => `${g.company} ${g.value}`).join(' | ');

const formatCentering = (
  lr?: number | string | null,
  tb?: number | string | null,
): string => {
  if (lr == null && tb == null) return '—';
  return `LR ${lr ?? '—'} · TB ${tb ?? '—'}`;
};

const truncateNote = (note: string): string =>
  note.length > SUBMITTER_NOTE_MAX
    ? note.slice(0, SUBMITTER_NOTE_MAX - 1).trimEnd() + '…'
    : note;

const stagePillCopy = (stage: SubmissionStage): string => {
  switch (stage) {
    case 'pre_vote':         return 'PRE-VOTE';
    case 'community_voting': return 'COMMUNITY VOTING OPEN';
    case 'review_complete':  return 'REVIEW COMPLETE';
    case 'sealed':           return 'SEALED';
    case 'archived':         return 'ARCHIVED';
  }
};

const stagePillTone = (stage: SubmissionStage): 'gold' | 'green' | 'muted' => {
  if (stage === 'sealed') return 'green';
  if (stage === 'community_voting' || stage === 'review_complete') return 'gold';
  return 'muted';
};

// ──────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────

/** Centering-mark logo — rounded gold square with concentric ring + dot. */
const ProofMark: React.FC = () => (
  <View style={mark.outer}>
    <View style={mark.ring}>
      <View style={mark.dot} />
    </View>
  </View>
);

const Pill: React.FC<{label: string; tone: 'gold' | 'green' | 'muted'}> = ({label, tone}) => (
  <View style={[pill.base, pill[tone]]}>
    <Text style={[pill.label, tone === 'green' && pill.labelGreen]} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

const SectionLabel: React.FC<{children: React.ReactNode}> = ({children}) => (
  <Text style={styles.sectionLabel}>{children}</Text>
);

// ──────────────────────────────────────────────────────────────
// ShareCard (forwardRef so caller can captureRef on the View)
// ──────────────────────────────────────────────────────────────

export const ShareCard = forwardRef<View, ShareCardProps>((props, ref) => {
  const {
    variant,
    submissionId,
    stage,
    captureSource,
    cardName,
    cardType,
    frontImageUri,
    backImageUri,
    initialRead,
    centeringLR,
    centeringTB,
    submitterNote,
    isBetaTester = false,
    qrUrl,
  } = props;

  const idShort = submissionId.slice(0, SUBMISSION_ID_LEN).toUpperCase();
  const stagePill = stagePillCopy(stage);
  const stageTone = stagePillTone(stage);

  return (
    <View ref={ref} collapsable={false} style={styles.cardOuter}>
      {/* ─────────────  Header  ───────────── */}
      <View style={styles.header}>
        <ProofMark />
        <View style={styles.wordmarkBlock}>
          <Text style={styles.wordmark}>PROOF</Text>
          <Text style={styles.byFrame}>BY FRAME</Text>
        </View>
        <View style={styles.headerStatus}>
          <Pill label={stagePill} tone={stageTone} />
        </View>
      </View>

      {/* ─────────────  Source + ID row  ───────────── */}
      <View style={styles.metaRow}>
        <Pill
          label={captureSource === 'live_capture' ? 'LIVE CAPTURE' : 'UPLOADED'}
          tone="green"
        />
        <Text style={styles.idText}>{idShort}</Text>
      </View>

      {/* ─────────────  Image grid  ───────────── */}
      {variant === 'compact' ? (
        <View style={styles.imagesRow}>
          <View style={styles.imageBlockHalf}>
            <SectionLabel>FRONT</SectionLabel>
            <View style={styles.imageFrame}>
              <Image source={{uri: frontImageUri}} style={styles.cardImage} resizeMode="contain" />
            </View>
          </View>
          <View style={styles.imageBlockHalf}>
            <SectionLabel>BACK</SectionLabel>
            <View style={styles.imageFrame}>
              <Image source={{uri: backImageUri}} style={styles.cardImage} resizeMode="contain" />
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.imagesStack}>
          <View style={styles.imageBlockFull}>
            <SectionLabel>FRONT</SectionLabel>
            <View style={[styles.imageFrame, styles.imageFrameTall]}>
              <Image source={{uri: frontImageUri}} style={styles.cardImage} resizeMode="contain" />
            </View>
          </View>
          <View style={styles.imageBlockFull}>
            <SectionLabel>BACK</SectionLabel>
            <View style={[styles.imageFrame, styles.imageFrameTall]}>
              <Image source={{uri: backImageUri}} style={styles.cardImage} resizeMode="contain" />
            </View>
          </View>
        </View>
      )}

      {/* ─────────────  Card name  ───────────── */}
      <View style={styles.namePanel}>
        <Text style={styles.cardName}>{cardName}</Text>
        <Text style={styles.cardType}>{cardType}</Text>
      </View>

      {/* ─────────────  Initial read + Centering  ───────────── */}
      <View style={styles.assessRow}>
        <View style={styles.assessBlock}>
          <SectionLabel>PROOF GRADE ASSESSMENT</SectionLabel>
          <Text style={styles.gradeText}>
            {initialRead.length > 0 ? formatGradeLine(initialRead) : '—'}
          </Text>
        </View>
        <View style={styles.assessBlock}>
          <SectionLabel>CENTERING</SectionLabel>
          <Text style={styles.centeringText}>
            {formatCentering(centeringLR, centeringTB)}
          </Text>
        </View>
      </View>

      {/* ─────────────  Submitter note  ───────────── */}
      {submitterNote && submitterNote.trim().length > 0 && (
        <View style={styles.notePanel}>
          <SectionLabel>SUBMITTER NOTE</SectionLabel>
          <Text style={styles.noteText}>{truncateNote(submitterNote.trim())}</Text>
        </View>
      )}

      {/* ─────────────  Tagline + QR + BETA badge  ─────────────
          QR encodes the vote Blink URL by default — anyone who scans
          the shared image opens the vote action in their Solana wallet
          and signs in one tap. "SCAN TO VOTE" caption makes the
          affordance explicit on the rendered snapshot. */}
      <View style={styles.footer}>
        <View style={styles.taglinePanel}>
          <Text style={styles.tagline}>{TAGLINE}</Text>
          {isBetaTester && (
            <View style={styles.betaBadge}>
              <Text style={styles.betaBadgeText}>BETA TESTER</Text>
            </View>
          )}
        </View>
        {qrUrl ? (
          <View style={styles.qrColumn}>
            <View style={styles.qrFrame}>
              <QRCode
                value={qrUrl}
                size={64}
                color={T.gold}
                backgroundColor="transparent"
              />
            </View>
            <Text style={styles.qrCaption}>SCAN TO VOTE</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

ShareCard.displayName = 'ShareCard';

export default ShareCard;

// ──────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────

const GOLD_BORDER = T.borderGold;

const styles = StyleSheet.create({
  cardOuter: {
    backgroundColor: T.bgApp,
    borderColor: T.gold,
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 18,
    gap: 16,
    width: '100%',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  wordmarkBlock: {
    flex: 1,
  },
  wordmark: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 28,
    letterSpacing: 2,
    color: T.gold,
    lineHeight: 30,
  },
  byFrame: {
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 4,
    color: T.textMuted,
    marginTop: 2,
  },
  headerStatus: {
    alignItems: 'flex-end',
  },

  // Source + ID row
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  idText: {
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1.5,
    color: T.textSecondary,
  },

  // Image grid
  imagesRow: {
    flexDirection: 'row',
    gap: 10,
  },
  imagesStack: {
    flexDirection: 'column',
    gap: 12,
  },
  imageBlockHalf: {
    flex: 1,
    gap: 6,
  },
  imageBlockFull: {
    width: '100%',
    gap: 6,
  },
  imageFrame: {
    backgroundColor: '#000',
    borderColor: GOLD_BORDER,
    borderWidth: 1,
    borderRadius: 12,
    aspectRatio: 0.72,
    padding: 8,
    overflow: 'hidden',
  },
  imageFrameTall: {
    aspectRatio: 0.72,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },

  // Section label
  sectionLabel: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 2,
    color: T.textMuted,
    textTransform: 'uppercase',
  },

  // Name panel
  namePanel: {
    paddingTop: 4,
  },
  cardName: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 22,
    color: T.textPrimary,
    lineHeight: 26,
  },
  cardType: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: T.textSecondary,
    marginTop: 2,
  },

  // Assessment row
  assessRow: {
    flexDirection: 'row',
    gap: 10,
  },
  assessBlock: {
    flex: 1,
    backgroundColor: T.bgSurface,
    borderColor: GOLD_BORDER,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  gradeText: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 15,
    lineHeight: 21,
    color: T.gold,
  },
  centeringText: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 15,
    lineHeight: 21,
    color: T.textPrimary,
  },

  // Submitter note
  notePanel: {
    backgroundColor: T.bgSurface,
    borderColor: GOLD_BORDER,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  noteText: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 18,
    color: T.textPrimary,
  },

  // Footer (tagline + QR + beta)
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopColor: GOLD_BORDER,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
    gap: 12,
  },
  taglinePanel: {
    flex: 1,
    gap: 8,
  },
  tagline: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 18,
    color: T.textPrimary,
  },
  betaBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    borderColor: T.gold,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  betaBadgeText: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 9,
    letterSpacing: 1.5,
    color: T.gold,
  },
  qrColumn: {
    alignItems: 'center',
    gap: 6,
  },
  qrFrame: {
    backgroundColor: T.bgApp,
    borderColor: GOLD_BORDER,
    borderWidth: 1,
    borderRadius: 8,
    padding: 6,
  },
  qrCaption: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 8,
    letterSpacing: 1.5,
    color: T.gold,
  },
});

// ── Pill styles ──
const pill = StyleSheet.create({
  base: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  gold: {
    backgroundColor: 'transparent',
    borderColor: T.gold,
  },
  green: {
    backgroundColor: '#1FB95B',
    borderColor: '#1FB95B',
  },
  muted: {
    backgroundColor: 'transparent',
    borderColor: T.textMuted,
  },
  label: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 1.5,
    color: T.gold,
    textTransform: 'uppercase',
  },
  labelGreen: {
    color: '#FFFFFF',
  },
});

// ── PROOF centering-mark logo ──
const mark = StyleSheet.create({
  outer: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderColor: T.gold,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderColor: T.gold,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: T.red,
  },
});
