import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useLocalAuth} from '../hooks/useLocalAuth';
import {useMWAWallet} from '../hooks/useMWAWallet';
import {useDiscordAuth} from '../hooks/useDiscordAuth';

// Screens
import {OnboardingScreen} from '../screens/OnboardingScreen';
import {EmailVerifyScreen} from '../screens/EmailVerifyScreen';
import {WorldIDScreen} from '../screens/WorldIDScreen';
import {HomeScreen} from '../screens/HomeScreen';
import {CameraScreenWrapper} from '../screens/CameraScreenWrapper';
import {ConditionScreen} from '../screens/ConditionScreen';
import {ReviewScreen} from '../screens/ReviewScreen';
import {SubmissionScreen} from '../screens/SubmissionScreen';
import {ResultScreen} from '../screens/ResultScreen';
import {SealedResultScreen} from '../screens/SealedResultScreen';
import {VaultScreen} from '../screens/VaultScreen';
import {WalletScreen} from '../screens/WalletScreen';
import {DebugScreen} from '../screens/DebugScreen';
import {DEBUG_TOOLS_ENABLED} from '../utils/debugGuard';

export type ConditionData = {
  corners: string;
  edges?: string;
  surface?: string;
  centering?: string;
  other?: string;
};

/** State of the baseline grade claim for a submission.
 *  - unverified_self_declared: user picked company/tier, no cert lookup (or
 *    cert lookup not attempted because company != PSA).
 *  - psa_verified_match: PSA API confirmed cert + grade matches the tier.
 *  - psa_verified_mismatch_override: PSA API returned cert but grade differs;
 *    user explicitly acknowledged the mismatch and proceeded.
 *  - psa_lookup_failed: cert lookup errored (no data, bad cert, network, etc.)
 *  - psa_lookup_timeout: 3-second client budget exceeded. */
export type BaselineVerificationStatus =
  | 'unverified_self_declared'
  | 'psa_verified_match'
  | 'psa_verified_mismatch_override'
  | 'psa_lookup_failed'
  | 'psa_lookup_timeout';

export type BaselineData = {
  company?: string;
  grade?: string;
  certNumber?: string;
  /** Set by ConditionScreen after the cert lookup settles. Persisted on
   *  the Submission record so the backend + Vault can show a PSA-verified
   *  badge or surface the override state on results. */
  verificationStatus?: BaselineVerificationStatus;
  /** Integer grade PSA returned for the cert (8, 9, 10). Kept alongside
   *  `grade` so the server-authoritative value survives even if the user
   *  overrides the displayed tier. */
  psaGradeValue?: number;
  /** Card name PSA returned for the cert. Kept for the Vault display. */
  psaCardName?: string;
};

export type RootStackParamList = {
  Onboarding: undefined;
  EmailVerify: {email: string};
  WorldID: undefined;
  Home: undefined;
  Camera: {captureMode: 'front' | 'back'; submissionId?: string; frontUri?: string};
  Condition: {frontUri: string; backUri: string};
  Review: {frontUri: string; backUri: string; condition: ConditionData; baselines?: BaselineData};
  Submission: {frontUri: string; backUri: string; condition: ConditionData; baselines?: BaselineData; cardLabel?: string};
  Result: {submissionId: string};
  SealedResult: {submissionId: string};
  Vault: undefined;
  Wallet: undefined;
  Debug: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  // Wallet paths feed the submission pipeline but do NOT unlock the app shell
  // on their own — Discord below does. We still wait for their restore calls
  // so the initial render doesn't flash the wrong stack.
  const {isLocallyAuthed, isLoading: isLocalLoading} = useLocalAuth();
  const {isLoading: isMWALoading} = useMWAWallet();
  const {isLinked: isDiscordLinked, isLoading: isDiscordLoading} = useDiscordAuth();

  // Demo Mode (local-only wallet) unlocks the app shell so judges and
  // first-time evaluators can walk the full submit→OCR→vote→seal flow without
  // a Discord round-trip. Discord remains the beta-operator-approval channel
  // and is surfaced inside Home when not linked. Per onboarding policy:
  // unverified users may submit / mint / bid; only voting + listing require
  // World ID onboarding.
  const isAuthed = isDiscordLinked || isLocallyAuthed;

  // NOTE: we used to auto-provision a local keypair here the moment Discord
  // approved, so drafts could persist under a stable wallet-scoped storage
  // bucket. That had two bad side effects: (1) the app looked like it was
  // permanently in Demo Mode because `isLocallyAuthed` was true before the
  // user picked a path, and (2) Discord sign-out flipped isAuthed off but the
  // local keypair remained, producing a confusing half-signed-out state.
  // SubmissionScreen's `ensurePubkey` now mints the keypair lazily on first
  // submit instead — identity is created when it's actually needed.

  if (isLocalLoading || isMWALoading || isDiscordLoading) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: {backgroundColor: '#0E0E0E'},
          animation: 'slide_from_right',
        }}>
        {!isAuthed ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="EmailVerify" component={EmailVerifyScreen} />
            <Stack.Screen name="WorldID" component={WorldIDScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="WorldID" component={WorldIDScreen} />
            <Stack.Screen name="Camera" component={CameraScreenWrapper} />
            <Stack.Screen name="Condition" component={ConditionScreen} />
            <Stack.Screen name="Review" component={ReviewScreen} />
            <Stack.Screen name="Submission" component={SubmissionScreen} />
            <Stack.Screen name="Result" component={ResultScreen} />
            <Stack.Screen name="SealedResult" component={SealedResultScreen} />
            <Stack.Screen name="Vault" component={VaultScreen} />
            <Stack.Screen name="Wallet" component={WalletScreen} />
            {DEBUG_TOOLS_ENABLED && (
              <Stack.Screen name="Debug" component={DebugScreen} />
            )}
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
