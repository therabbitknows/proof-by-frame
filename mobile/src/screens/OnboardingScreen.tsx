import React, {useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import {useLocalAuth} from '../hooks/useLocalAuth';
import {useDiscordAuth} from '../hooks/useDiscordAuth';
import {CenteringMark} from '../components/CenteringMark';
import {T} from '../constants/tokens';

/**
 * Onboarding screen — first stop for unauthenticated users.
 * Offers Phantom Connect (Google / Apple / existing wallet).
 * The modal UI is provided by the SDK.
 */
export const OnboardingScreen: React.FC = () => {
  const {activateLocalAuth, isLocallyAuthed, localPubkey} = useLocalAuth();
  const {signInWithDiscord, isLinked: isDiscordLinked} = useDiscordAuth();
  const [busy, setBusy] = useState<'discord' | 'demo' | null>(null);

  const handleDiscordSignIn = async () => {
    setBusy('discord');
    try {
      const result = await signInWithDiscord();
      if (!result.success) {
        if (result.error && result.error !== 'Cancelled') {
          Alert.alert('Discord sign-in failed', result.error);
        }
        return;
      }
      // Successful Discord auth — surface the gate state to the user so they
      // know to wait for operator approval (or can proceed if already approved).
      if (result.accessStatus === 'approved') {
        Alert.alert(
          'Welcome to PROOF',
          'Your Discord is linked and approved. You can now submit cards.',
        );
      } else if (result.accessStatus === 'pending') {
        Alert.alert(
          'Request submitted',
          'A PROOF operator will approve your access in Discord. You will unlock submissions once approved.',
        );
      } else if (result.accessStatus === 'rejected') {
        Alert.alert(
          'Access denied',
          'Your beta access request was rejected. Contact the team on Discord.',
        );
      }
      // RootNavigator should pick up the linked Discord via a future
      // isDiscordLinked signal; for now Discord auth does NOT unlock the app
      // by itself — users still pick a wallet path (Demo/Phantom) for the
      // identity, and Discord controls the submission gate.
    } catch (err: any) {
      Alert.alert('Discord sign-in failed', err?.message || 'Unknown error');
    } finally {
      setBusy(null);
    }
  };

  const handleDemoMode = async () => {
    // Demo Mode is the judge / first-time-evaluator path: unlock the app
    // shell with a local-only wallet, no Discord round-trip. Idempotent —
    // if a local keypair already exists we DO NOT regenerate (would orphan
    // drafts), and we do NOT bounce the user with an alert; the navigator
    // picks up isLocallyAuthed and swaps to the Home stack on its own.
    if (isLocallyAuthed && localPubkey) {
      console.log('[PROOF] Demo mode already active, pubkey:', localPubkey);
      return;
    }
    setBusy('demo');
    try {
      const pubkey = await activateLocalAuth();
      console.log('[PROOF] Demo mode activated, pubkey:', pubkey);
    } catch (err: any) {
      Alert.alert('Demo mode failed', err?.message || 'Unknown error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      {/* Logo */}
      <View style={styles.logoBlock}>
        <CenteringMark size={64} primaryColor={T.gold} dotColor={T.red} />
        <Text style={styles.wordmark}>PROOF</Text>
        <Text style={styles.subWordmark}>BY FRAME</Text>
      </View>

      {/* Value prop */}
      <View style={styles.hero}>
        <Text style={styles.tagline}>Community consensus.</Text>
        <Text style={styles.taglineAccent}>Before the slab.</Text>
        <Text style={styles.body}>
          Submit your card. Let verified collectors assess its condition.
          Get a permanent result you can share.
        </Text>
      </View>

      {/* Auth options */}
      <View style={styles.authBlock}>
        <Text style={styles.sectionLabel}>GET STARTED</Text>

        <TouchableOpacity
          style={[styles.discordBtn, busy === 'discord' && styles.authBtnActive]}
          onPress={handleDiscordSignIn}
          disabled={!!busy}
          activeOpacity={0.7}>
          {busy === 'discord' ? (
            <ActivityIndicator color={T.bgApp} />
          ) : (
            <>
              <View style={[styles.providerDot, {backgroundColor: T.bgApp}]} />
              <Text style={styles.discordBtnText}>SIGN IN WITH DISCORD</Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.discordBtnSub}>
          Required for beta access — PROOF operators approve via Discord.
        </Text>

        {/* Google / Apple Phantom-wallet CTAs moved OFF the Onboarding
            (access-gate) screen. Phantom's web2→web3 connector signs a
            user into an EMBEDDED WALLET — that's a wallet-connection
            step, not an access step. Our access gate is Discord (beta
            approval), and wallet-connect should happen AFTER the user
            is past the gate, inside the app shell.

            This also sidesteps any parallel-provider state races at mount
            and matches Phantom's official reference pattern (single
            useModal().open() trigger from inside the authed app, not from
            the gate screen). See WalletScreen for the new entry point. */}

        {/* MWA "Connect Phantom App" entry also lives on WalletScreen —
            the Phantom SDK modal opened from there surfaces it internally
            when the Phantom app is installed. */}

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity
          style={[styles.demoBtn, busy === 'demo' && styles.demoBtnActive]}
          onPress={handleDemoMode}
          disabled={!!busy}
          activeOpacity={0.7}>
          {busy === 'demo' ? (
            <ActivityIndicator color={T.gold} />
          ) : (
            <>
              <Text style={styles.demoBtnText}>DEMO MODE</Text>
              <Text style={styles.demoBtnSub}>Continue with a local wallet</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Fine print */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          A wallet is created for you automatically. Your keys never leave
          your device. Session lasts 7 days.
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.bgApp,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 96,
    paddingBottom: 48,
  },
  logoBlock: {
    alignItems: 'center',
    marginBottom: 48,
  },
  wordmark: {
    color: T.gold,
    fontSize: 32,
    fontFamily: 'monospace',
    fontWeight: '900',
    letterSpacing: 8,
    marginTop: 16,
  },
  subWordmark: {
    color: T.textMuted,
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 4,
    marginTop: 4,
  },
  hero: {
    marginBottom: 48,
    alignItems: 'center',
  },
  tagline: {
    color: T.textPrimary,
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  taglineAccent: {
    color: T.gold,
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    color: T.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  authBlock: {
    gap: 12,
    marginBottom: 32,
  },
  sectionLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 4,
    marginBottom: 8,
    textAlign: 'center',
  },
  authBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.borderStrong,
    paddingVertical: 16,
    paddingHorizontal: 20,
    minHeight: 54,
  },
  authBtnActive: {
    borderColor: T.gold,
    backgroundColor: `${T.gold}10`,
  },
  authBtnText: {
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  providerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  otherBtn: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 4,
  },
  otherBtnText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: T.borderStrong,
  },
  dividerText: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 2,
    marginHorizontal: 12,
  },
  demoBtn: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.gold,
    borderStyle: 'dashed' as any,
    paddingVertical: 14,
    paddingHorizontal: 20,
    minHeight: 54,
  },
  demoBtnActive: {
    backgroundColor: `${T.gold}10`,
  },
  demoBtnText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  demoBtnSub: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1,
    marginTop: 4,
  },
  discordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.gold,
    borderRadius: 12,
    paddingVertical: 16,
    marginBottom: 6,
  },
  discordBtnText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: '700',
  },
  discordBtnSub: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 14,
  },
  footer: {
    marginTop: 24,
    paddingHorizontal: 12,
  },
  footerText: {
    color: T.textDisabled,
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 16,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
});
