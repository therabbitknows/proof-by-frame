import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {T} from '../constants/tokens';
import {BackButton} from '../components/BackButton';
import {useWorldID} from '../hooks/useWorldID';

function shortHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const WorldIDScreen: React.FC = () => {
  const {
    verification,
    isVerified,
    isVerifying,
    isConfigured,
    error,
    verify,
    clearVerification,
  } = useWorldID();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  const handleVerify = async () => {
    if (!isConfigured) {
      Alert.alert(
        'World ID not configured',
        'Set WORLD_ID_APP_ID in .env and rebuild. See https://developer.worldcoin.org to register an app.',
      );
      return;
    }
    const result = await verify();
    if (!result.success && result.error && result.error !== 'Cancelled') {
      Alert.alert('Verification failed', result.error);
    }
  };

  const handleSignOut = async () => {
    setConfirmingSignOut(true);
    Alert.alert(
      'Remove World ID verification?',
      'You can re-verify at any time. Any credits earned while verified stay tied to your nullifier.',
      [
        {text: 'Cancel', style: 'cancel', onPress: () => setConfirmingSignOut(false)},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await clearVerification();
            setConfirmingSignOut(false);
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.backSlot}>
          <BackButton />
        </View>
        <Text style={styles.title}>WORLD ID</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {isVerified && verification ? (
          <VerifiedState
            verification={verification}
            onSignOut={handleSignOut}
            isBusy={confirmingSignOut}
          />
        ) : (
          <UnverifiedState
            isVerifying={isVerifying}
            isConfigured={isConfigured}
            error={error}
            onVerify={handleVerify}
          />
        )}
      </ScrollView>
    </View>
  );
};

const UnverifiedState: React.FC<{
  isVerifying: boolean;
  isConfigured: boolean;
  error: string | null;
  onVerify: () => void;
}> = ({isVerifying, isConfigured, error, onVerify}) => (
  <>
    <Text style={styles.heading}>Prove you&rsquo;re human</Text>
    <Text style={styles.paragraph}>
      Verify once with World ID to unlock community voting and monthly free
      submission credits. One person, one voice — no duplicate accounts.
    </Text>
    <Text style={styles.paragraph}>
      Verification is anonymous: we only store a per-app nullifier hash, never
      any biometric data. You can remove it at any time.
    </Text>

    {!isConfigured ? (
      <View style={styles.warningBlock}>
        <Text style={styles.warningLabel}>NOT CONFIGURED</Text>
        <Text style={styles.warningText}>
          WORLD_ID_APP_ID is not set in .env. Register an app at
          developer.worldcoin.org and rebuild to enable verification.
        </Text>
      </View>
    ) : null}

    {error ? (
      <View style={styles.errorBlock}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    ) : null}

    <TouchableOpacity
      style={[styles.primaryBtn, isVerifying && styles.primaryBtnBusy]}
      onPress={onVerify}
      disabled={isVerifying || !isConfigured}
      activeOpacity={0.7}>
      {isVerifying ? (
        <ActivityIndicator color={T.bgApp} />
      ) : (
        <Text style={styles.primaryBtnText}>VERIFY WITH WORLD ID</Text>
      )}
    </TouchableOpacity>
    <Text style={styles.fineprint}>
      A browser tab will open to id.worldcoin.org. Complete verification and
      you&rsquo;ll be returned here automatically.
    </Text>
  </>
);

const VerifiedState: React.FC<{
  verification: {
    nullifierHash: string;
    verificationLevel: 'orb' | 'device' | null;
    issuedAt: number;
  };
  onSignOut: () => void;
  isBusy: boolean;
}> = ({verification, onSignOut, isBusy}) => (
  <>
    <View style={styles.successBlock}>
      <Text style={styles.successLabel}>VERIFIED</Text>
      <Text style={styles.successTitle}>You&rsquo;re in.</Text>
      <Text style={styles.successSub}>
        Community voting and monthly free-submission credits are unlocked on
        your account.
      </Text>
    </View>

    <View style={styles.detailBlock}>
      <DetailRow
        label="NULLIFIER"
        value={shortHash(verification.nullifierHash)}
      />
      <DetailRow
        label="LEVEL"
        value={(verification.verificationLevel || 'unknown').toUpperCase()}
      />
      <DetailRow label="VERIFIED" value={formatDate(verification.issuedAt)} />
    </View>

    <TouchableOpacity
      style={styles.secondaryBtn}
      onPress={onSignOut}
      disabled={isBusy}
      activeOpacity={0.7}>
      <Text style={styles.secondaryBtnText}>REMOVE VERIFICATION</Text>
    </TouchableOpacity>
  </>
);

const DetailRow: React.FC<{label: string; value: string}> = ({label, value}) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: T.bgApp},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 52,
    paddingBottom: 16,
  },
  backSlot: {flex: 1},
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
    padding: 24,
    gap: 16,
  },
  heading: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 14,
    letterSpacing: 2,
    marginBottom: 8,
  },
  paragraph: {
    color: T.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  fineprint: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 8,
  },
  warningBlock: {
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderStyle: 'dashed' as any,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  warningLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 2,
  },
  warningText: {
    color: T.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  errorBlock: {
    borderWidth: 1,
    borderColor: T.red,
    borderRadius: 12,
    padding: 14,
  },
  errorText: {
    color: T.red,
    fontSize: 13,
    lineHeight: 20,
  },
  primaryBtn: {
    backgroundColor: T.gold,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    marginTop: 8,
  },
  primaryBtnBusy: {
    opacity: 0.8,
  },
  primaryBtnText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: '700',
  },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: T.borderStrong,
  },
  secondaryBtnText: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
  },
  successBlock: {
    borderWidth: 1,
    borderColor: T.gold,
    borderRadius: 12,
    padding: 18,
    gap: 6,
    backgroundColor: `${T.gold}10`,
  },
  successLabel: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 4,
  },
  successTitle: {
    color: T.textPrimary,
    fontSize: 20,
    fontWeight: '600',
    marginTop: 4,
  },
  successSub: {
    color: T.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  detailBlock: {
    borderWidth: 1,
    borderColor: T.borderStrong,
    borderRadius: 12,
    paddingVertical: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.borderStrong,
  },
  detailLabel: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 2,
  },
  detailValue: {
    color: T.textPrimary,
    fontFamily: 'monospace',
    fontSize: 13,
  },
});
