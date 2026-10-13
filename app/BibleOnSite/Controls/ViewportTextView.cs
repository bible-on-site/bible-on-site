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
public sealed class ViewportTextView : UIView
{
    public UITextView TextView { get; } = new()
    {
        Editable = false,
        ScrollEnabled = true,
        Bounces = false,
        BackgroundColor = UIColor.Clear,
        TextContainerInset = UIEdgeInsets.Zero
    };

    private readonly List<IDisposable> _scrollObservers = [];

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
        if (TextView.Hidden) { return; }
        var frame = new CGRect(0, viewport.Offset, (double)Bounds.Width, viewport.Height);
        if (TextView.Frame != frame) { TextView.Frame = frame; }
        var offset = new CGPoint(0, viewport.Offset);
        if (TextView.ContentOffset != offset) { TextView.SetContentOffset(offset, false); }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            StopTracking();
            TextView.WeakDelegate = null;
        }
        base.Dispose(disposing);
    }
}
#endif
