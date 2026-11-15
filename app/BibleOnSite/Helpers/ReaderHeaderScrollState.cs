namespace BibleOnSite.Helpers;

/// <summary>Hide after deliberate downward scrolling; reveal on the first upward movement.</summary>
public sealed class ReaderHeaderScrollState
{
    private double _downwardDistance;
    public bool IsVisible { get; private set; } = true;

    public bool Update(double delta) => Update(delta, false);

    public bool Update(double delta, bool keepVisible)
    {
        if (keepVisible)
        {
            Reset();
        }
        else if (double.IsFinite(delta))
        {
            if (delta < -0.5)
            {
                Reset();
            }
            else if (delta > 0.5)
            {
                _downwardDistance += delta;
                if (_downwardDistance >= 12)
                {
                    IsVisible = false;
                }
            }
        }
        return IsVisible;
    }

    public void Reset()
    {
        _downwardDistance = 0;
        IsVisible = true;
    }
}
