using BibleOnSite.Helpers;
using BibleOnSite.Models;
using GraphicsFont = Microsoft.Maui.Graphics.Font;

namespace BibleOnSite.Controls;

/// <summary>
/// Draws the תיקון קוראים continuous flow with full text justification on every
/// line — including the last — which platform labels cannot do. Words are laid
/// out and drawn directly on a canvas so spacing is distributed exactly across
/// the column width, like a printed tikkun. Tap anywhere (handled by the page)
/// toggles niqqud and taamim for the whole perek.
/// </summary>
public class TikkunFlowView : GraphicsView
{
    private static readonly Thickness ContentPadding = new(12, 8, 12, 0);
    private const double LineHeightFactor = 1.4;

    private static readonly BindableProperty.BindingPropertyChangedDelegate OnContentChanged =
        (bindable, _, _) => ((TikkunFlowView)bindable).InvalidateContent();

    /// <summary>The perek's pesukim — bound to the carousel item's Pasukim.</summary>
    public static readonly BindableProperty PasukimProperty = BindableProperty.Create(
        nameof(Pasukim), typeof(IReadOnlyList<Pasuk>), typeof(TikkunFlowView),
        default(IReadOnlyList<Pasuk>), propertyChanged: OnContentChanged);

    /// <summary>שניים מקרא: emit each pasuk's words twice.</summary>
    public static readonly BindableProperty RepeatEachPasukProperty = BindableProperty.Create(
        nameof(RepeatEachPasuk), typeof(bool), typeof(TikkunFlowView), false,
        propertyChanged: OnContentChanged);

    /// <summary>Hide niqqud and taamim for the whole perek.</summary>
    public static readonly BindableProperty HideMarksProperty = BindableProperty.Create(
        nameof(HideMarks), typeof(bool), typeof(TikkunFlowView), false,
        propertyChanged: OnContentChanged);

    /// <summary>Base pasuk font size (bound to the app's scaled PasukFontSize resource).</summary>
    public static readonly BindableProperty TextFontSizeProperty = BindableProperty.Create(
        nameof(TextFontSize), typeof(double), typeof(TikkunFlowView), 18.0,
        propertyChanged: OnContentChanged);

    private readonly TikkunFlowDrawable _drawable;
    private int _contentVersion;

    public TikkunFlowView()
    {
        Drawable = _drawable = new TikkunFlowDrawable(this);
        // The layout engine positions words for RTL itself; GraphicsView
        // auto-mirrors its canvas when the page is RTL, which would flip the
        // manual positions back — force an LTR canvas instead.
        FlowDirection = FlowDirection.LeftToRight;
        // A starting estimate — the drawable corrects it to the exact flow
        // height once it can measure words on the real canvas.
        HeightRequest = TextFontSize * LineHeightFactor * 4;
    }

    public IReadOnlyList<Pasuk>? Pasukim
    {
        get => (IReadOnlyList<Pasuk>?)GetValue(PasukimProperty);
        set => SetValue(PasukimProperty, value);
    }

    public bool RepeatEachPasuk
    {
        get => (bool)GetValue(RepeatEachPasukProperty);
        set => SetValue(RepeatEachPasukProperty, value);
    }

    public bool HideMarks
    {
        get => (bool)GetValue(HideMarksProperty);
        set => SetValue(HideMarksProperty, value);
    }

    public double TextFontSize
    {
        get => (double)GetValue(TextFontSizeProperty);
        set => SetValue(TextFontSizeProperty, value);
    }

    private void InvalidateContent()
    {
        _contentVersion++;
        Invalidate();
    }

    private sealed class TikkunFlowDrawable : IDrawable
    {
        private readonly TikkunFlowView _view;
        private IReadOnlyList<TikkunWord> _words = [];
        private int _wordsVersion = -1;
        private TikkunFlowLayout.Result? _layout;
        private float _laidWidth = -1;

        public TikkunFlowDrawable(TikkunFlowView view) => _view = view;

        public void Draw(ICanvas canvas, RectF dirtyRect)
        {
            EnsureWords();
            var textWidth = dirtyRect.Width - (float)(ContentPadding.Left + ContentPadding.Right);
            if (_words.Count == 0 || textWidth <= 0)
            {
                var empty = (float)(ContentPadding.Top + ContentPadding.Bottom);
                if (Math.Abs(_view.HeightRequest - empty) > 0.5)
                {
                    _view.Dispatcher.Dispatch(() => _view.HeightRequest = empty);
                }
                return;
            }

            if (_layout == null || Math.Abs(_laidWidth - textWidth) > 0.5f)
            {
                var baseSize = (float)_view.TextFontSize;
                _layout = TikkunFlowLayout.Layout(_words, MeasureWord(canvas), baseSize,
                    textWidth, (float)LineHeightFactor);
                _laidWidth = textWidth;
            }

            var isDark = Application.Current?.RequestedTheme == AppTheme.Dark;
            var defaultColor = isDark ? Color.FromArgb("#e0e0e0") : Color.FromArgb("#1a1a1a");
            var padLeft = (float)ContentPadding.Left;
            var padTop = (float)ContentPadding.Top;
            foreach (var word in _layout.Words)
            {
                canvas.Font = word.IsBold ? GraphicsFont.DefaultBold : GraphicsFont.Default;
                canvas.FontSize = word.FontSize;
                canvas.FontColor = word.TextColor ?? defaultColor;
                canvas.DrawString(word.Text, padLeft + word.X, padTop + word.Y,
                    Math.Max(0, textWidth - word.X), (float)_view.TextFontSize * (float)LineHeightFactor,
                    HorizontalAlignment.Left, VerticalAlignment.Center, TextFlow.OverflowBounds);
            }

            var needed = _layout.Height + padTop + (float)ContentPadding.Bottom;
            if (Math.Abs(_view.HeightRequest - needed) > 0.5)
            {
                _view.Dispatcher.Dispatch(() => _view.HeightRequest = needed);
            }
        }

        private void EnsureWords()
        {
            if (_wordsVersion == _view._contentVersion)
            {
                return;
            }

            _words = TikkunKorimTextBuilder.BuildWords(_view.Pasukim, _view.RepeatEachPasuk, _view.HideMarks);
            _wordsVersion = _view._contentVersion;
            _layout = null;
        }

        private static Func<string, float, bool, float> MeasureWord(ICanvas canvas) =>
            (text, fontSize, bold) =>
                canvas.GetStringSize(text, bold ? GraphicsFont.DefaultBold : GraphicsFont.Default, fontSize).Width;
    }
}
