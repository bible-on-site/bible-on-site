#if ANDROID
using Android.Gms.Extensions;
using Xamarin.Google.Android.Play.Core.AssetPacks;
using Xamarin.Google.Android.Play.Core.AssetPacks.Model;
#elif IOS || MACCATALYST
using Foundation;
using UIKit;
#endif

namespace BibleOnSite.Services;

/// <summary>
/// On-demand asset delivery service.
/// Android: Play Asset Delivery via AssetPackManager.
/// iOS: Apple On-Demand Resources via NSBundleResourceRequest.
/// Other platforms: no-op.
/// </summary>
public sealed partial class PadDeliveryService : IPadDeliveryService
{
    private const string PerushimNotesPackName = "perushim_notes";

    public static IPadDeliveryService Instance { get; } = new PadDeliveryService();

    private PadDeliveryService() { }

    /// <inheritdoc />
    public Task<string?> TryGetAssetPathAsync(string packName, CancellationToken cancellationToken = default)
    {
#if ANDROID
        return TryGetAssetPathAndroidAsync(packName, cancellationToken);
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

    private static Task<string?> TryGetAssetPathAndroidAsync(string packName, CancellationToken cancellationToken)
    {
        var manager = GetAssetPackManager();
        if (manager == null)
            return Task.FromResult<string?>(null);

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
                return true;

            var listener = new AssetPackStateUpdateListenerWrapper();
            listener.StateUpdate += (_, e) =>
            {
                var status = e.State?.Status() ?? 0;
                if ((status == (int)AssetPackStatus.Downloading || status == (int)AssetPackStatus.Transferring) && e.State != null)
                {
                    var total = e.State.TotalBytesToDownload();
                    var downloaded = e.State.BytesDownloaded();
                    if (total > 0)
                        progress?.Report((double)downloaded / total);
                }
                else if (status == (int)AssetPackStatus.WaitingForWifi)
                {
                    var activity = Platform.CurrentActivity;
                    if (activity != null)
                        manager.ShowConfirmationDialog(activity);
                }
            };

            var activity = Platform.CurrentActivity;
            if (activity != null)
                manager.RegisterListener(listener.Listener!);

            try
            {
                await manager.Fetch(new[] { packName })!.AsAsync<Java.Lang.Object>();
                cancellationToken.ThrowIfCancellationRequested();

                // In local-testing mode (bundletool --local-testing), the
                // FakeAssetPackService extracts the pack asynchronously after
                // Fetch resolves. Poll until the location becomes available.
                for (var attempt = 0; attempt < 60; attempt++)
                {
                    var fetchedLocation = manager.GetPackLocation(packName);
                    if (fetchedLocation?.AssetsPath() != null)
                        return true;

                    await Task.Delay(500, cancellationToken);
                }

                LastAndroidPadError =
                    "Fetch finished but GetPackLocation still null after 30s — pack may be missing from the Play-delivered bundle, or install was not from Play Store.";
                return false;
            }
            finally
            {
                if (activity != null)
                    manager.UnregisterListener(listener.Listener!);
            }
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
            lines.Add($"Last PAD fetch error: {LastAndroidPadError}");

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

            if ((int)Android.OS.Build.VERSION.SdkInt >= (int)Android.OS.BuildVersionCodes.R)
            {
                var info = pm.GetInstallSourceInfo(pn);
                var installing = info?.InstallingPackageName;
                lines.Add($"Install source (API {(int)Android.OS.BuildVersionCodes.R}+): {installing ?? "(null — not from a package installer, e.g. adb/sideload)"}");
                if (installing != "com.android.vending")
                    lines.Add("PAD: On-demand packs are served for installs from Google Play (installer com.android.vending). Other sources often cannot download PAD.");
            }
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
partial class PadDeliveryService
{
    private const string NotesDbName = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";
    private const string DatasetAssetName = "perushim_notes";

    private static string OdrCacheDir(string packName)
    {
        var dir = Path.Combine(FileSystem.CacheDirectory, "odr_assets", packName);
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static async Task<string?> TryGetAssetPathIosAsync(string packName, CancellationToken ct)
    {
        var cacheDir = OdrCacheDir(packName);
        if (File.Exists(Path.Combine(cacheDir, NotesDbName)))
            return cacheDir;

        try
        {
            using var request = new NSBundleResourceRequest(new NSSet<NSString>(new NSString(packName)));
            var available = await request.ConditionallyBeginAccessingResourcesAsync();
            if (!available)
            {
                System.Diagnostics.Debug.WriteLine("ODR: ConditionallyBeginAccessing returned false — resource not yet downloaded");
                return null;
            }

            try
            {
                return SaveOdrDataAsset(cacheDir, request.Bundle);
            }
            finally
            {
                request.EndAccessingResources();
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"ODR TryGetAssetPath failed: {ex.Message}");
            return null;
        }
    }

    private static async Task<bool> FetchIosAsync(
        string packName,
        IProgress<double>? progress,
        CancellationToken ct)
    {
        using var request = new NSBundleResourceRequest(new NSSet<NSString>(new NSString(packName)));

        IDisposable? observer = null;
        if (progress != null)
        {
            observer = request.Progress.AddObserver(
                "fractionCompleted",
                NSKeyValueObservingOptions.New,
                _ => progress.Report(request.Progress.FractionCompleted));
        }

        try
        {
            System.Diagnostics.Debug.WriteLine($"ODR: BeginAccessingResources for tag '{packName}'...");
            await request.BeginAccessingResourcesAsync();
            ct.ThrowIfCancellationRequested();

            var cacheDir = OdrCacheDir(packName);
            var result = SaveOdrDataAsset(cacheDir, request.Bundle);
            return result != null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"ODR Fetch failed: {ex.Message}");
            return false;
        }
        finally
        {
            observer?.Dispose();
            request.EndAccessingResources();
        }
    }

    /// <summary>
    /// After BeginAccessingResources, the asset catalog data is available via NSDataAsset.
    /// actool compiles the .dataset into Assets.car, so we read it via NSDataAsset and
    /// write to disk for SQLite file-based access.
    /// ODR assets live in the request's bundle, not the main bundle.
    /// </summary>
    private static string? SaveOdrDataAsset(string cacheDir, NSBundle bundle)
    {
        using var asset = new NSDataAsset(DatasetAssetName, bundle);
        if (asset?.Data == null)
        {
            System.Diagnostics.Debug.WriteLine($"ODR: NSDataAsset('{DatasetAssetName}') returned null");
            return null;
        }

        System.Diagnostics.Debug.WriteLine($"ODR: NSDataAsset loaded, length={asset.Data.Length}");
        var destPath = Path.Combine(cacheDir, NotesDbName);
        try
        {
            using var stream = asset.Data.AsStream();
            using var fileStream = File.Create(destPath);
            stream.CopyTo(fileStream);
            System.Diagnostics.Debug.WriteLine($"ODR: Saved to {destPath}");
            return cacheDir;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"ODR: Save failed: {ex.Message}");
            return null;
        }
    }

    private static async Task<List<string>> GetDeliveryDiagnosticsIosAsync(string packName)
    {
        var lines = new List<string> { "--- ODR (iOS) delivery diagnostics ---" };

        var cacheDir = OdrCacheDir(packName);
        var cachedFile = Path.Combine(cacheDir, NotesDbName);
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

        // Main bundle info
        try
        {
            var mainBundle = NSBundle.MainBundle;
            lines.Add($"Main bundle path: {mainBundle.BundlePath}");
            var assetsCar = Path.Combine(mainBundle.BundlePath, "Assets.car");
            lines.Add($"Main Assets.car exists: {File.Exists(assetsCar)}");
            if (File.Exists(assetsCar))
                lines.Add($"Main Assets.car size: {new FileInfo(assetsCar).Length} bytes");
        }
        catch (Exception ex)
        {
            lines.Add($"Main bundle info error: {ex.Message}");
        }

        // Probe NSDataAsset with main bundle
        try
        {
            using var directAsset = new NSDataAsset(DatasetAssetName);
            lines.Add($"NSDataAsset(main): {(directAsset?.Data != null ? $"length={directAsset.Data.Length}" : "(null)")}");
        }
        catch (Exception ex)
        {
            lines.Add($"NSDataAsset(main) error: {ex.GetType().Name}: {ex.Message}");
        }

        // ODR request
        try
        {
            using var request = new NSBundleResourceRequest(new NSSet<NSString>(new NSString(packName)));
            lines.Add($"NSBundleResourceRequest created for tag '{packName}'");
            lines.Add($"Request bundle path (before access): {request.Bundle?.BundlePath ?? "(null)"}");

            var conditionalOk = await request.ConditionallyBeginAccessingResourcesAsync();
            lines.Add($"ConditionallyBeginAccessing: {conditionalOk}");

            if (conditionalOk)
            {
                lines.Add($"Request bundle path (after conditional): {request.Bundle?.BundlePath ?? "(null)"}");
                ProbeNSDataAsset(lines, "ODR(conditional,request.Bundle)", DatasetAssetName, request.Bundle);
                request.EndAccessingResources();
            }
            else
            {
                lines.Add("Attempting BeginAccessingResources...");
                try
                {
                    using var fetchReq = new NSBundleResourceRequest(new NSSet<NSString>(new NSString(packName)));
                    await fetchReq.BeginAccessingResourcesAsync();
                    lines.Add("BeginAccessingResources: succeeded");
                    lines.Add($"Request bundle path (after fetch): {fetchReq.Bundle?.BundlePath ?? "(null)"}");

                    // Check if ODR asset pack was downloaded
                    var odrDir = Path.Combine(fetchReq.Bundle?.BundlePath ?? "", "OnDemandResources");
                    lines.Add($"ODR dir in bundle exists: {Directory.Exists(odrDir)}");

                    ProbeNSDataAsset(lines, "ODR(fetched,request.Bundle)", DatasetAssetName, fetchReq.Bundle);
                    ProbeNSDataAsset(lines, "ODR(fetched,mainBundle)", DatasetAssetName, NSBundle.MainBundle);

                    // Enumerate files in request bundle to see what's there
                    try
                    {
                        var bundlePath = fetchReq.Bundle?.BundlePath;
                        if (bundlePath != null && Directory.Exists(bundlePath))
                        {
                            var files = Directory.GetFiles(bundlePath, "*", SearchOption.AllDirectories);
                            lines.Add($"Request bundle file count: {files.Length}");
                            foreach (var f in files.Take(20))
                                lines.Add($"  {f.Replace(bundlePath, "~")}");
                            if (files.Length > 20)
                                lines.Add($"  ... and {files.Length - 20} more");
                        }
                    }
                    catch (Exception enumEx)
                    {
                        lines.Add($"Bundle enumeration error: {enumEx.Message}");
                    }

                    fetchReq.EndAccessingResources();
                }
                catch (Exception fetchEx)
                {
                    lines.Add($"BeginAccessingResources FAILED: {fetchEx.GetType().Name}: {fetchEx.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            lines.Add($"ODR request error: {ex.GetType().Name}: {ex.Message}");
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

    private static void ProbeNSDataAsset(List<string> lines, string label, string assetName, NSBundle? bundle)
    {
        try
        {
            using var asset = bundle != null ? new NSDataAsset(assetName, bundle) : new NSDataAsset(assetName);
            lines.Add($"{label}: {(asset?.Data != null ? $"length={asset.Data.Length}" : "(null)")}");
        }
        catch (Exception ex)
        {
            lines.Add($"{label} error: {ex.GetType().Name}: {ex.Message}");
        }
    }
}
#endif
