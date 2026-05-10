/**
 * Proof by Frame — mobile companion.
 * Bare React Native 0.79, Android-first.
 *
 * Auth flow: Discord Sign In → Solana Pay → World ID → Submit → Vote → Blinks.
 * No vendor-locked wallet SDK at the root anymore; wallet interaction is
 * wallet-agnostic via Solana Pay URLs + MWA.
 */
import 'react-native-get-random-values';

import React from 'react';
import {StatusBar} from 'react-native';
import {LocalAuthProvider} from './src/hooks/useLocalAuth';
import {MWAWalletProvider} from './src/hooks/useMWAWallet';
import {DiscordAuthProvider} from './src/hooks/useDiscordAuth';
import {WorldIDAuthProvider} from './src/hooks/useWorldID';
import {SolanaPayConnectProvider} from './src/hooks/useSolanaPayConnect';
import {RootNavigator} from './src/navigation/RootNavigator';
import {SlabFrame} from './src/components/SlabFrame';

export default function App() {
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#0E0E0E" />
      <DiscordAuthProvider>
        <SolanaPayConnectProvider>
          <LocalAuthProvider>
            <MWAWalletProvider>
              {/* WorldIDAuthProvider depends on useSession (→ useMWAWallet
                  + useLocalAuth), so it must be nested INSIDE both wallet
                  providers. Otherwise useWorldID crashes at mount with
                  "useMWAWallet must be used within a MWAWalletProvider".
                  This applies after wiring useWorldID.verify() to POST
                  the id_token to PROOF backend (needs walletPubkey). */}
              <WorldIDAuthProvider>
                {/* SlabFrame wraps the entire app shell so every screen
                    (Home, Camera, Condition, Review, Submission, Result,
                    Vault, Wallet, Onboarding, World ID, Debug) reads as
                    if it's inside a graded card slab — gold 2px rim +
                    rounded 30/28 corners. */}
                <SlabFrame>
                  <RootNavigator />
                </SlabFrame>
              </WorldIDAuthProvider>
            </MWAWalletProvider>
          </LocalAuthProvider>
        </SolanaPayConnectProvider>
      </DiscordAuthProvider>
    </>
  );
}
