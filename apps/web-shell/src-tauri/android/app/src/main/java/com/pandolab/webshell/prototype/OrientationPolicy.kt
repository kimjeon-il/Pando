package com.pandolab.webshell.prototype

import android.content.pm.ActivityInfo

internal object OrientationPolicy {
  fun requestedOrientation(smallestScreenWidthDp: Int, inMultiWindow: Boolean): Int =
    if (smallestScreenWidthDp < 600 && !inMultiWindow) {
      ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    } else {
      ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
}
