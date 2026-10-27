namespace BibleOnSite;

public partial class App : Application
{
    public App()
    {
        try
        {
            InitializeComponent();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: init failure is logged then rethrown
        catch (Exception ex) //NOSONAR — init failure is logged then rethrown.
        {
            #pragma warning restore S2221
            System.Diagnostics.Debug.WriteLine($"InitializeComponent failed: {ex}");
            Console.Error.WriteLine($"InitializeComponent failed: {ex}");
            throw;
        }
    }

    protected override Window CreateWindow(IActivationState? activationState)
    {
        try
        {
            var shell = new AppShell();
            var window = new Window(shell);
            window.Stopped += (_, _) => Services.RecitationService.Instance.RequestPlaybackStop();
#if WINDOWS
            // Window minimums + persisted bounds + shared keyboard/mouse
            // shortcuts are attached before the title bar so the window
            // opens at its desktop size (#2766).
            DesktopWindowChrome.Attach(window, shell);
            window.TitleBar = CreateTitleBar(window, shell);
#endif
            Services.SearchIndexService.WarmupForE2e();
            return window;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: window-creation failure is logged then rethrown
        catch (Exception ex) //NOSONAR — window-creation failure is logged then rethrown.
        {
            #pragma warning restore S2221
            System.Diagnostics.Debug.WriteLine($"CreateWindow failed: {ex}");
            Console.Error.WriteLine($"CreateWindow failed: {ex}");
            throw;
        }
    }

#if WINDOWS
    /// <summary>
    /// Windows Back lives in the title-bar chrome rather than the content
    /// toolbar (#2467). A LeadingContent view handles its own input, so the
    /// button is clickable without disturbing the drag region or the window
    /// system controls. The press rides the same IWindow.BackButtonClicked
    /// route as every other Back input (fullscreen dismissal → page
    /// navigation → exit confirmation), and the button is disabled at a root
    /// destination — it never acts as an app-exit control.
    /// </summary>
    private static TitleBar CreateTitleBar(Window window, AppShell shell)
    {
        var back = new Button
        {
            Text = Fonts.FluentUI.arrow_right_16_regular,
            FontFamily = "FluentIcons",
            FontSize = 14,
            WidthRequest = 46,
            HeightRequest = 32,
            Padding = 0,
            BackgroundColor = Colors.Transparent,
            AutomationId = "TitleBarBackButton",
            IsEnabled = false,
        };
        // SemanticProperties.Description and ToolTipProperties.Text are
        // attached properties; they cannot be assigned inside an object
        // initializer. The tooltip advertises the keyboard equivalent that
        // DesktopWindowChrome wires on the window (#2766).
        SemanticProperties.SetDescription(back, "חזור");
        ToolTipProperties.SetText(back, "חזור (Alt+Left)");
        shell.Navigated += (_, _) =>
            back.IsEnabled = shell.Navigation.NavigationStack.Count > 1;
        back.Clicked += (_, _) => _ = ((Microsoft.Maui.IWindow)window).BackButtonClicked();
        return new TitleBar { Title = "תנ\"ך על הפרק", LeadingContent = back };
    }
#endif
}
