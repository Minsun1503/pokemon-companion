using System;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Web.Script.Serialization;

// Owns two disposable workbooks. Commands only seed/reset or independently verify.
public static class CommonTaskExcelFixture {
    static object Get(object target, string name, params object[] args) { return target.GetType().InvokeMember(name, BindingFlags.GetProperty, null, target, args, CultureInfo.InvariantCulture); }
    static object Call(object target, string name, params object[] args) { return target.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, target, args, CultureInfo.InvariantCulture); }
    static void Put(object target, string name, object value) { target.GetType().InvokeMember(name, BindingFlags.SetProperty, null, target, new object[] { value }, CultureInfo.InvariantCulture); }
    static void Reply(object value) { Console.WriteLine(new JavaScriptSerializer().Serialize(value)); }
    [STAThread]
    public static void Main(string[] args) {
        object app = null, book = null, other = null;
        try {
            app = Activator.CreateInstance(Type.GetTypeFromProgID("Excel.Application", true));
            Put(app, "DisplayAlerts", false); Put(app, "EnableEvents", false); Put(app, "AutomationSecurity", 3);
            var books = Get(app, "Workbooks");
            book = Call(books, "Add");
            var sheet = Get(Get(book, "Worksheets"), "Item", 1); Put(sheet, "Name", "Data");
            for (int column = 1; column <= 10; column++) Put(Get(sheet, "Cells", 1, column), "Value2", column);
            string path = Path.Combine(args[0], "Common Tasks " + args[1] + ".xlsx");
            Call(book, "SaveAs", path, 51);
            other = Call(books, "Add");
            Call(other, "SaveAs", Path.Combine(args[0], "Untouched " + args[1] + ".xlsx"), 51);
            Put(app, "Visible", true);
            Call(Get(Get(other, "Windows"), "Item", 1), "Activate");
            Reply(new { kind = "ready", window_id = Convert.ToString(Get(Get(Get(book, "Windows"), "Item", 1), "Hwnd")), name = Get(book, "Name"), path = path });
            string command;
            while ((command = Console.ReadLine()) != null && command != "close") {
                string[] parts = command.Split(':'); int row = Int32.Parse(parts[1]);
                if (parts[0] == "persist") {
                    // Do not save here: this must verify the save performed through MCP.
                    Call(book, "Close", false); book = null;
                    book = Call(books, "Open", path); sheet = Get(Get(book, "Worksheets"), "Item", 1);
                }
                var values = new object[10];
                for (int column = 1; column <= 10; column++) values[column - 1] = Get(Get(sheet, "Cells", row, column), "Value2");
                object otherCell = Get(Get(Get(Get(other, "Worksheets"), "Item", 1), "Cells", 1, 1), "Value2");
                Reply(new { kind = "verified", values = values, formula = Get(Get(sheet, "Cells", row, 11), "Formula"), calculated = Get(Get(sheet, "Cells", row, 11), "Value2"),
                    other_untouched = otherCell == null, path = Get(book, "FullName"), window_id = Convert.ToString(Get(Get(Get(book, "Windows"), "Item", 1), "Hwnd")) });
            }
        } catch (Exception error) {
            while (error.InnerException != null) error = error.InnerException;
            Reply(new { kind = "error", error = error.Message });
        } finally {
            if (book != null) Call(book, "Close", false);
            if (other != null) Call(other, "Close", false);
            if (app != null && Convert.ToInt32(Get(Get(app, "Workbooks"), "Count")) == 0) Call(app, "Quit");
        }
    }
}
