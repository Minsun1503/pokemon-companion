using System;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Web.Script.Serialization;

// Owns a new Excel application and two disposable local workbooks.
// Production operations must attach to these windows, never to an active workbook.
public static class ExcelSmokeFixture {
    static object Get(object target, string name, params object[] args) { return target.GetType().InvokeMember(name, BindingFlags.GetProperty, null, target, args, CultureInfo.InvariantCulture); }
    static object Call(object target, string name, params object[] args) { return target.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, target, args, CultureInfo.InvariantCulture); }
    static void Put(object target, string name, object value) { target.GetType().InvokeMember(name, BindingFlags.SetProperty, null, target, new object[] { value }, CultureInfo.InvariantCulture); }
    static void Reply(object value) { Console.WriteLine(new JavaScriptSerializer().Serialize(value)); }
    [STAThread]
    public static void Main(string[] args) {
        Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        object app = null, bookA = null, bookB = null;
        try {
            app = Activator.CreateInstance(Type.GetTypeFromProgID("Excel.Application", true));
            Put(app, "DisplayAlerts", false); Put(app, "EnableEvents", false); Put(app, "AutomationSecurity", 3);
            var books = Get(app, "Workbooks");
            bookA = Call(books, "Add");
            var data = Get(Get(bookA, "Worksheets"), "Item", 1); Put(data, "Name", "Data");
            Call(bookA, "SaveAs", Path.Combine(args[0], "Pokemon Excel A " + args[1] + ".xlsx"), 51);
            bookB = Call(books, "Add");
            var other = Get(Get(bookB, "Worksheets"), "Item", 1); Put(other, "Name", "Data");
            Call(bookB, "SaveAs", Path.Combine(args[0], "Pokemon Excel B " + args[1] + ".xlsx"), 51);
            Put(app, "Visible", true);
            var windowA = Get(Get(bookA, "Windows"), "Item", 1);
            var windowB = Get(Get(bookB, "Windows"), "Item", 1);
            Call(windowB, "Activate");
            Reply(new {kind = "ready", window_a = Convert.ToString(Get(windowA, "Hwnd")), name_a = Get(bookA, "Name"), path_a = Get(bookA, "FullName"),
                window_b = Convert.ToString(Get(windowB, "Hwnd")), name_b = Get(bookB, "Name"), path_b = Get(bookB, "FullName")});
            string command;
            while ((command = Console.ReadLine()) != null && command != "close") {
                if (command == "protect") Call(data, "Protect");
                else if (command == "unprotect") Call(data, "Unprotect");
                else if (command == "change") Put(Get(data, "Range", "A1"), "Value2", "external change");
                else if (command == "merge") Call(Get(data, "Range", "F1:G1"), "Merge");
                else if (command == "unmerge") Call(Get(data, "Range", "F1:G1"), "UnMerge");
                else if (command == "array") Put(Get(data, "Range", "I1:I2"), "FormulaArray", "=ROW(I1:I2)");
                else if (command == "spill") Put(Get(data, "Range", "J1"), "Formula2", "=SEQUENCE(2)");
                else if (command == "other") Call(windowB, "Activate");
                else if (command == "hidden") Put(data, "Visible", 0);
                else if (command == "close_a") { Call(bookA, "Close", false); bookA = null; }
                else if (command == "reopen") { bookA = Call(books, "Open", Path.Combine(args[0], "Pokemon Excel A " + args[1] + ".xlsx")); windowA = Get(Get(bookA, "Windows"), "Item", 1); }
                else if (command == "reopen_readonly") { bookA = Call(books, "Open", Path.Combine(args[0], "Pokemon Excel A " + args[1] + ".xlsx"), 0, true); windowA = Get(Get(bookA, "Windows"), "Item", 1); }
                Reply(new {kind = "done", command = command, window_a = bookA == null ? "" : Convert.ToString(Get(windowA, "Hwnd")), name_a = bookA == null ? "" : Convert.ToString(Get(bookA, "Name"))});
            }
        } catch (Exception error) {
            while (error.InnerException != null) error = error.InnerException;
            Reply(new {kind = "error", error = error.Message});
        } finally {
            if (bookB != null) Call(bookB, "Close", false);
            if (bookA != null) Call(bookA, "Close", false);
            // Never quit an application if unexpected workbooks have appeared in it.
            if (app != null && Convert.ToInt32(Get(Get(app, "Workbooks"), "Count")) == 0) Call(app, "Quit");
        }
    }
}
