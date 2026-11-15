using DeviceTestApp.Runner;
using Microsoft.Extensions.DependencyInjection;

namespace DeviceTestApp;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
        builder.UseMauiApp<Microsoft.Maui.Controls.Application>();
        builder.Services.AddSingleton(new TestOptions
        {
            Assemblies = { typeof(MauiProgram).Assembly },
        });
        builder.Services.AddSingleton(new HeadlessRunnerOptions());
        builder.Services.AddTransient<HeadlessTestRunner>();
        return builder.Build();
    }
}
