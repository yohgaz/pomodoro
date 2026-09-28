using System;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;

namespace Pomodoro.Desktop;

// Petite fenêtre de capture (Ctrl+Alt+N) : une idée part dans l'Inbox, une
// tâche dans la liste perso ou la liste de stream — sans quitter ce qu'on fait.
public partial class CaptureWindow : Window
{
    private readonly ServerClient server;
    private bool busy;

    public CaptureWindow(ServerClient server)
    {
        this.server = server;
        InitializeComponent();
        Deactivated += (_, _) => { if (!busy) Hide(); };
        PreviewKeyDown += OnKey;
    }

    public void Summon()
    {
        var area = SystemParameters.WorkArea;
        Left = area.Left + (area.Width - Width) / 2;
        Top = area.Top + area.Height * 0.22;
        Status.Text = "";
        Input.Text = "";
        Show();
        Activate();
        Native.SetForegroundWindow(new WindowInteropHelper(this).Handle);
        Input.Focus();
        Keyboard.Focus(Input);
    }

    private async void OnKey(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape) { e.Handled = true; Hide(); return; }
        if (e.Key == Key.Tab)
        {
            e.Handled = true;
            if (ModeNote.IsChecked == true) ModePerso.IsChecked = true;
            else if (ModePerso.IsChecked == true) ModeStream.IsChecked = true;
            else ModeNote.IsChecked = true;
            return;
        }
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            await SaveAsync();
        }
    }

    private async Task SaveAsync()
    {
        var text = Input.Text.Trim();
        if (text.Length == 0 || busy) return;
        busy = true;
        Status.Foreground = (System.Windows.Media.Brush)FindResource("Mu");
        Status.Text = "Enregistrement…";
        bool ok;
        string done;
        if (ModeNote.IsChecked == true)
        {
            ok = await server.PostJsonAsync("/api/notes", new { body = $"# {text}\n\n", container = (string?)null });
            done = "Note ajoutée à l’Inbox ✓";
        }
        else
        {
            var login = "_perso";
            if (ModeStream.IsChecked == true)
            {
                using var s = await server.GetJsonAsync("/api/stream");
                login = s != null && s.RootElement.TryGetProperty("streamer", out var st) && st.GetString() is string v && v.Length > 0 ? v : "moi";
            }
            ok = await server.PostJsonAsync("/api/stream/action", new { op = "add", login, text, where = "backlog" });
            done = ModeStream.IsChecked == true ? "Ajoutée à ta liste de stream ✓" : "Ajoutée à tes tâches perso ✓";
        }
        busy = false;
        if (!ok)
        {
            Status.Foreground = System.Windows.Media.Brushes.IndianRed;
            Status.Text = "Serveur injoignable";
            return;
        }
        Status.Foreground = (System.Windows.Media.Brush)FindResource("Mint");
        Status.Text = done;
        Input.Text = "";
        await Task.Delay(700);
        Hide();
    }
}
