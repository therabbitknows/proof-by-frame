/**
 * wallet.ts — public contract.
 *
 * MWA wallet interface used throughout the app. The implementation
 * (multi-variant signAndSendTransactions for Phantom 26.6.0 quirks,
 * SIWS signMessages, MWA authorize flow, etc.) is held privately.
 *
 * Anything importing from this module will type-check; calling these
 * methods at runtime in the public source is not supported.
 */

export interface WalletConnectResult {
  pubkey: string;
}

export interface WalletSignAndSendResult {
  signature: string;
  error?: string;
}

export interface WalletService {
  connect(): Promise<WalletConnectResult | null>;
  disconnect(): Promise<void>;
  signMessageRaw(message: Uint8Array, address: string): Promise<Uint8Array | null>;
  signAndSendMemoTx(memo: string, address: string): Promise<WalletSignAndSendResult>;
  signAndSendListingMemoTx(memo: string, address: string): Promise<WalletSignAndSendResult>;
}

const NOT_IMPLEMENTED = "wallet.ts is a public contract stub; implementation is private";

class WalletServiceStub implements WalletService {
  async connect(): Promise<WalletConnectResult | null> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async disconnect(): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async signMessageRaw(): Promise<Uint8Array | null> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async signAndSendMemoTx(): Promise<WalletSignAndSendResult> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async signAndSendListingMemoTx(): Promise<WalletSignAndSendResult> {
    throw new Error(NOT_IMPLEMENTED);
  }
}

export const walletService: WalletService = new WalletServiceStub();
