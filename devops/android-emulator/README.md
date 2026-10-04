# Windows Android emulator recovery

An emulator that freezes during Android boot can be crashing in its host graphics renderer. On the recitation QA laptop, even `-gpu swiftshader` loaded an unrelated 2023 ANGLE `libEGL.dll` and `libGLESv2.dll` from `C:\Windows\System32`. The crash dump reported an access violation in that `libGLESv2.dll`. Updating the emulator alone did not resolve the DLL collision.

Keep the system DLLs and the shared Android SDK intact. Make a private copy of the emulator runtime, and place that runtime's bundled SwiftShader DLLs beside its QEMU executables. Windows searches the executable directory before System32. Always start this private copy with `-gpu swiftshader`; its adjacent graphics DLLs are specific to that renderer.

Run this once from the repository root in PowerShell, with the SDK and source runtime paths adjusted if necessary. The destination must be new; no existing runtime or virtual device is replaced.

```powershell
$sdkDirectory = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$sourceRuntime = Join-Path $sdkDirectory 'emulator'
$qaRuntime = Join-Path (Get-Location).Path '.cache/android-emulator-qa'
if (Test-Path -LiteralPath $qaRuntime) { throw 'Choose a new private runtime directory.' }
Copy-Item -LiteralPath $sourceRuntime -Destination $qaRuntime -Recurse
foreach ($rendererDll in @('libEGL.dll', 'libGLESv2.dll', 'libGLES_CM.dll')) {
    Copy-Item -LiteralPath (Join-Path $qaRuntime "lib64/gles_swiftshader/$rendererDll") `
        -Destination (Join-Path $qaRuntime "qemu/windows-x86_64/$rendererDll")
}
```

Use a dedicated QA AVD, created with an installed x86_64 Android system image. The validated configuration used Android API 35, 2 GiB RAM, two cores, WHPX, no snapshots, and an isolated ADB server on port 5039. A fresh AVD needs room for the system image's minimum userdata size; reducing `disk.dataPartition.size` does not shrink that minimum. Clean disposable build outputs with the project's build tool if necessary, preserving the APK before cleaning. Do not remove source recordings, model caches, or another AVD to free space.

Start the QA device from the private runtime:

```powershell
$env:ANDROID_SDK_ROOT = $sdkDirectory
$env:ANDROID_ADB_SERVER_PORT = '5039'
$env:ADB_SERVER_SOCKET = 'tcp:127.0.0.1:5039'
$adbExecutable = Join-Path $sdkDirectory 'platform-tools/adb.exe'
& $adbExecutable -P 5039 start-server
& (Join-Path $qaRuntime 'emulator.exe') -avd Codex_Recitation_QA `
    -gpu swiftshader -feature -Vulkan -memory 2048 -cores 2 `
    -no-snapshot -no-boot-anim -no-audio -port 5562 `
    -no-direct-adb -delay-adb -adb-path $adbExecutable -verbose
```

Add `-no-window` for unattended testing. Check the verbose log for `Google SwiftShader` and verify that both graphics DLLs resolve inside the private runtime, never System32. In another terminal, `adb -P 5039 -s emulator-5562 shell getprop sys.boot_completed` must return `1` before installing or testing the app. Keep ADB commands scoped to that serial so a connected phone or another emulator is unaffected. Stop the QA emulator when testing is finished; recitation alignment does not require it.

This recovery was verified with emulator 37.2.12 from Google's SDK repository and the released app 5.0.106. The emulator completed boot, installed the release bundle's universal APK, and opened the reader. The installed shared SDK was preserved.

See [Android's graphics mode documentation](https://developer.android.com/studio/run/emulator-acceleration#graphics) and [Windows DLL search order](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-search-order).
