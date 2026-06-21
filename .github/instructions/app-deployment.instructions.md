---
description: "Android app deployment preferences — physical device, Nuke RunAndroid, PAD testing"
applyTo: "app/**"
---

# Android App Deployment

- **Always deploy to the physical device**, not the emulator.
- Use `dotnet nuke RunAndroid` for regular APK builds.
- For PAD (Play Asset Delivery) testing, build AAB with `bundletool build-apks` and `bundletool install-apks --local-testing`.
- The physical device connects via ADB wireless pairing — ask the user for pairing code/port if the device is disconnected.
