---
description: "App (.NET MAUI) development, testing, running, and troubleshooting practices"
applyTo: "app/**"
---

# App (app/) Practices

## Legacy Reference

"Inspire from legacy app" = the untracked `legacy-app/` directory in the repo root.

## Agent behavior

- **Read the full terminal output of every command.** "Build FAILED", `error XA…`/`error CS…`, a non-zero exit, "Exception", or "FATAL" means report the failure with the error and fix it — never report success. For background processes, read the terminal file for the real output and exit state.
- After editing XAML or C#, run `dotnet build` from `app/BibleOnSite` (e.g. `-f net10.0-android`, `-f net10.0-windows10.0.19041.0`) and finish with 0 errors and 0 warnings.

## Testing

Orchestrate through the devops project:

| Task | Command |
| ---- | ------- |
| All Tests | `dotnet run --project devops -- Test` |
| Unit Only | `dotnet run --project devops -- TestUnit` |
| Integration | `dotnet run --project devops -- TestIntegration` |
| E2E (Windows) | `dotnet run --project devops -- TestE2E` |
| Unit Coverage | `dotnet run --project devops -- CoverageUnit` |
| Integration Coverage | `dotnet run --project devops -- CoverageIntegration` |

Integration tests use `[Trait("Category", "Integration")]` and need the API at `http://127.0.0.1:3003`. Unit tests: xUnit + FluentAssertions + Moq in `BibleOnSite.Tests`; E2E: FlaUI in `BibleOnSite.Tests.E2E`.

## Running the app (Android)

**Always use Nuke RunAndroid** to build and deploy; manual `dotnet build` only when debugging build issues.

### Nuke RunAndroid (REQUIRED)

From the **app** directory:

```bash
# One-shot build + install + launch (fast deploy after the first install)
dotnet run --project devops -- RunAndroid

# --full-apk     force full APK (embed native libs): first install, WiFi deploy, after wipe
# --fast-deploy  force incremental Fast Deployment
# --watch        dotnet watch hot reload
# --api-env prod use the production API instead of local
```

RunAndroid automatically starts the emulator and the API server (unless `--api-env prod`), chooses full APK (~90s, only when the app is not installed) or Fast Deployment (~18s incremental), then builds, installs, launches, and verifies the app (PID check, crash detection). After the first full install, fast deploy is automatic — `--full-apk` is only for a first install, WiFi deploy, or after a wipe.

**Run from `app/`**: Nuke looks for `.nuke` in the current directory and fails from the repo root with "Could not locate '.nuke' directory".

### Quick Launch Cheatsheet (manual)

```bash
# Stale dotnet processes (build lock errors)
cmd //c "taskkill /F /IM dotnet.exe"

# Fast Deploy from app/BibleOnSite (~10s incremental)
dotnet build -t:Install -f net10.0-android -c Debug

# Full APK (first deploy or after wipe, ~90s)
dotnet build -t:Install -f net10.0-android -c Debug --property:EmbedAssembliesIntoApk=true

# Force stop + launch (adb: $LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe)
adb shell am force-stop com.tanah.daily929
adb shell monkey -p com.tanah.daily929 -c android.intent.category.LAUNCHER 1

# Verify (PID if alive)
adb shell pidof com.tanah.daily929
```

**Always force-stop before launching after an install**, or Android may keep the old process alive.

### Fast Deployment vs Full APK

| Mode | Time | When |
|------|------|------|
| Fast Deployment | ~10-20s | app installed, incremental changes |
| Full APK | ~90s | first deploy, after emulator wipe, or crash with `libmonosgen-2.0.so not found` |

`BibleOnSite.csproj` sets `EmbedAssembliesIntoApk` for android Release only, so Debug uses Fast Deployment and Release embeds assemblies for distribution. Override with `--property:EmbedAssembliesIntoApk=true/false` or Nuke `--full-apk`/`--fast-deploy`.

### Troubleshooting RunAndroid

- **build.log locked** ("The process cannot access the file … `\.nuke\temp\build.log`"): `cmd //c "taskkill /F /IM dotnet.exe"`, or use the manual commands.
- **Crash with `libmonosgen-2.0.so not found`**: native libs missing — rerun with `--full-apk` (or `--property:EmbedAssembliesIntoApk=true`).
- **dotnet watch "Too many changes"**: use the one-shot `dotnet build -t:Install` instead of watch.

### Verify app is running

Never report success without checking; Nuke RunAndroid does this automatically, manual runs must too:

```bash
# Returns PID if running, empty if crashed
adb shell pidof com.tanah.daily929

# If crashed, check logcat
adb logcat -d -t 200 | grep -E "FATAL|AndroidRuntime|libmonosgen"
```

## Android deployment (manual / WiFi)

Fast Deployment does not push native libs over the network, so WiFi deploys crash with `libmonosgen-2.0.so not found` — use `--full-apk`. Prefer USB: WiFi needs the ~1 min full APK install, USB gets incremental deploys. Never hand-build with `--property:EmbedAssembliesIntoApk=true` (~3 min); Nuke's `--full-apk` reuses cached builds.

One-time pairing from the device's Wireless debugging screen: `adb pair <pairing-ip>:<pairing-port>` (6-digit code), `adb connect <ip>:<port>`, verify `adb devices -l`. Use the full adb path if it is not on PATH (`%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`).

```bash
dotnet run --project devops -- RunAndroid --full-apk   # from app/

# Nuke targets the emulator, so install to the WiFi device manually
adb -s <device-ip:port> install -r --no-incremental bin/Debug/net10.0-android/com.tanah.daily929-Signed.apk
adb -s <device-ip:port> shell am force-stop com.tanah.daily929
adb -s <device-ip:port> shell am start -n com.tanah.daily929/crc640368fd9db13d8734.MainActivity
```

## Troubleshooting Android

### Emulator storage full (ADB0060 InsufficientSpaceException)

`/data` fills with APKs and caches (use `$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe` on Windows):

```bash
adb shell 'df -h /data'                    # check space
adb shell 'rm -rf /data/local/tmp/*.apk'   # clear temporary APKs
adb shell 'pm uninstall com.tanah.daily929'
adb shell 'pm list packages -3'            # other 3rd-party apps to remove
adb shell 'pm trim-caches 2G'
```

Then touch a source file to trigger a `dotnet watch` rebuild.

### App crashes on startup (TargetInvocationException in XAML)

A crash during `InitializeComponent` usually means XAML references an `x:Name` that no longer exists, a missing `StaticResource`, or an invalid font icon code (5+ hex digits). Get the trace with `adb logcat -d | grep -A 50 "UNHANDLED EXCEPTION"`; when recent edits broke it, revert the `.xaml` and `.xaml.cs` together so they stay in sync.

### dotnet watch property syntax

`dotnet watch` reads `-p` as `--project`, so MSBuild properties need `--property:`:

```bash
dotnet watch build --property:EmbedAssembliesIntoApk=true
```

### Launch app manually after deployment

```bash
adb shell 'dumpsys package com.tanah.daily929 | grep -A 5 "Activity Resolver"'  # find activity
adb shell am start -n com.tanah.daily929/<activity-class>
```
