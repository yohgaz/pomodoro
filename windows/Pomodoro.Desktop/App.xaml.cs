using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Win32;
using Forms = System.Windows.Forms;
using Drawing = System.Drawing;

namespace Pomodoro.Desktop;

public partial class App : Application
{
    public static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pomodoro");
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    private Mutex? single;
    private EventWaitHandle? showSignal;
    private ServerClient server = null!;
    private MainWindow main = null!;
    private CaptureWindow? capture;
    private Forms.NotifyIcon tray = null!;
    private Forms.ToolStripMenuItem timerItem = null!, toggleItem = null!, startupItem = null!;
    private readonly CancellationTokenSource cts = new();
    private JsonElement? timer;
    private string? lastPhase;
    private bool hiddenTipShown;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        Directory.CreateDirectory(DataDir);

        // Une seule instance : un second lancement ramène simplement la fenêtre.
        single = new Mutex(true, "Pomodoro.Desktop.Instance", out bool first);
        showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, "Pomodoro.Desktop.Show");
        if (!first) { showSignal.Set(); Shutdown(); return; }
        new Thread(() => { while (showSignal.WaitOne()) Dispatcher.Invoke(() => main.ShowAndFocus()); }) { IsBackground = true }.Start();

        var url = Environment.GetEnvironmentVariable("POMODORO_URL") ?? "http://localhost:3210";
        server = new ServerClient(url);
        main = new MainWindow(server);
        main.HotkeyPressed += ShowCapture;
        new System.Windows.Interop.WindowInteropHelper(main).EnsureHandle();

        CreateTray();
        bool startInTray = e.Args.Contains("--tray");
        if (!startInTray) main.Show();
        _ = main.StartAsync();
        _ = server.ListenAsync("stream", OnStream, cts.Token);

        // Rafraîchit l'infobulle du minuteur chaque seconde.
        var tick = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        tick.Tick += (_, _) => UpdateTimerUi();
        tick.Start();
    }

    // ── Zone de notification ──
    private void CreateTray()
    {
        var iconStream = GetResourceStream(new Uri("pack://application:,,,/pomodoro.ico"))?.Stream;
        tray = new Forms.NotifyIcon
        {
            Icon = iconStream != null ? new Drawing.Icon(iconStream) : Drawing.SystemIcons.Application,
            Text = "Pomodoro",
            Visible = true
        };
        var menu = new Forms.ContextMenuStrip { Renderer = new DarkRenderer(), ShowImageMargin = false, Font = new Drawing.Font("Segoe UI", 10f) };
        menu.Items.Add("Ouvrir Pomodoro", null, (_, _) => main.ShowAndFocus());
        menu.Items.Add("Capture rapide\tCtrl+Alt+N", null, (_, _) => ShowCapture());
        menu.Items.Add("Mes tâches", null, (_, _) => { main.ShowAndFocus(); main.Go("/tasks"); });
        menu.Items.Add(new Forms.ToolStripSeparator());
        timerItem = new Forms.ToolStripMenuItem("🍅 Aucun minuteur") { Enabled = false };
        toggleItem = new Forms.ToolStripMenuItem("Pause / reprendre le minuteur", null, async (_, _) => await server.PostJsonAsync("/api/stream/action", new { op = "timer", cmd = "toggle" })) { Visible = false };
        menu.Items.Add(timerItem);
        menu.Items.Add(toggleItem);
        menu.Items.Add("Minuteur…", null, (_, _) => { main.ShowAndFocus(); main.Go("/stream/timer"); });
        menu.Items.Add(new Forms.ToolStripSeparator());
        startupItem = new Forms.ToolStripMenuItem("Lancer avec Windows", null, (_, _) => ToggleStartup()) { Checked = IsStartupEnabled() };
        menu.Items.Add(startupItem);
        menu.Items.Add("Quitter", null, (_, _) => Quit());
        tray.ContextMenuStrip = menu;
        tray.MouseClick += (_, e) => { if (e.Button == Forms.MouseButtons.Left) main.ShowAndFocus(); };
    }

    public void NotifyHidden()
    {
        if (hiddenTipShown) return;
        hiddenTipShown = true;
        tray.ShowBalloonTip(4000, "Pomodoro continue en arrière-plan", "Clic sur l’icône 🍅 pour rouvrir · Ctrl+Alt+N pour capturer une idée ou une tâche.", Forms.ToolTipIcon.None);
    }

    private void ShowCapture()
    {
        capture ??= new CaptureWindow(server);
        capture.Summon();
    }

    // ── Minuteur : infobulle + notification à chaque changement de phase ──
    private void OnStream(JsonElement snap)
    {
        Dispatcher.Invoke(() =>
        {
            timer = snap.TryGetProperty("timer", out var t) && t.ValueKind == JsonValueKind.Object ? t : null;
            string? phase = timer?.GetProperty("phase").GetString();
            if (lastPhase != null && phase != null && phase != lastPhase)
            {
                var label = timer!.Value.TryGetProperty("label", out var l) ? l.GetString() : "";
                var (title, body) = phase switch
                {
                    "break" => ("☕ Pause !", "Focus terminé — lève-toi, bois un verre d’eau."),
                    "work" => ("🍅 C’est reparti", "Nouveau cycle de focus."),
                    _ => ("🎉 Session terminée", "Bravo, tous les pomodoros sont bouclés !")
                };
                tray.ShowBalloonTip(5000, title, string.IsNullOrEmpty(label) ? body : $"{label} — {body}", Forms.ToolTipIcon.None);
            }
            lastPhase = phase;
            UpdateTimerUi();
        });
    }

    private void UpdateTimerUi()
    {
        if (tray == null) return;
        if (timer is not JsonElement t || t.GetProperty("phase").GetString() == "done")
        {
            tray.Text = "Pomodoro";
            timerItem.Text = "🍅 Aucun minuteur en cours";
            toggleItem.Visible = false;
            return;
        }
        bool paused = t.TryGetProperty("paused", out var p) && p.ValueKind == JsonValueKind.True;
        double ms = paused
            ? (t.TryGetProperty("remaining", out var r) && r.ValueKind == JsonValueKind.Number ? r.GetDouble() : 0)
            : Math.Max(0, t.GetProperty("endsAt").GetDouble() - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        var span = TimeSpan.FromMilliseconds(ms);
        var time = span.TotalHours >= 1 ? span.ToString(@"h\:mm\:ss") : span.ToString(@"m\:ss");
        var phase = t.GetProperty("phase").GetString() == "work" ? "Focus" : "Pause";
        var cycles = $"{t.GetProperty("completed").GetInt32()}/{t.GetProperty("goal").GetInt32()}";
        var text = $"🍅 {phase} {time}{(paused ? " (en pause)" : "")} · {cycles}";
        timerItem.Text = text;
        toggleItem.Visible = true;
        toggleItem.Text = paused ? "▶ Reprendre le minuteur" : "⏸ Mettre en pause";
        tray.Text = text.Length > 63 ? text[..63] : text;
    }

    // ── Lancement avec Windows (clé Run de l'utilisateur, démarre dans la zone de notification) ──
    private static bool IsStartupEnabled()
    {
        using var k = Registry.CurrentUser.OpenSubKey(RunKey);
        return k?.GetValue("Pomodoro") != null;
    }

    private void ToggleStartup()
    {
        using var k = Registry.CurrentUser.OpenSubKey(RunKey, true) ?? Registry.CurrentUser.CreateSubKey(RunKey);
        if (IsStartupEnabled()) k.DeleteValue("Pomodoro", false);
        else k.SetValue("Pomodoro", $"\"{Environment.ProcessPath}\" --tray");
        startupItem.Checked = IsStartupEnabled();
    }

    private void Quit()
    {
        cts.Cancel();
        tray.Visible = false;
        tray.Dispose();
        main.ReallyClose = true;
        main.Close();
        Shutdown();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (tray != null) tray.Visible = false;
        single?.Dispose();
        base.OnExit(e);
    }
}

// Menu de la zone de notification aux couleurs de Pomodoro.
internal sealed class DarkRenderer : Forms.ToolStripProfessionalRenderer
{
    private static readonly Drawing.Color Bg = Drawing.Color.FromArgb(20, 22, 31);
    private static readonly Drawing.Color Hover = Drawing.Color.FromArgb(39, 43, 59);
    public DarkRenderer() : base(new DarkColors()) { RoundedEdges = false; }
    protected override void OnRenderItemText(Forms.ToolStripItemTextRenderEventArgs e)
    {
        e.TextColor = e.Item.Enabled ? Drawing.Color.FromArgb(244, 242, 237) : Drawing.Color.FromArgb(232, 184, 77);
        base.OnRenderItemText(e);
    }
    protected override void OnRenderMenuItemBackground(Forms.ToolStripItemRenderEventArgs e)
    {
        using var b = new Drawing.SolidBrush(e.Item.Selected && e.Item.Enabled ? Hover : Bg);
        e.Graphics.FillRectangle(b, new Drawing.Rectangle(Drawing.Point.Empty, e.Item.Size));
    }
    private sealed class DarkColors : Forms.ProfessionalColorTable
    {
        public override Drawing.Color ToolStripDropDownBackground => Bg;
        public override Drawing.Color MenuBorder => Drawing.Color.FromArgb(50, 54, 70);
        public override Drawing.Color SeparatorDark => Drawing.Color.FromArgb(50, 54, 70);
        public override Drawing.Color SeparatorLight => Bg;
        public override Drawing.Color ImageMarginGradientBegin => Bg;
        public override Drawing.Color ImageMarginGradientMiddle => Bg;
        public override Drawing.Color ImageMarginGradientEnd => Bg;
        public override Drawing.Color CheckBackground => Drawing.Color.FromArgb(240, 101, 61);
        public override Drawing.Color CheckSelectedBackground => Drawing.Color.FromArgb(240, 101, 61);
    }
}
