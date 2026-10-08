namespace BibleOnSite.Models;

/// <summary>
/// One drawable word in the תיקון קוראים continuous flow — the unit the justified
/// layout measures, wraps and spaces. Carries the styling of the pasuk span it
/// came from so qri/ktiv notes, parsha markers and pasuk numbers keep their look.
/// </summary>
/// <param name="Text">The word text (never contains spaces; maqaf-joined words stay one unit).</param>
/// <param name="TextColor">Explicit span color, or null to use the theme text color.</param>
/// <param name="FontSizeScale">Font size as a fraction of the base pasuk size (14/18 for notes and markers).</param>
/// <param name="IsBold">Whether the word renders bold.</param>
public sealed record TikkunWord(string Text, Color? TextColor, float FontSizeScale, bool IsBold);
