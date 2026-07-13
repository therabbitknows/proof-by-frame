package com.proofbyframe

import android.content.Intent
import android.net.Uri
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.worldcoin.idkit.Environment
import com.worldcoin.idkit.IDKit
import com.worldcoin.idkit.IDKitRequestConfig
import com.worldcoin.idkit.IDKitStatus
import com.worldcoin.idkit.RpContext
import com.worldcoin.idkit.idkitResultToJson
import com.worldcoin.idkit.orbLegacy
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class WorldIDModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  override fun getName(): String = "ProofWorldID"

  @ReactMethod
  fun verify(input: ReadableMap, promise: Promise) {
    scope.launch {
      try {
        val rp = input.getMap("rp_context")
          ?: throw IllegalArgumentException("rp_context is required")
        val environment = when (input.getString("environment")) {
          "staging" -> Environment.STAGING
          "production" -> Environment.PRODUCTION
          else -> throw IllegalArgumentException("World ID environment is invalid")
        }
        val config = IDKitRequestConfig(
          appId = input.requiredString("app_id"),
          action = input.requiredString("action"),
          rpContext = RpContext(
            rpId = rp.requiredString("rp_id"),
            nonce = rp.requiredString("nonce"),
            createdAt = rp.requiredWholeNumber("created_at").toULong(),
            expiresAt = rp.requiredWholeNumber("expires_at").toULong(),
            signature = rp.requiredString("signature"),
          ),
          actionDescription = null,
          bridgeUrl = null,
          allowLegacyProofs = true,
          overrideConnectBaseUrl = null,
          returnTo = input.getString("return_to"),
          environment = environment,
          connectUrlMode = null,
        )
        val request = IDKit.request(config).preset(
          orbLegacy(signal = input.requiredString("wallet_signal")),
        )
        if (request.connectorURI.isBlank()) {
          throw IllegalStateException("World ID connector URL was not created")
        }
        reactApplicationContext.startActivity(
          Intent(Intent.ACTION_VIEW, Uri.parse(request.connectorURI)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          },
        )
        var lastNetworkError: String? = null
        repeat(60) {
          when (val status = request.pollStatusOnce()) {
            is IDKitStatus.Confirmed -> {
              promise.resolve(idkitResultToJson(status.result))
              return@launch
            }
            is IDKitStatus.Failed -> {
              Log.w(TAG, "poll failed code=${status.error.rawValue}")
              promise.reject("WORLD_ID_${status.error.rawValue}", status.error.rawValue)
              return@launch
            }
            is IDKitStatus.NetworkingError -> {
              lastNetworkError = status.error.rawValue
              Log.w(TAG, "poll networking error code=$lastNetworkError")
            }
            IDKitStatus.AwaitingConfirmation,
            IDKitStatus.WaitingForConnection -> Unit
          }
          delay(2_000)
        }
        val timeoutCode = lastNetworkError ?: "timeout"
        Log.w(TAG, "poll exhausted code=$timeoutCode")
        promise.reject("WORLD_ID_$timeoutCode", timeoutCode)
      } catch (error: Throwable) {
        Log.e(TAG, "native request failed type=${error.javaClass.simpleName}")
        promise.reject("WORLD_ID_NATIVE_ERROR", "native_error")
      }
    }
  }

  override fun invalidate() {
    scope.cancel()
    super.invalidate()
  }

  companion object {
    private const val TAG = "ProofWorldID"
  }
}

private fun ReadableMap.requiredString(key: String): String =
  getString(key)?.takeIf(String::isNotBlank)
    ?: throw IllegalArgumentException("$key is required")

private fun ReadableMap.requiredWholeNumber(key: String): Long {
  val value = getDouble(key)
  if (!value.isFinite() || value < 0 || value % 1.0 != 0.0) {
    throw IllegalArgumentException("$key is invalid")
  }
  return value.toLong()
}
