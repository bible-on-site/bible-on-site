using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Unit tests for <see cref="BoundedLruCache{TKey,TValue}"/> — the bounded
/// render cache the Android HtmlView handler shares across recycled cells.
/// </summary>
public class BoundedLruCacheTests
{
    private static BoundedLruCache<string, string> Create() => Create(3, 100);

    private static BoundedLruCache<string, string> Create(int maxEntries) => Create(maxEntries, 100);

    private static BoundedLruCache<string, string> Create(int maxEntries, int maxTotalSize) =>
        new(maxEntries, maxTotalSize, value => value.Length);

    public class Lookup
    {
        [Fact]
        public void returns_the_factory_value_on_a_miss()
        {
            var cache = Create();
            cache.GetOrAdd("k", () => "v").Should().Be("v");
        }

        [Fact]
        public void returns_the_cached_value_without_calling_the_factory_again()
        {
            var cache = Create();
            var calls = 0;
            cache.GetOrAdd("k", () => { calls++; return "v"; });
            cache.GetOrAdd("k", () => { calls++; return "other"; }).Should().Be("v");
            calls.Should().Be(1);
        }

        [Fact]
        public void distinct_keys_cache_independently()
        {
            var cache = Create();
            cache.GetOrAdd("a", () => "1");
            cache.GetOrAdd("b", () => "2").Should().Be("2");
            cache.GetOrAdd("a", () => "x").Should().Be("1");
        }
    }

    public class Eviction
    {
        [Fact]
        public void evicts_the_least_recently_used_entry_over_max_entries()
        {
            var cache = Create(2);
            cache.GetOrAdd("a", () => "1");
            cache.GetOrAdd("b", () => "2");
            cache.GetOrAdd("c", () => "3"); // evicts "a" (LRU)
            cache.GetOrAdd("a", () => "1-again").Should().Be("1-again"); // miss — evicts "b"
            cache.GetOrAdd("c", () => "x").Should().Be("3"); // survived both evictions
            cache.GetOrAdd("b", () => "2-again").Should().Be("2-again");
        }

        [Fact]
        public void a_hit_refreshes_the_entry_so_it_survives_eviction()
        {
            var cache = Create(2);
            cache.GetOrAdd("a", () => "1");
            cache.GetOrAdd("b", () => "2");
            cache.GetOrAdd("a", () => "x");  // refresh "a" — "b" is now oldest
            cache.GetOrAdd("c", () => "3");
            cache.GetOrAdd("a", () => "x").Should().Be("1");
            cache.GetOrAdd("b", () => "2-again").Should().Be("2-again");
        }

        [Fact]
        public void evicts_until_the_total_size_fits()
        {
            var cache = Create(10, 9);
            cache.GetOrAdd("a", () => "12345");
            cache.GetOrAdd("b", () => "12345");
            cache.GetOrAdd("c", () => "12345"); // total 15 > 9 → evicts "a" and "b"
            cache.Count.Should().Be(1);
            cache.GetOrAdd("a", () => "again").Should().Be("again");
        }

        [Fact]
        public void a_value_larger_than_the_size_budget_is_returned_but_not_cached()
        {
            var cache = Create(4, 5);
            cache.GetOrAdd("big", () => "1234567890").Should().Be("1234567890");
            cache.Count.Should().Be(0);
            cache.GetOrAdd("big", () => "again").Should().Be("again");
        }
    }

    public class Validation
    {
        [Fact]
        public void rejects_nonpositive_bounds()
        {
            var act = () => new BoundedLruCache<string, string>(0, 100, v => v.Length);
            act.Should().Throw<ArgumentOutOfRangeException>();
        }
    }
}
