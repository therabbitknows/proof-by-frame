import React, {useState, useEffect, useMemo, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  Dimensions,
} from 'react-native';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import {T} from '../constants/tokens';
import {ApiService} from '../services/api';
import {useSession} from '../hooks/useSession';
import type {RootStackParamList} from '../navigation/RootNavigator';

const {width: SCREEN_WIDTH} = Dimensions.get('window');
const CARD_ASPECT = 2.5 / 3.5;

type Nav = any;

export const SealedResultScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, 'SealedResult'>>();
  const {submissionId} = route.params;
  const {walletPubkey} = useSession();

  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSide, setActiveSide] = useState<'front' | 'back'>('front');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await ApiService.getSubmission(submissionId, walletPubkey ?? undefined);
      setStatus(res.data);
    } catch (err) {
      console.log('[PROOF][sealed] fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, [submissionId, walletPubkey]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const identity = useMemo(() => {
    const id = status?.card_identity || {};
    return {
      year: id.year || '—',
      manufacturer: id.manufacturer || '—',
      set: id.set || '—',
      cardNumber: id.card_number || '—',
      player: id.player || 'Card',
    };
  }, [status]);

  const revealUrl = useMemo(
    () => `https://proofbyframe.com/reveal/${submissionId}`,
    [submissionId],
  );

  const handleShare = useCallback(async () => {
    const cardName = status?.card_name || 'my PROOF-sealed card';
    try {
      await Share.share({
        message:
          `I sealed ${cardName} on PROOF.\n\n` +
          `Tap to view: ${revealUrl}\n\n` +
          `(Community-driven, on-chain provenance + condition record on Solana.)`,
        url: revealUrl,
      });
    } catch {
      // Share.share throws on user-cancel on Android; swallow.
    }
  }, [status, revealUrl]);

  if (loading || !status) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={T.gold} />
      </View>
    );
  }

  const imageUrl = `https://frame-brain-production.up.railway.app/api/submissions/${submissionId}/image/${activeSide}`;
  const askAmount = status?.marketplace?.ask_amount || status?.ask_amount;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Brand row */}
        <View style={styles.brandRow}>
          <Text style={styles.brandText}>PROOF · BY · FRAME</Text>
          <View style={styles.stateBadge}>
            <Text style={styles.stateBadgeText}>
              {(status.state || 'SEALED').replace(/_/g, ' ').toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Inner gold-rim card */}
        <View style={styles.cardContainer}>
          <View style={styles.goldFrame}>
            <View style={styles.innerContent}>
              {/* Card Title */}
              <Text style={styles.cardTitle}>{status.card_name || identity.player}</Text>

              {/* Identity Row */}
              <Text style={styles.identityRow}>
                {identity.year} · {identity.manufacturer} · {identity.set} · #{identity.cardNumber}
              </Text>

              {/* Photo tabs */}
              <View style={styles.tabRow}>
                <TouchableOpacity
                  onPress={() => setActiveSide('front')}
                  style={[styles.tab, activeSide === 'front' && styles.tabActive]}
                >
                  <Text style={[styles.tabText, activeSide === 'front' && styles.tabTextActive]}>FRONT</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setActiveSide('back')}
                  style={[styles.tab, activeSide === 'back' && styles.tabActive]}
                >
                  <Text style={[styles.tabText, activeSide === 'back' && styles.tabTextActive]}>BACK</Text>
                </TouchableOpacity>
              </View>

              {/* Image */}
              <View style={styles.imageWrap}>
                <Image
                  source={{uri: imageUrl}}
                  style={styles.cardImage}
                  resizeMode="contain"
                />
              </View>

              {/* ASK Row */}
              {askAmount && (
                <View style={styles.askRow}>
                  <Text style={styles.askLabel}>LISTED PRICE</Text>
                  <View style={styles.askValueRow}>
                    <Text style={styles.askAmount}>{askAmount}</Text>
                    <Text style={styles.askCurrency}>USDC</Text>
                  </View>
                </View>
              )}

              {/* Conditions */}
              <View style={styles.conditionSection}>
                <Text style={styles.sectionLabel}>ASSESSMENT CEILING</Text>
                <View style={styles.gradeRow}>
                  <Text style={styles.gradeLabel}>GRADE CEILING</Text>
                  <Text style={styles.gradeValue}>{status.grade_ceiling || '—'}</Text>
                </View>
                <View style={styles.flagRow}>
                  {status.centering_flag && (
                    <View style={styles.flagChip}><Text style={styles.flagText}>CENTERING {status.centering_flag}</Text></View>
                  )}
                  {status.glare_flag && (
                    <View style={styles.flagChip}><Text style={styles.flagText}>GLARE {status.glare_flag}</Text></View>
                  )}
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* Share button — primary social-share action */}
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={styles.buyPhantomBtn}
            onPress={handleShare}
          >
            <Text style={styles.buyPhantomText}>SHARE TO SOCIAL</Text>
          </TouchableOpacity>
        </View>

        {/* Disclaimer */}
        <Text style={styles.disclaimer}>
          NOT an official grade from PSA, BGS, CGC, TAG, or any other certified grading service.
        </Text>

        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.navigate('Home')}
        >
          <Text style={styles.backBtnText}>BACK TO HOME</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.bgApp,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: {
    padding: 16,
    paddingTop: 60,
    paddingBottom: 40,
  },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  brandText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 5,
    fontWeight: '700',
  },
  stateBadge: {
    borderWidth: 1,
    borderColor: T.gold,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  stateBadgeText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
  },
  cardContainer: {
    width: '100%',
    marginBottom: 24,
  },
  goldFrame: {
    borderWidth: 2,
    borderColor: T.gold,
    borderRadius: 12,
    padding: 1,
    backgroundColor: T.bgApp,
  },
  innerContent: {
    backgroundColor: T.bgSurface,
    borderRadius: 10,
    padding: 16,
  },
  cardTitle: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 4,
  },
  identityRow: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 10,
    textAlign: 'center',
    marginBottom: 16,
  },
  tabRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 12,
  },
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: 6,
  },
  tabActive: {
    backgroundColor: T.gold,
    borderColor: T.gold,
  },
  tabText: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
  },
  tabTextActive: {
    color: T.bgApp,
  },
  imageWrap: {
    width: '100%',
    aspectRatio: CARD_ASPECT,
    backgroundColor: '#000',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: T.border,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  askRow: {
    borderTopWidth: 1,
    borderTopColor: T.border,
    paddingTop: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  askLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 4,
  },
  askValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  askAmount: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 24,
    fontWeight: '900',
  },
  askCurrency: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
  },
  conditionSection: {
    borderTopWidth: 1,
    borderTopColor: T.border,
    paddingTop: 12,
  },
  sectionLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 2,
    marginBottom: 12,
    textAlign: 'center',
  },
  gradeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  gradeLabel: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  gradeValue: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '900',
  },
  flagRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  flagChip: {
    backgroundColor: T.bgInput,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: T.border,
  },
  flagText: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
  },
  actionSection: {
    gap: 12,
    marginBottom: 24,
  },
  buyPhantomBtn: {
    backgroundColor: T.gold,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buyPhantomText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '900',
  },
  buySolflareBtn: {
    borderWidth: 1,
    borderColor: T.gold,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buySolflareText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '900',
  },
  disclaimer: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    textAlign: 'center',
    lineHeight: 14,
    paddingHorizontal: 20,
    marginBottom: 32,
  },
  backBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  backBtnText: {
    color: T.textDisabled,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
  },
});
