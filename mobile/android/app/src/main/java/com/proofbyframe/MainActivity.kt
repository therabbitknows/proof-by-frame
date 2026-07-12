package com.proofbyframe
import android.os.Bundle
import expo.modules.ReactActivityDelegateWrapper

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "proofbyframe"

  /**
   * Pass `null` to `super.onCreate(...)` so Android does NOT try to restore
   * the previous react-native-screens fragment state when the process is
   * recreated (background → memory pressure → relaunch). Without this,
   * the OS rebuilds the saved fragment hierarchy and ScreenFragment's init
   * trips
   *   java.lang.IllegalStateException: Screen fragments should never be restored.
   * Symptom on Seeker 2026-05-07: PROOF crashes the moment user reopens
   * after Android killed the process. Fix is the canonical react-native-
   * screens recommendation:
   *   https://github.com/software-mansion/react-native-screens/issues/17#issuecomment-424704067
   * Discarding savedInstanceState forces RN to re-render from scratch on
   * relaunch, which is what we want anyway (RN owns navigation state).
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      ReactActivityDelegateWrapper(this, BuildConfig.IS_NEW_ARCHITECTURE_ENABLED, DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled))
}
