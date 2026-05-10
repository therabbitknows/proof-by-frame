// SharePage.tsx
// Page 4 — SHARE — wires the rendered ShareCard component to a real PNG share.
//
// Captures the on-screen ShareCard View as a PNG via react-native-view-shot,
// then hands that file URI to react-native-share so the user can post the
// branded snapshot to X / Twitter / Discord / DM.
//
// Variant flow:
//   1. User taps SHARE SNAPSHOT.
//   2. Bottom sheet opens: COMPACT (default) | FULL | CANCEL.
//   3. On select, the corresponding ShareCard variant is rendered off-screen,
//      captured at 2x density, and passed to the system image share sheet.
//
// Both variants are rendered to an off-screen container so we never have to
// re-mount the visible card; this keeps the on-screen preview stable while the
// captured image always reflects the chosen variant at full fidelity.
//
// Blink integration: ShareCard's QR encodes a vote Blink URL
// (e.g. `https://proofbyframe.com/blinkitem/vote/<id>`). Anyone who scans
// the shared image opens the vote action in their Solana wallet —
// one-tap social voting from a Twitter / X / DM share. No extra code
// here; just pass the right `qrUrl` in `data`.
//
// Native deps required (must be installed + autolinked before this
// screen will run):
//   - react-native-view-shot
//   - react-native-share

import React, {useCallback, useRef, useState} from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import {captureRef} from 'react-native-view-shot';
import Share from 'react-native-share';
import {T} from '../constants/tokens';
import {
  ShareCard,
  ShareCardProps,
  ShareCardVariant,
} from '../components/ShareCard';

type ShareCardData = Omit<ShareCardProps, 'variant'>;

export interface SharePageProps {
  data: ShareCardData;
  onNewSubmission: () => void;
  onBackHome: () => void;
}

// ──────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────

export const SharePage: React.FC<SharePageProps> = ({
  data,
  onNewSubmission,
  onBackHome,
}) => {
  // Visible preview (compact by default — matches design spec)
  const previewRef = useRef<View>(null);

  // Off-screen render targets for each variant — used for capture only
  const compactCaptureRef = useRef<View>(null);
  const fullCaptureRef = useRef<View>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState<ShareCardVariant | null>(null);

  const captureAndShare = useCallback(
    async (variant: ShareCardVariant) => {
      const target = variant === 'compact' ? compactCaptureRef : fullCaptureRef;
      if (!target.current) {
        Alert.alert('Share', 'Snapshot not ready yet — please try again.');
        return;
      }
      setBusy(variant);
      try {
        const uri = await captureRef(target, {
          format: 'png',
          quality: 1,
          result: 'tmpfile',
          // 2x for crisp output (375pt × 2 ≈ 750px) — per ShareCard spec
          // width/height not set — captures at native layout × pixelRatio
        });
        await Share.open({
          url: uri.startsWith('file://') ? uri : `file://${uri}`,
          type: 'image/png',
          failOnCancel: false,
          // No `message` — image-only share, no text-channel fallback
        });
      } catch (err: unknown) {
        // react-native-share throws on user cancel even with failOnCancel:false on some versions;
        // swallow cancels, surface real errors only.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/cancel/i.test(msg)) {
          Alert.alert('Share failed', msg);
        }
      } finally {
        setBusy(null);
        setSheetOpen(false);
      }
    },
    [],
  );

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionLabel}>SHAREABLE SNAPSHOT</Text>
        <Text style={styles.subText}>
          Capture a branded PROOF card to share on X / Discord / DMs. The
          embedded QR opens the vote action directly in any Solana wallet —
          one-tap kickoff for social voting.
        </Text>

        {/* Visible preview — compact variant */}
        <View ref={previewRef} collapsable={false} style={styles.previewWrap}>
          <ShareCard {...data} variant="compact" />
        </View>

        {/* Action buttons */}
        <Pressable
          style={({pressed}) => [styles.btnPrimary, pressed && styles.pressed]}
          onPress={() => setSheetOpen(true)}
          disabled={busy !== null}
        >
          <Text style={styles.btnPrimaryText}>SHARE SNAPSHOT</Text>
        </Pressable>

        <Pressable
          style={({pressed}) => [styles.btnSecondary, pressed && styles.pressed]}
          onPress={onNewSubmission}
        >
          <Text style={styles.btnSecondaryText}>NEW SUBMISSION</Text>
        </Pressable>

        <Pressable style={styles.btnTertiary} onPress={onBackHome}>
          <Text style={styles.btnTertiaryText}>BACK TO HOME</Text>
        </Pressable>
      </ScrollView>

      {/* ─────────  Off-screen capture targets  ─────────
          Positioned far off-screen so they render to a real native view tree
          (required by view-shot) but never appear to the user. */}
      <View style={styles.offscreen} pointerEvents="none">
        <View ref={compactCaptureRef} collapsable={false} style={styles.offscreenCard}>
          <ShareCard {...data} variant="compact" />
        </View>
        <View ref={fullCaptureRef} collapsable={false} style={styles.offscreenCard}>
          <ShareCard {...data} variant="full" />
        </View>
      </View>

      {/* ─────────  Variant bottom sheet  ───────── */}
      {sheetOpen && (
        <View style={styles.sheetBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => !busy && setSheetOpen(false)}
          />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>CHOOSE SNAPSHOT LAYOUT</Text>
            <Text style={styles.sheetSubtitle}>
              Default is compact. Full stacks front and back for a taller share image.
            </Text>

            <Pressable
              style={({pressed}) => [
                styles.sheetOption, styles.sheetOptionPrimary, pressed && styles.pressed,
              ]}
              onPress={() => captureAndShare('compact')}
              disabled={busy !== null}
            >
              {busy === 'compact' ? (
                <ActivityIndicator color={T.gold} />
              ) : (
                <>
                  <Text style={styles.sheetOptionTitle}>COMPACT</Text>
                  <Text style={styles.sheetOptionBody}>
                    Side-by-side front and back in one portrait card.
                  </Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={({pressed}) => [
                styles.sheetOption, styles.sheetOptionSecondary, pressed && styles.pressed,
              ]}
              onPress={() => captureAndShare('full')}
              disabled={busy !== null}
            >
              {busy === 'full' ? (
                <ActivityIndicator color={T.gold} />
              ) : (
                <>
                  <Text style={styles.sheetOptionTitle}>FULL</Text>
                  <Text style={styles.sheetOptionBody}>
                    Front full width with back stacked below.
                  </Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={styles.sheetCancel}
              onPress={() => setSheetOpen(false)}
              disabled={busy !== null}
            >
              <Text style={styles.sheetCancelText}>CANCEL</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
};

export default SharePage;

// ──────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: T.bgApp,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  sectionLabel: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 2,
    color: T.gold,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  subText: {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 20,
    color: T.textSecondary,
    marginBottom: 12,
  },
  previewWrap: {
    marginBottom: 8,
  },

  // Buttons
  btnPrimary: {
    backgroundColor: T.gold,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 2,
    color: T.bgApp,
  },
  btnSecondary: {
    backgroundColor: 'transparent',
    borderColor: T.gold,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnSecondaryText: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 2,
    color: T.gold,
  },
  btnTertiary: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnTertiaryText: {
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 1.5,
    color: T.textMuted,
  },
  pressed: {
    opacity: 0.85,
  },

  // Off-screen capture surface — rendered, never visible
  offscreen: {
    position: 'absolute',
    left: -10000,
    top: 0,
    width: 380, // matches design width; capture pixel ratio handles density
  },
  offscreenCard: {
    width: 380,
    marginBottom: 20,
  },

  // Bottom sheet
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: T.bgApp,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopColor: T.gold,
    borderTopWidth: 1,
    padding: 20,
    paddingBottom: 30,
    gap: 12,
  },
  sheetTitle: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 2,
    color: T.gold,
    textAlign: 'center',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sheetSubtitle: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 18,
    color: T.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
  },
  sheetOption: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    minHeight: 76,
    justifyContent: 'center',
  },
  sheetOptionPrimary: {
    borderColor: T.gold,
    backgroundColor: 'transparent',
  },
  sheetOptionSecondary: {
    borderColor: T.borderGold,
    backgroundColor: T.bgSurface,
  },
  sheetOptionTitle: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 2,
    color: T.gold,
    marginBottom: 4,
  },
  sheetOptionBody: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: T.textSecondary,
  },
  sheetCancel: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  sheetCancelText: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 2,
    color: T.textMuted,
  },
});
