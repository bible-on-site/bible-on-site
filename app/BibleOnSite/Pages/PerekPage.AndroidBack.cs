#if ANDROID
using AndroidX.Activity;
using System.ComponentModel;

namespace BibleOnSite.Pages;

#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class PerekPage
#pragma warning restore S2333
{
    private ReaderBackCallback? _readerBack;

    private void RegisterReaderBack()
    {
        UnregisterReaderBack();
        if (Platform.CurrentActivity is not MainActivity activity) return;
        _readerBack = new ReaderBackCallback(this, activity);
        activity.OnBackPressedDispatcher.AddCallback(activity, _readerBack);
        ChapterSearch.SearchOpenChanged += OnReaderBackStateChanged;
        SelectionBar.PropertyChanged += OnReaderSelectionChanged;
        UpdateReaderBack();
    }

    private void UnregisterReaderBack()
    {
        ChapterSearch.SearchOpenChanged -= OnReaderBackStateChanged;
        SelectionBar.PropertyChanged -= OnReaderSelectionChanged;
        _readerBack?.Remove();
        _readerBack?.Dispose();
        _readerBack = null;
    }

    private void OnReaderBackStateChanged(object? sender, EventArgs e) => UpdateReaderBack();
    private void OnReaderSelectionChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(IsVisible)) UpdateReaderBack();
    }

    private void UpdateReaderBack()
    {
        // Root-page overlays do not add a Shell navigation entry. Android needs
        // an enabled callback before predictive Back begins to consume them.
        if (_readerBack != null) _readerBack.Enabled = ChapterSearch.IsSearchOpen || SelectionBar.IsVisible;
    }

    private sealed class ReaderBackCallback(PerekPage page, MainActivity activity) : OnBackPressedCallback(false)
    {
        public override void HandleOnBackPressed()
        {
            if (page.TryHandleReaderBack()) return;
            Enabled = false;
            activity.OnBackPressedDispatcher.OnBackPressed();
        }
    }
}
#endif
