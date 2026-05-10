/**
 * DebugScreen — internal developer panel.
 *
 * Only registered in navigation when `DEBUG_TOOLS_ENABLED === true`.
 * Exposes session/wallet introspection + devnet memo proof + local sign
 * + explorer refresh + disconnect. Alpha tester builds never reach this screen.
 */

import React, {useCallback, useEffect, useState} from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useSession} from '../hooks/useSession';
import {useLocalAuth} from '../hooks/useLocalAuth';
import {useMWAWallet} from '../hooks/useMWAWallet';
import {T} from '../constants/tokens';
import {BackButton} from '../components/BackButton';
import CONFIG from '../constants/config';
import {
  getBalance,
  getRecentSignatures,
  signAndSendMemo,
  signTestMessage,
} from '../services/memo';
import {WalletService} from '../services/wallet';

const KNOWN_SESSION_KEYS = [
  'proof_wallet_verified',
  'proof_wallet_address',
  'proof_local_auth',
  'proof_local_pubkey',
  'mwa_wallet_pubkey',
];

type LogEntry = {
  ts: number;
  action: string;
  ok: boolean;
  detail: string;
  url?: string;
};

const truncate = (s: string | null | undefined, head = 6, tail = 6) => {
  if (!s) return '—';
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
};

const maskValue = (v: string | null) => {
  if (!v) return '(empty)';
  if (v === 'true' || v === 'false') return v;
  return truncate(v, 6, 6);
};

const lamportsToSol = (l: number | null) =>
  l === null ? '—' : `${(l / 1_000_000_000).toFixed(4)} SOL`;

export const DebugScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const session = useSession();
  const {localPubkey, isLocallyAuthed, clearLocalAuth} = useLocalAuth();
  const {mwaPubkey, isMWAConnected} = useMWAWallet();

  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [sessionKeys, setSessionKeys] = useState<[string, string | null][]>([]);
  const [recentSigs, setRecentSigs] = useState<
    {signature: string; blockTime: number | null; err: unknown}[]
  >([]);

  const pushLog = useCallback(
    (action: string, ok: boolean, detail: string, url?: string) => {
      setLog(prev =>
        [{ts: Date.now(), action, ok, detail, url}, ...prev].slice(0, 10),
      );
    },
    [],
  );

  // Surface enough of the error to diagnose on-screen (release builds strip
  // console output from logcat). Keeps the top stack frame in the visible
  // log row so "undefined is not a function" isn't the whole story.
  const describeError = (err: unknown): string => {
    const e = err as any;
    const name = e?.name || 'Error';
    const msg = e?.message || String(err);
    const stack: string =
      typeof e?.stack === 'string' ? e.stack : '';
    const frame = stack.split('\n').slice(1).find(l => l.trim()) || '';
    return `${name}: ${msg}${frame ? ` · ${frame.trim().slice(0, 140)}` : ''}`;
  };

  const refreshState = useCallback(async () => {
    try {
      const [bal, entries, sigs] = await Promise.all([
        getBalance(),
        AsyncStorage.multiGet(KNOWN_SESSION_KEYS),
        getRecentSignatures(5).catch(() => []),
      ]);
      setBalance(bal);
      setSessionKeys(entries as [string, string | null][]);
      setRecentSigs(sigs);
    } catch (err: any) {
      pushLog('refresh', false, err?.message || String(err));
    }
  }, [pushLog]);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  const runVerifyWallet = useCallback(async () => {
    setBusy('verify');
    try {
      const res = await session.authenticateWithBackend();
      if (res.success) {
        pushLog('verify-wallet', true, 'verified');
      } else {
        // A 404 on /api/auth/wallet-nonce or /api/auth/wallet-verify
        // means the backend hasn't been (re)deployed, not a client bug.
        const err = res.error || 'failed';
        const isNotDeployed = /404|not found|wallet-nonce|wallet-verify/i.test(err);
        pushLog(
          'verify-wallet',
          false,
          isNotDeployed
            ? `backend endpoint unavailable: ${err}`
            : err,
        );
      }
    } catch (err: any) {
      console.error('[PROOF][debug][verify-wallet]', err);
      pushLog('verify-wallet', false, describeError(err));
    } finally {
      setBusy(null);
      refreshState();
    }
  }, [session, pushLog, refreshState]);

  const runSignTest = useCallback(async () => {
    setBusy('sign');
    try {
      const msg = `PROOF debug ping @ ${Date.now()}`;
      if (session.authMode === 'demo') {
        const {signatureHex} = await signTestMessage(msg);
        pushLog('sign-test', true, `demo · sig=${truncate(signatureHex, 10, 10)}`);
      } else if (session.authMode === 'mwa') {
        const res = await WalletService.signMessageRaw(msg);
        if (res.error) throw new Error(res.error);
        pushLog(
          'sign-test',
          true,
          `mwa · ${truncate(res.pubkey, 6, 6)} · sig=${truncate(res.signature, 10, 10)}`,
        );
      } else if (session.authMode === 'solana-pay') {
        pushLog(
          'sign-test',
          false,
          'Solana Pay signing not wired in debug panel yet — memo-tx path TBD',
        );
      } else {
        pushLog(
          'sign-test',
          false,
          'no active wallet · connect a wallet or activate Demo Mode first',
        );
      }
    } catch (err: any) {
      console.error('[PROOF][debug][sign-test]', err);
      pushLog('sign-test', false, describeError(err));
    } finally {
      setBusy(null);
    }
  }, [session.authMode, pushLog]);

  const runProveOnDevnet = useCallback(async () => {
    setBusy('memo');
    try {
      const pubkey = localPubkey || session.walletPubkey || 'unknown';
      const memo = `PROOF memo: ${pubkey} @ ${Date.now()}`;
      if (session.authMode === 'demo') {
        const {signature} = await signAndSendMemo(memo);
        const url = `https://solscan.io/tx/${signature}?cluster=devnet`;
        pushLog('prove-devnet', true, `demo · ${truncate(signature, 8, 8)}`, url);
      } else if (session.authMode === 'mwa') {
        const res = await WalletService.sendMemoDevnetMWA(memo);
        if (res.error) throw new Error(res.error);
        const url = `https://solscan.io/tx/${res.signature}?cluster=devnet`;
        pushLog('prove-devnet', true, `mwa · ${truncate(res.signature, 8, 8)}`, url);
      } else if (session.authMode === 'solana-pay') {
        pushLog(
          'prove-devnet',
          false,
          'Solana Pay devnet send not wired in debug panel yet',
        );
      } else {
        pushLog(
          'prove-devnet',
          false,
          'no active wallet · connect a wallet or activate Demo Mode first',
        );
      }
    } catch (err: any) {
      console.error('[PROOF][debug][prove-devnet]', err);
      pushLog('prove-devnet', false, describeError(err));
    } finally {
      setBusy(null);
      refreshState();
    }
  }, [session.authMode, localPubkey, session.walletPubkey, pushLog, refreshState]);

  const runClearSession = useCallback(() => {
    Alert.alert(
      'Clear local session?',
      'Signs out the current session and removes Demo Mode local keypair. This cannot be undone.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setBusy('clear');
            try {
              await session.signOut();
              if (isLocallyAuthed) await clearLocalAuth();
              pushLog('clear-session', true, 'session cleared');
            } catch (err: any) {
              pushLog('clear-session', false, err?.message || String(err));
            } finally {
              setBusy(null);
              refreshState();
            }
          },
        },
      ],
    );
  }, [session, isLocallyAuthed, clearLocalAuth, pushLog, refreshState]);

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.backBtn}>
          <BackButton />
        </View>
        <Text style={styles.title}>DEBUG</Text>
        <View style={styles.headerRight} />
      </View>

      <View style={styles.warnCard}>
        <Text style={styles.warnText}>
          INTERNAL BUILD ONLY · DEBUG_TOOLS_ENABLED=true
        </Text>
      </View>

      {/* Session state */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>SESSION</Text>
        <Row k="authMode" v={session.authMode || '—'} />
        <Row k="authProvider" v={session.authProvider || '—'} />
        <Row
          k="walletPubkey"
          v={truncate(session.walletPubkey, 8, 8)}
        />
        <Row
          k="isAuthenticated"
          v={session.isAuthenticated ? 'true' : 'false'}
        />
        <Row
          k="isPendingBackendAuth"
          v={session.isPendingBackendAuth ? 'true' : 'false'}
        />
      </View>

      {/* AsyncStorage session keys */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>STORAGE</Text>
        {sessionKeys.map(([k, v]) => (
          <Row key={k} k={k} v={maskValue(v)} />
        ))}
      </View>

      {/* Local keypair */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>LOCAL KEYPAIR</Text>
        <Row
          k="isLocallyAuthed"
          v={isLocallyAuthed ? 'true' : 'false'}
        />
        <Row k="localPubkey" v={truncate(localPubkey, 8, 8)} />
        <Row k="mwaPubkey" v={truncate(mwaPubkey, 8, 8)} />
        <Row k="isMWAConnected" v={isMWAConnected ? 'true' : 'false'} />
        <Row k="balance" v={lamportsToSol(balance)} />
        <Row k="network" v={CONFIG.SOLANA_NETWORK} />
        <TouchableOpacity
          style={styles.btnSecondary}
          onPress={refreshState}
          disabled={busy !== null}>
          <Text style={styles.btnSecondaryText}>EXPLORER REFRESH</Text>
        </TouchableOpacity>
      </View>

      {/* Actions */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>ACTIONS</Text>

        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={runVerifyWallet}
          disabled={busy !== null || !session.walletPubkey}>
          {busy === 'verify' ? (
            <ActivityIndicator color={T.bgApp} />
          ) : (
            <Text style={styles.btnPrimaryText}>VERIFY WALLET</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={runSignTest}
          disabled={busy !== null || session.authMode === null}>
          {busy === 'sign' ? (
            <ActivityIndicator color={T.bgApp} />
          ) : (
            <Text style={styles.btnPrimaryText}>SIGN TEST MESSAGE</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnPrimary}
          onPress={runProveOnDevnet}
          disabled={busy !== null || session.authMode === null}>
          {busy === 'memo' ? (
            <ActivityIndicator color={T.bgApp} />
          ) : (
            <Text style={styles.btnPrimaryText}>PROVE ON DEVNET</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnDestructive}
          onPress={runClearSession}
          disabled={busy !== null}>
          {busy === 'clear' ? (
            <ActivityIndicator color={T.red} />
          ) : (
            <Text style={styles.btnDestructiveText}>
              DISCONNECT / CLEAR LOCAL SESSION
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Recent signatures */}
      {recentSigs.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>RECENT TX (this keypair)</Text>
          {recentSigs.map(s => {
            const url = `https://solscan.io/tx/${s.signature}?cluster=devnet`;
            return (
              <TouchableOpacity
                key={s.signature}
                style={styles.row}
                onPress={() => openUrl(url)}>
                <Text style={styles.rowKey}>
                  {truncate(s.signature, 6, 6)}
                </Text>
                <Text style={styles.rowValue}>
                  {s.err ? 'ERR' : 'OK'} ·{' '}
                  {s.blockTime
                    ? new Date(s.blockTime * 1000).toLocaleTimeString()
                    : '—'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Log */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>LOG</Text>
        {log.length === 0 ? (
          <Text style={styles.muted}>No actions yet.</Text>
        ) : (
          log.map(entry => (
            <View key={entry.ts} style={styles.logRow}>
              <Text style={styles.logTs}>
                {new Date(entry.ts).toLocaleTimeString()}
              </Text>
              <Text
                style={[
                  styles.logAction,
                  {color: entry.ok ? T.gold : T.red},
                ]}>
                {entry.action}
              </Text>
              <Text selectable style={styles.logDetail}>
                {entry.detail}
              </Text>
              {entry.url && (
                <TouchableOpacity onPress={() => openUrl(entry.url!)}>
                  <Text style={styles.logUrl}>{entry.url}</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}
      </View>

      <Text style={styles.footerNote}>
        This screen is disabled in alpha tester builds.
      </Text>
    </ScrollView>
  );
};

const Row: React.FC<{k: string; v: string}> = ({k, v}) => (
  <View style={styles.row}>
    <Text style={styles.rowKey}>{k}</Text>
    <Text selectable style={styles.rowValue}>
      {v}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: T.bgApp},
  content: {paddingHorizontal: 20, paddingTop: 52, paddingBottom: 48, gap: 14},
  header: {flexDirection: 'row', alignItems: 'center', marginBottom: 4},
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
  warnCard: {
    backgroundColor: T.bgInput,
    borderWidth: 1,
    borderColor: `${T.amber}66`,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  warnText: {
    color: T.amber,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 2,
  },
  card: {
    backgroundColor: T.bgSurface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: T.border,
    gap: 6,
  },
  cardLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
  },
  rowKey: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
  },
  rowValue: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    maxWidth: '60%',
    textAlign: 'right',
  },
  btnPrimary: {
    backgroundColor: T.gold,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  btnPrimaryText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  btnSecondary: {
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  btnSecondaryText: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
  },
  btnDestructive: {
    borderWidth: 1,
    borderColor: `${T.red}88`,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  btnDestructiveText: {
    color: T.red,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
  },
  muted: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
  },
  logRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.border,
    gap: 2,
  },
  logTs: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
  },
  logAction: {
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
  },
  logDetail: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 10,
  },
  logUrl: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 10,
    marginTop: 2,
  },
  footerNote: {
    color: T.textDisabled,
    fontFamily: 'monospace',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 8,
  },
});

export default DebugScreen;
