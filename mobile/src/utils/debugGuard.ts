/**
 * Build-gate for internal-only developer affordances.
 *
 * Source of truth: `DEBUG_TOOLS_ENABLED` env var, consumed via react-native-config
 * → `CONFIG.DEBUG_TOOLS_ENABLED`. Absent/empty → false (fail-safe).
 *
 * Internal dev builds: `.env` contains `DEBUG_TOOLS_ENABLED=true`.
 * Alpha tester builds: line removed or set to `false` before assembleDebug.
 */

import CONFIG from '../constants/config';

export const DEBUG_TOOLS_ENABLED = CONFIG.DEBUG_TOOLS_ENABLED === true;
