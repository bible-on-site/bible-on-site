#if WINDOWS
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Input;
using Windows.System;
using KeyboardAccelerator = Microsoft.UI.Xaml.Input.KeyboardAccelerator;

namespace BibleOnSite.Pages;

#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class ParashaPage
#pragma warning restore S2333
{
    private UIElement? _keyboardBackOwner;
    private KeyboardAccelerator? _keyboardBack;

    private void RegisterReaderKeyboardBack()
    {
        UnregisterReaderKeyboardBack();
        MainGrid.HandlerChanged += OnReaderKeyboardHandlerChanged;
        MainGrid.Loaded += OnReaderKeyboardHandlerChanged;
        Shell.Current.Navigated += OnReaderNavigated;
        AttachReaderKeyboardBack();
    }

    private void OnReaderKeyboardHandlerChanged(object? sender, EventArgs e)
    {
        AttachReaderKeyboardBack();
        FocusReaderKeyboard();
    }

    private void OnReaderNavigated(object? sender, ShellNavigatedEventArgs args) => FocusReaderKeyboard();

    private void FocusReaderKeyboard()
    {
        Dispatcher.Dispatch(() =>
        {
            if (Shell.Current.CurrentPage == this && !ChapterSearch.IsSearchOpen)
            {
                NormalNavigationBar.NavigationButton.Focus();
            }
        });
    }

    private void AttachReaderKeyboardBack()
    {
        if (Window?.Handler?.PlatformView is not Microsoft.UI.Xaml.Window window || window.Content is not UIElement owner || ReferenceEquals(owner, _keyboardBackOwner))
        {
            return;
        }

        DetachReaderKeyboardBack();
        _keyboardBackOwner = owner;
        _keyboardBack = new KeyboardAccelerator { Key = VirtualKey.Left, Modifiers = VirtualKeyModifiers.Menu };
        _keyboardBack.Invoked += OnReaderKeyboardBackInvoked;
        owner.KeyboardAccelerators.Add(_keyboardBack);
    }

    private void UnregisterReaderKeyboardBack()
    {
        MainGrid.HandlerChanged -= OnReaderKeyboardHandlerChanged;
        MainGrid.Loaded -= OnReaderKeyboardHandlerChanged;
        Shell.Current.Navigated -= OnReaderNavigated;
        DetachReaderKeyboardBack();
    }

    private void DetachReaderKeyboardBack()
    {
        if (_keyboardBack != null)
        {
            _keyboardBack.Invoked -= OnReaderKeyboardBackInvoked;
            _keyboardBackOwner?.KeyboardAccelerators.Remove(_keyboardBack);
        }
        _keyboardBack = null;
        _keyboardBackOwner = null;
    }

    private async void OnReaderKeyboardBackInvoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args)
    {
        if (Shell.Current.CurrentPage != this)
        {
            return;
        }

        args.Handled = TryHandleReaderBack();
        if (args.Handled || Navigation.NavigationStack.Count <= 1)
        {
            return;
        }

        args.Handled = true;
        try
        {
            await Shell.Current.GoToAsync("..", false);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: reader Back navigation failure is log-only
        catch (Exception exception) //NOSONAR — reader Back navigation failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Reader Back navigation failed: {exception}");
        }
    }
}
#endif
