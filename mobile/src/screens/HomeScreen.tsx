import React, {useCallback, useMemo, useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {CenteringMark} from '../components/CenteringMark';
import {CreditService, CreditBalance} from '../services/credits';
import {useLocalAuth} from '../hooks/useLocalAuth';
import {useMWAWallet} from '../hooks/useMWAWallet';
import {useSession} from '../hooks/useSession';
import {useDiscordAuth} from '../hooks/useDiscordAuth';
import {useWorldID} from '../hooks/useWorldID';
import {T} from '../constants/tokens';
import {hasAcceptedSafetyTerms} from '../services/safety';

const truncate = (s: string, head = 4, tail = 4) => {
  if (!s) return '';
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
};

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const {localPubkey, isLocallyAuthed, clearLocalAuth} = useLocalAuth();
  const {mwaPubkey, isMWAConnected} = useMWAWallet();
  const {
    walletPubkey,
    isPendingBackendAuth,
    authenticateWithBackend,
    authMode,
    signOut: signOutWallet,
  } = useSession();
  const {
    accessStatus,
    discordUsername,
    isLinked,
    isApproved,
    isSigningIn,
    signInWithDiscord,
    signOutDiscord,
    refreshProfile,
  } = useDiscordAuth();
  const {
    isVerified: worldIdVerified,
    isLoading: isWorldIDLoading,
  } = useWorldID();
  const [balance, _setBalance] = useState<CreditBalance | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      hasAcceptedSafetyTerms().then(accepted => {
        if (active) setTermsAccepted(accepted);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const isDemo = authMode === 'demo';
  const isMWA = authMode === 'mwa';

  // Full sign-out: clears Discord session AND any wallet path (Phantom SDK /
  // MWA / local keypair). Phantom support suggested clearing stale state to
  // unblock the connect.phantom.app 400; operationalizing that here so every
  // sign-out is a clean slate rather than leaving orphaned identities that
  // can loop the user back into demo mode.
  const handleSignOut = useCallback(async () => {
    try {
      await signOutWallet();
    } catch {
      // non-fatal
    }
    try {
      await clearLocalAuth();
    } catch {
      // non-fatal
    }
    await signOutDiscord();
  }, [signOutWallet, clearLocalAuth, signOutDiscord]);

  const handleVerifyWallet = async () => {
    setIsVerifying(true);
    setVerifyError(null);
    const result = await authenticateWithBackend();
    if (!result.success) {
      setVerifyError(result.error ?? 'Verification failed');
    }
    setIsVerifying(false);
  };

  // Wallet badge: truncated pubkey via the canonical useSession source
  // (Solana Pay > MWA > Demo priority). Neutral "NO WALLET" when unlinked.
  const displayName = useMemo(() => {
    if (walletPubkey) return truncate(walletPubkey, 4, 4);
    return 'NO WALLET';
  }, [walletPubkey]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={T.bgApp} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logoLockup}>
          <CenteringMark size={34} primaryColor={T.gold} dotColor={T.red} />
          <View>
            <Text style={styles.wordmark}>PROOF</Text>
            <Text style={styles.subWordmark}>BY FRAME</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.walletBadge}
          onPress={() => navigation.navigate('Wallet')}>
          <View style={styles.walletDot} />
          <Text style={styles.walletLabel} numberOfLines={1}>
            {displayName}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {balance && (
          <View style={styles.creditCard}>
            <View style={styles.creditCardAccent} />
            <View style={styles.creditCardBody}>
              <Text style={styles.creditCardLabel}>THIS MONTH</Text>
              <Text style={styles.creditCardValue}>
                {balance.submission_credits} free submission
                {balance.submission_credits !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.creditCardSub}>
                {balance.credits_earned_this_month} /{' '}
                {balance.max_monthly_credits} credits earned · earn rate{' '}
                {balance.effective_earn_rate.toFixed(2)}/vote
              </Text>
            </View>
          </View>
        )}

        {/* VERIFY YOUR WALLET card intentionally disabled: /api/auth/wallet-*
            endpoints are not deployed. Submission endpoints accept
            wallet_pubkey directly (alpha-parity), so no server-side proof is
            needed for the demo pipeline. */}

        {/* BETA ACCESS card — always rendered, swaps content based on
            Discord sign-in state. Approved state shows positive confirmation
            so user has clear visual signal they are signed in. */}
        <View
          style={[
            styles.verifyCard,
            isApproved && {borderColor: T.gradeGreen},
            accessStatus === 'rejected' && {borderColor: '#EF4444'},
          ]}>
          <Text
            style={[
              styles.verifyTitle,
              isApproved && {color: T.gradeGreen},
            ]}>
            {isApproved
              ? `\u2713 SIGNED IN AS @${discordUsername ?? 'Discord user'}`
              : accessStatus === 'pending'
              ? 'ACCESS PENDING'
              : accessStatus === 'rejected'
              ? 'ACCESS DENIED'
              : 'BETA ACCESS'}
          </Text>
          <Text style={styles.verifyBody}>
            {isApproved
              ? 'Beta access approved. You can submit cards for community grading.'
              : accessStatus === 'pending'
              ? `Request sent${discordUsername ? ` as @${discordUsername}` : ''}. A PROOF operator will approve in Discord.`
              : accessStatus === 'rejected'
              ? 'Your request was rejected. Contact the team on Discord.'
              : 'Sign in with Discord so PROOF operators can approve your beta access.'}
          </Text>
          {isApproved ? (
            <TouchableOpacity
              style={[styles.verifyBtn, {borderColor: T.textMuted}]}
              onPress={handleSignOut}>
              <Text style={[styles.verifyBtnText, {color: T.textMuted}]}>
                SIGN OUT
              </Text>
            </TouchableOpacity>
          ) : accessStatus === 'pending' ? (
            <TouchableOpacity
              style={styles.verifyBtn}
              onPress={refreshProfile}>
              <Text style={styles.verifyBtnText}>CHECK STATUS →</Text>
            </TouchableOpacity>
          ) : accessStatus === 'rejected' ? null : (
            <TouchableOpacity
              style={[styles.verifyBtn, {backgroundColor: T.gold, borderColor: T.gold}]}
              disabled={isSigningIn}
              onPress={async () => {
                await signInWithDiscord();
              }}>
              {isSigningIn ? (
                <ActivityIndicator color={T.bgApp} />
              ) : (
                <Text style={[styles.verifyBtnText, {color: T.bgApp, fontWeight: '700'}]}>
                  SIGN IN WITH DISCORD →
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {!isWorldIDLoading && (
          <View
            style={[
              styles.verifyCard,
              worldIdVerified && {borderColor: T.gradeGreen},
            ]}>
            <Text
              style={[
                styles.verifyTitle,
                worldIdVerified && {color: T.gradeGreen},
              ]}>
              {worldIdVerified
                ? '\u2713 WORLD ID VERIFIED'
                : 'VERIFY YOUR IDENTITY'}
            </Text>
            <Text style={styles.verifyBody}>
              {worldIdVerified
                ? 'Unique-human access is active for community voting and submission credits.'
                : 'Verify with World ID to vote on submissions and earn free submission credits.'}
            </Text>
            <TouchableOpacity
              style={styles.verifyBtn}
              onPress={() => navigation.navigate('WorldID')}>
              <Text style={styles.verifyBtnText}>
                {worldIdVerified
                  ? 'MANAGE WORLD ID →'
                  : 'VERIFY WITH WORLD ID →'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.howCard}>
          <Text style={styles.sectionLabel}>HOW IT WORKS</Text>
          {[
            {
              n: '01',
              title: 'Submit your card',
              body: 'Capture front and back photos. Our AI reads the card and routes it to the community.',
            },
            {
              n: '02',
              title: 'Community votes',
              body: 'Verified collectors assess condition. Consensus determines the result.',
            },
            {
              n: '03',
              title: 'Sealed proof',
              body: 'Your result is permanently recorded on a public ledger. Share it as a grade certificate.',
            },
          ].map((step, i) => (
            <View key={i} style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{step.n}</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepBody}>{step.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.submitBtn}
          onPress={() => {
            if (!termsAccepted) {
              navigation.navigate('Safety', {returnToSubmission: true});
              return;
            }
            navigation.navigate('Camera', {captureMode: 'front'});
          }}>
          <Text style={styles.submitBtnText}>
            {balance
              ? CreditService.getSubmitButtonLabel(balance)
              : 'START SUBMISSION'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.vaultBtn}
          onPress={() => navigation.navigate('Vault')}>
          <Text style={styles.vaultBtnText}>VIEW MY SUBMISSIONS</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.safetyBtn}
          onPress={() => navigation.navigate('Safety')}>
          <Text style={styles.safetyBtnText}>PRIVACY &amp; SAFETY</Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <CenteringMark
            size={12}
            primaryColor={T.textDisabled}
            dotColor={T.textDisabled}
          />
          <Text style={styles.footerText}>
            PROOF IS THE MOBILE COMPANION FOR FRAME
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: T.bgApp},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 16,
  },
  logoLockup: {flexDirection: 'row', alignItems: 'center', gap: 12},
  wordmark: {
    color: T.gold,
    fontSize: 20,
    fontFamily: 'monospace',
    fontWeight: '900',
    letterSpacing: 5,
  },
  subWordmark: {
    color: T.textMuted,
    fontSize: 7,
    fontFamily: 'monospace',
    letterSpacing: 3,
  },
  walletBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: T.bgInput,
    borderWidth: 1,
    borderColor: `${T.gold}33`,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: 160,
  },
  walletDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: T.amber},
  walletLabel: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
  },
  scroll: {flex: 1},
  scrollContent: {paddingHorizontal: 20, paddingBottom: 40, gap: 16},
  creditCard: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: T.border,
  },
  creditCardAccent: {height: 3, backgroundColor: T.gold},
  creditCardBody: {padding: 16},
  creditCardLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: 4,
  },
  creditCardValue: {
    color: T.textPrimary,
    fontSize: 18,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  creditCardSub: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
  },
  verifyCard: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: T.borderGold,
    overflow: 'hidden',
  },
  verifyTitle: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 3,
    marginBottom: 8,
    fontWeight: '700',
  },
  verifyBody: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  verifyBtn: {
    borderWidth: 1,
    borderColor: T.amber,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  verifyBtnText: {
    color: T.amber,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
  },
  verifyError: {
    color: T.red,
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 10,
    textAlign: 'center',
  },
  howCard: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: T.border,
  },
  sectionLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 4,
    marginBottom: 20,
  },
  step: {flexDirection: 'row', gap: 16, marginBottom: 20},
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: T.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumberText: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
  },
  stepContent: {flex: 1},
  stepTitle: {
    color: T.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  stepBody: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
  submitBtn: {
    backgroundColor: T.gold,
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#0E0E0E',
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
  },
  vaultBtn: {
    borderWidth: 1,
    borderColor: `${T.gold}44`,
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  vaultBtnText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 2,
  },
  safetyBtn: {padding: 12, alignItems: 'center'},
  safetyBtnText: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  footerText: {
    color: T.textDisabled,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 2,
  },
});
