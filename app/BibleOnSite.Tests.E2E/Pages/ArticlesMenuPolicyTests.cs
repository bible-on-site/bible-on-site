using BibleOnSite.Tests.E2E.Fixtures;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Capturing;

namespace BibleOnSite.Tests.E2E.Pages;

/// <summary>Offline app instance booted onto a regular perek — the articles
/// surface comes from the packaged starter snapshot, so no API is needed to
/// exercise the ⋮ menu's content-mode policy (#3401).</summary>
public sealed class ArticlesMenuFixture : AppFixture
{
    protected override bool RequiresApi => false;

    protected override IEnumerable<KeyValuePair<string, string>> LaunchEnvironment =>
        [new("BIBLE_E2E_PEREK", "10")];
}

[CollectionDefinition("Articles menu", DisableParallelization = true)]
public sealed class ArticlesMenuCollection : ICollectionFixture<ArticlesMenuFixture>;

/// <summary>
/// #3401 rendered check: the reader's ⋮ options menu follows the active
/// content mode — in the articles view only הסתר שם השם remains; שניים מקרא
/// and תיקון קוראים leave no rendered, focusable or invocable row. Returning
/// to the text restores the scripture menu with its saved toggles intact.
/// Presence probes read the visibility tree + real bounds — a hidden row's
/// peer reports IsOffscreen or a zero rect — and actions run through the
/// Invoke pattern, so a desktop window covering the app cannot starve them.
/// </summary>
[Collection("Articles menu")]
public sealed class ArticlesMenuPolicyTests(ArticlesMenuFixture fixture)
{
    [Fact]
    public async Task ArticlesMode_ShowsOnlyMaskingAction_ThenRestoresScriptureMenu()
    {
        await WaitForReaderAsync();

        // Scripture mode: all three actions render; toggle שניים מקרא on so
        // its survival across the articles round-trip is provable.
        await OpenMenuAsync();
        RenderedCheckBox("ShnayimMikraCheckBox").Should().NotBeNull();
        RenderedCheckBox("TikkunKorimCheckBox").Should().NotBeNull();
        var maskingBox = RenderedCheckBox("DivineNameMaskingCheckBox");
        maskingBox.Should().NotBeNull();
        var maskingBefore = ToggleStateOf(maskingBox!);
        CaptureScreenshot("articles-menu-scripture.png");

        await ClickWithForegroundRetryAsync(RenderedCheckBox("ShnayimMikraCheckBox")!);

        await InvokeButtonAsync("ArticlesButton");

        var articles = await WaitForArticlesViewAsync();
        if (articles is null)
        {
            DumpCandidates("ReaderArticlesView", "PasukimCollection");
        }
        articles.Should().NotBeNull("the articles button must swap in the article catalogue");

        // Articles mode: only הסתר שם השם renders — the scripture rows leave
        // no live peer at all.
        await OpenMenuAsync();
        RenderedCheckBox("DivineNameMaskingCheckBox").Should().NotBeNull(
            "articles mode keeps the one article-applicable action (#3401)");
        RenderedCheckBox("ShnayimMikraCheckBox").Should().BeNull(
            "שניים מקרא must not render a row, blank space or hit target in articles mode (#3401)");
        RenderedCheckBox("TikkunKorimCheckBox").Should().BeNull(
            "תיקון קוראים must not render a row, blank space or hit target in articles mode (#3401)");
        CaptureScreenshot("articles-menu-articles.png");

        // Masking still works from the articles menu — it flips the real
        // preference, not a shadow copy.
        await ClickWithForegroundRetryAsync(RenderedCheckBox("DivineNameMaskingCheckBox")!);
        await OpenMenuAsync();
        ToggleStateOf(RenderedCheckBox("DivineNameMaskingCheckBox")!).Should().NotBe(maskingBefore,
            "the articles-mode masking toggle flips the real preference (#3401)");

        // Close the menu, then back to the text: the full scripture menu is
        // restored and the saved שניים מקרא value survived the round-trip.
        await CloseMenuAsync();
        await InvokeButtonAsync("TextButton");
        await WaitForReaderAsync();

        await OpenMenuAsync();
        RenderedCheckBox("ShnayimMikraCheckBox").Should().NotBeNull();
        RenderedCheckBox("TikkunKorimCheckBox").Should().NotBeNull();
        RenderedCheckBox("DivineNameMaskingCheckBox").Should().NotBeNull();
        ToggleStateOf(RenderedCheckBox("ShnayimMikraCheckBox")!).Should().Be(FlaUI.Core.Definitions.ToggleState.On,
            "hiding the row in articles mode must not reset the saved שניים מקרא mode (#3401)");

        // Restore the masking preference this test flipped — it persists on
        // the machine across launches.
        await ClickWithForegroundRetryAsync(RenderedCheckBox("DivineNameMaskingCheckBox")!);
        await OpenMenuAsync();
        ToggleStateOf(RenderedCheckBox("DivineNameMaskingCheckBox")!).Should().Be(maskingBefore);
        await CloseMenuAsync();
    }

    /// <summary>Waits until the reader's own surface reports visible with
    /// real bounds — the dump shows dead carousel pages keep IsOffscreen or a
    /// zero rect, so the visibility tree + geometry is the honest live-page
    /// signal and does not care which window is topmost on the desktop.</summary>
    private async Task WaitForReaderAsync()
    {
        var reader = await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId("PasukimCollection"))
                .FirstOrDefault(element => IsVisibleInTree(element)
                    && element.BoundingRectangle is { Height: > 200 }),
            TimeSpan.FromSeconds(30));
        if (reader is null)
        {
            DumpCandidates("PasukimCollection", "ReaderMenuButton", "PerekSource");
        }
        reader.Should().NotBeNull("the perek reader must render its pasuk list");
    }

    /// <summary>Writes the main window's rendered pixels to the E2E artifacts
    /// directory — the scripture/articles menu captures are this issue's
    /// visual evidence (#3401).</summary>
    private void CaptureScreenshot(string name)
    {
        var artifacts = Path.GetFullPath(Path.Join(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".artifacts"));
        Directory.CreateDirectory(artifacts);
        using var capture = Capture.Element(fixture.MainWindow);
        capture.ToFile(Path.Join(artifacts, name));
    }

    /// <summary>Dumps every enumerated copy of the ambiguous elements with
    /// the state each ghost check reads — the tree says what the pixels
    /// cannot (same diagnostic the tikkun suite dumps).</summary>
    private void DumpCandidates(params string[] automationIds)
    {
        CaptureScreenshot("articles-menu-dump.png");
        foreach (var id in automationIds)
        {
            var elements = fixture.MainWindow.FindAllDescendants(fixture.CF.ByAutomationId(id));
            foreach (var element in elements)
            {
                var chain = new List<string>();
                for (var node = element.Parent; node != null; node = node.Parent)
                {
                    chain.Add($"{node.Properties.AutomationId.ValueOrDefault ?? node.ControlType.ToString()}" +
                              $"(off={node.Properties.IsOffscreen.ValueOrDefault},en={node.Properties.IsEnabled.ValueOrDefault})");
                }
                var bounds = element.BoundingRectangle;
                var hit = bounds is { Width: > 0, Height: > 0 }
                    ? fixture.Automation.FromPoint(new System.Drawing.Point(
                        (int)(bounds.Left + bounds.Width / 2),
                        (int)(bounds.Top + bounds.Height / 2)))
                    : null;
                var hitInfo = hit is null
                    ? "none"
                    : $"id={hit.Properties.AutomationId.ValueOrDefault ?? hit.ControlType.ToString()} " +
                      $"name={hit.Properties.Name.ValueOrDefault} pid={hit.Properties.ProcessId.ValueOrDefault} " +
                      $"rect={hit.BoundingRectangle}";
                var live = IsVisibleInTree(element) && bounds is { Width: > 0, Height: > 0 };
                Console.WriteLine($"{id}: live={live} off={element.IsOffscreen} en={element.IsEnabled} rect={element.BoundingRectangle} " +
                                  $"atCenter=[{hitInfo}] chain={string.Join(">", chain)}");
            }
        }
    }

    /// <summary>The articles view is a CollectionView that stays realized but
    /// hidden — presence in the tree is not proof, only the live box is: a
    /// hidden collection reports IsOffscreen or a zero rect.
    /// </summary>
    private Task<AutomationElement?> WaitForArticlesViewAsync() =>
        fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId("ReaderArticlesView"))
                .FirstOrDefault(element => IsVisibleInTree(element)
                    && element.BoundingRectangle is { Height: > 200 }),
            TimeSpan.FromSeconds(15));

    /// <summary>Fires the ⋮ toolbar button's real Clicked handler — the
    /// Invoke pattern drives the control without a foreground/hit-test, so a
    /// window covering the app (observed: a Chrome mail preview stealing the
    /// desktop) cannot starve the action.</summary>
    private async Task ClickMenuButtonAsync() => await InvokeButtonAsync("ReaderMenuButton");

    /// <summary>Finds a live button peer and fires its Invoke pattern; falls
    /// back to a physical click when the control exposes no invoker.</summary>
    private async Task InvokeButtonAsync(string automationId)
    {
        var button = await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId(automationId))
                .FirstOrDefault(element => IsVisibleInTree(element)
                    && element.BoundingRectangle is { Width: > 0, Height: > 0 }));
        button.Should().NotBeNull($"{automationId} must render in every content mode");
        if (button!.Patterns.Invoke.TryGetPattern(out var invoke))
        {
            invoke.Invoke();
            return;
        }
        await ClickWithForegroundRetryAsync(button);
    }

    /// <summary>Physical click with the app re-raised on each attempt — the
    /// gesture asserts foreground ownership, so a window stealing focus
    /// between polls is retried rather than failing the test.</summary>
    private async Task ClickWithForegroundRetryAsync(AutomationElement element)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
        while (true)
        {
            try
            {
                fixture.MainWindow.SetForeground();
                fixture.Click(element);
                return;
            }
            catch (InvalidOperationException) when (DateTime.UtcNow < deadline)
            {
                // Another app owns the foreground right now — re-raise and retry.
                await Task.Delay(250);
            }
        }
    }

    /// <summary>Opens the ⋮ menu and waits for the live overlay element.</summary>
    private async Task OpenMenuAsync()
    {
        await ClickMenuButtonAsync();

        var overlay = await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId("ReaderMenuOverlay"))
                .FirstOrDefault(element => IsVisibleInTree(element)
                    && element.BoundingRectangle is { Width: > 0, Height: > 0 }),
            TimeSpan.FromSeconds(10));
        overlay.Should().NotBeNull("the ⋮ button must open the options menu");
    }

    /// <summary>Dismisses the open menu — a second ⋮ press toggles it closed;
    /// Invoke drives the real handler without needing the desktop foreground.</summary>
    private async Task CloseMenuAsync()
    {
        if (await WaitForMenuHiddenAsync(TimeSpan.FromMilliseconds(500)))
        {
            return;
        }

        await InvokeButtonAsync("ReaderMenuButton");
        if (!await WaitForMenuHiddenAsync(TimeSpan.FromSeconds(5)))
        {
            DumpCandidates("ReaderMenuOverlay", "ReaderMenuButton");
            (await WaitForMenuHiddenAsync(TimeSpan.FromSeconds(2))).Should().BeTrue(
                "a second ⋮ press must dismiss the options menu");
        }
    }

    private async Task<bool> WaitForMenuHiddenAsync(TimeSpan timeout)
    {
        var hidden = await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId("ReaderMenuOverlay"))
                    .All(element => element.IsOffscreen
                        || element.BoundingRectangle is { Width: 0 } or { Height: 0 })
                ? window
                : null,
            timeout);
        return hidden is not null;
    }

    /// <summary>The rendered checkbox element inside the open menu, or null
    /// when every UIA candidate is hidden: a row whose IsVisible binding
    /// collapsed it reports IsOffscreen or a zero rect, so the visibility
    /// tree + real bounds is the honest "the app renders this row" signal —
    /// deliberately not FromPoint, which answers for whatever desktop window
    /// is topmost rather than for the app.</summary>
    private AutomationElement? RenderedCheckBox(string automationId)
    {
        foreach (var element in fixture.MainWindow.FindAllDescendants(fixture.CF.ByAutomationId(automationId)))
        {
            if (IsVisibleInTree(element)
                && element.BoundingRectangle is { Width: > 0, Height: > 0 })
            {
                return element;
            }
        }
        return null;
    }

    private static FlaUI.Core.Definitions.ToggleState ToggleStateOf(AutomationElement element) =>
        element.Patterns.Toggle.TryGetPattern(out var toggle)
            ? toggle.ToggleState
            : throw new InvalidOperationException("the menu checkbox exposes no UIA Toggle pattern");

    /// <summary>The element itself and every ancestor report on-screen and
    /// enabled — a hidden row keeps a stale peer whose parent chain still
    /// reports the overlay's last state.</summary>
    private static bool IsVisibleInTree(AutomationElement element)
    {
        for (var node = (AutomationElement?)element; node != null; node = node.Parent)
        {
            if ((node.Properties.IsOffscreen.TryGetValue(out var offscreen) && offscreen)
                || (node.Properties.IsEnabled.TryGetValue(out var enabled) && !enabled))
            {
                return false;
            }
        }
        return true;
    }
}
