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
	///
	/// Reset is authenticated: any loopback process could otherwise erase hits
	/// mid-scenario and corrupt the merged report. The harness generates a
	/// per-run token and delivers it as BIBLE_E2E_COVERAGE_TOKEN (iOS launch
	/// environment; Android intent extra persisted to <Personal>/e2e-coverage-token
	/// for the relaunches that drop extras). Requests must echo it in the
	/// X-Bible-Coverage-Token header. When no token reaches the app, reset is
	/// refused rather than left open.
	/// </summary>
	internal static class CoverageEndpoint
	{
		internal const int DefaultPort = 4787;
		private const int MaxRequestBytes = 16 * 1024;
		private const string TokenVariable = "BIBLE_E2E_COVERAGE_TOKEN";
		private const string TokenHeader = "x-bible-coverage-token";
		private const string TokenFileName = "e2e-coverage-token";
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
			TcpListener? listener = null;
			try
			{
				listener = new TcpListener(IPAddress.Loopback, Port);
				listener.Start();
				Console.Error.WriteLine($"E2E coverage endpoint listening on 127.0.0.1:{Port}");
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
			catch (Exception exception) when (exception is SocketException or IOException)
			{
				Console.Error.WriteLine(
					$"E2E coverage endpoint could not bind 127.0.0.1:{Port}: {exception.Message}");
			}
			finally
			{
				// Modern runtimes implement IDisposable, but the recorder's
				// netstandard2.0 reference contract does not expose it.
				if (listener is IDisposable disposable)
				{
					disposable.Dispose();
				}
				else if (listener != null)
				{
					listener.Stop();
					// Stop creates a replacement socket even when the bind failed.
					listener.Server.Dispose();
				}
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
					var head = ReadRequestHead(stream);
					var authorized = IsAuthorized(head);
					if (head == null)
					{
						return;
					}
					var requestLine = head.Split(new[] { "\r\n" }, StringSplitOptions.None)[0];
					var parts = requestLine.Split(' ');
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
							if (!authorized)
							{
								WriteResponse(stream, 403, "text/plain",
									Encoding.UTF8.GetBytes("forbidden"));
								break;
							}
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

		/// <summary>
		/// The request's first header line plus headers, i.e. everything through
		/// the blank line. Bodies are never read — the routes need no payload.
		/// </summary>
		private static string? ReadRequestHead(NetworkStream stream)
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
				if (text.Contains("\r\n\r\n"))
				{
					return text;
				}
			}
			return null;
		}

		private static bool IsAuthorized(string? requestHead)
		{
			var required = RequiredToken();
			if (requestHead == null || required == null)
			{
				return false;
			}
			foreach (var line in requestHead.Split(new[] { "\r\n" }, StringSplitOptions.None))
			{
				var colon = line.IndexOf(':');
				if (colon > 0 &&
					string.Equals(line.Substring(0, colon).Trim(), TokenHeader, StringComparison.OrdinalIgnoreCase) &&
					line.Substring(colon + 1).Trim() == required)
				{
					return true;
				}
			}
			return false;
		}

		/// <summary>
		/// The token a reset must echo: the launch environment when the platform
		/// supplies one (iOS, Windows), else the file the app's intent-extra
		/// handler persisted (Android relaunches drop extras).
		/// </summary>
		private static string? RequiredToken()
		{
			var configured = Environment.GetEnvironmentVariable(TokenVariable);
			if (!string.IsNullOrEmpty(configured))
			{
				return configured;
			}
			try
			{
				var path = Path.Combine(
					Environment.GetFolderPath(Environment.SpecialFolder.Personal), TokenFileName);
				if (File.Exists(path))
				{
					var persisted = File.ReadAllText(path).Trim();
					return string.IsNullOrEmpty(persisted) ? null : persisted;
				}
			}
			catch (Exception exception) when (exception is IOException
				or UnauthorizedAccessException or NotSupportedException)
			{
				Console.Error.WriteLine($"E2E coverage token file unreadable: {exception.Message}");
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
