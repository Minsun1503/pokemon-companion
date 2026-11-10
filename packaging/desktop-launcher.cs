using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class PokemonDesktopLauncher {
    [STAThread]
    private static int Main(string[] args) {
        bool created;
        using (var singleInstance = new Mutex(true, @"Local\PokemonCompanionDesktop", out created)) {
            if (!created) {
                MessageBox.Show("Pokémon Companion is already running. Click its Pokémon or its tray icon.", "Pokémon Companion");
                return 0;
            }
            try {
                bool smoke = args.Length == 1 && args[0] == "--smoke-test";
                string root = AppDomain.CurrentDomain.BaseDirectory;
                string profile = Environment.GetEnvironmentVariable("POKEMON_STANDALONE_USER_DATA_DIR");
                if (String.IsNullOrWhiteSpace(profile)) profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "pokemon-companion");
                profile = Path.GetFullPath(profile);
                Directory.CreateDirectory(profile);
                string settings = Path.Combine(profile, "setting.json");
                if (!File.Exists(settings)) File.Copy(Path.Combine(root, "frontend", "config", "setting.json"), settings);
                string node = Path.Combine(root, "runtime", "node.exe");
                string entry = Path.Combine(root, "backend", "dist", "standalone.js");
                if (!File.Exists(node) || !File.Exists(entry)) throw new IOException("The app files are missing. Extract the complete ZIP into a folder before opening the app.");
                string log = Path.Combine(profile, "app.log");
                var start = new ProcessStartInfo(node, "\"" + entry + "\"" + (smoke ? " --smoke-test" : "")) {
                    WorkingDirectory = root,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                start.StandardOutputEncoding = Encoding.UTF8;
                start.StandardErrorEncoding = Encoding.UTF8;
                start.EnvironmentVariables["POKEMON_FRONTEND_DIR"] = Path.Combine(root, "frontend");
                start.EnvironmentVariables["POKEMON_USER_DATA_DIR"] = profile;
                start.EnvironmentVariables["POKEMON_WINDOW_TITLE"] = "Pokémon Companion";
                start.EnvironmentVariables.Remove("POKEMON_UI");
                start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
                start.EnvironmentVariables.Remove("POKEMON_AGENT_AUDIT");
                object logLock = new object();
                using (var process = new Process()) {
                    process.StartInfo = start;
                    DataReceivedEventHandler writeLog = delegate(object sender, DataReceivedEventArgs data) {
                        if (data.Data == null) return;
                        lock (logLock) { File.AppendAllText(log, DateTime.Now.ToString("s") + " " + data.Data + Environment.NewLine); }
                    };
                    process.OutputDataReceived += writeLog;
                    process.ErrorDataReceived += writeLog;
                    process.Start();
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    process.WaitForExit();
                    if (process.ExitCode != 0 && !smoke) MessageBox.Show("The companion could not start. Details are saved in:\n" + log, "Pokémon Companion");
                    return process.ExitCode;
                }
            } catch (Exception error) {
                MessageBox.Show(error.Message, "Pokémon Companion", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            } finally {
                singleInstance.ReleaseMutex();
            }
        }
    }
}
