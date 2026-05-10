/**
 * Devnet memo signer — signs and sends SPL Memo transactions using the
 * Demo Mode local keypair stored by `useLocalAuth`.
 *
 * Scope: debug / proof-of-pipeline only. Not wired into the product submission flow.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
// Static import so Metro bundles tweetnacl in every build path, and so a
// missing/shape-broken module surfaces at module-load time instead of at
// first sign() call (which was coming through as an opaque
// "undefined is not a function" in the debug log).
import nacl from 'tweetnacl';
import CONFIG from '../constants/config';
import {loadLocalSecret} from './localSecret';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

function assertNaclReady(label: string): void {
  if (typeof nacl?.sign?.detached !== 'function') {
    throw new Error(
      `${label}: tweetnacl.sign.detached missing (nacl=${typeof nacl} sign=${typeof nacl?.sign}). ` +
        'Metro bundle likely lost tweetnacl — check polyfills.js ordering.',
    );
  }
}

export async function getLocalKeypair(): Promise<Keypair | null> {
  const stored = await loadLocalSecret();
  if (!stored) return null;
  const bytes = Uint8Array.from(stored.split(',').map(n => Number(n)));
  if (bytes.length !== 64) return null;
  return Keypair.fromSecretKey(bytes);
}

export async function getBalance(): Promise<number | null> {
  const keypair = await getLocalKeypair();
  if (!keypair) return null;
  const connection = new Connection(CONFIG.SOLANA_RPC_URL, 'confirmed');
  return connection.getBalance(keypair.publicKey);
}

export async function ensureFundedOnDevnet(
  connection: Connection,
  pubkey: PublicKey,
): Promise<void> {
  if (CONFIG.SOLANA_NETWORK !== 'devnet') return;
  const balance = await connection.getBalance(pubkey);
  if (balance > 0) return;
  const sig = await connection.requestAirdrop(pubkey, 1_000_000_000);
  await connection.confirmTransaction(sig, 'confirmed');
}

export async function signAndSendMemo(
  memo: string,
): Promise<{signature: string; pubkey: string}> {
  assertNaclReady('signAndSendMemo');
  const keypair = await getLocalKeypair();
  if (!keypair) {
    throw new Error('No local keypair — activate Demo Mode first.');
  }

  const connection = new Connection(CONFIG.SOLANA_RPC_URL, 'confirmed');
  await ensureFundedOnDevnet(connection, keypair.publicKey);

  const memoIx = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [],
    data: Buffer.from(memo, 'utf8'),
  });

  const tx = new Transaction().add(memoIx);
  tx.feePayer = keypair.publicKey;
  const {blockhash} = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.sign(keypair);

  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(signature, 'confirmed');
  return {signature, pubkey: keypair.publicKey.toBase58()};
}

export async function signTestMessage(
  message: string,
): Promise<{signatureHex: string; pubkey: string}> {
  assertNaclReady('signTestMessage');
  const keypair = await getLocalKeypair();
  if (!keypair) {
    throw new Error('No local keypair — activate Demo Mode first.');
  }
  const msgBytes = Buffer.from(message, 'utf8');
  const sig: Uint8Array = nacl.sign.detached(msgBytes, keypair.secretKey);
  const hex = Buffer.from(sig).toString('hex');
  return {signatureHex: hex, pubkey: keypair.publicKey.toBase58()};
}

export async function getRecentSignatures(
  limit = 5,
): Promise<{signature: string; blockTime: number | null; err: unknown}[]> {
  const keypair = await getLocalKeypair();
  if (!keypair) return [];
  const connection = new Connection(CONFIG.SOLANA_RPC_URL, 'confirmed');
  const sigs = await connection.getSignaturesForAddress(keypair.publicKey, {limit});
  return sigs.map(s => ({
    signature: s.signature,
    blockTime: s.blockTime ?? null,
    err: s.err,
  }));
}
