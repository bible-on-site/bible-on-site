#if ANDROID
using Android.Gms.Extensions;
using Xamarin.Google.Android.Play.Core.AssetPacks;
using Xamarin.Google.Android.Play.Core.AssetPacks.Model;
#elif IOS || MACCATALYST
using BackgroundAssets;
using Foundation;
using System.Runtime.Versioning;
#endif
using System.Net.Http;

namespace BibleOnSite.Services;

/// <summary>
/// On-demand asset delivery service.
/// Android: Play Asset Delivery via AssetPackManager.
/// iOS: Apple Background Assets via BAAssetPackManager (managed asset packs).
/// Other platforms: no-op.
/// </summary>
public sealed partial class PadDeliveryService : IPadDeliveryService
{
    private const string PerushimNotesPackName = "perushim_notes";

    internal static string PayloadFileName(string packName) => packName == PerushimNotesPackName
        ? "sefaria-dump-5784-sivan-4.perushim_notes.sqlite" : packName + ".zip";

    /// <summary>
    /// Pack payload files published on the app-v* GitHub release — the delivery
    /// path for runtimes where managed asset packs cannot exist (iOS/MacCatalyst
    /// below 26, or builds without the app-group entitlement). The first entry
    /// is the required payload; later entries are best-effort companions (the
    /// prebuilt search index — the app rebuilds it on-device when absent).
    /// </summary>
    internal static IReadOnlyList<string> ReleasePayloadFiles(string packName)
    {
        var files = new List<string> { PayloadFileName(packName) };
        if (packName == PerushimNotesPackName)
        {
            files.Add(PerushimNotesService.SearchIndexDbName);
        }
        return files;
    }

    /// <summary>Release-asset URL a pack payload is published under for this app version.</summary>
    internal static Uri ReleasePayloadUri(IAppInfo appInfo, string fileName)
    {
        return new Uri(
            $"https://github.com/bible-on-site/bible-on-site/releases/download/app-v{appInfo.VersionString}/{fileName}");
    }

    /// <summary>
    /// Streams each release-published payload file into the pack's cache dir
    /// through a ".download" temp + rename, so an interrupted fetch never leaves
    /// a partial file that <see cref="TryGetAssetPathAsync"/> would then serve.
    /// Returns the failure reason, or null once the required payload landed;
    /// optional companions are skipped best-effort.
    /// </summary>
    internal static async Task<string?> DownloadReleasePayloadsAsync(
        HttpClient client, IAppInfo appInfo, string packName, string cacheDir,
        IProgress<double>? progress, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(cacheDir);
        var files = ReleasePayloadFiles(packName);
        for (var index = 0; index < files.Count; index++)
        {
            var fileName = files[index];
            try
            {
                await DownloadReleaseFileAsync(client, ReleasePayloadUri(appInfo, fileName),
                    Path.Join(cacheDir, fileName),
                    new ScaledProgress(index, files.Count, progress),
                    cancellationToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                if (index == 0)
                {
                    return $"{ex.GetType().Name}: {ex.Message}";
                }
                System.Diagnostics.Debug.WriteLine(
                    $"Optional release payload '{fileName}' unavailable: {ex.Message}");
            }
        }
        return null;
    }

    private static async Task DownloadReleaseFileAsync(
        HttpClient client, Uri uri, string destination,
        IProgress<double> progress, CancellationToken cancellationToken)
    {
        using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        var expected = response.Content.Headers.ContentLength;
        var temporary = destination + ".download";
        try
        {
            long received = 0;
            await using (var source = await response.Content.ReadAsStreamAsync(cancellationToken))
            await using (var target = File.Create(temporary))
            {
                var buffer = new byte[81920];
                int read;
                while ((read = await source.ReadAsync(buffer, cancellationToken)) > 0)
                {
                    await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                    received += read;
                    if (expected > 0)
                    {
                        progress.Report(Math.Clamp((double)received / expected.Value, 0, 1));
                    }
                }
            }
            if (expected.HasValue && received != expected.Value)
            {
                throw new IOException($"Truncated payload: received {received} of {expected} bytes");
            }
            File.Move(temporary, destination, overwrite: true);
        }
        finally { File.Delete(temporary); }
    }

    /// <summary>
    /// Synchronous per-file progress adapter: maps a file's 0–1 fraction into
    /// its slice of the whole payload set, so reports stay ordered across files.
    /// </summary>
    private sealed class ScaledProgress(int index, int count, IProgress<double>? inner) : IProgress<double>
    {
        public void Report(double value) =>
            inner?.Report((index + Math.Clamp(value, 0, 1)) / count);
    }

    public static IPadDeliveryService Instance { get; } = new PadDeliveryService();

    private PadDeliveryService() { }

    internal static string AssetPackCacheDirectory(IFileSystem fileSystem, IAppInfo appInfo, string packName)
    {
        // Extracted asset-pack data belongs to this app build, just like the store resource.
        var generation = $"{appInfo.VersionString}-{appInfo.BuildString}";
        var root = Path.Join(fileSystem.CacheDirectory, "asset_packs");
        // Every ODR access sweeps stale generations: prior {version}-{build}
        // directories (and any legacy unversioned pack dirs) are app-owned
        // cache the OS will not reclaim.
        SweepStaleAssetPackGenerations(root, generation);
        var dir = Path.Join(root, generation, packName);
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static void SweepStaleAssetPackGenerations(string odrRoot, string currentGeneration)
    {
        try
        {
            if (!Directory.Exists(odrRoot))
            {
                return;
            }

            foreach (var stale in Directory.EnumerateDirectories(odrRoot).ToList())
            {
                if (Path.GetFileName(stale) == currentGeneration)
                {
                    continue;
                }

                try { Directory.Delete(stale, true); }
                // Cleanup is best-effort: only IO failures are swallowed.
                catch (IOException ex) { LogAssetPackSweepFailure(ex); }
                catch (UnauthorizedAccessException ex) { LogAssetPackSweepFailure(ex); }
            }
        }
        catch (IOException ex) { LogAssetPackSweepFailure(ex); }
        catch (UnauthorizedAccessException ex) { LogAssetPackSweepFailure(ex); }
    }

    private static void LogAssetPackSweepFailure(Exception ex) =>
        System.Diagnostics.Debug.WriteLine($"Asset-pack stale generation cleanup: {ex.Message}");

    /// <inheritdoc />
    public Task<string?> TryGetAssetPathAsync(string packName, CancellationToken cancellationToken = default)
    {
#if ANDROID
        return TryGetAssetPathAndroidAsync(packName);
#elif IOS || MACCATALYST
        return TryGetAssetPathIosAsync(packName, cancellationToken);
#else
        return Task.FromResult<string?>(null);
#endif
    }

    /// <inheritdoc />
    public Task<bool> FetchAsync(
        string packName,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
#if ANDROID
        return FetchAndroidAsync(packName, progress, cancellationToken);
#elif IOS || MACCATALYST
        return FetchIosAsync(packName, progress, cancellationToken);
#else
        return Task.FromResult(false);
#endif
    }

    /// <inheritdoc />
    public Task<List<string>> GetDeliveryDiagnosticsAsync(string packName)
    {
#if ANDROID
        return GetDeliveryDiagnosticsAndroidAsync(packName);
#elif IOS || MACCATALYST
        return GetDeliveryDiagnosticsIosAsync(packName);
#else
        return Task.FromResult(new List<string> { "Platform: no on-demand delivery support" });
#endif
    }
}

#if ANDROID
partial class PadDeliveryService
{
    /// <summary>Last PAD fetch error or reason (for support diagnostics).</summary>
    internal static string? LastAndroidPadError { get; private set; }

    private static IAssetPackManager? GetAssetPackManager()
    {
        // Prefer Activity; fall back to Application context so Fetch/diagnostics work when
        // CurrentActivity is briefly null (e.g. background callbacks).
        var ctx = Platform.CurrentActivity ?? Android.App.Application.Context;
        return ctx != null ? AssetPackManagerFactory.GetInstance(ctx) : null;
    }

    private static Task<string?> TryGetAssetPathAndroidAsync(string packName)
    {
        var manager = GetAssetPackManager();
        if (manager == null)
        {
            return Task.FromResult<string?>(null);
        }

        try
        {
            var location = manager.GetPackLocation(packName);
            return Task.FromResult(location?.AssetsPath());
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"PAD GetPackLocation failed: {ex.Message}");
            return Task.FromResult<string?>(null);
        }
    }

    private static async Task<bool> FetchAndroidAsync(
        string packName,
        IProgress<double>? progress,
        CancellationToken cancellationToken)
    {
        LastAndroidPadError = null;
        var manager = GetAssetPackManager();
        if (manager == null)
        {
            LastAndroidPadError = "AssetPackManager unavailable (no Activity/Application context).";
            return false;
        }

        try
        {
            var location = manager.GetPackLocation(packName);
            if (location?.AssetsPath() != null)
            {
                return true;
            }

            var listener = new AssetPackStateUpdateListenerWrapper();
            string? failure = null;
            listener.StateUpdate += (_, e) =>
            {
                if (e.State?.Name() != packName)
                {
                    return;
                }

                var status = e.State?.Status() ?? 0;
                if ((status == (int)AssetPackStatus.Downloading || status == (int)AssetPackStatus.Transferring) && e.State != null)
                {
                    var total = e.State.TotalBytesToDownload();
                    var downloaded = e.State.BytesDownloaded();
                    if (total > 0)
                    {
                        progress?.Report((double)downloaded / total);
                    }
                }
                else if (status == (int)AssetPackStatus.WaitingForWifi)
                {
                    var activity = Platform.CurrentActivity;
                    if (activity != null)
                    {
                        manager.ShowConfirmationDialog(activity);
                    }
                }
                else if (status == (int)AssetPackStatus.Failed || status == (int)AssetPackStatus.Canceled)
                {
                    failure = $"Pack '{packName}' ended with status {status}, error {e.State?.ErrorCode()}";
                }
            };

            manager.RegisterListener(listener.Listener!);

            try
            {
                await manager.Fetch(new[] { packName })!.AsAsync<Java.Lang.Object>();
                cancellationToken.ThrowIfCancellationRequested();

                // In local-testing mode (bundletool --local-testing), the
                // FakeAssetPackService extracts the pack asynchronously after
                // Fetch resolves. Poll until the location becomes available.
                for (var attempt = 0; attempt < 3600; attempt++)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (failure != null)
                    {
                        LastAndroidPadError = failure;
                        return false;
                    }
                    var fetchedLocation = manager.GetPackLocation(packName);
                    if (fetchedLocation?.AssetsPath() != null)
                    {
                        return true;
                    }

                    await Task.Delay(500, cancellationToken);
                }

                LastAndroidPadError =
                    $"Pack '{packName}' did not become available within 30 minutes.";
                return false;
            }
            finally
            {
                manager.UnregisterListener(listener.Listener!);
            }
        }
        catch (OperationCanceledException)
        {
            manager.Cancel(new[] { packName });
            throw;
        }
        catch (Exception ex)
        {
            LastAndroidPadError = $"{ex.GetType().Name}: {ex.Message}";
            System.Diagnostics.Debug.WriteLine($"PAD Fetch failed: {ex.Message}");
            return false;
        }
    }

    private static Task<List<string>> GetDeliveryDiagnosticsAndroidAsync(string packName)
    {
        var lines = new List<string> { "--- PAD (Android) delivery diagnostics ---" };
        lines.Add($"CurrentActivity: {(Platform.CurrentActivity != null ? "present" : "null")}");
        AppendInstallSourceLines(lines);

        if (!string.IsNullOrEmpty(LastAndroidPadError))
        {
            lines.Add($"Last PAD fetch error: {LastAndroidPadError}");
        }

        var manager = GetAssetPackManager();
        if (manager == null)
        {
            lines.Add("AssetPackManager: null (no Context)");
            lines.Add(
                "Hint: On-demand asset packs require an install from Google Play. Sideloaded APKs/AAB splits do not expose PAD.");
            return Task.FromResult(lines);
        }

        try
        {
            var location = manager.GetPackLocation(packName);
            lines.Add($"GetPackLocation('{packName}'): {(location != null ? $"path={location.AssetsPath()}" : "(null)")}");
            if (location == null)
            {
                lines.Add(
                    "If (null) after install from Play: the AAB may have been built without the perushim_notes asset pack (missing .sqlite at CI package time), or the app was not installed from Play.");
            }
        }
        catch (Exception ex)
        {
            lines.Add($"GetPackLocation error: {ex.Message}");
        }

        return Task.FromResult(lines);
    }

    private static void AppendInstallSourceLines(List<string> lines)
    {
        try
        {
            var ctx = Android.App.Application.Context;
            var pm = ctx.PackageManager;
            var pn = ctx.PackageName;
            if (pm == null || pn == null)
            {
                lines.Add("Install source: (unavailable)");
                return;
            }

#pragma warning disable CA1416 // Guarded by runtime SdkInt check; R/GetInstallSourceInfo require API 30+
            if ((int)Android.OS.Build.VERSION.SdkInt >= (int)Android.OS.BuildVersionCodes.R)
            {
                var info = pm.GetInstallSourceInfo(pn);
                var installing = info?.InstallingPackageName;
                lines.Add($"Install source (API {(int)Android.OS.BuildVersionCodes.R}+): {installing ?? "(null — not from a package installer, e.g. adb/sideload)"}");
                if (installing != "com.android.vending")
                {
                    lines.Add("PAD: On-demand packs are served for installs from Google Play (installer com.android.vending). Other sources often cannot download PAD.");
                }
            }
#pragma warning restore CA1416
            else
            {
#pragma warning disable CA1422 // GetInstallerPackageName deprecated — used only below API R (30)
                var legacy = pm.GetInstallerPackageName(pn);
#pragma warning restore CA1422
                lines.Add($"Installer package: {legacy ?? "(null)"}");
            }
        }
        catch (Exception ex)
        {
            lines.Add($"Install source error: {ex.Message}");
        }
    }
}
#endif

#if IOS || MACCATALYST
// Apple obsoleted On-Demand Resources (NSBundleResourceRequest) in the iOS 27 SDK and
// directs delivery to the Background Assets framework; this leg uses the managed
// asset-pack API (BAAssetPackManager, iOS 26+) with Apple-hosted packs.
// https://github.com/bible-on-site/bible-on-site/issues/2036
partial class PadDeliveryService
{
    /// <summary>Last Background Assets fetch error or reason (for support diagnostics).</summary>
    internal static string? LastIosDeliveryError { get; private set; }

    // Referencing BAAssetPackManager.SharedManager opts the app into managed asset
    // packs; installing its delegate at launch lets resumed downloads report
    // progress and completion before the first fetch runs.
    private static AssetPackDownloadEvents? _downloadEvents;

    // Infinite client timeout — payloads run hundreds of MB and cancellation is
    // owned by the caller's token, not by an arbitrary clock.
    private static readonly Lazy<HttpClient> _releasePayloadClient =
        new(() => new HttpClient { Timeout = Timeout.InfiniteTimeSpan });

    private static string? BaAppGroupId =>
        NSBundle.MainBundle.ObjectForInfoDictionary("BAAppGroupID")?.ToString();

    /// <summary>
    /// Managed asset packs are usable only on iOS/MacCatalyst 26+ while the shared
    /// app-group container is reachable. The container is granted by the
    /// app-groups codesign entitlement, which unsigned simulator builds (Appium
    /// CI) do not carry — BAAssetPackManager.SharedManager validates it once and
    /// calls Swift fatalError when the group is inaccessible (observed as an
    /// EXC_BREAKPOINT at launch in AssetPackManager.swift). Because that abort is
    /// not catchable, every SharedManager access is gated on this probe — which
    /// asks for exactly what the framework checks — rather than on the OS
    /// version or simulator detection alone.
    /// </summary>
    [SupportedOSPlatformGuard("ios26.0")]
    [SupportedOSPlatformGuard("maccatalyst26.0")]
    private static bool ManagedDeliverySupported
    {
        get
        {
#if MACCATALYST
            if (!OperatingSystem.IsMacCatalystVersionAtLeast(26))
#else
            if (!OperatingSystem.IsIOSVersionAtLeast(26))
#endif
            {
                return false;
            }

            var groupId = BaAppGroupId;
            return !string.IsNullOrEmpty(groupId)
                && NSFileManager.DefaultManager.GetContainerUrl(groupId) != null;
        }
    }

    /// <summary>
    /// Installs the managed asset-pack download delegate. Called once at app
    /// startup (MauiProgram) so that downloads resumed by the system after an
    /// update report into this service.
    /// </summary>
    internal static void ConfigureBackgroundAssets()
    {
        if (!ManagedDeliverySupported)
        {
            return;
        }

        _downloadEvents ??= new AssetPackDownloadEvents();
        BAAssetPackManager.SharedManager.Delegate = _downloadEvents;
    }

    private static string AssetPackCacheDir(string packName)
    {
        return AssetPackCacheDirectory(FileSystem.Current, AppInfo.Current, packName);
    }

    private static async Task<string?> TryGetAssetPathIosAsync(string packName, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var cacheDir = AssetPackCacheDir(packName);
        // A partial extraction must not hide a missing prebuilt index.
        if (File.Exists(Path.Join(cacheDir, PayloadFileName(packName))) &&
            (packName != PerushimNotesPackName || File.Exists(Path.Join(cacheDir, PerushimNotesService.SearchIndexDbName))))
        {
            return cacheDir;
        }

        if (!ManagedDeliverySupported)
        {
            return null;
        }

        try
        {
            if (!IsAssetPackLocallyAvailable(packName))
            {
                System.Diagnostics.Debug.WriteLine($"BA: asset pack '{packName}' is not downloaded yet");
                return null;
            }

            ct.ThrowIfCancellationRequested();
            return await SaveAssetPackPayloadAsync(cacheDir, packName);
        }
        catch (Exception ex)
        {
            ct.ThrowIfCancellationRequested();
            System.Diagnostics.Debug.WriteLine($"BA TryGetAssetPath failed: {ex.Message}");
            return null;
        }
    }

    private static async Task<bool> FetchIosAsync(
        string packName,
        IProgress<double>? progress,
        CancellationToken ct)
    {
        LastIosDeliveryError = null;
        var cacheDir = AssetPackCacheDir(packName);
        try
        {
            // An extracted payload remains usable even if the OS evicts its
            // pack — but a partial extraction must not hide a missing index.
            if (File.Exists(Path.Join(cacheDir, PayloadFileName(packName))) &&
                (packName != PerushimNotesPackName || File.Exists(Path.Join(cacheDir, PerushimNotesService.SearchIndexDbName))))
            {
                return true;
            }

            string? failure = null;
            if (ManagedDeliverySupported)
            {
                failure = await TryFetchManagedPackAsync(packName, cacheDir, progress, ct);
                if (failure == null)
                {
                    return true;
                }

                // A managed fetch can still fail — the pack may not be
                // registered with the store yet, or the system download may
                // error — so fall through to the release leg rather than
                // stranding the device when the same bytes are published.
                System.Diagnostics.Debug.WriteLine($"BA: managed fetch failed, trying release payload: {failure}");
            }

            // Managed asset packs cannot exist below iOS/MacCatalyst 26 and
            // need the app-group entitlement unsigned builds lack, so those
            // runtimes download the same release-coupled payloads from the
            // app-v* GitHub release into this same extraction cache.
            var releaseFailure = await DownloadReleasePayloadsAsync(
                _releasePayloadClient.Value, AppInfo.Current, packName, cacheDir, progress, ct);
            if (releaseFailure == null)
            {
                return true;
            }

            LastIosDeliveryError = failure == null
                ? $"Release-payload download failed: {releaseFailure}"
                : $"Managed fetch: {failure}; release fallback: {releaseFailure}";
            System.Diagnostics.Debug.WriteLine($"BA: {LastIosDeliveryError}");
            return false;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (NSErrorException ex)
        {
            ct.ThrowIfCancellationRequested();
            LastIosDeliveryError = $"EnsureLocalAvailability failed: {ex.Error.LocalizedDescription}";
            System.Diagnostics.Debug.WriteLine($"BA: {LastIosDeliveryError}");
            return false;
        }
        catch (Exception ex)
        {
            ct.ThrowIfCancellationRequested();
            LastIosDeliveryError = $"{ex.GetType().Name}: {ex.Message}";
            System.Diagnostics.Debug.WriteLine($"BA Fetch failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Managed asset-pack leg of <see cref="FetchIosAsync"/>: null on success,
    /// an error string when the pack could not be delivered or extracted.
    /// Call only when <see cref="ManagedDeliverySupported"/> is true.
    /// </summary>
    [SupportedOSPlatform("ios26.0")]
    [SupportedOSPlatform("maccatalyst26.0")]
    private static async Task<string?> TryFetchManagedPackAsync(
        string packName,
        string cacheDir,
        IProgress<double>? progress,
        CancellationToken ct)
    {
        // Same short-circuit the ODR path had: an already-downloaded pack only
        // needs extraction, not a store round-trip.
        if (IsAssetPackLocallyAvailable(packName))
        {
            return await SaveAssetPackPayloadAsync(cacheDir, packName) != null
                ? null
                : "downloaded asset pack did not contain its payload";
        }

        var pack = await ResolveAssetPackAsync(packName);
        if (pack == null)
        {
            return $"Asset pack '{packName}' is not declared in the Background Assets manifest.";
        }

        ConfigureBackgroundAssets();
        using var subscription = _downloadEvents?.Subscribe(packName, progress);
        using var cancellation = ct.Register(() => CancelAssetPackDownload(pack));

        // EnsureLocalAvailability completes with a faulted task on NSError.
        var ensure = BAAssetPackManager.SharedManager.EnsureLocalAvailabilityAsync(pack);
        var completed = await Task.WhenAny(ensure, Task.Delay(Timeout.Infinite, ct));
        if (completed != ensure)
        {
            ct.ThrowIfCancellationRequested();
        }

        try
        {
            await ensure;
        }
        catch (NSErrorException ex)
        {
            ct.ThrowIfCancellationRequested();
            return $"EnsureLocalAvailability failed: {ex.Error.LocalizedDescription}";
        }
        return await SaveAssetPackPayloadAsync(cacheDir, packName) != null
            ? null
            : "downloaded asset pack did not contain its payload";
    }

    /// <summary>
    /// Resolves the store-registered asset pack for this identifier. Uses the
    /// enumeration API rather than GetAssetPack, which the iOS 27 SDK deprecates.
    /// </summary>
    [SupportedOSPlatform("ios26.0")]
    [SupportedOSPlatform("maccatalyst26.0")]
    private static async Task<BAAssetPack?> ResolveAssetPackAsync(string packName)
    {
        if (!ManagedDeliverySupported)
        {
            return null;
        }

        try
        {
            var packs = await BAAssetPackManager.SharedManager.GetAllAssetPacksAsync();
            return packs.Cast<BAAssetPack>().FirstOrDefault(p => p.Identifier == packName);
        }
        catch (NSErrorException ex)
        {
            System.Diagnostics.Debug.WriteLine($"BA: asset pack '{packName}' lookup failed: {ex.Error.LocalizedDescription}");
            return null;
        }
    }

    /// <summary>
    /// Whether the pack's payload is already on the device. iOS 26.4 has a
    /// synchronous probe; earlier releases surface the same answer through the
    /// content lookup's error.
    /// </summary>
    [SupportedOSPlatform("ios26.0")]
    [SupportedOSPlatform("maccatalyst26.0")]
    private static bool IsAssetPackLocallyAvailable(string packName)
    {
        if (!ManagedDeliverySupported)
        {
            return false;
        }

#if MACCATALYST
        if (OperatingSystem.IsMacCatalystVersionAtLeast(26, 4))
#else
        if (OperatingSystem.IsIOSVersionAtLeast(26, 4))
#endif
        {
            return BAAssetPackManager.SharedManager.IsAssetPackAvailableLocally(packName);
        }

        using var data = BAAssetPackManager.SharedManager.GetContents(
            PayloadFileName(packName), packName, NSDataReadingOptions.Mapped, out _);
        return data != null;
    }

    /// <summary>
    /// Copies the payload out of the downloaded asset pack into the versioned
    /// extraction cache, matching the previous ODR extraction semantics: callers
    /// always consume a plain directory path and a stale build's data is never reused.
    /// The perushim pack also carries the prebuilt search index — save it too
    /// when present so both files reach the delivery dir.
    /// </summary>
    [SupportedOSPlatform("ios26.0")]
    [SupportedOSPlatform("maccatalyst26.0")]
    private static async Task<string?> SaveAssetPackPayloadAsync(string cacheDir, string packName)
    {
        if (!await SavePackFileAsync(cacheDir, packName, PayloadFileName(packName), required: true))
        {
            return null;
        }
        if (packName == PerushimNotesPackName)
        {
            if (!await SavePackFileAsync(cacheDir, packName, PerushimNotesService.SearchIndexDbName, required: true))
            {
                return null;
            }
        }
        return cacheDir;
    }

    [SupportedOSPlatform("ios26.0")]
    [SupportedOSPlatform("maccatalyst26.0")]
    private static async Task<bool> SavePackFileAsync(string cacheDir, string packName, string relative, bool required)
    {
        using var data = BAAssetPackManager.SharedManager.GetContents(
            relative, packName, NSDataReadingOptions.Mapped, out var error);
        if (data == null)
        {
            if (required)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"BA: contents for '{relative}' in pack '{packName}' failed: {error?.LocalizedDescription ?? "unavailable"}");
            }
            return false;
        }

        System.Diagnostics.Debug.WriteLine($"BA: '{relative}' loaded, length={data.Length}");

        // `relative` names a file inside the pack. If it were ever rooted or
        // contained '..', Path.Combine would silently drop cacheDir — refuse to
        // write outside the extraction cache rather than trust pack contents.
        var destPath = Path.GetFullPath(Path.Combine(cacheDir, relative));
        var cacheRoot = Path.GetFullPath(cacheDir) + Path.DirectorySeparatorChar;
        if (!destPath.StartsWith(cacheRoot, StringComparison.OrdinalIgnoreCase))
        {
            System.Diagnostics.Debug.WriteLine($"BA: refusing out-of-cache path '{relative}'");
            return false;
        }
        try
        {
            // Keep the native asset lookup and lifetime on the caller's context,
            // but extracting the full notes/index payload must not block its UI.
            await Task.Run(() =>
            {
                using var stream = data.AsStream();
                var temporary = destPath + ".download";
                try
                {
                    using (var fileStream = File.Create(temporary))
                    {
                        stream.CopyTo(fileStream);
                    }

                    File.Move(temporary, destPath, true);
                }
                finally { File.Delete(temporary); }
            });
            System.Diagnostics.Debug.WriteLine($"BA: saved to {destPath}");
            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"BA: save failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Best-effort cancellation of an in-flight managed pack download. The system
    /// owns managed downloads, so a rejected cancel is logged rather than thrown.
    /// </summary>
    [SupportedOSPlatform("ios26.0")]
    [SupportedOSPlatform("maccatalyst26.0")]
    private static void CancelAssetPackDownload(BAAssetPack pack)
    {
        try
        {
            using var download = pack.Download(BAContentRequest.Install);
            var cancelled = BADownloadManager.SharedManager.CancelDownload(download, out var error);
            if (!cancelled)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"BA: cancel for '{pack.Identifier}' did not apply: {error?.LocalizedDescription ?? "not scheduled"}");
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"BA: cancel failed: {ex.Message}");
        }
    }

    private static async Task<List<string>> GetDeliveryDiagnosticsIosAsync(string packName)
    {
        var lines = new List<string> { "--- Background Assets (iOS) delivery diagnostics ---" };

        var cacheDir = AssetPackCacheDir(packName);
        var cachedFile = Path.Join(cacheDir, PayloadFileName(packName));
        lines.Add($"Cache dir: {cacheDir}");
        lines.Add($"Cached file exists: {File.Exists(cachedFile)}");
        if (File.Exists(cachedFile))
        {
            try
            {
                var fi = new FileInfo(cachedFile);
                lines.Add($"Cached file size: {fi.Length} bytes");
            }
            catch (Exception ex)
            {
                lines.Add($"Cached file info error: {ex.Message}");
            }
        }

        // Everything above this point is safe on any build; the SharedManager
        // probes below would abort the process when the app-group container is
        // inaccessible (see ManagedDeliverySupported).
        try
        {
            var info = NSBundle.MainBundle;
            lines.Add($"BAHasManagedAssetPacks: {info.ObjectForInfoDictionary("BAHasManagedAssetPacks")?.ToString() ?? "(unset)"}");
            lines.Add($"BAUsesAppleHosting: {info.ObjectForInfoDictionary("BAUsesAppleHosting")?.ToString() ?? "(unset)"}");
            lines.Add($"BAAppGroupID: {info.ObjectForInfoDictionary("BAAppGroupID")?.ToString() ?? "(unset)"}");
        }
        catch (Exception ex)
        {
            lines.Add($"Info.plist probe error: {ex.Message}");
        }

        try
        {
            var groupId = BaAppGroupId;
            var container = groupId == null
                ? null
                : NSFileManager.DefaultManager.GetContainerUrl(groupId);
            lines.Add($"App-group container: {(container == null ? "inaccessible" : "accessible")}");
        }
        catch (Exception ex)
        {
            lines.Add($"App-group container probe error: {ex.Message}");
        }

        if (!ManagedDeliverySupported)
        {
            lines.Add(
                "Managed delivery unavailable: requires iOS 26+ and an accessible app-group container "
                + "— pack payloads download from the app-v* GitHub release instead.");
            if (!string.IsNullOrEmpty(LastIosDeliveryError))
            {
                lines.Add($"Last release-payload error: {LastIosDeliveryError}");
            }
            return lines;
        }

        if (!string.IsNullOrEmpty(LastIosDeliveryError))
        {
            lines.Add($"Last BA fetch error: {LastIosDeliveryError}");
        }

        try
        {
            lines.Add($"Delegate installed: {_downloadEvents != null}");
#if MACCATALYST
            if (OperatingSystem.IsMacCatalystVersionAtLeast(26, 4))
#else
            if (OperatingSystem.IsIOSVersionAtLeast(26, 4))
#endif
            {
                lines.Add($"IsAssetPackAvailableLocally('{packName}'): {BAAssetPackManager.SharedManager.IsAssetPackAvailableLocally(packName)}");
                try
                {
                    var status = await BAAssetPackManager.SharedManager.GetLocalStatusAsync(packName).WaitAsync(TimeSpan.FromMinutes(2));
                    lines.Add($"Local status: {status}");
                }
                catch (Exception ex)
                {
                    lines.Add($"Local status error: {ex.GetType().Name}: {ex.Message}");
                }
            }
            else
            {
                lines.Add("Local status probe requires iOS 26.4 or later.");
            }
        }
        catch (Exception ex)
        {
            lines.Add($"Availability probe error: {ex.GetType().Name}: {ex.Message}");
        }

        try
        {
            var packs = (await BAAssetPackManager.SharedManager.GetAllAssetPacksAsync().WaitAsync(TimeSpan.FromMinutes(2)))
                .Cast<BAAssetPack>().Select(p => p.Identifier).OrderBy(id => id).ToList();
            lines.Add($"Store packs ({packs.Count}): {string.Join(", ", packs)}");
        }
        catch (Exception ex)
        {
            lines.Add($"GetAllAssetPacks error: {ex.GetType().Name}: {ex.Message}");
        }

        // Disk space
        try
        {
            var cacheRoot = FileSystem.CacheDirectory;
            var driveInfo = new DriveInfo(Path.GetPathRoot(cacheRoot) ?? "/");
            lines.Add($"Available disk space: {driveInfo.AvailableFreeSpace / (1024 * 1024)} MB");
        }
        catch (Exception ex)
        {
            lines.Add($"Disk space check error: {ex.Message}");
        }

        return lines;
    }

    /// <summary>
    /// Fans managed asset-pack download progress out to in-flight FetchAsync calls.
    /// Progress callbacks only fire while the app process is alive, matching the
    /// previous ODR Progress observer behavior.
    /// </summary>
    [SupportedOSPlatform("ios26.0")]
    [SupportedOSPlatform("maccatalyst26.0")]
    private sealed class AssetPackDownloadEvents : BAManagedAssetPackDownloadDelegate
    {
        private readonly Dictionary<Guid, (string PackName, IProgress<double>? Progress)> _subscribers = new();
        private readonly object _sync = new();

        public IDisposable Subscribe(string packName, IProgress<double>? progress)
        {
            var key = Guid.NewGuid();
            lock (_sync)
            {
                _subscribers[key] = (packName, progress);
            }
            return new Subscription(this, key);
        }

        public override void DownloadBegan(BAAssetPack assetPack)
        {
            System.Diagnostics.Debug.WriteLine($"BA: download of '{assetPack.Identifier}' began");
        }

        public override void DownloadProgress(BAAssetPack assetPack, NSProgress progress)
        {
            IProgress<double>?[] subscribers;
            lock (_sync)
            {
                subscribers = _subscribers.Values
                    .Where(entry => entry.PackName == assetPack.Identifier)
                    .Select(entry => entry.Progress)
                    .ToArray();
            }
            foreach (var subscriber in subscribers)
            {
                subscriber?.Report(progress.FractionCompleted);
            }
        }

        public override void DownloadPaused(BAAssetPack assetPack)
        {
            System.Diagnostics.Debug.WriteLine($"BA: download of '{assetPack.Identifier}' paused");
        }

        public override void DownloadFinished(BAAssetPack assetPack)
        {
            System.Diagnostics.Debug.WriteLine($"BA: download of '{assetPack.Identifier}' finished");
        }

        public override void DownloadFailed(BAAssetPack assetPack, NSError error)
        {
            System.Diagnostics.Debug.WriteLine(
                $"BA: download of '{assetPack.Identifier}' failed: {error.LocalizedDescription}");
        }

        private void Unsubscribe(Guid key)
        {
            lock (_sync)
            {
                _subscribers.Remove(key);
            }
        }

        private sealed class Subscription(AssetPackDownloadEvents owner, Guid key) : IDisposable
        {
            public void Dispose() => owner.Unsubscribe(key);
        }
    }
}
#endif
