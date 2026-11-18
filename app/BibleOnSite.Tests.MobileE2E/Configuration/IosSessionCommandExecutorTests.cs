using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class IosSessionCommandExecutorTests
{
    [Fact]
    public void PreparationReducesOnlyNewSessionAndPreservesLaterCommandTransportDeadline()
    {
        var executors = new List<(TimeSpan Timeout, Executor Executor)>();
        using var commands = new IosSessionCommandExecutor(TimeSpan.FromSeconds(50), timeout =>
        {
            var executor = new Executor();
            executors.Add((timeout, executor));
            return executor;
        });
        Assert.True(commands.TryAddCommand("beforeStartup", new HttpCommandInfo("POST", "/session")));
        commands.Execute(Command(DriverCommand.NewSession));
        Assert.True(commands.TryAddCommand("afterStartup", new HttpCommandInfo("POST", "/session/{sessionId}/execute/sync")));
        commands.Execute(Command(DriverCommand.ExecuteScript));

        Assert.Equal(TimeSpan.FromSeconds(50), executors[0].Timeout);
        Assert.Equal(TimeSpan.FromMinutes(5), executors[1].Timeout);
        Assert.Equal([DriverCommand.NewSession], executors[0].Executor.Commands);
        Assert.Equal([DriverCommand.ExecuteScript], executors[1].Executor.Commands);
        Assert.Equal(["beforeStartup"], executors[0].Executor.Registrations);
        Assert.Equal(["beforeStartup", "afterStartup"], executors[1].Executor.Registrations);
        Assert.Equal(1, executors[0].Executor.Disposals);
        Assert.Equal(0, executors[1].Executor.Disposals);
    }

    [Fact]
    public void FailedStartupClosesItsTransportAndCannotCreateAnUntrackedSecondSession()
    {
        var executors = new List<Executor>();
        var failure = new WebDriverTimeoutException("startup budget exhausted");
        var commands = new IosSessionCommandExecutor(TimeSpan.FromSeconds(1), _ =>
        {
            var executor = new Executor { Failure = executors.Count == 0 ? failure : null };
            executors.Add(executor);
            return executor;
        });
        Assert.Same(failure, Assert.Throws<WebDriverTimeoutException>(() => commands.Execute(Command(DriverCommand.NewSession))));
        Assert.Throws<InvalidOperationException>(() => commands.Execute(Command(DriverCommand.NewSession)));
        Assert.Equal(1, executors[0].Disposals);
        commands.Dispose();
        Assert.Equal(1, executors[0].Disposals);
        Assert.Equal(1, executors[1].Disposals);
    }

    [Fact]
    public void DisposalBeforeStartupReleasesBothExecutors()
    {
        var executors = new List<Executor>();
        var commands = new IosSessionCommandExecutor(TimeSpan.FromSeconds(1), _ =>
        {
            var executor = new Executor();
            executors.Add(executor);
            return executor;
        });
        commands.Dispose();
        Assert.All(executors, executor => Assert.Equal(1, executor.Disposals));
    }

    [Fact]
    public void ADisposalErrorCannotReplaceAnUnconfirmedNewSessionFailure()
    {
        var startup = new WebDriverTimeoutException("new session did not answer");
        var disposal = new UnknownErrorException("invalid session id during transport disposal");
        var executors = new List<Executor>();
        using var commands = new IosSessionCommandExecutor(TimeSpan.FromSeconds(1), _ =>
        {
            var executor = executors.Count == 0
                ? new Executor { Failure = startup, DisposalFailure = disposal } : new Executor();
            executors.Add(executor);
            return executor;
        });
        var failure = Assert.Throws<AggregateException>(() => commands.Execute(Command(DriverCommand.NewSession)));
        Assert.Equal([startup, disposal], failure.InnerExceptions);
        Assert.Throws<InvalidOperationException>(() => commands.Execute(Command(DriverCommand.NewSession)));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(301)]
    public void RefusesMissingOrExpandedStartupBudget(int seconds) =>
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            new IosSessionCommandExecutor(TimeSpan.FromSeconds(seconds), _ => new Executor()));

    private static Command Command(string name) => new(new SessionId("unit-session"), name, []);

    private sealed class Executor : ICommandExecutor
    {
        public List<string> Commands { get; } = [];
        public List<string> Registrations { get; } = [];
        public int Disposals { get; private set; }
        public WebDriverException? Failure { get; init; }
        public Exception? DisposalFailure { get; init; }
        public bool TryAddCommand(string name, CommandInfo? info)
        {
            if (info == null)
            {
                return false;
            }
            Registrations.Add(name);
            return true;
        }
        public Response Execute(Command command) => ExecuteAsync(command).GetAwaiter().GetResult();
        public Task<Response> ExecuteAsync(Command command)
        {
            Commands.Add(command.Name);
            if (Failure != null)
            {
                throw Failure;
            }
            return Task.FromResult(new Response("unit-session", null, WebDriverResult.Success));
        }
        public void Dispose()
        {
            Disposals++;
            if (DisposalFailure != null)
            {
                throw DisposalFailure;
            }
        }
    }
}
