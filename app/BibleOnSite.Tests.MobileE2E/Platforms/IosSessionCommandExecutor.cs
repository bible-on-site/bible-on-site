using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.Service;
using System.Runtime.ExceptionServices;

namespace BibleOnSite.Tests.MobileE2E.Platforms;

// Only NewSession spends the preparation's remaining startup budget. Reusing
// that HttpClient for the session would also shorten every later command.
internal sealed class IosSessionCommandExecutor : ICommandExecutor
{
    internal static readonly TimeSpan CommandTimeout = TimeSpan.FromMinutes(5);
    private readonly ICommandExecutor _startup;
    private readonly ICommandExecutor _commands;
    private bool _startupFinished;

    internal IosSessionCommandExecutor(Uri server, TimeSpan startupBudget)
        : this(startupBudget, timeout => CreateExecutor(server, timeout)) { }

    internal IosSessionCommandExecutor(TimeSpan startupBudget, Func<TimeSpan, ICommandExecutor> create)
    {
        if (startupBudget <= TimeSpan.Zero || startupBudget > CommandTimeout)
        {
            throw new ArgumentOutOfRangeException(nameof(startupBudget));
        }
        _startup = create(startupBudget);
        try
        {
            _commands = create(CommandTimeout);
        }
        finally
        {
            if (_commands == null)
            {
                _startup.Dispose();
            }
        }
    }

    private static AppiumHttpCommandExecutor CreateExecutor(Uri server, TimeSpan timeout)
    {
        var executor = new AppiumHttpCommandExecutor(server, timeout, AppiumClientConfig.DefaultConfig());
        executor.SendingRemoteHttpRequest += (_, request) =>
            request.AddHeader("X-Idempotency-Key", Guid.NewGuid().ToString());
        return executor;
    }

    public bool TryAddCommand(string name, CommandInfo? info)
    {
        var added = _commands.TryAddCommand(name, info);
        if (!_startupFinished)
        {
            _startup.TryAddCommand(name, info);
        }
        return added;
    }

    public Response Execute(Command command) => ExecuteAsync(command).GetAwaiter().GetResult();

    public async Task<Response> ExecuteAsync(Command command)
    {
        if (command.Name != DriverCommand.NewSession)
        {
            return await _commands.ExecuteAsync(command).ConfigureAwait(false);
        }
        if (_startupFinished)
        {
            throw new InvalidOperationException("A startup executor cannot create a second session.");
        }
        Response? response = null;
        Exception? startupFailure = null;
        try
        {
            response = await _startup.ExecuteAsync(command).ConfigureAwait(false);
        }
        catch (Exception exception) //NOSONAR - Retain startup uncertainty if transport disposal also fails.
        {
            startupFailure = exception;
        }
        _startupFinished = true;
        try
        {
            _startup.Dispose();
        }
        catch (Exception disposalFailure) //NOSONAR - A transport disposal error cannot prove session death.
        {
            if (startupFailure != null)
            {
                throw new AggregateException("Session startup and its transport disposal both failed.", startupFailure, disposalFailure);
            }
            throw new InvalidOperationException("The iOS startup transport could not be released.", disposalFailure);
        }
        if (startupFailure != null)
        {
            ExceptionDispatchInfo.Capture(startupFailure).Throw();
        }
        return response!;
    }

    public void Dispose()
    {
        try
        {
            if (!_startupFinished)
            {
                _startupFinished = true;
                _startup.Dispose();
            }
        }
        finally
        {
            _commands.Dispose();
        }
    }
}
