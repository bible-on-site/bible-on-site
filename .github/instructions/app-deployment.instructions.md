---
description: "Android app deployment preferences — physical device, Nuke RunAndroid, PAD testing"
applyTo: "app/**"
---

# Android App Deployment

- Deploy to the **physical device**, never the emulator.
- Regular APKs: `dotnet nuke RunAndroid`.
- PAD testing: `bundletool build-apks` + `bundletool install-apks --local-testing`.
- Device pairs over ADB wireless; ask for pairing code/port when it is disconnected.
