using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

// Attach to Excel's native object model through the requested XLMAIN window.
// Never choose a target using GetActiveObject/ActiveWorkbook or create an Excel instance here.
public static class PokemonExcelAutomation {
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hwnd, EnumChild callback, IntPtr data);
    [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint objectId, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object result);
    delegate bool EnumChild(IntPtr hwnd, IntPtr data);
    static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;
    static Dictionary<string, object> Obj(params object[] args) {
        var result = new Dictionary<string, object>();
        for (int i = 0; i < args.Length; i += 2) result[(string)args[i]] = args[i + 1];
        return result;
    }
    sealed class ComScope : IDisposable {
        readonly List<object> objects = new List<object>();
        public object Track(object value) { if (value != null && Marshal.IsComObject(value)) objects.Add(value); return value; }
        public object Get(object target, string name, params object[] args) {
            return Track(target.GetType().InvokeMember(name, BindingFlags.GetProperty, null, target, args, Invariant));
        }
        public object Call(object target, string name, params object[] args) {
            return Track(target.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, target, args, Invariant));
        }
        public void Put(object target, string name, object value) {
            target.GetType().InvokeMember(name, BindingFlags.SetProperty, null, target, new object[] { value }, Invariant);
        }
        public void Dispose() {
            for (int i = objects.Count - 1; i >= 0; i--) {
                try { Marshal.ReleaseComObject(objects[i]); } catch (InvalidComObjectException) { }
            }
        }
    }
    sealed class Bounds {
        public int Row, Column, Rows, Columns;
        public int Count { get { return Rows * Columns; } }
        public string Address;
    }
    static int Column(string letters) { int result = 0; foreach (char ch in letters) result = result * 26 + ch - 'A' + 1; return result; }
    static string Letters(int col) {
        string result = "";
        while (col > 0) { col--; result = (char)('A' + col % 26) + result; col /= 26; }
        return result;
    }
    static Bounds ParseRange(string address) {
        address = (address ?? "").ToUpperInvariant();
        var match = Regex.Match(address, @"^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})(?::\$?([A-Z]{1,3})\$?([1-9]\d{0,6}))?$");
        if (!match.Success) throw new Exception("Use a single rectangular A1 range; names, sheet qualifiers, and whole columns are unsupported.");
        int row = Int32.Parse(match.Groups[2].Value, Invariant), col = Column(match.Groups[1].Value);
        int lastRow = match.Groups[4].Success ? Int32.Parse(match.Groups[4].Value, Invariant) : row;
        int lastCol = match.Groups[3].Success ? Column(match.Groups[3].Value) : col;
        if (row > 1048576 || lastRow > 1048576 || col > 16384 || lastCol > 16384 || lastRow < row || lastCol < col || (long)(lastRow - row + 1) * (lastCol - col + 1) > 1000)
            throw new Exception("Range must be within Excel bounds and contain at most 1,000 cells.");
        return new Bounds { Row = row, Column = col, Rows = lastRow - row + 1, Columns = lastCol - col + 1, Address = address.Replace("$", "") };
    }
    static string Text(Dictionary<string, object> args, string key, string fallback = "") { object value; return args.TryGetValue(key, out value) && value != null ? Convert.ToString(value, Invariant) : fallback; }
    static int Number(Dictionary<string, object> args, string key, int fallback) { object value; return args.TryGetValue(key, out value) ? Convert.ToInt32(value, Invariant) : fallback; }
    static bool Flag(Dictionary<string, object> args, string key, bool fallback) { object value; return args.TryGetValue(key, out value) ? Convert.ToBoolean(value, Invariant) : fallback; }
    static object At(object matrix, int row, int col) {
        var array = matrix as Array;
        return array != null && array.Rank == 2 ? array.GetValue(array.GetLowerBound(0) + row, array.GetLowerBound(1) + col) : matrix;
    }
    static bool Empty(object value) { return value == null || value is DBNull; }
    static string Class(IntPtr hwnd) { var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity); return name.ToString(); }
    static object Bind(ComScope scope, string windowId, string expectedName, out object app, out object selectedWindow, out IntPtr hwnd) {
        long id;
        if (!Int64.TryParse(windowId, out id)) throw new Exception("Invalid Excel window id.");
        hwnd = new IntPtr(id);
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (!IsWindow(hwnd) || Class(hwnd) != "XLMAIN" || pid == 0)
            throw new Exception("The selected window is not a live desktop Excel workbook.");
        using (var process = Process.GetProcessById((int)pid)) {
            if (!process.ProcessName.Equals("EXCEL", StringComparison.OrdinalIgnoreCase)) throw new Exception("The selected window is not a live desktop Excel workbook.");
        }
        if (!IsWindowEnabled(hwnd)) throw new Exception("Excel is blocked by a dialog. Resolve it and inspect the workbook again.");
        object native = null;
        EnumChildWindows(hwnd, delegate(IntPtr child, IntPtr unused) {
            if (Class(child) != "EXCEL7") return true;
            var iid = new Guid("00020400-0000-0000-C000-000000000046");
            object candidate;
            if (AccessibleObjectFromWindow(child, 0xfffffff0, ref iid, out candidate) == 0 && candidate != null) { native = scope.Track(candidate); return false; }
            return true;
        }, IntPtr.Zero);
        if (native == null) throw new Exception("Excel native object model is unavailable. Protected View, the start screen, and Excel Online are unsupported.");
        app = scope.Get(native, "Application");
        var books = scope.Get(app, "Workbooks");
        int count = Convert.ToInt32(scope.Get(books, "Count"), Invariant);
        if (count > 100) throw new Exception("Too many open workbooks to identify the target safely.");
        object selected = null;
        selectedWindow = null;
        for (int i = 1; i <= count; i++) {
            var book = scope.Get(books, "Item", i);
            var windows = scope.Get(book, "Windows");
            int windowCount = Convert.ToInt32(scope.Get(windows, "Count"), Invariant);
            if (windowCount > 100) throw new Exception("Too many workbook windows to identify the target safely.");
            for (int j = 1; j <= windowCount; j++) {
                var win = scope.Get(windows, "Item", j);
                if (Convert.ToInt64(scope.Get(win, "Hwnd"), Invariant) != id) continue;
                if (selected != null && !Object.ReferenceEquals(selected, book)) throw new Exception("Excel window maps to multiple workbooks; no target was selected.");
                selected = book;
                selectedWindow = win;
            }
        }
        if (selected == null) throw new Exception("No editable workbook belongs to this window. Protected View is unsupported.");
        string name = Convert.ToString(scope.Get(selected, "Name"), Invariant);
        if (!String.IsNullOrEmpty(expectedName) && name != expectedName) throw new Exception("Workbook name changed or does not match. Inspect this window again; no input was sent.");
        return selected;
    }
    static string Version(string identity, object values, object formulas, Bounds bounds) {
        using (var hash = SHA256.Create()) {
            using (var stream = new CryptoStream(Stream.Null, hash, CryptoStreamMode.Write)) {
                using (var writer = new BinaryWriter(stream, Encoding.UTF8)) {
                    writer.Write(identity);
                    for (int i = 0; i < bounds.Count; i++) {
                        int row = i / bounds.Columns, col = i % bounds.Columns;
                        foreach (object value in new object[] { At(values, row, col), At(formulas, row, col) }) {
                            writer.Write(Empty(value) ? "null" : value.GetType().FullName);
                            writer.Write(Empty(value) ? "" : value is ErrorWrapper ? ((ErrorWrapper)value).ErrorCode.ToString(Invariant) : value is double ? ((double)value).ToString("R", Invariant) : value is float ? ((float)value).ToString("R", Invariant) : Convert.ToString(value, Invariant));
                        }
                    }
                }
            }
            return BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant();
        }
    }
    static object Value(object value, int maxChars, Dictionary<string, object> cell, string clippedKey) {
        if (Empty(value)) return null;
        if (value is ErrorWrapper || (value is int && ((uint)(int)value & 0xffff0000) == 0x800a0000)) {
            int code = value is ErrorWrapper ? ((ErrorWrapper)value).ErrorCode : (int)value;
            int excelCode = code & 0xffff;
            string error = excelCode == 2000 ? "#NULL!" : excelCode == 2007 ? "#DIV/0!" : excelCode == 2015 ? "#VALUE!" : excelCode == 2023 ? "#REF!" : excelCode == 2029 ? "#NAME?" : excelCode == 2036 ? "#NUM!" : excelCode == 2042 ? "#N/A" : "Excel error";
            return Obj("error", error, "error_code", code);
        }
        var text = value as string;
        if (text != null && text.Length > maxChars) {
            int end = maxChars;
            if (end > 0 && Char.IsHighSurrogate(text[end - 1]) && Char.IsLowSurrogate(text[end])) end--;
            cell[clippedKey] = true;
            return text.Substring(0, end);
        }
        return value;
    }
    static bool HasFormula(ComScope scope, object range, int row, int col, object raw) {
        var text = raw as string;
        if (text == null || !text.StartsWith("=", StringComparison.Ordinal)) return false;
        var cells = scope.Get(range, "Cells");
        var cell = scope.Get(cells, "Item", row + 1, col + 1);
        return Convert.ToBoolean(scope.Get(cell, "HasFormula"), Invariant);
    }
    static Dictionary<string, object> Cell(ComScope scope, object range, Bounds bounds, object values, object formulas, int offset, int chars) {
        int row = offset / bounds.Columns, col = offset % bounds.Columns;
        var cell = Obj("offset", offset, "address", Letters(bounds.Column + col) + (bounds.Row + row).ToString(Invariant));
        cell["value"] = Value(At(values, row, col), chars, cell, "value_clipped");
        var raw = At(formulas, row, col);
        cell["formula"] = HasFormula(scope, range, row, col, raw) ? Value(raw, chars, cell, "formula_clipped") : null;
        return cell;
    }
    static object Page(ComScope scope, object range, Bounds bounds, object values, object formulas, string version, Dictionary<string, object> args, bool search) {
        int offset = Number(args, "offset", 0), chars = Number(args, "cell_chars", 1024);
        int limit = Math.Min(Number(args, "page_size", 100), Math.Max(1, 150000 / (chars * 2)));
        if (offset < 0 || offset > bounds.Count || chars < 16 || chars > 32767 || limit < 1 || limit > 100) throw new Exception("Invalid Excel page bounds.");
        var cells = new List<object>();
        string query = Text(args, "query");
        string mode = Text(args, "match", "contains"), lookIn = Text(args, "look_in", "values");
        var comparison = Flag(args, "case_sensitive", false) ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;
        int position = offset;
        for (; position < bounds.Count && cells.Count < limit; position++) {
            int row = position / bounds.Columns, col = position % bounds.Columns;
            if (search) {
                object raw = lookIn == "formulas" ? At(formulas, row, col) : At(values, row, col);
                if (lookIn == "formulas" && !HasFormula(scope, range, row, col, raw)) continue;
                if (Empty(raw)) continue;
                var normalized = Value(raw, 32767, new Dictionary<string, object>(), "clipped") as Dictionary<string, object>;
                string candidate = normalized != null && normalized.ContainsKey("error") ? Convert.ToString(normalized["error"], Invariant) : Convert.ToString(raw, Invariant);
                if (mode == "exact" ? !candidate.Equals(query, comparison) : candidate.IndexOf(query, comparison) < 0) continue;
            }
            cells.Add(Cell(scope, range, bounds, values, formulas, position, chars));
        }
        return Obj("ok", true, "cells", cells, "range", bounds.Address, "offset", offset, "next_offset", position < bounds.Count ? (object)position : null,
            "has_more", position < bounds.Count, "total_cells", bounds.Count, "version", version);
    }
    static bool Equal(object left, object right) {
        if (Empty(left) || Empty(right)) return Empty(left) && Empty(right);
        if (left is string || right is string || left is bool || right is bool) return Object.Equals(left, right);
        return Convert.ToDouble(left, Invariant).Equals(Convert.ToDouble(right, Invariant));
    }
    public static object Execute(string json) {
        string phase = "binding", input = "not_sent";
        try {
            var args = new JavaScriptSerializer { MaxJsonLength = 2000000 }.Deserialize<Dictionary<string, object>>(json);
            string action = Text(args, "action"), workbookName = Text(args, "workbook_name"), sheetName = Text(args, "sheet");
            using (var scope = new ComScope()) {
                object app;
                object selectedWindow;
                IntPtr hwnd;
                var book = Bind(scope, Text(args, "window_id"), workbookName, out app, out selectedWindow, out hwnd);
                string name = Convert.ToString(scope.Get(book, "Name"), Invariant), fullName = Convert.ToString(scope.Get(book, "FullName"), Invariant);
                bool readOnly = Convert.ToBoolean(scope.Get(book, "ReadOnly"), Invariant);
                if (action == "excel_inspect_workbook") {
                    var worksheets = scope.Get(book, "Worksheets");
                    int count = Convert.ToInt32(scope.Get(worksheets, "Count"), Invariant);
                    var sheets = new List<object>();
                    for (int i = 1; i <= Math.Min(count, 100); i++) {
                        var sheet = scope.Get(worksheets, "Item", i);
                        var used = scope.Get(sheet, "UsedRange");
                        sheets.Add(Obj("name", scope.Get(sheet, "Name"), "visible", Convert.ToInt32(scope.Get(sheet, "Visible"), Invariant) == -1,
                            "protected", scope.Get(sheet, "ProtectContents"), "used_range", scope.Get(used, "Address")));
                    }
                    return Obj("ok", true, "workbook_name", name, "full_name", fullName, "read_only", readOnly, "saved", scope.Get(book, "Saved"),
                        "sheet_count", count, "sheets", sheets, "sheets_truncated", count > sheets.Count, "calculation_mode", scope.Get(app, "Calculation"), "calculation_state", scope.Get(app, "CalculationState"));
                }
                if (String.IsNullOrEmpty(workbookName)) throw new Exception("Exact workbook_name is required after inspection.");
                if (action == "excel_save_workbook") {
                    phase = "save_preflight";
                    if (readOnly || String.IsNullOrEmpty(Convert.ToString(scope.Get(book, "Path"), Invariant))) throw new Exception("Save requires an existing writable workbook path. Save As and unsaved workbooks are unsupported.");
                    if (fullName != Text(args, "expected_path")) throw new Exception("Workbook path changed or does not match; inspect before saving.");
                    phase = "save"; input = "unknown";
                    scope.Call(book, "Save"); input = "applied";
                    phase = "save_verification";
                    bool saved = Convert.ToBoolean(scope.Get(book, "Saved"), Invariant);
                    if (!saved || Convert.ToString(scope.Get(book, "FullName"), Invariant) != fullName) throw new Exception("Excel did not confirm the workbook as saved at the expected path.");
                    return Obj("ok", true, "input_state", input, "workbook_name", name, "full_name", fullName, "saved", true, "verified", true);
                }
                phase = "range_preflight";
                var bounds = ParseRange(Text(args, "range"));
                var sheetsCollection = scope.Get(book, "Worksheets");
                var worksheet = scope.Get(sheetsCollection, "Item", sheetName);
                if (Convert.ToString(scope.Get(worksheet, "Name"), Invariant) != sheetName) throw new Exception("Exact worksheet name is required.");
                var range = scope.Get(worksheet, "Range", bounds.Address);
                object values = scope.Get(range, "Value2"), formulas = scope.Get(range, "Formula");
                string version = Version(fullName + "\n" + sheetName + "\n" + bounds.Address, values, formulas, bounds);
                string expected = Text(args, "version", Text(args, "expected_version"));
                if (!String.IsNullOrEmpty(expected) && expected != version) throw new Exception("Excel range contents changed. Read the range again; input was not replayed.");
                if (action == "excel_read_range" || action == "excel_find_cells") {
                    if (Number(args, "offset", 0) > 0 && String.IsNullOrEmpty(expected)) throw new Exception("Subsequent pages require the original version.");
                    return Page(scope, range, bounds, values, formulas, version, args, action == "excel_find_cells");
                }
                if (action == "excel_select_range") {
                    if (Convert.ToInt32(scope.Get(worksheet, "Visible"), Invariant) != -1) throw new Exception("Worksheet is hidden; it will not be unhidden automatically.");
                    phase = "selection"; input = "unknown";
                    scope.Call(selectedWindow, "Activate");
                    scope.Call(worksheet, "Activate");
                    scope.Call(range, "Select"); input = "applied";
                    phase = "selection_verification";
                    var selection = scope.Get(app, "Selection");
                    var activeSheet = scope.Get(app, "ActiveSheet");
                    var activeBook = scope.Get(app, "ActiveWorkbook");
                    var activeWindow = scope.Get(app, "ActiveWindow");
                    if (Convert.ToInt64(scope.Get(activeWindow, "Hwnd"), Invariant) != hwnd.ToInt64() || Convert.ToString(scope.Get(activeBook, "FullName"), Invariant) != fullName || Convert.ToString(scope.Get(activeSheet, "Name"), Invariant) != sheetName ||
                        Convert.ToString(scope.Get(selection, "Address"), Invariant).Replace("$", "") != bounds.Address)
                        throw new Exception("Excel selection did not match the requested workbook, sheet, and range.");
                    return Obj("ok", true, "input_state", input, "verified", true, "workbook_name", name, "sheet", sheetName, "range", bounds.Address);
                }
                if (action != "excel_write_range") throw new Exception("Unsupported Excel action.");
                if (readOnly || Convert.ToBoolean(scope.Get(worksheet, "ProtectContents"), Invariant)) throw new Exception("Workbook is read-only or worksheet is protected; no input was sent.");
                if (!Object.Equals(scope.Get(range, "MergeCells"), false) || !Object.Equals(scope.Get(range, "HasArray"), false)) throw new Exception("Writes to merged cells or existing array formulas are unsupported.");
                try {
                    if (!Object.Equals(scope.Get(range, "HasSpill"), false)) throw new Exception("Writes to spill ranges are unsupported.");
                } catch (TargetInvocationException error) {
                    var cause = error.InnerException as COMException;
                    if (cause == null || (cause.ErrorCode != unchecked((int)0x80020003) && cause.ErrorCode != unchecked((int)0x80020006))) throw;
                } catch (MissingMemberException) { /* Older Excel versions have no HasSpill property. */ }
                if (!Flag(args, "require_empty", true) && String.IsNullOrEmpty(expected)) throw new Exception("Overwriting requires expected_version from a fresh range read.");
                if (Flag(args, "require_empty", true)) {
                    for (int i = 0; i < bounds.Count; i++) {
                        object value = At(values, i / bounds.Columns, i % bounds.Columns), formula = At(formulas, i / bounds.Columns, i % bounds.Columns);
                        if (!Empty(value) || (!Empty(formula) && !Object.Equals(formula, "")))
                            throw new Exception("Target range is not empty. Read it, then explicitly overwrite using expected_version.");
                    }
                }
                var rows = args["data"] as System.Collections.IList;
                if (rows == null || rows.Count != bounds.Rows) throw new Exception("Data rows do not match the target range.");
                var data = new object[bounds.Rows, bounds.Columns];
                bool formulaMode = Text(args, "mode", "values") == "formulas";
                for (int row = 0; row < bounds.Rows; row++) {
                    var columns = rows[row] as System.Collections.IList;
                    if (columns == null || columns.Count != bounds.Columns) throw new Exception("Data columns do not match the target range.");
                    for (int col = 0; col < bounds.Columns; col++) {
                        object value = columns[col];
                        if (formulaMode && (!(value is string) || !((string)value).StartsWith("=", StringComparison.Ordinal))) throw new Exception("Formula mode requires an English A1 formula starting with '=' in every cell.");
                        data[row, col] = !formulaMode && value is string ? "'" + (string)value : value;
                    }
                }
                phase = "write"; input = "unknown";
                scope.Put(range, formulaMode ? "Formula" : "Value2", data); input = "applied";
                phase = "write_verification";
                object actual = scope.Get(range, formulaMode ? "Formula" : "Value2");
                object storedFormulas = scope.Get(range, "Formula");
                for (int row = 0; row < bounds.Rows; row++) {
                    var columns = (System.Collections.IList)rows[row];
                    for (int col = 0; col < bounds.Columns; col++) {
                        if (!Equal(At(actual, row, col), columns[col]) || (!formulaMode && HasFormula(scope, range, row, col, At(storedFormulas, row, col))))
                            throw new Exception("Written contents did not verify. Some input may already be applied; inspect before continuing.");
                    }
                }
                values = scope.Get(range, "Value2"); formulas = scope.Get(range, "Formula");
                return Obj("ok", true, "input_state", input, "verified", true, "workbook_name", name, "sheet", sheetName, "range", bounds.Address,
                    "written_cells", bounds.Count, "version", Version(fullName + "\n" + sheetName + "\n" + bounds.Address, values, formulas, bounds), "saved", scope.Get(book, "Saved"), "calculation_state", scope.Get(app, "CalculationState"));
            }
        } catch (Exception error) {
            while (error.InnerException != null) error = error.InnerException;
            string message = error.Message;
            if (message.Length > 400) message = message.Substring(0, 400);
            return Obj("ok", false, "phase", phase, "input_state", input, "error", message);
        }
    }
}
