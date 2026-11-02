using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// Perek reading-position progress on the view model (issue #2607): scroll
/// anchors replay once the async metric attach lands, fractions come from the
/// stored pasuk units, and missing metrics hide the bar rather than
/// fabricating a position.
/// </summary>
public class PerekReadingProgressTests
{
	private static readonly ReadingMetric Metric = new()
	{
		WordCount = 100,
		EstimatedSeconds = 27,
		WordsPerMinute = 220,
		CalcVersion = 1,
		SourceHash = "hash",
	};

	private static readonly IReadOnlyList<ReadingProgressUnit> Units =
	[
		new() { Key = "1", WordCount = 40, CumulativeWords = 40 },
		new() { Key = "2", WordCount = 60, CumulativeWords = 100 },
	];

	private sealed class FakePerekDataService()
		: PerekDataService(LocalDatabaseService.Instance)
	{
		public TaskCompletionSource<ReadingMetric?> MetricRead { get; } =
			new(TaskCreationOptions.RunContinuationsAsynchronously);
		public IReadOnlyList<ReadingProgressUnit> StoredUnits { get; set; } = [];

		public override Task<ReadingMetric?> GetReadingMetricAsync(int perekId)
		{
			ArgumentOutOfRangeException.ThrowIfNegativeOrZero(perekId);
			return MetricRead.Task;
		}

		public override Task<IReadOnlyList<ReadingProgressUnit>> GetPasukProgressUnitsAsync(
			int perekId)
		{
			ArgumentOutOfRangeException.ThrowIfNegativeOrZero(perekId);
			return Task.FromResult(StoredUnits);
		}
	}

	private static PerekViewModel CreateViewModel(PerekDataService? dataService = null)
	{
		var storage = new InMemoryPreferencesStorage();
		var preferences = PreferencesService.CreateForTesting(storage);
		return new PerekViewModel(preferences, _ => null, dataService,
			null, null, null, null, null);
	}

	private static Perek CreatePerek(int perekId = 1) => new()
	{
		PerekId = perekId,
		PerekNumber = 1,
		SeferId = 1,
		SeferName = "בראשית",
		SeferTanahUsName = "Genesis",
		Header = "Header",
		Date = "2026-01-20",
		HebDate = "תשרי",
		Tseit = "18:00",
		Pasukim = [],
	};

	[Fact]
	public void UpdateReadingProgress_UnitsAndMetricSet_ComputesFraction()
	{
		var vm = CreateViewModel();
		var perek = CreatePerek();
		perek.ProgressUnits = Units;
		perek.ReadingMetric = Metric;
		vm.Perek = perek;

		vm.UpdateReadingProgress(1, contentEndVisible: false);

		// Pasuk 1 anchors → 0 words passed its own count → 0%.
		vm.ReadingProgress.Should().Be(0);
		vm.UpdateReadingProgress(2, contentEndVisible: false);
		// Pasuk 2 anchors → 40 of 100 words passed → 40%.
		vm.ReadingProgress.Should().BeApproximately(0.4, 1e-9);
	}

	[Fact]
	public void UpdateReadingProgress_ContentTailVisible_ReportsFullyRead()
	{
		var vm = CreateViewModel();
		var perek = CreatePerek();
		perek.ProgressUnits = Units;
		perek.ReadingMetric = Metric;
		vm.Perek = perek;

		vm.UpdateReadingProgress(1, contentEndVisible: true);

		vm.ReadingProgress.Should().Be(1);
	}

	[Fact]
	public void UpdateReadingProgress_NoUnitsOrMetric_StaysHidden()
	{
		var vm = CreateViewModel();
		vm.Perek = CreatePerek();

		vm.UpdateReadingProgress(3, contentEndVisible: false);

		vm.ReadingProgress.Should().Be(0);
	}

	[Fact]
	public void UpdateReadingProgress_NoPerek_StaysHidden()
	{
		var vm = CreateViewModel();
		// vm.Perek is null — the anchor is still captured for a later perek.
		vm.UpdateReadingProgress(2, contentEndVisible: false);

		vm.ReadingProgress.Should().Be(0);
	}

	[Fact]
	public void UpdateReadingProgress_EmptyUnits_StaysHidden()
	{
		var vm = CreateViewModel();
		var perek = CreatePerek();
		perek.ProgressUnits = [];
		perek.ReadingMetric = Metric;
		vm.Perek = perek;

		vm.UpdateReadingProgress(1, contentEndVisible: false);

		vm.ReadingProgress.Should().Be(0);
	}

	[Fact]
	public void UpdateReadingProgress_ZeroWordCountMetric_StaysHidden()
	{
		var vm = CreateViewModel();
		var perek = CreatePerek();
		perek.ProgressUnits = Units;
		perek.ReadingMetric = new ReadingMetric { WordCount = 0 };
		vm.Perek = perek;

		vm.UpdateReadingProgress(1, contentEndVisible: false);

		vm.ReadingProgress.Should().Be(0);
	}

	[Fact]
	public void UpdateReadingProgress_AnchorOutsideUnits_StaysHidden()
	{
		var vm = CreateViewModel();
		var perek = CreatePerek();
		perek.ProgressUnits = Units;
		perek.ReadingMetric = Metric;
		vm.Perek = perek;

		// Pasuk 42 has no stored unit — the anchor can't be word-weighted.
		vm.UpdateReadingProgress(42, contentEndVisible: false);

		vm.ReadingProgress.Should().Be(0);
	}

	[Fact]
	public async Task UpdateReadingProgress_ScrollBeforeMetricAttach_ReplaysAnchor()
	{
		var fake = new FakePerekDataService { StoredUnits = Units };
		var vm = CreateViewModel(fake);
		vm.Perek = CreatePerek();

		// The scroll fires while the sqlite read is still pending: nothing to
		// compute with yet, but the anchor must be captured for replay.
		vm.UpdateReadingProgress(2, contentEndVisible: false);
		vm.ReadingProgress.Should().Be(0);

		fake.MetricRead.SetResult(Metric);
		var deadline = DateTime.UtcNow.AddSeconds(5);
		while (vm.ReadingProgress == 0 && DateTime.UtcNow < deadline)
		{
			await Task.Delay(20);
		}

		vm.ReadingProgress.Should().BeApproximately(0.4, 1e-9,
			"the captured anchor is replayed once the stored units attach");
	}
}
