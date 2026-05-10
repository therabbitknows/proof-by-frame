// AssessmentPage.tsx
// Page 2 of the result-screen wizard (ASSESSMENT · 2/4)
//
// Layout order, top → bottom (3 cards instead of 4 — identity + details
// merged 2026-04-25 to minimize scrolling):
//   1. PROOF GRADE ASSESSMENT — per-house assessment ceiling + centering
//                               (PSA / BGS / CGC / TAG always rendered as
//                               distinct rows, placeholder when absent)
//   2. PROOF SUBMISSION       — merged card. Identity facts (Player,
//                               Year·Set, Card #, Variation, Rarity)
//                               + submission summary (Card, Type, Stage)
//                               + condition notes (Corners, Edges,
//                               Surface, Centering, Other notes).
//                               Empty rows are conditionally hidden.
//                               OCR confidence dropped per user direction.
//   3. LEGAL DISCLOSURE       — brand non-affiliation + locked-vocab
//                               disclaimer required on any assessment
//                               surface (proof_copy_rules memory)
//
// Vocabulary: locked per OCR_CONDITION_PIPELINE_KB v2.1 +
// proof_copy_rules.md. PROOF Grade Assessment / Assessment Ceiling /
// Estimated Equivalent Range. Never "official grade" / "guaranteed
// grade" / "predicted PSA grade" / "will grade" — those phrases create
// legal exposure and are explicitly disallowed.

import React from 'react';
import {View, Text, ScrollView, StyleSheet} from 'react-native';
import {T} from '../constants/tokens';

// ──────────────────────────────────────────────────────────────
// Types — JSON shape returned by the backend's OCR endpoint
// ──────────────────────────────────────────────────────────────

export interface OcrIdentity {
  player_name?: string | null;
  year?: string | number | null;
  manufacturer?: string | null;    // Topps / Panini / Bandai / Upper Deck …
  set_name?: string | null;        // e.g. "2023 Topps Chrome Update"
  card_number?: string | null;     // e.g. "USC-12" / "543"
  variation?: string | null;       // parallel / refractor / Young Guns / Alt Art
  rarity_flag?: 'base' | 'SP' | 'SSP' | 'USP' | null;
  printing_uuid?: string | null;
  confidence?: number | null;      // 0.0 – 1.0
}

export interface AiInitialReadGrade {
  company: 'PSA' | 'BGS' | 'CGC' | 'TAG';
  value: string;                   // "10" | "9.5 Gem Mint" | "10 Gem Mint" …
}

export interface AiInitialRead {
  grades: AiInitialReadGrade[];    // already deduped by ShareCard spec
  centering_lr?: number | string | null;
  centering_tb?: number | string | null;
}

export interface SubmissionNotes {
  card: string;                    // user description
  type: string;                    // "Card" | "Slab" | "Sealed" …
  stage: string;                   // e.g. "Community voting open"
  corners?: string | null;
  edges?: string | null;
  surface?: string | null;
  centering?: string | null;
  other_notes?: string | null;
}

export interface AssessmentPageProps {
  identity: OcrIdentity | null;     // null while OCR still in flight
  initialRead: AiInitialRead | null;
  notes: SubmissionNotes;
  ocrPending?: boolean;             // true → show pending state on identity card
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

const PLACEHOLDER = '—';

// Canonical grading-house order. Always rendered in this order so the
// layout doesn't shuffle as different submissions populate different
// subsets of the matrix.
const GRADING_HOUSES: Array<AiInitialReadGrade['company']> = [
  'PSA',
  'BGS',
  'CGC',
  'TAG',
];

const formatCentering = (
  lr?: number | string | null,
  tb?: number | string | null,
): string => {
  if (lr == null && tb == null) return PLACEHOLDER;
  const left = lr != null ? `LR ${lr}` : `LR ${PLACEHOLDER}`;
  const right = tb != null ? `TB ${tb}` : `TB ${PLACEHOLDER}`;
  return `${left} · ${right}`;
};

const formatYearSet = (id: OcrIdentity): string => {
  const parts: string[] = [];
  if (id.year) parts.push(String(id.year));
  if (id.manufacturer) parts.push(id.manufacturer);
  if (id.set_name) parts.push(id.set_name);
  return parts.length > 0 ? parts.join(' · ') : PLACEHOLDER;
};

const formatVariation = (id: OcrIdentity): string => {
  const parts: string[] = [];
  if (id.variation) parts.push(id.variation);
  if (id.rarity_flag && id.rarity_flag !== 'base') parts.push(id.rarity_flag);
  return parts.length > 0 ? parts.join(' · ') : 'Base';
};

const formatConfidence = (c?: number | null): string =>
  c == null ? PLACEHOLDER : `${Math.round(c * 100)}%`;

// ──────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────

interface RowProps {
  label: string;
  value: string | null | undefined;
  emphasis?: 'gold' | 'plain';
  multiline?: boolean;
}

const Row: React.FC<RowProps> = ({label, value, emphasis = 'plain', multiline = false}) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text
      style={[
        styles.rowValue,
        emphasis === 'gold' && styles.rowValueGold,
        multiline && styles.rowValueMultiline,
      ]}
      numberOfLines={multiline ? 0 : 2}
    >
      {value ?? PLACEHOLDER}
    </Text>
  </View>
);

// ──────────────────────────────────────────────────────────────
// Cards
// ──────────────────────────────────────────────────────────────

const AiAssessmentCard: React.FC<{read: AiInitialRead | null}> = ({read}) => {
  // Index incoming grades by company so we can render every house in the
  // canonical order even when only a subset has values. Missing houses
  // show PLACEHOLDER — keeps the matrix stable across submissions.
  const byCompany = new Map<AiInitialReadGrade['company'], string>(
    (read?.grades ?? []).map((g: AiInitialReadGrade) => [g.company, g.value]),
  );

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>PROOF GRADE ASSESSMENT</Text>

      <Text style={styles.subTitle}>
        ASSESSMENT CEILING — ESTIMATED EQUIVALENT RANGE
      </Text>
      {GRADING_HOUSES.map(house => {
        const value = byCompany.get(house);
        return (
          <Row
            key={house}
            label={house}
            value={value ?? PLACEHOLDER}
            emphasis={value ? 'gold' : 'plain'}
          />
        );
      })}

      <Text style={[styles.subTitle, {marginTop: 16}]}>CENTERING</Text>
      <Text style={styles.centeringLine}>
        {formatCentering(read?.centering_lr, read?.centering_tb)}
      </Text>
    </View>
  );
};

// Merged Identity + Submission card. Replaces the prior two-card layout
// (CardIdentityCard + SubmissionDetailsCard) per user direction
// 2026-04-25 — minimizes scrolling on Page 2 by collapsing related
// fields into a single PROOF SUBMISSION card. Empty rows are
// conditionally suppressed so the card grows / shrinks with the data
// the user actually has.
//
// State branches:
//   - pending=true → "Reading card details…" pending blurb at the top,
//     submission rows still render below if present
//   - identity empty + pending=false → small "could not auto-extract"
//     blurb at the top, submission rows render below
//   - identity present → identity rows render at top (gold-emphasized
//     player / rarity), submission rows below, condition notes last
//
// OCR confidence intentionally NOT shown — the % was internal-debug
// noise that didn't help users decide anything actionable.
const ProofSubmissionCard: React.FC<{
  identity: OcrIdentity | null;
  notes: SubmissionNotes;
  pending?: boolean;
}> = ({identity, notes, pending}) => {
  const hasIdentity = !!(
    identity &&
    (identity.player_name || identity.set_name || identity.card_number)
  );

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>PROOF SUBMISSION</Text>

      {pending && (
        <Text style={styles.pendingText}>
          Reading card details — this usually takes a few seconds.
        </Text>
      )}

      {!pending && !hasIdentity && (
        <Text style={styles.pendingText}>
          Card identity could not be auto-extracted. Community voting
          will proceed on visual condition only; you can edit identity
          details before voting closes.
        </Text>
      )}

      {hasIdentity && identity && (
        <>
          <Row label="Player"     value={identity.player_name}   emphasis="gold" />
          <Row label="Year · Set" value={formatYearSet(identity)} />
          <Row label="Card #"     value={identity.card_number} />
          <Row label="Variation"  value={formatVariation(identity)} />
          {identity.rarity_flag && identity.rarity_flag !== 'base' && (
            <Row label="Rarity"   value={identity.rarity_flag} emphasis="gold" />
          )}
        </>
      )}

      {/* Submission summary — always rendered. Card / Type / Stage
          are populated for every submission. */}
      <Row label="Card"  value={notes.card} />
      <Row label="Type"  value={notes.type} />
      <Row label="Stage" value={notes.stage} />

      {/* Condition notes — only render rows that have a value.
          Reduces visual clutter on submissions where the user didn't
          enter notes for every field. */}
      {notes.corners && <Row label="Corners" value={notes.corners} />}
      {notes.edges && <Row label="Edges" value={notes.edges} />}
      {notes.surface && <Row label="Surface" value={notes.surface} />}
      {notes.centering && <Row label="Centering" value={notes.centering} />}
      {notes.other_notes && (
        <Row label="Other notes" value={notes.other_notes} multiline />
      )}
    </View>
  );
};

// Legal disclosure required on every assessment surface per the locked
// proof_copy_rules memory. The first paragraph is the canonical
// disclaimer text (verbatim from OCR_CONDITION_PIPELINE_KB v2.1). The
// second paragraph extends it to brand non-affiliation — PROOF is a
// complementary, independent assessment tool.
const LegalDisclosureCard: React.FC = () => (
  <View style={styles.disclosureCard}>
    <Text style={styles.disclosureTitle}>NOT AN OFFICIAL GRADE</Text>
    <Text style={styles.disclosureBody}>
      PROOF Grade Assessment is an internal condition assessment based on
      image analysis, reference data, and community consensus. It is not
      an official grade and does not guarantee any outcome from PSA, BGS,
      TAG, or CGC.
    </Text>
    <Text style={[styles.disclosureBody, styles.disclosureBodySpaced]}>
      PROOF is an independent, complementary assessment tool. We are not
      affiliated with — nor endorsed by — any grading company (PSA, BGS,
      CGC, TAG) or trading-card manufacturer (Topps, Panini, Upper Deck,
      Bandai, or others). All third-party brand names appear here for
      reference only. Submitting your card for official grading remains a
      separate process with the grading company of your choice.
    </Text>
  </View>
);

// ──────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────

export const AssessmentPage: React.FC<AssessmentPageProps> = ({
  identity,
  initialRead,
  notes,
  ocrPending = false,
}) => {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <AiAssessmentCard read={initialRead} />
      <ProofSubmissionCard
        identity={identity}
        notes={notes}
        pending={ocrPending}
      />
      <LegalDisclosureCard />
    </ScrollView>
  );
};

export default AssessmentPage;

// ──────────────────────────────────────────────────────────────
// Styles — token-driven; canonical brand tokens live in
// src/constants/tokens.ts as the flat `T` object. Fonts use the
// app-wide `monospace` family + numeric fontWeight for bold,
// matching the pattern in ResultScreen / ConditionScreen / HomeScreen.
// ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: T.bgApp,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },

  // Card container
  card: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.borderGold,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 2,
    color: T.gold,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  subTitle: {
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1.5,
    color: T.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },

  centeringLine: {
    fontFamily: 'monospace',
    fontSize: 16,
    color: T.textPrimary,
  },

  // Row (key/value)
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
  },
  rowLabel: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: T.textSecondary,
    flex: 1,
    paddingRight: 12,
  },
  rowValue: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 14,
    color: T.textPrimary,
    flex: 2,
    textAlign: 'right',
  },
  rowValueGold: {
    color: T.gold,
  },
  rowValueMultiline: {
    textAlign: 'right',
    flexShrink: 1,
  },

  // Pending / empty state
  pendingText: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
    color: T.textSecondary,
    fontStyle: 'italic',
  },

  // Legal disclosure card — visually distinct from data cards. No gold
  // border, muted text, smaller copy. Intentionally less prominent so it
  // reads as fine-print without screaming for attention; still legible.
  disclosureCard: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.border,
    padding: 16,
    marginBottom: 16,
  },
  disclosureTitle: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 2,
    color: T.textMuted,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  disclosureBody: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    color: T.textMuted,
  },
  disclosureBodySpaced: {
    marginTop: 10,
  },
});
