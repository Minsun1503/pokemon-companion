using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class SelectionForm : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
}
class SelectionFixture {
    [STAThread] static void Main(string[] args) {
        try { Run(args); }
        catch (Exception error) { File.WriteAllText(Path.Combine(args[0], "failure.txt"), error.ToString()); }
    }
    static void Run(string[] args) {
        string folder = args[0];
        var json = new JavaScriptSerializer();
        var config = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(folder, "fixture.json")));
        var stages = (System.Collections.ArrayList)config["stages"];
        var form = new SelectionForm { Text = args[1], Width = 650, Height = 470, ShowInTaskbar = false };
        var instruction = new Label { AccessibleName = "Instruction", Location = new Point(20, 20), Width = 580, Height = 50 };
        form.Controls.Add(instruction);
        int stage = 0, correct = 0, wrong = 0;
        var controls = new List<Control>();
        Action render = delegate {
            instruction.Text = stage == stages.Count ? "Task workflow complete" : (string)((Dictionary<string, object>)stages[stage])["instruction"];
            instruction.AccessibleName = instruction.Text;
            for (int i = 0; i < controls.Count; i++) controls[i].Enabled = i == stage;
        };
        Action<int, string> applied = delegate(int index, string value) {
            var item = (Dictionary<string, object>)stages[index];
            if (index == stage && value == (string)item["value"]) { correct++; stage++; render(); }
            else wrong++;
        };
        for (int i = 0; i < stages.Count; i++) {
            int index = i;
            var item = (Dictionary<string, object>)stages[i];
            string kind = (string)item["kind"], name = (string)item["name"];
            Control control;
            if (kind == "edit") {
                var field = new TextBox { Width = 260 };
                field.TextChanged += delegate { if (field.Text.Length > 0) applied(index, field.Text); };
                control = field;
            } else if (kind == "toggle") {
                var check = new CheckBox { Width = 260, Text = name };
                check.CheckedChanged += delegate { if (check.Checked) applied(index, "on"); };
                control = check;
            } else {
                var button = new Button { Width = 260, Text = name };
                button.Click += delegate { applied(index, "pressed"); };
                control = button;
            }
            control.Name = "target" + index;
            control.AccessibleName = name;
            control.Location = new Point(20, 80 + i * 45);
            controls.Add(control); form.Controls.Add(control);
        }
        var timer = new Timer { Interval = 20 };
        timer.Tick += delegate {
            var state = new { stage = stage, correct = correct, wrong = wrong, complete = stage == stages.Count, window_id = form.Handle.ToInt64().ToString() };
            File.WriteAllText(Path.Combine(folder, "state.json"), json.Serialize(state));
            if (File.Exists(Path.Combine(folder, "quit"))) { timer.Stop(); Application.Exit(); }
        };
        form.Shown += delegate { render(); timer.Start(); };
        Application.Run(form); timer.Dispose();
    }
}
