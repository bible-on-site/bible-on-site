using BibleOnSite.Helpers;
using BibleOnSite.Models;

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

    /// <summary>
    /// Hide niqqud and taamim for the whole perek. Visibility is a paint-time
    /// concern only: the fully marked text stays the measurement/layout
    /// reference, so a toggle repaints without moving a single base letter
    /// (#3265) — hence a bare <see cref="GraphicsView.Invalidate"/> rather than
    /// <see cref="InvalidateContent"/>.
    /// </summary>
    public static readonly BindableProperty HideMarksProperty = BindableProperty.Create(
        nameof(HideMarks), typeof(bool), typeof(TikkunFlowView), false,
        propertyChanged: (bindable, _, _) =>
        {
            var view = (TikkunFlowView)bindable;
            view.Invalidate();
            // Windows: once the carousel's host item stops re-arranging, the
            // CanvasControl's visual stays attached to the compositor but its
            // swapchain stops presenting — Draw() runs, the frame never
            // reaches the screen (dotnet/maui#7639 family). Detaching and
            // re-attaching the CanvasControl gives it a fresh composition
            // visual, so the next Invalidate() actually presents (#3265).
#if WINDOWS
            if (view.Handler?.PlatformView is Microsoft.UI.Xaml.Controls.UserControl platform
                && platform.Content is Microsoft.UI.Xaml.UIElement canvas)
            {
                platform.Content = null;
                platform.Content = canvas;
                view.Invalidate();
            }
#endif
        });

    /// <summary>
    /// הסתר שם השם revision — a change-only input bound to
    /// PerekViewModel.DivineNameMaskingRevision. Any change bumps the content
    /// version so EnsureWords rebuilds with the new masking options (the
    /// options themselves live in the static DivineNameMasking state).
    /// </summary>
    public static readonly BindableProperty MaskingRevisionProperty = BindableProperty.Create(
        nameof(MaskingRevision), typeof(int), typeof(TikkunFlowView), 0,
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
        // Word and marker colors resolve from the requested theme at build
        // time, so a flip must re-derive them instead of repainting with the
        // stale palette (#2601).
        if (Application.Current is { } app)
        {
            // Loaded/Unloaded so a re-presented view re-subscribes and rebuilds
            // under the theme that is active then.
            Loaded += (_, _) =>
            {
                app.RequestedThemeChanged += OnAppRequestedThemeChanged;
                Dispatcher.Dispatch(InvalidateContent);
            };
            Unloaded += (_, _) => app.RequestedThemeChanged -= OnAppRequestedThemeChanged;
        }
    }

    internal void OnAppRequestedThemeChanged(object? sender, AppThemeChangedEventArgs e) =>
        Dispatcher.Dispatch(InvalidateContent);

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

    public int MaskingRevision
    {
        get => (int)GetValue(MaskingRevisionProperty);
        set => SetValue(MaskingRevisionProperty, value);
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
        // Word widths repeat massively across a perek (את, ה׳…) — a layout
        // re-run (marks/masking toggles, resize) otherwise re-measures every
        // word through the native text stack. Keyed by the exact inputs.
        private readonly Dictionary<(string Text, float FontSize, bool Bold), float> _widthCache = new();
        private const string WidthProbeText = "אאא";
        private const float FauxBoldOffset = 0.5f;
        private float _widthProbe = -1;

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
            var lineHeight = (float)_view.TextFontSize * (float)LineHeightFactor;
            foreach (var word in _layout.Words)
            {
                // Taamey D (#2623) — the same scripture face as the pasuk
                // labels. The canvas resolves IFont.Name through the platform
                // text stack, not the font registrar.
                canvas.Font = word.IsBold ? ScriptureFonts.Bold : ScriptureFonts.Regular;
                canvas.FontSize = word.FontSize;
                canvas.FontColor = word.TextColor ?? defaultColor;
                // The draw box must never be tighter than the word's drawn
                // width: Android truncates it to int and hands it to a
                // StaticLayout as the wrap constraint, so a snug box fragments
                // the word into narrow vertical pieces that pile over the
                // surrounding lines (#2069). Current MAUI forces an LTR text
                // direction inside DrawString, so HorizontalAlignment.Left
                // anchors the text at word.X no matter how wide the box is —
                // give every word the whole column, and an overlong word its
                // measured width plus slack.
                var drawWidth = MathF.Max(word.Width + 1f, textWidth);
                // word.Text is the geometry string (fully marked); PaintText
                // drops the marks only for the painted run so every base
                // letter keeps the origin the marked layout gave it (#3265).
                var paintText = PaintText(word.Text);
                canvas.DrawString(paintText, padLeft + word.X, padTop + word.Y,
                    drawWidth, lineHeight,
                    HorizontalAlignment.Left, VerticalAlignment.Center, TextFlow.OverflowBounds);
#if !WINDOWS
                if (word.IsBold)
                {
                    // MAUI's canvas drops IFont.Weight once a bundled font
                    // resolves to a real typeface (Android asset, iOS CTFont) —
                    // only Windows honors it via CanvasTextFormat.FontWeight.
                    // A sub-pixel double-strike keeps the pasuk-marker emphasis
                    // the system font used to provide (#2623).
                    canvas.DrawString(paintText, padLeft + word.X + FauxBoldOffset, padTop + word.Y,
                        drawWidth, lineHeight,
                        HorizontalAlignment.Left, VerticalAlignment.Center, TextFlow.OverflowBounds);
                }
#endif
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

            // Geometry words always carry the marked text — HideMarks never
            // reaches this method (it repaints instead of invalidating content).
            _words = TikkunKorimTextBuilder.BuildWords(_view.Pasukim, _view.RepeatEachPasuk);
            _wordsVersion = _view._contentVersion;
            _layout = null;
        }

        // Painted text per word, stripped on demand. Keyed by the marked
        // geometry string so a few hundred words share their stripped form
        // instead of re-allocating it on every repaint.
        private readonly Dictionary<string, string> _strippedTexts = new();

        private string PaintText(string markedText)
        {
            if (!_view.HideMarks)
            {
                return markedText;
            }

            if (!_strippedTexts.TryGetValue(markedText, out var stripped))
            {
                stripped = TikkunKorimTextBuilder.StripMarks(markedText);
                _strippedTexts[markedText] = stripped;
            }
            return stripped;
        }

        private Func<string, float, bool, float> MeasureWord(ICanvas canvas)
        {
            // One probe per layout validates the cache context: a canvas with
            // different font metrics or a font-size change (slider drags)
            // shifts the probe width, so entries measured under another
            // context are flushed instead of reused or accumulated.
            var probe = canvas.GetStringSize(
                WidthProbeText, ScriptureFonts.Regular, (float)_view.TextFontSize).Width;
            if (Math.Abs(probe - _widthProbe) > 0.01f)
            {
                _widthCache.Clear();
                _widthProbe = probe;
            }
            return (text, fontSize, bold) =>
            {
                if (_widthCache.TryGetValue((text, fontSize, bold), out var width))
                {
                    return width;
                }
                width = canvas.GetStringSize(text,
                    bold ? ScriptureFonts.Bold : ScriptureFonts.Regular, fontSize).Width;
                _widthCache[(text, fontSize, bold)] = width;
                return width;
            };
        }
    }
}
