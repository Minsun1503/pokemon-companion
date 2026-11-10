using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

internal static class PokemonStandaloneLauncher {
    [STAThread]
    private static void Main() {
        bool created;
        using (var singleInstance = new Mutex(true, @"Local\PokemonCompanionStandaloneTest", out created)) {
            if (!created) {
                MessageBox.Show("Pokémon Companion Test is already running. Click its Pokémon or its tray icon.", "Pokémon Companion Test");
                return;
            }
            try {
                string root = AppDomain.CurrentDomain.BaseDirectory;
                string profile = Environment.GetEnvironmentVariable("POKEMON_STANDALONE_USER_DATA_DIR");
                if (String.IsNullOrWhiteSpace(profile)) profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "pokemon-companion-test");
                profile = Path.GetFullPath(profile);
                Directory.CreateDirectory(profile);
                string settings = Path.Combine(profile, "setting.json");
                if (!File.Exists(settings)) File.Copy(Path.Combine(root, "frontend", "config", "setting.json"), settings);
                string node = Path.Combine(root, "runtime", "node.exe");
                string entry = Path.Combine(root, "backend", "dist", "standalone.js");
                if (!File.Exists(node) || !File.Exists(entry)) throw new IOException("The app files are missing. Extract the complete ZIP into a folder before opening the app.");
                string log = Path.Combine(profile, "app.log");
                var start = new ProcessStartInfo(node, "\"" + entry + "\"") {
                    WorkingDirectory = root,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                start.EnvironmentVariables["POKEMON_FRONTEND_DIR"] = Path.Combine(root, "frontend");
                start.EnvironmentVariables["POKEMON_USER_DATA_DIR"] = profile;
                start.EnvironmentVariables["POKEMON_WINDOW_TITLE"] = "Pokémon Companion Test";
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
                    if (process.ExitCode != 0) MessageBox.Show("The companion could not start. Details are saved in:\n" + log, "Pokémon Companion Test");
                }
            } catch (Exception error) {
                MessageBox.Show(error.Message, "Pokémon Companion Test", MessageBoxButtons.OK, MessageBoxIcon.Error);
            } finally {
                singleInstance.ReleaseMutex();
            }
        }
    }
}
