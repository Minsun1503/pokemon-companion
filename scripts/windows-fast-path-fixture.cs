using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

static class FastPathFixture {
    [STAThread]
    static void Main(string[] args) {
        string executable = Assembly.GetExecutingAssembly().Location;
        File.WriteAllText(Path.ChangeExtension(executable, ".pid"), Process.GetCurrentProcess().Id.ToString());
        File.WriteAllText(Path.ChangeExtension(executable, ".args"), args.Length.ToString());
        Application.EnableVisualStyles();
        var form = new Form { Text = Path.GetFileNameWithoutExtension(executable), Width = 420, Height = 240 };
        var value = new TextBox { Name = "Wait value", Text = "old", Location = new Point(20, 20), Width = 220 };
        var reveal = new Button { Text = "Reveal control", Location = new Point(20, 60), Width = 150 };
        var timer = new Timer { Interval = 350 };
        timer.Tick += delegate {
            timer.Stop();
            value.Text = "ready";
            form.Controls.Add(new Button { Text = "Delayed control", Location = new Point(20, 100), Width = 150 });
        };
        reveal.Click += delegate { timer.Start(); };
        form.Controls.Add(value);
        form.Controls.Add(reveal);
        form.FormClosed += delegate { timer.Dispose(); };
        Application.Run(form);
    }
}
