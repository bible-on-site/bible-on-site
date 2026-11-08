using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using AltCover.Recorder;

// Standalone disposable process: starvation cannot affect the unit runner.
internal static class Program
{
    private static void Main()
    {
        using var released = new ManualResetEventSlim();
        using var blocked = new ManualResetEventSlim();
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var server = new Thread(() => CoverageEndpoint.ServeConnections(listener)) { IsBackground = true };
        try
        {
            if (!ThreadPool.SetMinThreads(1, 1) || !ThreadPool.SetMaxThreads(1, 1))
            {
                throw new InvalidOperationException("Could not isolate the worker pool");
            }
            ThreadPool.QueueUserWorkItem(_ => { blocked.Set(); released.Wait(); });
            if (!blocked.Wait(1000))
            {
                throw new InvalidOperationException("Worker was not blocked");
            }
            server.Start();
            using var client = new TcpClient { ReceiveTimeout = 1000, SendTimeout = 1000 };
            client.Connect((IPEndPoint)listener.LocalEndpoint);
            using var stream = client.GetStream();
            var request = Encoding.ASCII.GetBytes("GET /coverage/health HTTP/1.1\r\nHost: localhost\r\n\r\n");
            stream.Write(request);
            using var reader = new StreamReader(stream);
            var timer = Stopwatch.StartNew();
            var status = reader.ReadLine();
            if (status != "HTTP/1.1 200 OK")
            {
                throw new InvalidOperationException("Coverage endpoint did not respond");
            }
            Console.WriteLine($"{status}; blocked-worker response: {timer.ElapsedMilliseconds}ms");
        }
        finally
        {
            released.Set();
            listener.Stop();
        }
        if (server.IsAlive && !server.Join(1000))
        {
            throw new InvalidOperationException("Coverage listener did not stop");
        }
    }
}
