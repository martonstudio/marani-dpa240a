// DPA bridge: serves the app's static files on http://localhost:<port>/ and passes bytes between a
// WebSocket at /ws and the unit's serial port. One WebSocket client at a time; the serial port is open only
// while a client is connected, so other tools can use it otherwise.
// Safety: frames from the client are checked (forbidden commands, 0x17 at 0x2000+); if the client leaves
// after a connect (0x00) without a disconnect (0x0f), the bridge sends the disconnect itself.
// Build: csc /out:dpa_bridge.exe Bridge.cs     Run: dpa_bridge.exe <webroot> <port> <COMx> <baud>
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Ports;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

class Bridge
{
    static string Root, Com; static int Port, Baud;
    static int clients = 0;
    static string LogPath;
    static readonly object logLock = new object();

    static void Log(string s)
    {
        lock (logLock) { File.AppendAllText(LogPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff ") + s + "\r\n"); }
    }

    static int Main(string[] a)
    {
        Root = Path.GetFullPath(a.Length > 0 ? a[0] : "dist");
        Port = a.Length > 1 ? int.Parse(a[1]) : 8240;
        Com = a.Length > 2 ? a[2] : "COM5";
        Baud = a.Length > 3 ? int.Parse(a[3]) : 9600;
        LogPath = Path.Combine(Path.GetDirectoryName(Root), "bridge.log");
        var l = new HttpListener();
        l.Prefixes.Add("http://localhost:" + Port + "/");
        l.Prefixes.Add("http://127.0.0.1:" + Port + "/");
        l.Start();
        Log("listening on " + Port + " root " + Root + " serial " + Com + " " + Baud);
        while (true)
        {
            var ctx = l.GetContext();
            ThreadPool.QueueUserWorkItem(_ => { try { Handle(ctx); } catch (Exception e) { Log("handler error " + e.Message); try { ctx.Response.Abort(); } catch { } } });
        }
    }

    static void Handle(HttpListenerContext ctx)
    {
        var path = ctx.Request.Url.AbsolutePath;
        if (path == "/ws" && ctx.Request.IsWebSocketRequest) { Ws(ctx).Wait(); return; }
        if (path == "/api/status")
        {
            Send(ctx, 200, "application/json", Encoding.UTF8.GetBytes("{\"serial\":\"" + Com + "\",\"busy\":" + (clients > 0 ? "true" : "false") + "}"));
            return;
        }
        if (path == "/") path = "/index.html";
        var file = Path.GetFullPath(Path.Combine(Root, Uri.UnescapeDataString(path.TrimStart('/'))));
        if (!file.StartsWith(Root, StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) { Send(ctx, 404, "text/plain", Encoding.UTF8.GetBytes("not found")); return; }
        Send(ctx, 200, Mime(file), File.ReadAllBytes(file));
    }

    static string Mime(string f)
    {
        switch (Path.GetExtension(f).ToLowerInvariant())
        {
            case ".html": return "text/html; charset=utf-8";
            case ".js": return "text/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": case ".webmanifest": return "application/json";
            case ".svg": return "image/svg+xml";
            case ".png": return "image/png";
            case ".ico": return "image/x-icon";
            default: return "application/octet-stream";
        }
    }

    static void Send(HttpListenerContext ctx, int code, string type, byte[] body)
    {
        ctx.Response.StatusCode = code;
        ctx.Response.ContentType = type;
        ctx.Response.Headers["Cache-Control"] = "no-cache";
        ctx.Response.ContentLength64 = body.Length;
        ctx.Response.OutputStream.Write(body, 0, body.Length);
        ctx.Response.Close();
    }

    static readonly HashSet<int> Forbidden = new HashSet<int> { 0x28, 0x18, 0x10, 0x24 };
    static readonly HashSet<int> Allowed = new HashSet<int> { 0x00, 0x0f, 0x01, 0x02, 0x03, 0x04, 0x05, 0x07, 0x08, 0x09, 0x17 };

    static string Check(byte[] f)
    {
        if (f.Length != 13 || f[0] != 0xF0 || f[12] != 0xF7) return "not a 13-byte frame";
        if (f[1] != 0xC1 || f[2] != 0) return "model id / device byte refused";
        int c = f[3];
        if (Forbidden.Contains(c) || !Allowed.Contains(c)) return "command 0x" + c.ToString("x2") + " refused";
        if (c == 0x17 && ((f[4] << 8) | f[5]) >= 0x2000) return "read at 0x2000+ refused";
        if (c != 0x00 && c != 0x0f && c != 0x17 && f[4] > 5) return "channel byte refused";
        return null;
    }

    static string Hex(byte[] b, int n) { var sb = new StringBuilder(); for (int i = 0; i < n; i++) sb.Append(b[i].ToString("x2")).Append(i < n - 1 ? " " : ""); return sb.ToString(); }

    static async Task Ws(HttpListenerContext ctx)
    {
        if (Interlocked.Increment(ref clients) > 1)
        {
            Interlocked.Decrement(ref clients);
            var w0 = await ctx.AcceptWebSocketAsync(null);
            await Text(w0.WebSocket, "error: bridge busy (another client is connected)");
            await w0.WebSocket.CloseAsync(WebSocketCloseStatus.PolicyViolation, "busy", CancellationToken.None);
            return;
        }
        WebSocket ws = null; SerialPort sp = null; bool connected = false; byte id = 0xC1, dev = 0;
        var sendLock = new SemaphoreSlim(1, 1);
        try
        {
            ws = (await ctx.AcceptWebSocketAsync(null)).WebSocket;
            sp = new SerialPort(Com, Baud, Parity.None, 8, StopBits.One);
            sp.DtrEnable = false; sp.RtsEnable = false; sp.Handshake = Handshake.None;
            string openErr = null;
            try { sp.Open(); } catch { Thread.Sleep(1000); try { sp.Open(); } catch (Exception e) { openErr = e.Message; } }
            if (openErr != null) { Log("open failed " + openErr); await Text(ws, "error: cannot open " + Com + ": " + openErr); return; }
            Log("client connected, " + Com + " open");
            var port = sp; var sock = ws;
            // One reader thread: chunks reach the client in the order they left the unit. (DataReceived handlers run on
            // pool threads and can overlap, which can reorder chunks.)
            var reader = new Thread(() =>
            {
                var rb = new byte[1024];
                while (true)
                {
                    int n;
                    try { n = port.Read(rb, 0, rb.Length); } catch { break; } // port closed
                    if (n <= 0) continue;
                    try
                    {
                        sendLock.Wait();
                        try { sock.SendAsync(new ArraySegment<byte>(rb, 0, n), WebSocketMessageType.Binary, true, CancellationToken.None).Wait(); }
                        finally { sendLock.Release(); }
                    }
                    catch (Exception ex) { Log("serial->ws " + ex.Message); break; }
                }
            });
            reader.IsBackground = true;
            reader.Start();
            await sendLock.WaitAsync();
            try { await Text(ws, "ready"); } finally { sendLock.Release(); }
            var buf = new byte[4096]; var pending = new List<byte>();
            while (ws.State == WebSocketState.Open)
            {
                // clients send "ping" every 10 s; one silent for 30 s is gone: free the port (and disconnect below)
                var recv = ws.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None);
                if (await Task.WhenAny(recv, Task.Delay(30000)) != recv) { Log("client silent for 30 s: dropping it"); break; }
                var r = recv.Result;
                if (r.MessageType == WebSocketMessageType.Close) break;
                if (r.MessageType != WebSocketMessageType.Binary) continue;
                for (int i = 0; i < r.Count; i++) pending.Add(buf[i]);
                while (true)
                {
                    int s0 = pending.IndexOf(0xF0);
                    if (s0 < 0) { pending.Clear(); break; }
                    if (s0 > 0) pending.RemoveRange(0, s0);
                    if (pending.Count < 13) break;
                    var f = pending.GetRange(0, 13).ToArray(); pending.RemoveRange(0, 13);
                    var why = Check(f);
                    if (why != null) { Log("refused " + Hex(f, 13) + ": " + why); await sendLock.WaitAsync(); try { await Text(ws, "refused: " + why); } finally { sendLock.Release(); } continue; }
                    if (f[3] == 0x00) { connected = true; id = f[1]; dev = f[2]; } else if (f[3] == 0x0f) connected = false;
                    port.Write(f, 0, 13);
                }
            }
        }
        catch (Exception e) { Log("ws error " + e.Message); }
        finally
        {
            try
            {
                if (sp != null && sp.IsOpen && connected)
                {
                    var d = new byte[] { 0xF0, id, dev, 0x0F, 0, 0, 0, 0, 0, 0, 0, 0, 0xF7 };
                    sp.Write(d, 0, 13); Thread.Sleep(300);
                    Log("client left while connected: sent disconnect");
                }
            }
            catch (Exception e) { Log("exit disconnect failed " + e.Message); }
            try { if (sp != null) sp.Close(); } catch { }
            try { if (ws != null && ws.State == WebSocketState.Open) ws.Abort(); } catch { }
            Interlocked.Decrement(ref clients);
            Log("client gone, " + Com + " closed");
        }
    }

    static Task Text(WebSocket ws, string s)
    {
        var b = Encoding.UTF8.GetBytes(s);
        return ws.SendAsync(new ArraySegment<byte>(b), WebSocketMessageType.Text, true, CancellationToken.None);
    }
}
