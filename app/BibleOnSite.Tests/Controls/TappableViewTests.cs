using BibleOnSite.Controls;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// TappableView contract (#3252): one activation surface for every converted
/// Grid/Border + TapGestureRecognizer row — a tap recognizer on touch
/// platforms, the native Button's Click on Windows; both flow through
/// <c>SendActivated</c> with Button semantics (disabled/command-refused =
/// no activation).
/// </summary>
public class TappableViewTests
{
    [Fact]
    public void SendActivated_RaisesActivatedWithSenderAndParameter()
    {
        var view = new TappableView { CommandParameter = "פרמטר" };
        object? sender = null;
        object? parameter = new object(); // sentinel: must be replaced by CommandParameter
        view.Activated += (s, e) => { sender = s; parameter = e.Parameter; };

        view.SendActivated();

        sender.Should().BeSameAs(view);
        parameter.Should().Be("פרמטר");
    }

    [Fact]
    public void SendActivated_ExecutesCommandWithParameter()
    {
        object? received = null;
        var view = new TappableView
        {
            Command = new Command(p => received = p),
            CommandParameter = 42
        };

        view.SendActivated();

        received.Should().Be(42);
    }

    [Fact]
    public void SendActivated_RaisesActivatedBeforeCommand()
    {
        var order = new List<string>();
        var view = new TappableView { Command = new Command(_ => order.Add("command")) };
        view.Activated += (_, _) => order.Add("activated");

        view.SendActivated();

        order.Should().Equal("activated", "command");
    }

    [Fact]
    public void SendActivated_WhenDisabled_DoesNotActivateOrExecute()
    {
        var executed = 0;
        var view = new TappableView
        {
            IsEnabled = false,
            Command = new Command(_ => executed++)
        };
        var raised = 0;
        view.Activated += (_, _) => raised++;

        view.SendActivated();

        raised.Should().Be(0);
        executed.Should().Be(0);
    }

    [Fact]
    public void SendActivated_WhenCommandRefusesParameter_DoesNotActivateOrExecute()
    {
        var executed = 0;
        var view = new TappableView
        {
            Command = new Command(_ => executed++, _ => false),
            CommandParameter = "x"
        };
        var raised = 0;
        view.Activated += (_, _) => raised++;

        view.SendActivated();

        raised.Should().Be(0);
        executed.Should().Be(0);
    }

    [Fact]
    public void SendActivated_WithoutSubscribers_IsSafe()
    {
        var act = () => new TappableView { Command = new Command(_ => { }) }.SendActivated();
        act.Should().NotThrow();
    }

    [Fact]
    public void CommandParameter_Unset_PassesNull()
    {
        object? parameter = "sentinel";
        var view = new TappableView();
        view.Activated += (_, e) => parameter = e.Parameter;

        view.SendActivated();

        parameter.Should().BeNull();
    }

    [Fact]
    public void TapRecognizer_PlatformContract()
    {
#if WINDOWS
        // On Windows the platform Button owns activation; a tap recognizer
        // would double-fire Activated alongside Click.
        new TappableView().GestureRecognizers.Should().BeEmpty();
#else
        var view = new TappableView();
        var count = 0;
        view.Activated += (_, _) => count++;

        var tap = view.GestureRecognizers.OfType<TapGestureRecognizer>().Should().ContainSingle().Subject;
        typeof(TapGestureRecognizer)
            .GetMethod("SendTapped", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .Invoke(tap, [view, null]);

        count.Should().Be(1);
#endif
    }

    [Fact]
    public void TappedEventArgs_CarryCommandParameter_ForGestureStyleHandlers()
    {
        // Handlers migrated from TapGestureRecognizer.Tapped read e.Parameter —
        // the wired CommandParameter must flow through unchanged.
        var marker = new object();
        var view = new TappableView { CommandParameter = marker };
        object? parameter = null;
        view.Activated += (_, e) => parameter = e.Parameter;

        view.SendActivated();

        parameter.Should().BeSameAs(marker);
    }

    [Fact]
    public void Command_BindableProperties_RoundTrip()
    {
        var command = new Command(_ => { });
        var view = new TappableView
        {
            Command = command,
            CommandParameter = 7
        };

        view.Command.Should().BeSameAs(command);
        view.CommandParameter.Should().Be(7);
    }
}
