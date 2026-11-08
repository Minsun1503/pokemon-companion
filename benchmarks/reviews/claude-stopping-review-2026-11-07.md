## Đánh giá dừng cho phần tốc độ của server: nên dừng

Báo cáo đủ để kết luận, với điều kiện đo trên một máy, 20 mẫu mỗi kịch bản và ngưỡng 15% mình đặt trước:

- **Các lệnh `windows` trên ứng dụng thật đều dưới 250 ms:** `get_ui` hẹp ở ChatGPT Settings khoảng 89 ms, ở Edge khoảng 154 ms. Đúng quy tắc đã đặt, không động vào duyệt cây UI.
- **Thành phần còn lại không còn lớn hoặc không đáng làm:**
  - Click ~105 đến 130 ms là độ trễ 100 ms hiệu chỉnh của nut.js, và đường ưu tiên `windows invoke` đã nhanh hơn.
  - Khởi động lạnh ~1,4 đến 1,6 giây chỉ trả một lần mỗi phiên.
  - Gõ chữ và chụp ảnh đã giảm mạnh (500 ký tự từ 7,8 giây xuống ~0,19 giây, chụp ảnh khoảng 828 xuống 466 ms khi bật companion).
- **Còn một thành phần trên 15%:** ẩn/hiện companion cùng chờ 120 ms khi chụp ảnh, khoảng 137 ms trên 466 ms. Nhưng thử nghiệm loại trừ khỏi ảnh chụp **chưa kết luận được**: có một điểm ảnh khác biệt chưa rõ nguyên nhân, và số đo toàn công cụ trong lần chạy đó còn bị nhiễu. Agent hoàn nguyên là đúng theo quy tắc an toàn. Vì chụp ảnh là đường cuối cùng và thường không dùng, mình không khuyên đào sâu nữa, trừ khi sau này AI hay phải chụp ảnh.

Mình ước tính một lượt suy nghĩ của model mất vài giây (chưa đo), vượt xa 25 đến 200 ms của server. Điểm khác biệt còn lại nằm ở số lượt gọi, mà `batch`, `wait_for` và `launch` đã xử lý. Mình không khẳng định không thể tối ưu thêm. Chỉ là bằng chứng hiện có không biện minh cho việc làm tiếp.

## Cần phân biệt hai việc

| | Đã có | Chưa có |
|---|---|---|
| Kỹ thuật | build/check/99 test/`test:windows` qua, benchmark trên hai ứng dụng thật, bốn mục audit an toàn đều "yes" (agent báo kèm file:dòng, mình chưa tự đọc code) | |
| Sản phẩm | | Bài test GitHub chưa chạy, nên **chưa biết AI có tự nghĩ ra việc dùng tool hay không**. |

Điều thứ hai mới trả lời câu hỏi ban đầu của bạn.

## Bốn thay đổi nhỏ đáng làm trước bài test (đều liên quan tới kịch bản GitHub, không phải tốc độ)

1. **Lời nhắn khi `activate` bị từ chối đang bảo AI nhờ người dùng.** Thông báo hiện tại là "Windows did not allow activation. Select the window manually." Câu này đúng là phản xạ đẩy việc về người mà bạn muốn loại bỏ, và báo cáo cho biết Windows thỉnh thoảng từ chối activate. Chính agent cũng ghi nhận UIA vẫn chạy được ở nền khi activation bị từ chối.
2. **`launch` URL kèm truy vấn tiêu đề dễ hết hạn.** Agent báo URL GitHub mở được nhưng truy vấn tiêu đề "GitHub" hết hạn, và nó phải tự tìm tiêu đề thật. Với bước mở trang xác thực thật, AI có thể kết luận `launch` hỏng. Nên trả về chẩn đoán khi hết hạn và hướng dẫn tìm theo tên trình duyệt.
3. **`read_text` trên ô trống trả về một dấu hiệu kiểu đối tượng** (theo báo cáo). Cần xác nhận rồi sửa thành chuỗi rỗng, vì AI dùng `read_text` để xác minh.
4. **Bộ gõ tiếng Việt có thể làm sai ký tự khi gõ.** Báo cáo ghi các mẫu gõ chữ trước đó bị biến đổi dưới bộ gõ tiếng Việt, và benchmark phải dùng chữ số. Nếu laptop bật Telex hoặc VNI thì mã device code như `WDJB-MJHT` có thể bị gõ sai (ví dụ `W` thành `Ư`). Cần mô tả rõ trong công cụ và ưu tiên `set_value`.

Prompt cho agent:

```text
Branch `perf`. No push; keep the unrelated lockfile edit untouched; no new dependencies. Keep pause/cancellation, ordered safety locks, password hiding, stale-ID rejection, no input replay. Small commits; build, check, test, test:windows must pass. Do NOT run more benchmarks. After this, stop making changes: I will freeze the build for a product test.

1) Activation error (uia-worker.cs, "Windows did not allow activation. Select the window manually."): reword so it does not tell the model to ask the user. Suggested meaning: "Windows did not allow activation (foreground lock). Retry once; get_ui/invoke/set_value often work without activation; if the window shows only title-bar controls, try computer key alt+tab or a click on the window's title bar. Ask the user only if these fail." Keep it short. Update tests that assert the old text.

2) launch with a URL: when the wait for the window query times out, include in the error a short list (max 5) of windows that appeared since the launch (title + process name), and state the launch itself succeeded. In the windows description add one sentence: for URLs, query by the browser process name (for example the default browser's name) rather than the page title, which changes while loading. Keep the description compact.

3) read_text on an empty/blank field: reproduce, then return {"text": ""} (or the existing shape with an empty string), never an object marker. Add a test. If you cannot reproduce, report that.

4) Input method: (a) in the computer tool description (type action) add: "A Vietnamese/IME keyboard layout can alter typed letters (for example Telex). Prefer windows set_value for fields; after type, verify the field with read_text." (b) in the result of type, add a field `verify: "read the field to confirm the text; an active input method can alter letters"`. (c) Report whether the current implementation can detect the active keyboard layout/IME cheaply (GetKeyboardLayout for the foreground window); if yes, include `input_method` in the type result and say so, do not auto-switch layouts. Keep Unicode/clipboard behavior and existing tests unchanged.

REPORT: the diff summary, test results, and the final built hash of backend/dist/main.js.
```

## Trước khi chạy bài test GitHub

- **Khoá bản build:** sau khi agent xong, bảo nó không build thêm. Khởi động lại ChatGPT Desktop một lần.
- **Kiểm tra nhanh trong chat Codex mới:** gọi `pokemon status` và xem tool còn chạy không. Báo cáo nói connector Pokémon đã cài từng báo "desktop disconnected", nên nếu lỗi này còn thì bài test sẽ hỏng vì kết nối, không phải vì AI nghĩ sai.
- **Nếu laptop dùng bộ gõ tiếng Việt:** thử gõ `WDJB-MJHT aa dd ow` vào Notepad trước. Nếu ra sai, chuyển bộ gõ sang tiếng Anh khi test để khỏi lẫn lỗi.

Sau đó chạy bài test theo bảng tiêu chí ở lượt trước. Gửi mình kết quả từng lần cùng câu trả lời ở lần sai, mình sẽ chỉnh tiếp đúng chỗ đó.
