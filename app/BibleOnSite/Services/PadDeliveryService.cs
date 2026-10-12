#if ANDROID
using Android.Gms.Extensions;
using Xamarin.Google.Android.Play.Core.AssetPacks;
using Xamarin.Google.Android.Play.Core.AssetPacks.Model;
#elif IOS || MACCATALYST
using BackgroundAssets;
using Foundation;
using System.Runtime.Versioning;
#endif

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

    public static IPadDeliveryService Instance { get; } = new PadDeliveryService();

    private PadDeliveryService() { }

    internal static string AssetPackCacheDirectory(IFileSystem fileSystem, IAppInfo appInfo, string packName)
    {
        // Extracted asset-pack data belongs to this app build, just like the store resource.
        var generation = $"{appInfo.VersionString}-{appInfo.BuildString}";
        var root = Path.Join(fileSystem.CacheDirectory, "asset_packs");
        var dir = Path.Join(root, generation, packName);
        Directory.CreateDirectory(dir);
        // Extractions from previous app versions are obsolete — each holds a
        // full pack payload (hundreds of MB) and must not accumulate.
        try
        {
            foreach (var stale in Directory.GetDirectories(root)
                .Where(path => Path.GetFileName(path) != generation))
            {
                Directory.Delete(stale, recursive: true);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            System.Diagnostics.Debug.WriteLine($"Failed to remove stale asset-pack generations: {ex.Message}");
        }
        return dir;
    }

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

    /// <summary>
    /// Installs the managed asset-pack download delegate. Called once at app
    /// startup (MauiProgram) so that downloads resumed by the system after an
    /// update report into this service.
    /// </summary>
    internal static void ConfigureBackgroundAssets()
    {
#if MACCATALYST
        if (!OperatingSystem.IsMacCatalystVersionAtLeast(26))
#else
        if (!OperatingSystem.IsIOSVersionAtLeast(26))
#endif
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
        if (File.Exists(Path.Combine(cacheDir, PayloadFileName(packName))))
        {
            return cacheDir;
        }

#if MACCATALYST
        if (!OperatingSystem.IsMacCatalystVersionAtLeast(26))
#else
        if (!OperatingSystem.IsIOSVersionAtLeast(26))
#endif
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
            return SaveAssetPackPayload(cacheDir, packName);
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
#if MACCATALYST
        if (!OperatingSystem.IsMacCatalystVersionAtLeast(26))
#else
        if (!OperatingSystem.IsIOSVersionAtLeast(26))
#endif
        {
            LastIosDeliveryError = "Background Assets requires iOS 26 or later.";
            return false;
        }

        var cacheDir = AssetPackCacheDir(packName);
        try
        {
            // An extracted payload remains usable even if the OS evicts its pack.
            if (File.Exists(Path.Combine(cacheDir, PayloadFileName(packName))))
            {
                return true;
            }

            // Same short-circuit the ODR path had: an already-downloaded pack only
            // needs extraction, not a store round-trip.
            if (IsAssetPackLocallyAvailable(packName))
            {
                return SaveAssetPackPayload(cacheDir, packName) != null;
            }

            var pack = await ResolveAssetPackAsync(packName);
            if (pack == null)
            {
                LastIosDeliveryError =
                    $"Asset pack '{packName}' is not declared in the Background Assets manifest.";
                return false;
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

            await ensure;
            return SaveAssetPackPayload(cacheDir, packName) != null;
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
    /// Resolves the store-registered asset pack for this identifier. Uses the
    /// enumeration API rather than GetAssetPack, which the iOS 27 SDK deprecates.
    /// </summary>
    [SupportedOSPlatform("ios26.0")]
    [SupportedOSPlatform("maccatalyst26.0")]
    private static async Task<BAAssetPack?> ResolveAssetPackAsync(string packName)
    {
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
    private static string? SaveAssetPackPayload(string cacheDir, string packName)
    {
        if (!SavePackFile(cacheDir, packName, PayloadFileName(packName), required: true))
        {
            return null;
        }
        if (packName == PerushimNotesPackName)
        {
            SavePackFile(cacheDir, packName, PerushimNotesService.SearchIndexDbName, required: false);
        }
        return cacheDir;
    }

    [SupportedOSPlatform("ios26.0")]
    [SupportedOSPlatform("maccatalyst26.0")]
    private static bool SavePackFile(string cacheDir, string packName, string relative, bool required)
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
        var destPath = Path.Combine(cacheDir, relative);
        try
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
        var cachedFile = Path.Combine(cacheDir, PayloadFileName(packName));
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

#if MACCATALYST
        if (!OperatingSystem.IsMacCatalystVersionAtLeast(26))
#else
        if (!OperatingSystem.IsIOSVersionAtLeast(26))
#endif
        {
            lines.Add("Managed asset packs require iOS 26 or later.");
            return lines;
        }

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
                    var status = await BAAssetPackManager.SharedManager.GetLocalStatusAsync(packName);
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
            var packs = (await BAAssetPackManager.SharedManager.GetAllAssetPacksAsync())
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
