using System.Runtime.CompilerServices;
using BibleOnSite.Helpers;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// The repeated-navigation crash fix (#2640) rests on weak event
/// subscriptions: a pushed page must fire while alive, must not be retained
/// by the singleton source after it is popped, and a raise on a dead target
/// must self-detach instead of accumulating a dead delegate.
/// </summary>
public class WeakEventSubscriptionTests
{
    private sealed class Target
    {
        public int Fired { get; private set; }
        public void Hit() => Fired++;
    }

    private sealed class FakeSource
    {
        private readonly List<EventHandler> _handlers = new();
        public int SubscriberCount => _handlers.Count;
        public void Add(EventHandler h) => _handlers.Add(h);
        public void Remove(EventHandler h) => _handlers.Remove(h);
        public void Raise()
        {
            foreach (var handler in _handlers.ToArray())
            {
                handler(this, EventArgs.Empty);
            }
        }
    }

    [Fact]
    public void Raise_WhileTargetAlive_InvokesCallback()
    {
        var source = new FakeSource();
        var target = new Target();

        WeakEventSubscription.Subscribe(target, source,
            static (s, h) => s.Add(h),
            static (s, h) => s.Remove(h),
            static t => t.Hit());
        var strong = 0;
        source.Add((_, _) => strong++); // weak and strong subscribers coexist

        source.Raise();

        target.Fired.Should().Be(1);
        strong.Should().Be(1);
        source.SubscriberCount.Should().Be(2);
    }

    [Fact]
    public void Raise_AfterTargetCollected_SelfDetaches()
    {
        var source = new FakeSource();
        var weak = SubscribeCollectedTarget(source);
        GarbageCollection.CollectCycles();

        weak.IsAlive.Should().BeFalse("the source must not retain its subscribers");

        source.Raise();

        source.SubscriberCount.Should().Be(0, "a dead target's handler removes itself on the next raise");
    }

    [Fact]
    public void Raise_AfterOneTargetCollected_StillServesLiveTargets()
    {
        var source = new FakeSource();
        _ = SubscribeCollectedTarget(source); // the dead subscription is the fixture
        var live = new Target();
        WeakEventSubscription.Subscribe(live, source,
            static (s, h) => s.Add(h),
            static (s, h) => s.Remove(h),
            static t => t.Hit());
        GarbageCollection.CollectCycles();

        source.Raise();

        live.Fired.Should().Be(1);
        source.SubscriberCount.Should().Be(1, "only the dead subscription was detached");
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static WeakReference SubscribeCollectedTarget(FakeSource source)
    {
        var target = new Target();
        WeakEventSubscription.Subscribe(target, source,
            static (s, h) => s.Add(h),
            static (s, h) => s.Remove(h),
            static t => t.Hit());
        return new WeakReference(target);
    }

    [Fact]
    public void Preferences_DoesNotRetainASubscribedScreen()
    {
        // The exact #2640 mechanism: the singleton PreferencesService must not
        // keep a popped page alive through PreferencesChanged.
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var weak = CreateSubscribedScreen(preferences);

        GarbageCollection.CollectCycles();

        weak.IsAlive.Should().BeFalse("the singleton preferences must not retain a closed page");
        preferences.FontFactor = 1.2; // a raise on the dead subscription self-detaches
        GC.KeepAlive(preferences);
    }

    [Fact]
    public void Preferences_FiresWhileScreenAlive()
    {
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var screen = new Target();
        WeakPreferencesSubscription.Subscribe(screen, preferences, static t => t.Hit());

        preferences.FontFactor = 1.2;

        screen.Fired.Should().Be(1);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static WeakReference CreateSubscribedScreen(PreferencesService preferences)
    {
        var screen = new Target();
        WeakPreferencesSubscription.Subscribe(screen, preferences, static t => t.Hit());
        return new WeakReference(screen);
    }
}
