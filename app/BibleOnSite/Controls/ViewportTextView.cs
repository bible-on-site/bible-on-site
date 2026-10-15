#if IOS || MACCATALYST
using System.Runtime.InteropServices;
using CoreGraphics;
using CoreText;
using Foundation;
using UIKit;
using BibleOnSite.Helpers;

namespace BibleOnSite.Controls;

/// <summary>
/// An inline document keeps its full reader height while TextKit lays out only
/// the part intersecting the reader's viewport. The outer reader owns scrolling.
/// </summary>
public sealed class ViewportTextView : UIView, IUIAccessibilityContainer
{
    public UITextView TextView { get; } = new TracedTextView()
    {
        Editable = false,
        ScrollEnabled = true,
        Bounces = false,
        BackgroundColor = UIColor.Clear,
        TextContainerInset = UIEdgeInsets.Zero
    };

    private readonly List<IDisposable> _scrollObservers = [];

    private sealed class TracedTextView : UITextView
    {
        public override void LayoutSubviews()
        {
#if DEBUG
            var length = TextStorage.Length;
            if (length > 100_000) { NativeReaderTrace.Write($"text-layout:start length={length} frame={Frame}"); }
#endif
            base.LayoutSubviews();
#if DEBUG
            if (length > 100_000) { NativeReaderTrace.Write("text-layout:end"); }
#endif
        }
    }

    public ViewportTextView()
    {
        BackgroundColor = UIColor.Clear;
        // Preserve incremental TextKit 1 layout without a nested pan gesture.
        _ = TextView.LayoutManager;
        TextView.LayoutManager.AllowsNonContiguousLayout = true;
        TextView.TextContainer.LineFragmentPadding = 0;
        TextView.PanGestureRecognizer.Enabled = false;
        AddSubview(TextView);
    }

    private AccessibleSection[] _accessibleSections = [];
    private AccessibleTextSections.Section[] _sectionRanges = [];
    private readonly TextSectionGeometryCache<CGRect> _sectionGeometry = new();
    private bool _sectionedAccessibility;
    private int _accessibilitySerial;
    private bool _disposed;

    /// <summary>
    /// Bound both the number of accessibility objects and each spoken label.
    /// One label for a whole large document still makes XCTest snapshots costly.
    /// Text remains complete, ordered, and available with its link actions.
    /// </summary>
    internal void UpdateDocumentAccessibility()
    {
        var serial = ++_accessibilitySerial;
        _sectionGeometry.Reset();
        var text = TextView.AttributedText;
        var value = text?.Value ?? string.Empty;
        _sectionedAccessibility = value.Length > 16_384 || value.Count(c => c == '\n') > 128;
        TextView.AccessibilityElementsHidden = _sectionedAccessibility;
        // The bounded container sections own long-text accessibility. Hiding
        // children alone leaves UITextView's whole-document element exposed.
        TextView.IsAccessibilityElement = !_sectionedAccessibility;
        IsAccessibilityElement = false;
        AccessibilityAttributedLabel = null;
        AccessibilityIdentifier = null;
        AccessibilityCustomActions = null;
        _sectionRanges = _sectionedAccessibility && text is not null ? AccessibleTextSections.Split(value).ToArray() : [];
        _accessibleSections = _sectionedAccessibility && text is not null
            ? _sectionRanges.Select((section, index) =>
            {
                var range = new NSRange(section.Start, section.Length);
                using var part = text.Substring(range.Location, range.Length);
                return new AccessibleSection(this, index, serial)
                {
                    AccessibilityLabel = value.Substring(section.Start, section.Length),
                    AccessibilityIdentifier = "CommentaryTextSection",
                    AccessibilityTraits = (ulong)UIAccessibilityTrait.StaticText,
                    AccessibilityCustomActions = CreateLinkActions(part, part.Value ?? string.Empty)
                };
            }).ToArray()
            : [];
        EnsureSectionGeometry();
    }

    internal Func<string, bool>? ActivateLink { get; set; }

    private UIAccessibilityCustomAction[] CreateLinkActions(NSAttributedString text, string value)
    {
        var actions = new List<UIAccessibilityCustomAction>();
        for (nint index = 0; index < text.Length;)
        {
            var link = text.GetAttribute(UIStringAttributeKey.Link, index, out var range);
            index = Math.Max(index + 1, range.Location + range.Length);
            if (link is null) { continue; }
            var url = link is NSUrl nativeUrl ? nativeUrl.AbsoluteString : link.ToString();
            if (string.IsNullOrEmpty(url)) { continue; }
            var label = value.Substring((int)range.Location, (int)range.Length).Trim();
            actions.Add(new UIAccessibilityCustomAction(string.IsNullOrEmpty(label) ? url : label,
                new Func<UIAccessibilityCustomAction, bool>(_ => ActivateLink?.Invoke(url) == true)));
        }
        return actions.ToArray();
    }

    [Export("accessibilityElementCount")]
    public nint AccessibilityElementCount() => _sectionedAccessibility ? _accessibleSections.Length : 1;

    [Export("accessibilityElementAtIndex:")]
    public NSObject GetAccessibilityElementAt(nint index)
        => index < 0 || index >= AccessibilityElementCount() ? null!
            : _sectionedAccessibility ? _accessibleSections[(int)index] : TextView;

    [Export("indexOfAccessibilityElement:")]
    public nint GetIndexOfAccessibilityElement(NSObject element)
    {
        var index = _sectionedAccessibility
            ? Array.FindIndex(_accessibleSections, section => section.Handle == element.Handle)
            : element.Handle == TextView.Handle ? 0 : -1;
        return index < 0 ? nint.MaxValue : index;
    }

    [Export("accessibilityElements")]
    public NSObject[] GetAccessibilityElements() => _sectionedAccessibility ? _accessibleSections : [TextView];

    private void EnsureSectionGeometry()
    {
        if (_disposed || !_sectionedAccessibility || TextView.AttributedText is not { } currentText) { return; }
        var width = (double)TextView.Bounds.Width;
        var request = _sectionGeometry.Begin(width, _accessibleSections.Length);
        if (request is null) { return; }
        // CoreText measures the immutable copy off-thread; UIKit snapshots
        // then read cached frames without asking the live TextKit to lay out.
        var text = (NSAttributedString)currentText.Copy();
        var sections = _sectionRanges;
        _ = Task.Run(() =>
        {
            try
            {
                using (text)
                {
                    NativeReaderTrace.Write($"accessibility-measure:start length={text.Length} width={width} sections={sections.Length}");
                    var bounds = MeasureSectionBounds(text, width, sections);
                    NativeReaderTrace.Write("accessibility-measure:end");
                    MainThread.BeginInvokeOnMainThread(() =>
                    {
                        if (!_disposed && _sectionGeometry.Complete(request.Value, bounds) && Window is not null && !TextView.Hidden)
                        {
                            UIAccessibility.PostNotification(UIAccessibilityPostNotification.LayoutChanged, null);
                        }
                    });
                }
            }
            catch (Exception error)
            {
                Console.Error.WriteLine($"Commentary accessibility measurement failed: {error}");
            }
        });
    }

    private static CGRect[] MeasureSectionBounds(NSAttributedString text, double width, AccessibleTextSections.Section[] sections)
    {
        using var framesetter = new CTFramesetter(text);
        var range = new NSRange(0, text.Length);
        var size = framesetter.SuggestFrameSize(range, null, new CGSize((NFloat)width, NFloat.MaxValue), out _);
        var height = Math.Max(1, Math.Ceiling((double)size.Height) + 1);
        using var path = new CGPath();
        path.AddRect(new CGRect(0, 0, width, height));
        using var frame = framesetter.GetFrame(range, path, null)
            ?? throw new InvalidOperationException("CoreText could not measure commentary accessibility frames.");
        if (frame.GetVisibleStringRange().Length < text.Length)
        {
            throw new InvalidOperationException("Commentary accessibility measurement must cover the complete text.");
        }
        var lines = frame.GetLines();
        var origins = new CGPoint[lines.Length];
        frame.GetLineOrigins(new NSRange(0, 0), origins);
        var bounds = new CGRect[sections.Length];
        var sectionIndex = 0;
        try
        {
            // Both ranges are ordered. Sweep once through lines and sections;
            // measuring each section independently would repeatedly shape text.
            for (var lineIndex = 0; lineIndex < lines.Length; lineIndex++)
            {
                var line = lines[lineIndex];
                var lineRange = line.StringRange;
                var lineStart = (int)lineRange.Location;
                var lineEnd = lineStart + (int)lineRange.Length;
                while (sectionIndex < sections.Length && sections[sectionIndex].Start + sections[sectionIndex].Length <= lineStart)
                {
                    ++sectionIndex;
                }
                line.GetTypographicBounds(out var ascent, out var descent, out _);
                for (var index = sectionIndex; index < sections.Length && sections[index].Start < lineEnd; index++)
                {
                    var start = Math.Max(lineStart, sections[index].Start);
                    var end = Math.Min(lineEnd, sections[index].Start + sections[index].Length);
                    var left = (double)line.GetOffsetForStringIndex(start, out _);
                    var right = (double)line.GetOffsetForStringIndex(end, out _);
                    var rect = new CGRect((double)origins[lineIndex].X + Math.Min(left, right),
                        height - (double)origins[lineIndex].Y - (double)ascent,
                        Math.Max(1, Math.Abs(right - left)), (double)(ascent + descent));
                    bounds[index] = bounds[index].IsEmpty ? rect : CGRect.Union(bounds[index], rect);
                }
            }
        }
        finally
        {
            foreach (var line in lines) { line.Dispose(); }
        }
        return bounds;
    }

    private sealed class AccessibleSection : UIAccessibilityElement
    {
        private readonly WeakReference<ViewportTextView> _owner;
        private readonly int _index;
        private readonly int _serial;

        public AccessibleSection(ViewportTextView owner, int index, int serial) : base(owner)
        {
            _owner = new(owner);
            _index = index;
            _serial = serial;
        }

        public override CGRect AccessibilityFrame
        {
            get
            {
                if (!_owner.TryGetTarget(out var owner) || owner._disposed || owner.Window is null ||
                    _serial != owner._accessibilitySerial) { return CGRect.Empty; }
                var view = owner.TextView;
                if (!owner._sectionGeometry.TryGet(_index, (double)view.Bounds.Width, out var bounds)) { return CGRect.Empty; }
                // Cached glyph coordinates follow the live viewport transform.
                var rect = view.ConvertRectToView(bounds, owner);
                return UIAccessibility.ConvertFrameToScreenCoordinates(rect, owner);
            }
            set => base.AccessibilityFrame = value;
        }
    }
    public override void MovedToWindow()
    {
        base.MovedToWindow();
        StopTracking();
        if (Window is null) { return; }
        for (var ancestor = Superview; ancestor is not null; ancestor = ancestor.Superview)
        {
            if (ancestor is UIScrollView scrollView)
            {
                _scrollObservers.Add(scrollView.AddObserver("contentOffset",
                    NSKeyValueObservingOptions.New, _ => UpdateViewport()));
            }
        }
        UpdateViewport();
    }

    public override void LayoutSubviews()
    {
        base.LayoutSubviews();
        UpdateViewport();
    }

    internal void StopTracking()
    {
        foreach (var observer in _scrollObservers) { observer.Dispose(); }
        _scrollObservers.Clear();
    }

    private void UpdateViewport()
    {
        if (Window is not { } window || Bounds.Width <= 0) { return; }
        var visible = ConvertRectFromView(window.Bounds, window);
        var left = (double)visible.X;
        var right = (double)(visible.X + visible.Width);
        var top = (double)visible.Y;
        var bottom = (double)(visible.Y + visible.Height);
        for (var ancestor = Superview; ancestor is not null; ancestor = ancestor.Superview)
        {
            if (!ancestor.ClipsToBounds) { continue; }
            var clip = ConvertRectFromView(ancestor.Bounds, ancestor);
            left = Math.Max(left, (double)clip.X);
            right = Math.Min(right, (double)(clip.X + clip.Width));
            top = Math.Max(top, (double)clip.Y);
            bottom = Math.Min(bottom, (double)(clip.Y + clip.Height));
        }
        var viewport = TextViewport.Clip((double)Bounds.Height, top, bottom);
        var horizontal = TextViewport.Clip((double)Bounds.Width, left, right);
        TextView.Hidden = viewport.Height <= 0 || horizontal.Height <= 0;
        AccessibilityElementsHidden = TextView.Hidden;
        if (TextView.Hidden) { return; }
        var frame = new CGRect(0, viewport.Offset, (double)Bounds.Width, viewport.Height);
        if (TextView.Frame != frame)
        {
            NativeReaderTrace.Write($"viewport-frame:start {frame}");
            TextView.Frame = frame;
            NativeReaderTrace.Write("viewport-frame:end");
        }
        var offset = new CGPoint(0, viewport.Offset);
        if (TextView.ContentOffset != offset)
        {
            NativeReaderTrace.Write($"viewport-offset:start {offset}");
            TextView.SetContentOffset(offset, false);
            NativeReaderTrace.Write("viewport-offset:end");
        }
        EnsureSectionGeometry();
    }

    protected override void Dispose(bool disposing)
    {
        _disposed = true;
        ++_accessibilitySerial;
        _accessibleSections = [];
        _sectionRanges = [];
        _sectionGeometry.Reset();
        ActivateLink = null;
        if (disposing)
        {
            StopTracking();
            TextView.WeakDelegate = null;
        }
        base.Dispose(disposing);
    }
}
#endif
