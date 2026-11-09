# Project Source of Truth: pokemon-companion vs agent-desktop (Vercel)

## 1. Những gì đã làm (What was done)
- **Nghiên cứu & Đối chiếu Kiến trúc**:
  - Khảo sát toàn diện repo của user: [pokemon-companion](file:///c:/Users/84845.DESKTOP-6UDUU1B/Downloads/gitclone/pokemon-companion) (Desktop pet Electron + MCP Computer-Use Server).
  - Khảo sát sâu repo của Vercel Labs: [agent-desktop](file:///c:/Users/84845.DESKTOP-6UDUU1B/Downloads/gitclone/agent-desktop) (Rust CLI/C-lib accessibility-tree computer use engine).
  - Phân tích chi tiết các ưu điểm vượt trội của `agent-desktop` về: Native performance, Web Wrapper Flattening, Durable Window Identity, Ref system (`@s...:e...`), Skeleton Tree / Drill-down, Action Disposition Tri-state, và Security.
- **Học hỏi và Áp dụng vào `pokemon-companion`**:
  1. **Web Wrapper Flattening (Tối ưu duyệt cây Electron/Chromium)**:
     - File: [uia-worker.cs](file:///c:/Users/84845.DESKTOP-6UDUU1B/Downloads/gitclone/pokemon-companion/backend/src/windows/uia-worker.cs)
     - Logic: Thêm `GetClassName` từ `user32.dll` để phát hiện cửa sổ Chromium (`Chrome_WidgetWin_1`). Khi duyệt cây qua các container rỗng (`Group`, `Custom`, `Pane` không name, không automationId, không actions), không tăng logical depth (`nextDepth = isWebWrapper ? visit.Depth : visit.Depth + 1`). Tránh chạm cạn kiệt ngân sách `maxDepth: 24` trên các app Electron/Chromium sâu như Slack, VS Code, Chrome.
     - Credit: *Adapted from Vercel Labs agent-desktop (https://github.com/vercel-labs/agent-desktop)*.
  2. **Hỗ trợ Unified Ref System (`@s<snapshot>:e<element_id>`)**:
     - Files: [batch.ts](file:///c:/Users/84845.DESKTOP-6UDUU1B/Downloads/gitclone/pokemon-companion/backend/src/windows/batch.ts), [automation.ts](file:///c:/Users/84845.DESKTOP-6UDUU1B/Downloads/gitclone/pokemon-companion/backend/src/windows/automation.ts), [windows.ts](file:///c:/Users/84845.DESKTOP-6UDUU1B/Downloads/gitclone/pokemon-companion/backend/src/tools/windows.ts).
     - Logic: Thêm trường `ref` vào schema Zod của `windows` tool và batch step. Parser tự động phân tích cú pháp `@s<snapshot>:e<element_id>` thành `snapshot` và `element_id` cho worker native xử lý, giúp LLM gửi lệnh ngắn gọn, tự nhiên và ít lỗi cú pháp hơn.
     - Credit: *Adapted from Vercel Labs agent-desktop*.
  3. **Hỗ trợ Đa Nền Tảng (Cross-Platform Desktop Automation: Windows, macOS, Linux)**:
     - Files: [cross-platform.ts](file:///c:/Users/84845.DESKTOP-6UDUU1B/Downloads/gitclone/pokemon-companion/backend/src/windows/cross-platform.ts), [automation.ts](file:///c:/Users/84845.DESKTOP-6UDUU1B/Downloads/gitclone/pokemon-companion/backend/src/windows/automation.ts), [windows.ts](file:///c:/Users/84845.DESKTOP-6UDUU1B/Downloads/gitclone/pokemon-companion/backend/src/tools/windows.ts).
     - Logic: Gỡ bỏ giới hạn `process.platform !== 'win32'`. Tích hợp adapter đa nền tảng: C# UIA worker trên Windows, tự động ủy quyền `agent-desktop` CLI hoặc fallback `osascript` JXA trên macOS và `wmctrl`/`xdotool` trên Linux.
     - Credit: *Architecture and multi-platform bridge inspired by Vercel Labs agent-desktop*.
  4. **Kiểm thử & Benchmark Thực Tế**:
     - Toàn bộ 127 unit/integration tests trong 10 test files đều PASS 100%.
     - Chạy thành công benchmark thực tế: [windows-batch-2026-11-09.md](file:///c:/Users/84845.DESKTOP-6UDUU1B/Downloads/gitclone/pokemon-companion/benchmarks/results/windows-batch-2026-11-09.md).
     - Kết quả đo lường: Batch giảm **83.3%** số lượt gọi MCP (1 vs 6 calls), giảm **64.7%** ký tự kết quả trả về cho LLM (400 vs 1133 chars), và giảm **67.5%** dung lượng UTF-8 byte (506 vs 1557 bytes).

## 2. Những "đặc sản" logic vừa tìm thấy (Logic Quirks & Findings)
- **Interactive Windows Desktop Session Requirement**: Benchmark chạy Electron fixture với `--force-renderer-accessibility` và kiểm tra UIA thực tế yêu cầu môi trường desktop tương tác (`BypassSandbox: true`).
- **Lazy ChildProcess Import in Vitest**: Khi test unit mock `node:child_process`, việc import top-level `{execFile}` sẽ gây lỗi nếu mock không trả về `execFile`. Cần dùng lazy access `childProcess.execFile ? promisify(childProcess.execFile) : null`.
- **Web Wrapper Depth Trap**: Các ứng dụng Chromium/Electron tạo ra hàng chục tầng container ẩn danh không mang ngữ nghĩa. Gating kiểm tra `Chrome_WidgetWin` là cần thiết để không làm phẳng sai các container native thông thường.

## 3. Những việc còn dang dở / Tiềm năng nâng cấp tiếp theo (Pending Work & Roadmap)
- [ ] **Chế độ Skeleton Tree & Subtree Drill-down**: Thêm flag `skeleton: true` và `root_ref` vào `get_ui` để LLM quét khung sườn tổng quan trước khi đi sâu vào từng panel.
- [ ] **Action Disposition & Verification**: Chuẩn hóa envelope kết quả trả về của tool `windows` để trả về `disposition: { retry: 'safe' | 'unsafe' }`.
