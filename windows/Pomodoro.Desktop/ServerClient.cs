using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Pomodoro.Desktop;

// Dialogue avec le serveur local Pomodoro (http://localhost:3210) :
// vérifie qu'il tourne (et le démarre sinon), écoute les évènements temps
// réel, envoie notes et tâches.
public sealed class ServerClient
{
    public string BaseUrl { get; }
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(8) };

    public ServerClient(string baseUrl) { BaseUrl = baseUrl.TrimEnd('/'); }

    public async Task<bool> IsUpAsync()
    {
        try
        {
            using var r = await http.GetAsync(BaseUrl + "/api/state");
            return r.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    // Dossier du projet : on remonte depuis l'exécutable jusqu'à server.js,
    // sinon Documents\Pomodoro.
    public static string? FindProjectRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (int i = 0; i < 6 && dir != null; i++, dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "server.js"))) return dir.FullName;
        var docs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Pomodoro");
        return File.Exists(Path.Combine(docs, "server.js")) ? docs : null;
    }

    // Démarre le serveur via le lanceur silencieux s'il ne répond pas.
    public async Task<bool> EnsureRunningAsync()
    {
        if (await IsUpAsync()) return true;
        var root = FindProjectRoot();
        if (root == null) return false;
        var vbs = Path.Combine(root, "scripts", "windows", "pomodoro-silencieux.vbs");
        if (!File.Exists(vbs)) return false;
        Process.Start(new ProcessStartInfo("wscript.exe", $"\"{vbs}\"") { UseShellExecute = false, CreateNoWindow = true });
        for (int i = 0; i < 40; i++)
        {
            await Task.Delay(500);
            if (await IsUpAsync()) return true;
        }
        return false;
    }

    public async Task<JsonDocument?> GetJsonAsync(string path)
    {
        try
        {
            var s = await http.GetStringAsync(BaseUrl + path);
            return JsonDocument.Parse(s);
        }
        catch { return null; }
    }

    public async Task<bool> PostJsonAsync(string path, object body)
    {
        try
        {
            var json = JsonSerializer.Serialize(body);
            using var r = await http.PostAsync(BaseUrl + path, new StringContent(json, Encoding.UTF8, "application/json"));
            return r.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    // POST qui renvoie un objet JSON (ex. { id } de la liste de courses).
    public async Task<JsonDocument?> PostForJsonAsync(string path, object body)
    {
        try
        {
            using var r = await http.PostAsync(BaseUrl + path, new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"));
            if (!r.IsSuccessStatusCode) return null;
            return JsonDocument.Parse(await r.Content.ReadAsStringAsync());
        }
        catch { return null; }
    }

    // Flux d'évènements (Server-Sent Events), reconnexion automatique.
    public async Task ListenAsync(string eventName, Action<JsonElement> onEvent, CancellationToken ct)
    {
        using var sse = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var stream = await sse.GetStreamAsync(BaseUrl + "/api/events?overlay=1", ct);
                using var reader = new StreamReader(stream, Encoding.UTF8);
                string? ev = null;
                var data = new StringBuilder();
                while (!ct.IsCancellationRequested)
                {
                    var line = await reader.ReadLineAsync(ct);
                    if (line == null) break;
                    if (line.StartsWith("event:")) ev = line[6..].Trim();
                    else if (line.StartsWith("data:")) data.Append(line[5..].Trim());
                    else if (line.Length == 0)
                    {
                        if (ev == eventName && data.Length > 0)
                        {
                            try { using var doc = JsonDocument.Parse(data.ToString()); onEvent(doc.RootElement.Clone()); } catch { }
                        }
                        ev = null; data.Clear();
                    }
                }
            }
            catch (OperationCanceledException) { return; }
            catch { }
            try { await Task.Delay(3000, ct); } catch { return; }
        }
    }
}
