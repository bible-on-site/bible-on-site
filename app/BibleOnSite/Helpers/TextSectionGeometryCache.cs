namespace BibleOnSite.Helpers;

/// <summary>Cache section frames while rejecting stale width/document work.</summary>
public sealed class TextSectionGeometryCache<T>
{
    public readonly record struct Request(int Serial, double Width, int Count);
    private int _serial;
    private double _measuredWidth = double.NaN;
    private double _pendingWidth = double.NaN;
    private T[] _bounds = [];

    public void Reset()
    {
        ++_serial;
        _measuredWidth = double.NaN;
        _pendingWidth = double.NaN;
        _bounds = [];
    }

    public Request? Begin(double width, int count)
    {
        if (!double.IsFinite(width) || width <= 0 || count <= 0) { return null; }
        if (Math.Abs(width - _measuredWidth) < 0.5)
        {
            // Returning to a cached width cancels work for the interim width.
            if (!double.IsNaN(_pendingWidth) && Math.Abs(width - _pendingWidth) >= 0.5)
            {
                ++_serial;
                _pendingWidth = double.NaN;
            }
            return null;
        }
        if (Math.Abs(width - _pendingWidth) < 0.5) { return null; }
        _pendingWidth = width;
        return new(++_serial, width, count);
    }

    public bool Complete(Request request, T[] bounds)
    {
        if (request.Serial != _serial) { return false; }
        if (bounds.Length != request.Count) { throw new ArgumentException("Every text section needs a measured frame.", nameof(bounds)); }
        _pendingWidth = double.NaN;
        _measuredWidth = request.Width;
        _bounds = bounds;
        return true;
    }

    public bool TryGet(int index, double width, out T bounds)
    {
        if (Math.Abs(width - _measuredWidth) < 0.5 && index >= 0 && index < _bounds.Length)
        {
            bounds = _bounds[index];
            return true;
        }
        bounds = default!;
        return false;
    }
}
