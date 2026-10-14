#if IOS || MACCATALYST
using CoreGraphics;
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
        var text = TextView.AttributedText;
        var value = text?.Value ?? string.Empty;
        _sectionedAccessibility = value.Length > 16_384 || value.Count(c => c == '\n') > 128;
        TextView.AccessibilityElementsHidden = _sectionedAccessibility;
        IsAccessibilityElement = false;
        AccessibilityAttributedLabel = null;
        AccessibilityIdentifier = null;
        AccessibilityCustomActions = null;
        _accessibleSections = _sectionedAccessibility && text is not null
            ? AccessibleTextSections.Split(value).Select(section =>
            {
                var range = new NSRange(section.Start, section.Length);
                using var part = text.Substring(range.Location, range.Length);
                return new AccessibleSection(this, range, serial)
                {
                    AccessibilityLabel = value.Substring(section.Start, section.Length),
                    AccessibilityIdentifier = "CommentaryTextSection",
                    AccessibilityTraits = (ulong)UIAccessibilityTrait.StaticText,
                    AccessibilityCustomActions = CreateLinkActions(part, part.Value ?? string.Empty)
                };
            }).ToArray()
            : [];
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

    private sealed class AccessibleSection : UIAccessibilityElement
    {
        private readonly WeakReference<ViewportTextView> _owner;
        private readonly NSRange _range;
        private readonly int _serial;
        private double _measuredWidth = -1;
        private CGRect _textBounds;

        public AccessibleSection(ViewportTextView owner, NSRange range, int serial) : base(owner)
        {
            _owner = new(owner);
            _range = range;
            _serial = serial;
        }

        public override CGRect AccessibilityFrame
        {
            get
            {
                if (!_owner.TryGetTarget(out var owner) || owner._disposed || owner.Window is null ||
                    _serial != owner._accessibilitySerial) { return CGRect.Empty; }
                var view = owner.TextView;
                if (_range.Location + _range.Length > view.TextStorage.Length) { return CGRect.Empty; }
                var width = (double)view.TextContainer.Size.Width;
                if (Math.Abs(width - _measuredWidth) > 0.5)
                {
                    var glyphs = view.LayoutManager.GetGlyphRange(_range);
                    _textBounds = view.LayoutManager.GetBoundingRect(glyphs, view.TextContainer);
                    _measuredWidth = width;
                }
                // TextKit coordinates include the document offset; the text
                // view's bounds remove it when converted into the wrapper.
                var rect = view.ConvertRectToView(_textBounds, owner);
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
    }

    protected override void Dispose(bool disposing)
    {
        _disposed = true;
        ++_accessibilitySerial;
        _accessibleSections = [];
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
