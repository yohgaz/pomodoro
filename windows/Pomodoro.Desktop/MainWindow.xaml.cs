using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;

namespace Pomodoro.Desktop;

public partial class MainWindow : Window
{
    private readonly ServerClient server;
    public bool ReallyClose { get; set; }
    public event Action? HotkeyPressed;
    private const int HotkeyId = 0x504F;
    private static readonly string StateFile = Path.Combine(App.DataDir, "fenetre.json");

    public MainWindow(ServerClient server)
    {
        this.server = server;
        InitializeComponent();
        LoadBounds();
        SourceInitialized += (_, _) =>
        {
            var hwnd = new WindowInteropHelper(this).Handle;
            Native.DarkTitleBar(hwnd);
            HwndSource.FromHwnd(hwnd)?.AddHook(WndProc);
            // Ctrl+Alt+N : capture rapide, depuis n'importe quelle application.
            Native.RegisterHotKey(hwnd, HotkeyId, Native.MOD_CONTROL | Native.MOD_ALT | Native.MOD_NOREPEAT, 0x4E);
        };
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == Native.WM_HOTKEY && wParam.ToInt32() == HotkeyId) { HotkeyPressed?.Invoke(); handled = true; }
        return IntPtr.Zero;
    }

    public async Task StartAsync()
    {
        SplashText.Text = "Démarrage de Pomodoro…";
        SplashHint.Text = "";
        RetryBtn.Visibility = Visibility.Collapsed;
        Splash.Visibility = Visibility.Visible;
        if (!await server.EnsureRunningAsync())
        {
            SplashText.Text = "Le serveur Pomodoro ne répond pas";
            SplashHint.Text = "Vérifie qu’il est bien installé dans Documents\\Pomodoro (journal : logs\\server.log), puis réessaie.";
            RetryBtn.Visibility = Visibility.Visible;
            return;
        }
        if (Web.CoreWebView2 == null)
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(App.DataDir, "WebView2"));
            await Web.EnsureCoreWebView2Async(env);
            var core = Web.CoreWebView2!;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            // Liens externes : dans le navigateur par défaut, pas dans l'app.
            core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
            core.NavigationStarting += (_, e) =>
            {
                if (!e.Uri.StartsWith(server.BaseUrl, StringComparison.OrdinalIgnoreCase) && !e.Uri.StartsWith("about:")) { e.Cancel = true; OpenExternal(e.Uri); }
            };
            core.NavigationCompleted += (_, _) => Splash.Visibility = Visibility.Collapsed;
            core.DocumentTitleChanged += (_, _) => Title = string.IsNullOrWhiteSpace(core.DocumentTitle) ? "Pomodoro" : core.DocumentTitle;
        }
        Web.CoreWebView2!.Navigate(server.BaseUrl + "/");
    }

    public void Go(string path)
    {
        if (Web.CoreWebView2 != null) Web.CoreWebView2.Navigate(server.BaseUrl + path);
    }

    private static void OpenExternal(string uri)
    {
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch { }
    }

    private async void Retry_Click(object sender, RoutedEventArgs e) => await StartAsync();

    public void ShowAndFocus()
    {
        if (!IsVisible) Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        Native.SetForegroundWindow(new WindowInteropHelper(this).Handle);
    }

    // Fermer la fenêtre = la ranger dans la zone de notification.
    protected override void OnClosing(CancelEventArgs e)
    {
        SaveBounds();
        if (!ReallyClose) { e.Cancel = true; Hide(); ((App)Application.Current).NotifyHidden(); }
        base.OnClosing(e);
    }

    private record Bounds(double Left, double Top, double Width, double Height, bool Maximized);

    private void LoadBounds()
    {
        try
        {
            var b = JsonSerializer.Deserialize<Bounds>(File.ReadAllText(StateFile));
            if (b == null || b.Width < 400) return;
            // Toujours visible sur l'un des écrans actuels
            if (b.Left < SystemParameters.VirtualScreenLeft - 50 || b.Top < SystemParameters.VirtualScreenTop - 50 ||
                b.Left > SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - 100 ||
                b.Top > SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - 100) return;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = b.Left; Top = b.Top; Width = b.Width; Height = b.Height;
            if (b.Maximized) WindowState = WindowState.Maximized;
        }
        catch { }
    }

    private void SaveBounds()
    {
        try
        {
            var r = WindowState == WindowState.Normal ? new Rect(Left, Top, Width, Height) : RestoreBounds;
            File.WriteAllText(StateFile, JsonSerializer.Serialize(new Bounds(r.Left, r.Top, r.Width, r.Height, WindowState == WindowState.Maximized)));
        }
        catch { }
    }
}
