using BibleOnSite.Controls;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Controls;

public class ReaderExitFullscreenButtonTests
{
    private static void SendPan(ReaderExitFullscreenButton button, GestureStatus status, double totalX, double totalY) =>
        typeof(ReaderExitFullscreenButton)
            .GetMethod("OnPan", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .Invoke(button, [null, new PanUpdatedEventArgs(status, 0, totalX, totalY)]);

    [Fact]
    public void Ctor_StartsHidden_WithExitAutomationId()
    {
        var button = new ReaderExitFullscreenButton();
        button.AutomationId.Should().Be("ExitFullScreenButton");
        button.IsVisible.Should().BeFalse();
        button.GestureRecognizers.OfType<TapGestureRecognizer>().Should().ContainSingle();
        button.GestureRecognizers.OfType<PanGestureRecognizer>().Should().ContainSingle();
    }

    [Fact]
    public void Tap_RaisesExitRequested()
    {
        var button = new ReaderExitFullscreenButton();
        object? sender = null;
        button.ExitRequested += (s, _) => sender = s;
        var tap = button.GestureRecognizers.OfType<TapGestureRecognizer>().Single();
        typeof(TapGestureRecognizer)
            .GetMethod("SendTapped", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .Invoke(tap, [button, null]);
        sender.Should().BeSameAs(button);
    }

    [Fact]
    public void Tap_WithoutSubscribers_IsSafe()
    {
        var button = new ReaderExitFullscreenButton();
        var tap = button.GestureRecognizers.OfType<TapGestureRecognizer>().Single();
        FluentActions.Invoking(() => typeof(TapGestureRecognizer)
            .GetMethod("SendTapped", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .Invoke(tap, [button, null])).Should().NotThrow();
    }

    [Fact]
    public void Pan_Running_TranslatesFromTheGestureStartPosition()
    {
        var button = new ReaderExitFullscreenButton();

        SendPan(button, GestureStatus.Started, 0, 0);
        SendPan(button, GestureStatus.Running, 15, -25);
        button.TranslationX.Should().Be(15);
        button.TranslationY.Should().Be(-25);

        SendPan(button, GestureStatus.Completed, 15, -25);
        button.TranslationX.Should().Be(15, "a completed pan leaves the button where it landed");

        SendPan(button, GestureStatus.Started, 0, 0);
        SendPan(button, GestureStatus.Running, 5, 5);
        button.TranslationX.Should().Be(20, "a new pan continues from the last dropped position");
        button.TranslationY.Should().Be(-20);
    }

    [Fact]
    public void Pan_Canceled_KeepsTheDroppedPosition()
    {
        var button = new ReaderExitFullscreenButton();
        SendPan(button, GestureStatus.Started, 0, 0);
        SendPan(button, GestureStatus.Running, 30, 40);
        SendPan(button, GestureStatus.Canceled, 30, 40);
        button.TranslationX.Should().Be(30);
        button.TranslationY.Should().Be(40);
    }

    [Fact]
    public void ResetPosition_RedocksTheButton()
    {
        var button = new ReaderExitFullscreenButton();
        SendPan(button, GestureStatus.Started, 0, 0);
        SendPan(button, GestureStatus.Running, -80, -120);
        button.ResetPosition();
        button.TranslationX.Should().Be(0);
        button.TranslationY.Should().Be(0);
    }
}
