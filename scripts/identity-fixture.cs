using System;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class IdentityForm : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    public void ReplaceHandle() { RecreateHandle(); }
}
class IdentityFixture {
    [STAThread] static void Main(string[] args) {
        string folder = args[0];
        var form = new IdentityForm { Text = args[1], Width = 620, Height = 520, ShowInTaskbar = false };
        var field = new TextBox { Name = "editor", AccessibleName = "Editable field", Text = "initial", Location = new Point(20, 20), Width = 240 };
        var button = new Button { Name = "action", AccessibleName = "Original item", AccessibleDescription = "Original description", Text = "Item", Location = new Point(20, 60), Width = 160 };
        CheckBox replacementRole = null;
        Button twin = null;
        var region = new Panel { AccessibleName = "Nested region", Location = new Point(20, 110), Width = 280, Height = 50 };
        var nested = new TextBox { AccessibleName = "Nested field", Text = "nested", Width = 200 };
        region.Controls.Add(nested);
        int clicks = 0, sequence = 0;
        button.Click += delegate { clicks++; };
        form.Controls.Add(field);
        form.Controls.Add(button);
        form.Controls.Add(region);
        var other = new Panel { AccessibleName = "Other region", Location = new Point(20, 180), Width = 550, Height = 240 };
        for (int i = 0; i < 30; i++) other.Controls.Add(new TextBox { Name = "other" + i, AccessibleName = "Other field " + i,
            Text = "unrelated value " + i, Location = new Point((i % 5) * 105, (i / 5) * 35), Width = 95 });
        form.Controls.Add(other);
        var timer = new Timer { Interval = 30 };
        timer.Tick += delegate {
            string pending = Path.Combine(folder, "command");
            if (File.Exists(pending)) {
                string command = File.ReadAllText(pending);
                File.Delete(pending);
                if (command == "rename") button.AccessibleName = "Replacement item";
                if (command == "value") field.Text = "changed outside automation";
                if (command == "title") form.Text += " changed";
                if (command == "hide") button.Visible = false;
                if (command == "show") button.Visible = true;
                if (command == "disable") button.Enabled = false;
                if (command == "enable") button.Enabled = true;
                if (command == "move") button.Location = new Point(210, 60);
                if (command == "recreate-window") form.ReplaceHandle();
                if (command == "twin") {
                    twin = new Button { Name = button.Name, AccessibleName = button.AccessibleName,
                        AccessibleDescription = button.AccessibleDescription, Text = "Twin", Location = new Point(390, 60), Width = 160 };
                    twin.Click += delegate { clicks += 100; };
                    form.Controls.Add(twin);
                }
                if (command == "reset-benchmark") {
                    button.AccessibleName = "Original item"; button.Enabled = true; button.Visible = true; button.Location = new Point(20, 60);
                    if (twin != null) { form.Controls.Remove(twin); twin.Dispose(); twin = null; }
                }
                if (command == "delayed-rename") {
                    var delayed = new Timer { Interval = 200 };
                    delayed.Tick += delegate { button.AccessibleName = "Replacement item"; delayed.Stop(); delayed.Dispose(); sequence++; };
                    delayed.Start();
                }
                if (command == "automation-id") button.Name = "replacement-action";
                if (command == "description") button.AccessibleDescription = "Replacement description";
                if (command == "role") {
                    form.Controls.Remove(button);
                    replacementRole = new CheckBox { Name = button.Name, AccessibleName = button.AccessibleName,
                        AccessibleDescription = button.AccessibleDescription, Text = button.Text, Location = button.Location, Width = button.Width };
                    form.Controls.Add(replacementRole);
                }
                if (command == "identity-reset") {
                    if (replacementRole != null) { form.Controls.Remove(replacementRole); replacementRole.Dispose(); replacementRole = null; form.Controls.Add(button); }
                    button.Name = "action";
                    button.AccessibleDescription = "Original description";
                }
                if (command == "quit") { timer.Stop(); Application.Exit(); return; }
                sequence++;
            }
            var state = new { clicks = clicks, text = field.Text, nested = nested.Text, name = button.AccessibleName, sequence = sequence,
                window_id = form.Handle.ToInt64().ToString() };
            string path = Path.Combine(folder, "state.json");
            File.WriteAllText(path, new JavaScriptSerializer().Serialize(state));
        };
        form.Shown += delegate { timer.Start(); };
        Application.Run(form);
        timer.Dispose();
    }
}
