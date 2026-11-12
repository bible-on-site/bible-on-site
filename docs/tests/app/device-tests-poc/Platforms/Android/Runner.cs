// Minimal Android headless-runner wiring, trimmed from CommunityToolkit/Maui's
// vendored dotnet/maui runner (eng/devices PoC for issue #3336). MIT-licensed upstream.
using System.Globalization;
using Android.App;
using Android.Content;
using Android.OS;
using Android.Runtime;
using Microsoft.DotNet.XHarness.TestRunners.Common;
using Microsoft.DotNet.XHarness.TestRunners.Xunit;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Maui.ApplicationModel;
using Microsoft.Maui.Devices;

namespace DeviceTestApp.Runner;

class TestDevice : IDevice
{
    public string BundleIdentifier => AppInfo.PackageName;
    public string UniqueIdentifier => Guid.NewGuid().ToString("N");
    public string Name => DeviceInfo.Name;
    public string Model => DeviceInfo.Model;
    public string SystemName => DeviceInfo.Platform.ToString();
    public string SystemVersion => DeviceInfo.VersionString;
    public string Locale => CultureInfo.CurrentCulture.Name;
}

class HeadlessTestRunner : AndroidApplicationEntryPoint
{
    readonly TestOptions _options;
    readonly string _resultsPath;

    public HeadlessTestRunner(HeadlessRunnerOptions runnerOptions, TestOptions options)
    {
        _options = options;
        var cache = Android.App.Application.Context.CacheDir!.AbsolutePath;
        _resultsPath = Path.Combine(cache, runnerOptions.TestResultsFilename);
    }

    protected override bool LogExcludedTests => true;
    public override TextWriter? Logger => null;
    public override string TestsResultsFinalPath => _resultsPath;
    protected override int? MaxParallelThreads => System.Environment.ProcessorCount;
    protected override IDevice Device { get; } = new TestDevice();

    protected override IEnumerable<TestAssemblyInfo> GetTestAssemblies() =>
        _options.Assemblies
            .Distinct()
            .Select(assembly =>
            {
                var path = Path.Combine(Android.App.Application.Context.CacheDir!.AbsolutePath, assembly.GetName().Name + ".dll");
                if (!File.Exists(path))
                {
                    File.Create(path).Close();
                }
                return new TestAssemblyInfo(assembly, path);
            });

    protected override void TerminateWithSuccess()
    {
        // Intentionally empty: terminating the instrumentation process here
        // would kill the app before XHarness pulls the results file.
    }

    protected override TestRunner GetTestRunner(LogWriter logWriter)
    {
        var testRunner = base.GetTestRunner(logWriter);
        if (_options.SkipCategories?.Count > 0)
        {
            testRunner.SkipCategories(_options.SkipCategories);
        }
        return testRunner;
    }

    public async Task<Bundle> RunTestsAsync()
    {
        var bundle = new Bundle();
        EventHandler<TestRunResult> onTestsCompleted = (_, results) =>
        {
            var message =
                $"Tests run: {results.ExecutedTests} " +
                $"Passed: {results.PassedTests} " +
                $"Inconclusive: {results.InconclusiveTests} " +
                $"Failed: {results.FailedTests} " +
                $"Ignored: {results.SkippedTests}";
            bundle.PutString("test-execution-summary", message);
            bundle.PutLong("return-code", results.FailedTests == 0 ? 0 : 1);
        };
        TestsCompleted += onTestsCompleted;
        await RunAsync();
        TestsCompleted -= onTestsCompleted;
        if (File.Exists(TestsResultsFinalPath))
        {
            bundle.PutString("test-results-path", TestsResultsFinalPath);
        }
        if (bundle.GetLong("return-code", -1) == -1)
        {
            bundle.PutLong("return-code", 1);
        }
        return bundle;
    }
}

public abstract class MauiTestActivity : AndroidX.AppCompat.App.AppCompatActivity
{
    static Task<Bundle>? testPass;
    public TaskCompletionSource<Bundle> TaskCompletionSource { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

    protected override void OnCreate(Bundle? savedInstanceState)
    {
        base.OnCreate(savedInstanceState);
        _ = CompleteWhenThePassEndsAsync(EnsureTestPass());
    }

    // The pass is a static field so it survives activity recreation (rotation,
    // process config changes): a recreated activity must await the same pass.
    static Task<Bundle> EnsureTestPass()
    {
        if (testPass is not null)
        {
            Android.Util.Log.Warn("DeviceTests", "The test activity was recreated; the running test pass continues in it.");
            return testPass;
        }
        return testPass = Task.Run(async () => await MauiTestInstrumentation.Current.Services.GetRequiredService<HeadlessTestRunner>().RunTestsAsync());
    }

    async Task CompleteWhenThePassEndsAsync(Task<Bundle> pass)
    {
        try
        {
            TaskCompletionSource.TrySetResult(await pass);
        }
        catch (Exception ex)
        {
            TaskCompletionSource.TrySetException(ex);
        }
        Finish();
    }
}

public abstract class MauiTestInstrumentation : Instrumentation
{
    readonly TaskCompletionSource<Android.App.Application> _waitForApplication = new();
    Java.Lang.Class _activityClass = null!;

    protected MauiTestInstrumentation(IntPtr handle, JniHandleOwnership ownership)
        : base(handle, ownership)
    {
        Current = this;
    }

    public static MauiTestInstrumentation Current { get; private set; } = null!;
    public Bundle? Arguments { get; private set; }
    public IServiceProvider Services { get; private set; } = null!;
    public TestOptions Options { get; private set; } = null!;
    public HeadlessRunnerOptions RunnerOptions { get; private set; } = null!;
    public Context? CurrentExecutionContext { get; private set; }

    public override void OnCreate(Bundle? arguments)
    {
        _activityClass = Java.Lang.Class.ForName(Context!.PackageName + ".TestActivity");
        Arguments = arguments;
        base.OnCreate(arguments);
        Start();
    }

    public override void CallApplicationOnCreate(Android.App.Application? app)
    {
        base.CallApplicationOnCreate(app);
        if (app == null)
        {
            _waitForApplication.SetException(new ArgumentNullException(nameof(app)));
        }
        else
        {
            _waitForApplication.SetResult(app);
        }
    }

    public override async void OnStart()
    {
        base.OnStart();
        await _waitForApplication.Task;
        Services = IPlatformApplication.Current?.Services ?? throw new InvalidOperationException("Unable to find Application Services");
        Options = Services.GetRequiredService<TestOptions>();
        RunnerOptions = Services.GetRequiredService<HeadlessRunnerOptions>();
        var resultsFilename = Arguments?.GetString("results-file-name");
        if (!string.IsNullOrWhiteSpace(resultsFilename))
        {
            RunnerOptions.TestResultsFilename = resultsFilename;
        }
        var bundle = await RunTestsAsync();
        CopyFile(bundle);
        Finish(Result.Ok, bundle);
    }

    void CopyFile(Bundle bundle)
    {
        var resultsFile = bundle.GetString("test-results-path");
        if (resultsFile == null)
        {
            return;
        }
        var guid = Guid.NewGuid().ToString("N");
        var name = Path.GetFileName(resultsFile);
        var downloads = Android.OS.Environment.DirectoryDownloads!;
        var relative = Path.Combine(downloads, Context!.PackageName!, guid);
        var values = new ContentValues();
        values.Put(Android.Provider.MediaStore.IMediaColumns.DisplayName, name);
        values.Put(Android.Provider.MediaStore.IMediaColumns.MimeType, "text/xml");
        values.Put(Android.Provider.MediaStore.IMediaColumns.RelativePath, relative);
        var uri = Context!.ContentResolver!.Insert(Android.Provider.MediaStore.Downloads.ExternalContentUri, values)!;
        using (var dest = Context.ContentResolver.OpenOutputStream(uri)!)
        using (var source = File.OpenRead(resultsFile))
            source.CopyTo(dest);
#pragma warning disable CS0618
        var root = Android.OS.Environment.ExternalStorageDirectory!.AbsolutePath;
#pragma warning restore CS0618
        var finalPath = Path.Combine(root, relative, name);
        bundle.PutString("test-results-path", finalPath);
    }

    Task<Bundle> RunTestsAsync()
    {
        if (RunnerOptions.RequiresUIContext)
        {
            var intent = new Intent(TargetContext, _activityClass);
            intent.AddFlags(ActivityFlags.NewTask);
            var activity = StartActivitySync(intent);
            if (activity is not MauiTestActivity testActivity)
            {
                throw new InvalidOperationException($"Unexpected activity type '{activity?.GetType().FullName ?? "<null>"}'.");
            }
            CurrentExecutionContext = activity;
            return testActivity.TaskCompletionSource.Task;
        }
        else
        {
            CurrentExecutionContext = TargetContext;
            var runner = Services.GetRequiredService<HeadlessTestRunner>();
            return runner.RunTestsAsync();
        }
    }
}
