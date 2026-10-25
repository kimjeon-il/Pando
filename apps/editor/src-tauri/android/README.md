# Android source ownership

This directory owns the app's Android activity, orientation policy, policy unit
tests, app Gradle configuration and Gradle resource limits. Edit these sources,
then run `node apps/editor/src-tauri/sync-android.mjs` from the repository root.
`src-tauri/gen/android` is the generated copy consumed by Gradle.

`init:android` reapplies these files after Tauri regeneration. `build:android`
reapplies and checks them before compiling, and Gradle `preBuild` checks them for
direct Gradle/Tauri builds. `sync-android.mjs --check` reports drift without
writing files. Other Tauri scaffold files remain owned by Tauri.

The activity requests sensor landscape in a regular fullscreen window with
`smallestScreenWidthDp < 600`. This permits both landscape directions. Large
screens and multi-window use the system orientation. Create, resume,
configuration and multi-window transitions all recalculate the request. The
Android platform ultimately determines the displayed orientation.

Edge-to-edge remains enabled. The manifest has no unconditional orientation
lock. SDK 37.0, disabled cleartext traffic and Gradle memory/worker limits are
preserved by the canonical build files.

Run the regeneration tests with:

```text
node --test apps/editor/tests/android-policy-sync.test.mjs
```

Only in a CI Android compiler job, run the Kotlin policy tests from
`src-tauri/gen/android`:

```text
gradlew.bat :app:testArm64DebugUnitTest -x :app:rustBuildArm64Debug --no-daemon --max-workers=2 --console=plain
```

These JVM tests verify the requested orientation policy. Physical rotation,
multi-window transitions, fold/unfold and WebView safe-area rendering still
require device or emulator verification.
