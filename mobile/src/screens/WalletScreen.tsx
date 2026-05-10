import React, {useMemo, useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useLocalAuth} from '../hooks/useLocalAuth';
import {useMWAWallet} from '../hooks/useMWAWallet';
import {CenteringMark} from '../components/CenteringMark';
import {T} from '../constants/tokens';
import {BackButton} from '../components/BackButton';
import CONFIG from '../constants/config';
import {DEBUG_TOOLS_ENABLED} from '../utils/debugGuard';

const truncate = (s: string, head = 6, tail = 6) => {
  if (!s) return '';
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
};

/**
 * Wallet screen — displays the connected wallet pubkey and surfaces the three
 * connect paths (Solana Pay, MWA, Demo) when no wallet is linked.
 *
 * No Phantom SDK dependency. Wallet interaction is wallet-agnostic via
 * Solana Pay URLs (primary) or MWA (fallback for users who want the
 * in-app Phantom handshake).
 */
export const WalletScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const {localPubkey, isLocallyAuthed, activateLocalAuth, clearLocalAuth} = useLocalAuth();
  const {mwaPubkey, isMWAConnected, connectMWA, disconnectMWA} = useMWAWallet();
  const [connectingMWA, setConnectingMWA] = useState(false);
  const [activatingDemo, setActivatingDemo] = useState(false);

  // Connect-screen affordances are MWA + Demo only. Solana Pay is the
  // PROOF *payment* protocol (Blinks checkout, credits refill); it is
  // not an identity surface. The useSolanaPayConnect hook still lives
  // in the tree (App.tsx provider) so checkout + credits screens can
  // consume it later — just not here.
  const isDemo = !isMWAConnected && isLocallyAuthed;
  const isMWA = isMWAConnected;
  const hasWallet = isMWAConnected || isLocallyAuthed;

  const solanaAddress = useMemo(() => {
    if (isMWA && mwaPubkey) return mwaPubkey;
    if (isDemo && localPubkey) return localPubkey;
    return '';
  }, [isMWA, mwaPubkey, isDemo, localPubkey]);

  // Wallet-agnostic install path — Solana dApp Store hosts every
  // MWA-compliant wallet (Phantom, Solflare, Backpack, Ultimate,
  // Glow, etc.) and is the canonical install surface for Saga +
  // Seeker. On generic Android the dApp Store URL only renders a
  // marketing page (no install action), so we fall back to a Play
  // Store search that the OS resolves into the Play Store app
  // directly. Don't pin one wallet — the user picks whichever they're
  // already familiar with.
  const SOLANA_DAPP_STORE_URL = 'https://store.solanamobile.com/';
  const PLAY_STORE_WALLET_SEARCH_URL =
    'https://play.google.com/store/search?q=solana%20wallet&c=apps';

  const openWalletInstall = () => {
    // Try dApp Store first (canonical for Saga/Seeker), fall back to
    // Play Store search on generic Android, fall back to the alert
    // copy if neither resolves.
    Linking.openURL(SOLANA_DAPP_STORE_URL).catch(() =>
      Linking.openURL(PLAY_STORE_WALLET_SEARCH_URL).catch(() => {
        Alert.alert(
          'Could not open an app store',
          'Open the Solana dApp Store on your device (or Play Store on ' +
            'non-Saga Android), search for any Solana wallet — Phantom, ' +
            'Solflare, Backpack, Ultimate all work — install one, and ' +
            'return to PROOF.',
        );
      }),
    );
  };

  // Detect the "no MWA wallet installed" pattern — the OS-level
  // ActivityNotFound surface that fires when no app on the device
  // registers for the MWA WalletAdapterService intent. On Saga units
  // that haven't installed any wallet yet (Solana dApp Store + Play
  // Store both ship empty), this is the FIRST and MOST COMMON
  // failure — and the recovery path (install a wallet) is different
  // from the session-properties bug recovery (try a different wallet).
  const isNoWalletInstalled = (err: string | undefined): boolean => {
    if (!err) return false;
    const low = err.toLowerCase();
    return (
      low.includes('no installed') ||
      low.includes('no mwa wallet') ||
      low.includes('no wallet found') ||
      low.includes('activitynotfound') ||
      low.includes('no activity') ||
      low.includes('no wallets found')
    );
  };

  // Heuristic for the known-broken combination: @solana-mobile MWA
  // protocol-web3js@2.2.7 + Phantom 26.6.0 fail the session-properties
  // handshake, fall back to legacy session, and the legacy authorize
  // round-trip completes in ~3ms with no user-UI window — the wallet
  // returns an error response without showing fingerprint/PIN. Symptoms
  // we see in error.message:
  //   - "Authorization failed" / "Authorization rejected" / generic
  //     "Connection failed"
  //   - Silent return without an error string at all (auth_token empty)
  // Hard to detect from the user-visible error alone, so we surface
  // the alternative paths whenever connectMWA fails for ANY reason —
  // worst case the user sees the same alternatives twice for a real
  // user-rejection, which is harmless.
  const isLikelyKnownMwaBreakage = (err: string | undefined): boolean => {
    if (!err) return true; // empty error = known silent rejection pattern
    const low = err.toLowerCase();
    return (
      low.includes('authorization') ||
      low.includes('connection failed') ||
      low.includes('session') ||
      low.includes('rejected') ||
      low.includes('user declined')
    );
  };

  const handleConnectMWA = async () => {
    setConnectingMWA(true);
    try {
      const result = await connectMWA();
      if (result.error) {
        showMwaFailureAlert(result.error);
      }
    } catch (err: any) {
      showMwaFailureAlert(err?.message || 'Unknown error');
    } finally {
      setConnectingMWA(false);
    }
  };

  const showMwaFailureAlert = (err: string) => {
    // Branch 1: no MWA-compliant wallet on the device. Most common
    // first-run failure mode — recovery is "install a wallet,"
    // not "try again."
    if (isNoWalletInstalled(err)) {
      Alert.alert(
        'No Solana wallet installed',
        "PROOF talks to your wallet via the Mobile Wallet Adapter " +
          "protocol, but no MWA-compliant wallet is installed on " +
          "this device yet. Install any Solana wallet — Phantom, " +
          "Solflare, Backpack, Ultimate, Glow all work — from the " +
          "Solana dApp Store, then return to PROOF.\n\nYou can also " +
          "try Demo Mode to explore PROOF without a wallet.",
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Activate Demo Mode',
            onPress: () => handleActivateDemo(),
          },
          {
            text: 'Install a wallet',
            onPress: openWalletInstall,
          },
        ],
        {cancelable: true},
      );
      return;
    }

    // Branch 2: a wallet IS installed but the handshake failed.
    // Could be the Phantom 26.6.0 + MWA 2.2.7 session-properties
    // force-close, a user rejection, or a transient handshake error.
    // Recovery is "retry," "different wallet," or "Demo Mode" —
    // never "install something" since something IS installed.
    if (isLikelyKnownMwaBreakage(err)) {
      Alert.alert(
        'Wallet connect issue',
        'Your wallet rejected the in-app handshake. Some wallet ' +
          'builds force-close on the MWA session-properties parse. ' +
          'Try again, switch to a different Solana wallet app ' +
          '(Solflare / Backpack / Ultimate), or use Demo Mode.\n\n' +
          `(Diagnostic: ${err})`,
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Retry',
            onPress: () => handleConnectMWA(),
          },
          {
            text: 'Install a wallet',
            onPress: openWalletInstall,
          },
          {
            text: 'Demo Mode',
            onPress: () => handleActivateDemo(),
          },
        ],
        {cancelable: true},
      );
      return;
    }

    Alert.alert('Connection failed', err);
  };

  const handleActivateDemo = async () => {
    setActivatingDemo(true);
    try {
      await activateLocalAuth();
    } catch (err: any) {
      Alert.alert('Demo mode failed', err?.message || 'Unknown error');
    } finally {
      setActivatingDemo(false);
    }
  };

  const handleDisconnect = () => {
    const label = isDemo ? 'Exit demo mode?' : 'Disconnect wallet?';
    const body = isDemo
      ? "Your local wallet will be removed. You'll need to sign in again."
      : "You'll need to sign in again to access your account.";
    Alert.alert(label, body, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: isDemo ? 'Exit' : 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          try {
            if (isDemo) {
              await clearLocalAuth();
            } else if (isMWA) {
              await disconnectMWA();
            }
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.navigate('Home');
            }
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'Disconnect failed');
          }
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.backBtn}>
          <BackButton />
        </View>
        <Text style={styles.title}>WALLET</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Profile */}
      <View style={styles.profileCard}>
        <View style={styles.profileIcon}>
          <CenteringMark size={28} primaryColor={T.gold} dotColor={T.red} />
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileLabel}>SIGNED IN AS</Text>
          <Text style={styles.profileValue} numberOfLines={1}>
            {hasWallet ? truncate(solanaAddress, 8, 4) : 'No wallet connected'}
          </Text>
          {isDemo ? (
            <Text style={styles.profileProvider}>DEMO MODE</Text>
          ) : isMWA ? (
            <Text style={styles.profileProvider}>VIA WALLET APP</Text>
          ) : null}
        </View>
      </View>

      {/* Solana address */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>SOLANA ADDRESS</Text>
        {solanaAddress ? (
          <>
            <Text style={styles.addressValue}>{truncate(solanaAddress, 8, 8)}</Text>
            <Text style={styles.addressFull} numberOfLines={1}>
              {solanaAddress}
            </Text>
          </>
        ) : (
          <Text style={styles.muted}>No Solana address linked.</Text>
        )}
      </View>

      {/* Wallet metadata */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>WALLET DETAILS</Text>
        <View style={styles.row}>
          <Text style={styles.rowKey}>Wallet ID</Text>
          <Text style={styles.rowValue}>
            {isDemo ? 'LOCAL' : isMWA ? 'WALLET APP' : '—'}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowKey}>Network</Text>
          <Text style={styles.rowValue}>Solana · {CONFIG.SOLANA_NETWORK}</Text>
        </View>
      </View>

      {/* Developer tools (internal builds only) */}
      {DEBUG_TOOLS_ENABLED && (
        <TouchableOpacity
          style={styles.devToolsBtn}
          onPress={() => navigation.navigate('Debug')}
          activeOpacity={0.7}>
          <Text style={styles.devToolsText}>DEVELOPER TOOLS →</Text>
        </TouchableOpacity>
      )}

      {/* Connect / disconnect. Two paths surfaced when unlinked:
          1. Connect with wallet app (MWA) — wallet-agnostic in-app
             handshake. Speaks the Solana Mobile Wallet Adapter
             protocol to whichever wallet app the user picks
             (Solflare, Backpack, Ultimate, Phantom). Some wallet
             builds force-close on the session-properties handshake
             today (Phantom 26.6.0 + MWA 2.2.7 — see the
             smart-fallback alert); switching wallet apps is the
             primary recovery path.
          2. Demo Mode — offline-only keypair for local exploration.
             Useful for screening the app without any wallet at all. */}
      {hasWallet ? (
        <TouchableOpacity
          style={styles.disconnectBtn}
          onPress={handleDisconnect}
          activeOpacity={0.7}>
          <Text style={styles.disconnectText}>
            {isDemo ? 'EXIT DEMO MODE' : 'DISCONNECT WALLET'}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.connectBlock}>
          <Text style={styles.connectHeading}>LINK A WALLET</Text>
          <Text style={styles.connectBody}>
            Sign in with any installed Solana wallet so your
            submissions have a verifiable owner on-chain. PROOF speaks
            the Mobile Wallet Adapter protocol — no SDK lock-in, no
            extra installs.
          </Text>

          {/* PRIMARY: MWA — the canonical Solana Mobile sign-in path. */}
          <TouchableOpacity
            style={styles.primaryConnectBtn}
            onPress={handleConnectMWA}
            disabled={connectingMWA || activatingDemo}
            activeOpacity={0.7}>
            {connectingMWA ? (
              <ActivityIndicator color={T.bgApp} />
            ) : (
              <Text style={styles.primaryConnectText}>CONNECT WALLET</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.connectWhyHint}>
            Opens your installed Solana wallet (Solflare, Backpack,
            Ultimate, Phantom). You'll approve a sign-in request — no
            SOL or tokens are transferred. Solana Pay is reserved for
            checkout (buying cNFTs via Blinks) and Frame credit refills.
          </Text>

          {/* TERTIARY: Demo Mode — local-only keypair, no external wallet. */}
          <TouchableOpacity
            style={styles.demoBtn}
            onPress={handleActivateDemo}
            disabled={connectingMWA || activatingDemo}
            activeOpacity={0.7}>
            {activatingDemo ? (
              <ActivityIndicator color={T.gold} />
            ) : (
              <>
                <Text style={styles.demoBtnText}>ACTIVATE DEMO MODE</Text>
                <Text style={styles.demoBtnSub}>Local-only wallet, device-bound</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.footerNote}>
        {hasWallet
          ? 'Your keys never leave this device. Disconnecting ends the session on this device.'
          : 'Proof by Frame doesn’t hold your keys. Your wallet signs every transaction; Demo Mode keeps a local keypair on this device only.'}
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: T.bgApp},
  content: {paddingHorizontal: 20, paddingTop: 52, paddingBottom: 48, gap: 16},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
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
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: T.border,
  },
  profileIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: T.bgInput,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInfo: {flex: 1},
  profileLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 3,
    marginBottom: 4,
  },
  profileValue: {
    color: T.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  profileProvider: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 2,
    marginTop: 2,
  },
  card: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 16,
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
  addressValue: {
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 16,
    letterSpacing: 1,
  },
  addressFull: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    marginTop: 6,
  },
  muted: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 15,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
  },
  rowKey: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
  },
  rowValue: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
  },
  devToolsBtn: {
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  devToolsText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
  },
  disconnectBtn: {
    borderWidth: 1,
    borderColor: `${T.red}88`,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  disconnectText: {
    color: T.red,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  footerNote: {
    color: T.textDisabled,
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
    paddingHorizontal: 12,
    marginTop: 8,
  },
  connectBlock: {
    marginTop: 8,
    gap: 12,
  },
  connectHeading: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 3,
    marginBottom: 4,
  },
  connectBody: {
    color: T.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 8,
  },
  primaryConnectBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.gold,
    borderRadius: 12,
    paddingVertical: 16,
    minHeight: 54,
  },
  primaryConnectText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: '700',
  },
  connectWhyHint: {
    color: T.textDisabled,
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'left',
    paddingHorizontal: 4,
    marginTop: -4,
  },
  demoBtn: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.gold,
    borderStyle: 'dashed' as any,
    paddingVertical: 14,
    minHeight: 54,
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
});
