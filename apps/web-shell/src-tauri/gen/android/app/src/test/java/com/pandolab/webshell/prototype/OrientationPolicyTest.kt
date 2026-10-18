package com.pandolab.webshell.prototype

import android.content.pm.ActivityInfo
import org.junit.Assert.assertEquals
import org.junit.Test

class OrientationPolicyTest {
  @Test fun compactFullscreenAllowsBothLandscapeDirections() {
    for (width in listOf(320, 411, 599)) {
      assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, OrientationPolicy.requestedOrientation(width, false))
    }
  }

  @Test fun largeFullscreenUsesSystemOrientationAtThe600DpBoundary() {
    for (width in listOf(600, 840, 1280)) {
      assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, OrientationPolicy.requestedOrientation(width, false))
    }
  }

  @Test fun everyMultiwindowSizeUsesSystemOrientation() {
    for (width in listOf(320, 599, 600, 840)) {
      assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, OrientationPolicy.requestedOrientation(width, true))
    }
  }

  @Test fun returningToFullscreenAndUnfoldingRecomputesThePolicy() {
    assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, OrientationPolicy.requestedOrientation(411, false))
    assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, OrientationPolicy.requestedOrientation(411, true))
    assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, OrientationPolicy.requestedOrientation(411, false))
    assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, OrientationPolicy.requestedOrientation(840, false))
  }
}
