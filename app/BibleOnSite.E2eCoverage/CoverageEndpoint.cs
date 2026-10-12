using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace AltCover.Recorder
{
	/// <summary>
	/// Loopback-only HTTP responder that exports the in-app coverage snapshot
	/// while the instrumented app is running (#1232). The E2E harness reaches
	/// it through `adb forward` on Android and directly on the iOS simulator
	/// host (simulator processes share the host's loopback) or desktop host.
	/// Listens only on 127.0.0.1, never on external interfaces.
	///
	/// Routes:
	///   GET  /coverage/health — liveness probe for harness readiness checks
	///   GET  /coverage        — current hit snapshot (altcover-visits/1 JSON)
	///   POST /coverage/reset  — clear hits so per-test dumps stay attributed
	/// </summary>
	internal static class CoverageEndpoint
	{
		internal const int DefaultPort = 4787;
		private const int MaxRequestBytes = 16 * 1024;
		private static readonly byte[] HealthBody = Encoding.UTF8.GetBytes("{\"ok\":true}");
		private static int _started;

		internal static int Port
		{
			get
			{
				var configured = Environment.GetEnvironmentVariable("BIBLE_E2E_COVERAGE_PORT");
				return int.TryParse(configured, out var port) && port is > 0 and < 65536
					? port
					: DefaultPort;
			}
		}

		internal static void Start()
		{
			if (Interlocked.Exchange(ref _started, 1) != 0)
			{
				return;
			}
			var thread = new Thread(Listen) { IsBackground = true, Name = "e2e-coverage-endpoint" };
			thread.Start();
		}

		private static void Listen()
		{
			TcpListener listener;
			try
			{
				listener = new TcpListener(IPAddress.Loopback, Port);
				listener.Start();
			}
			catch (Exception exception) when (exception is SocketException or IOException)
			{
				Console.Error.WriteLine(
					$"E2E coverage endpoint could not bind 127.0.0.1:{Port}: {exception.Message}");
				return;
			}
			Console.Error.WriteLine($"E2E coverage endpoint listening on 127.0.0.1:{Port}");
			try
			{
				while (true)
				{
					TcpClient client;
					try
					{
						client = listener.AcceptTcpClient();
					}
					catch (Exception exception) when (exception is SocketException
						or InvalidOperationException or ObjectDisposedException)
					{
						return;
					}
					ThreadPool.QueueUserWorkItem(_ => Serve(client));
				}
			}
			finally
			{
				listener.Stop();
			}
		}

		private static void Serve(TcpClient client)
		{
			using (client)
			{
				try
				{
					client.ReceiveTimeout = 5000;
					client.SendTimeout = 5000;
					var stream = client.GetStream();
					var request = ReadRequestLine(stream);
					if (request == null)
					{
						return;
					}
					var parts = request.Split(' ');
					if (parts.Length < 2)
					{
						WriteResponse(stream, 400, "text/plain", Encoding.UTF8.GetBytes("bad request"));
						return;
					}
					var method = parts[0];
					var path = parts[1].Split('?')[0];
					switch ((method, path))
					{
						case ("GET", "/coverage/health"):
							WriteResponse(stream, 200, "application/json", HealthBody);
							break;
						case ("GET", "/coverage"):
							WriteResponse(stream, 200, "application/json",
								Encoding.UTF8.GetBytes(Instance.SnapshotJson()));
							break;
						case ("POST", "/coverage/reset"):
						case ("GET", "/coverage/reset"):
							Instance.Reset();
							WriteResponse(stream, 200, "application/json", HealthBody);
							break;
						default:
							WriteResponse(stream, 404, "text/plain", Encoding.UTF8.GetBytes("not found"));
							break;
					}
				}
				catch (Exception exception) when (exception is IOException
					or SocketException or ObjectDisposedException)
				{
					// Client-side disconnects are routine; the listener keeps serving.
				}
			}
		}

		private static string? ReadRequestLine(NetworkStream stream)
		{
			var buffer = new byte[MaxRequestBytes];
			var total = 0;
			while (total < buffer.Length)
			{
				var read = stream.Read(buffer, total, buffer.Length - total);
				if (read <= 0)
				{
					return null;
				}
				total += read;
				var text = Encoding.ASCII.GetString(buffer, 0, total);
				var end = text.IndexOf("\r\n", StringComparison.Ordinal);
				if (end > 0)
				{
					return text.Substring(0, end);
				}
			}
			return null;
		}

		private static void WriteResponse(NetworkStream stream, int status, string contentType, byte[] body)
		{
			var reason = status switch
			{
				200 => "OK",
				400 => "Bad Request",
				404 => "Not Found",
				_ => "Error"
			};
			var head = Encoding.ASCII.GetBytes(
				$"HTTP/1.1 {status} {reason}\r\nContent-Type: {contentType}\r\n" +
				$"Content-Length: {body.Length}\r\nConnection: close\r\n\r\n");
			stream.Write(head, 0, head.Length);
			stream.Write(body, 0, body.Length);
		}
	}
}
