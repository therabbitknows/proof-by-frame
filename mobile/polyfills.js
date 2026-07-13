// Hermes does not provide the browser globals required by the Solana clients.
// This module is imported before App, so keep all runtime setup here.
import {Buffer} from 'buffer';
import {TextDecoder, TextEncoder} from 'text-encoding';
import 'react-native-get-random-values';

globalThis.Buffer ??= Buffer;
globalThis.TextEncoder ??= TextEncoder;
globalThis.TextDecoder ??= TextDecoder;
globalThis.atob ??= value => Buffer.from(value, 'base64').toString('binary');
globalThis.btoa ??= value => Buffer.from(value, 'binary').toString('base64');
