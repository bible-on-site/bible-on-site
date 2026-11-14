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

    public TikkunFlowView() : this(TikkunFont.Shape) { }

    internal TikkunFlowView(Func<string, float, TikkunGlyphRun> shapeWord)
    {
        Drawable = _drawable = new TikkunFlowDrawable(this, shapeWord);
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
        private readonly Func<string, float, TikkunGlyphRun> _shapeWord;
        private readonly Dictionary<(string Text, float FontSize), TikkunGlyphRun> _runs = new();
        private const float FauxBoldOffset = 0.5f;

        public TikkunFlowDrawable(TikkunFlowView view, Func<string, float, TikkunGlyphRun> shapeWord)
        {
            _view = view;
            _shapeWord = shapeWord;
        }

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
                _layout = TikkunFlowLayout.Layout(_words, MeasureWord, baseSize,
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
                var run = GetRun(word.Text, word.FontSize);
                // Reserve the marked font's full ascent/descent in both states.
                // Native paths have no text box that Android can re-wrap (#2069).
                var baseline = (lineHeight - (run.Ascent - run.Descent)) / 2 + run.Ascent;
                canvas.SaveState();
                canvas.Translate(padLeft + word.X, padTop + word.Y + baseline);
                canvas.FillColor = word.TextColor ?? defaultColor;
                PaintRun(canvas, run);
                if (word.IsBold)
                {
                    // Preserve the marker emphasis used by the bundled regular
                    // scripture face on mobile (#2623), identically on Windows.
                    canvas.Translate(FauxBoldOffset, 0);
                    PaintRun(canvas, run);
                }
                canvas.RestoreState();
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
            var fontSize = (float)_view.TextFontSize;
            var active = _words.Select(w => (w.Text, w.FontSizeScale * fontSize)).ToHashSet();
            active.Add((" ", fontSize));
            active.Add((TikkunFlowLayout.StumaProbe, fontSize));
            foreach (var key in _runs.Keys.Where(k => !active.Contains(k)).ToArray())
            {
                _runs.Remove(key);
            }
            _wordsVersion = _view._contentVersion;
            _layout = null;
        }

        private void PaintRun(ICanvas canvas, TikkunGlyphRun run)
        {
            if (run.Bases.Count > 0)
            {
                canvas.FillPath(run.Bases, WindingMode.NonZero);
            }
            if (!_view.HideMarks && run.Marks.Count > 0)
            {
                canvas.FillPath(run.Marks, WindingMode.NonZero);
            }
        }

        private TikkunGlyphRun GetRun(string text, float fontSize)
        {
            if (!_runs.TryGetValue((text, fontSize), out var run))
            {
                run = _shapeWord(text, fontSize);
                _runs[(text, fontSize)] = run;
            }
            return run;
        }

        private float MeasureWord(string text, float fontSize, bool _) => GetRun(text, fontSize).Width;
    }
}
