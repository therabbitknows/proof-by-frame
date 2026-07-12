const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration — stock Expo + RN defaults.
 *
 * The @phantom/auth2 resolveRequest override was removed in Phase 3 of the
 * Solana Pay + Actions migration along with the rest of the Phantom SDK
 * surface. If Phantom Connect is re-introduced later, restore the resolver
 * override from commit history.
 */
module.exports = mergeConfig(getDefaultConfig(__dirname), {});
