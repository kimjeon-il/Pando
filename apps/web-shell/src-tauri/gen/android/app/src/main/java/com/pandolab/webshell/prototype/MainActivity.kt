package com.pandolab.webshell.prototype

import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    addOnMultiWindowModeChangedListener { info ->
      applyOrientationPolicy(resources.configuration, info.isInMultiWindowMode)
    }
    applyOrientationPolicy()
  }

  override fun onResume() {
    super.onResume()
    applyOrientationPolicy()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applyOrientationPolicy(newConfig)
  }

  private fun applyOrientationPolicy(
    configuration: Configuration = resources.configuration,
    inMultiWindow: Boolean = isInMultiWindowMode
  ) {
    val orientation = OrientationPolicy.requestedOrientation(configuration.smallestScreenWidthDp, inMultiWindow)
    if (requestedOrientation != orientation) requestedOrientation = orientation
  }
}
