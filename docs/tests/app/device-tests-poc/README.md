# Device-tests proof of concept (research for #3336)

Minimal upstream-style in-process device test app, Android only. Research
evidence — not built or tested by CI, not part of `bible-on-site.slnx`, kept
outside `app/` on purpose (the app NuGet-cache key hashes every `app/*.csproj`).

The runner (`Platforms/Android/Runner.cs`, `EntryPoints.cs`) is a trimmed,
hand-written equivalent of the vendored dotnet/maui headless runner used by
CommunityToolkit/Maui#3344 (~240 lines vs their ~70-file tree + source
generator, which emits the same manifest entries).

`Tests/` holds one parity test (assertions copied from
`BibleOnSite.Tests/Converters/PasukMarkerTextConverterTests` against the linked
production source — `csproj` links it, it is not copied) and six device-only
tests the portable suite cannot express.

## Run

```bash
dotnet tool install microsoft.dotnet.xharness.cli --tool-path ./tools \
  --version 11.0.0-prerelease.26466.1 \
  --add-source https://pkgs.dev.azure.com/dnceng/public/_packaging/dotnet-eng/nuget/v3/index.json

dotnet build -c Release -p:AndroidPackageFormat=apk -p:RunAOTCompilation=false

./tools/xharness android test \
  --app bin/Release/net10.0-android/com.bibleonsite.devicetests-Signed.apk \
  --package-name com.bibleonsite.devicetests \
  --instrumentation com.bibleonsite.devicetests.TestInstrumentation \
  --output-directory ./results --device-id <udid> --timeout 00:05:00
```

Requires an Android SDK, the `maui-android` workload and a booted emulator or
`-DeviceId` device. Release is required: Debug APKs ship no embedded assemblies
and abort on launch ("No assemblies found"). Measured output for the recorded
run is in `../device-tests-research.md` §4.
