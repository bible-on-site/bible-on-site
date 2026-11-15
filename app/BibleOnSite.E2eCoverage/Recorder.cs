using System;
using System.IO;

namespace AltCover.Recorder
{
	/// <summary>
	/// Attribute the AltCover instrumenter stamps on instrumented assemblies.
	/// Declared here so the instrumented module resolves it from this assembly
	/// instead of AltCover's generated recorder.
	/// </summary>
	[AttributeUsage(AttributeTargets.Assembly)]
	public sealed class InstrumentationAttribute : Attribute
	{
		public string? Assembly { get; set; }
		public string? Configuration { get; set; }
	}

	/// <summary>
	/// In-app coverage recorder for E2E-instrumented builds (#1232).
	///
	/// AltCover rewrites the app assembly so every sequence point calls
	/// <see cref="Visit(string, int)"/> with the module hash from the build's
	/// OpenCover template and a point key (sequence points pass their uspid,
	/// branch points pass int.MinValue + uspid). This class accumulates those
	/// hits verbatim; the build-time template maps keys back to source lines.
	///
	/// Unlike AltCover's generated recorder, hits are exported on demand: the
	/// E2E harness pulls <see cref="SnapshotJson"/> over the loopback endpoint
	/// started by <see cref="CoverageEndpoint"/> while the app is still
	/// running, which is the only way to capture coverage on Android/iOS where
	/// the test runner force-stops the app process.
	/// </summary>
	public static class Instance
	{
		private static readonly VisitCounters Hits = new();
		private static readonly long StartedTicks = DateTime.UtcNow.Ticks;
		private static readonly string ReportFileValue =
			Path.GetFullPath("e2e-coverage.json");

		static Instance()
		{
			CoverageEndpoint.Start();
			AppDomain.CurrentDomain.ProcessExit += (_, _) => FlushFinish();
		}

		// Members mirroring the generated recorder's public surface so the
		// instrumented assembly binds identically.
		public static string ReportFile => ReportFileValue;
		public static string ReportFilePath => ReportFileValue;
		public static bool Eager => false;
		public static long Timer => DateTime.UtcNow.Ticks - StartedTicks;
		public static string Token => string.Empty;

		/// <summary>Records one sequence/branch point visit in <paramref name="moduleId"/>.</summary>
		public static void Visit(string moduleId, int pointId)
		{
			Hits.Visit(moduleId, pointId);
		}

		// Call-context tracking is not enabled for app instrumentation; the
		// instrumenter emits these calls only under --callContext.
		public static void Push(int pointId)
		{
			// No-op: kept for surface parity with AltCover's generated recorder.
		}

		public static void Pop()
		{
			// No-op: kept for surface parity with AltCover's generated recorder.
		}

		/// <summary>
		/// The generated recorder flushes on process exit. Mobile test runners
		/// kill the app process instead, so this remains only a best-effort
		/// fallback for graceful desktop shutdowns.
		/// </summary>
		public static void FlushFinish()
		{
			try
			{
				File.WriteAllText(ReportFileValue, SnapshotJson());
			}
			catch (Exception exception) when (exception is IOException
				or UnauthorizedAccessException or NotSupportedException)
			{
				Console.Error.WriteLine($"E2E coverage flush could not write {ReportFileValue}: {exception.Message}");
			}
		}

		/// <summary>Clears all recorded hits (per-test attribution across app restarts).</summary>
		public static void Reset()
		{
			Hits.Reset();
		}

		/// <summary>
		/// Serializes the accumulated hits:
		/// { "format": "altcover-visits/1", "modules": { "&lt;hash&gt;": { "&lt;pointKey&gt;": &lt;count&gt; } } }
		/// The snapshot reads atomic counters while visits keep recording, without
		/// locking the app's hot paths.
		/// </summary>
		public static string SnapshotJson()
		{
			return Hits.SnapshotJson();
		}
	}
}
