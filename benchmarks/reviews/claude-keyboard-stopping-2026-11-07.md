# Claude keyboard-navigation stopping assessment

Received through the existing Claude conversation after exact read-back of the 5801-character report and verified submission. Claude's response was copied through its full-response Copy button. Its quota dialog appeared after the response; dismissing Not now exposed the completed reply.

The only remaining change within this task is consistent API-first guidance and one final build/check/test/test:windows run. The suggested GitHub logout/product campaign is outside this keyboard-navigation task. No additional benchmark, native-error retry, or layout switching is required.

Verbatim response:

**Đủ. Nhiệm vụ điều hướng bàn phím dừng ở đây.** Các kết quả không đạt cổng đã đặt (đúng 20/20 và tiết kiệm ít nhất một lượt gọi hoặc nhanh hơn trên 25%), nên quyết định không thêm bước `key` vào batch là đúng. Mình chưa tự đọc code, nên dưới đây dựa trên báo cáo của agent.

## Kết quả cho thấy gì

- **Edge:** đường UIA (1 lượt gọi, trung vị 334 ms, 20/20) thắng đường phím tắt (4 lượt, 551 ms, 19/20). Đây là so sánh sạch nhất. Lần sai duy nhất là Telex biến `127.0.0.1` thành `.1270.0.1`, khớp với cảnh báo bộ gõ đã thêm.
- **ChatGPT:** không kết luận được về tốc độ. Cả hai đường đều bị lỗi xác minh `COMException 0x80040201` khi control biến mất lúc chuyển màn hình (UIA 14/20, phím tắt 11/20), nên các trung vị gồm cả mẫu lỗi. Điều đã xác lập là Ctrl+, được hỗ trợ.
- **Bộ bảo vệ nền trước:** 40 lần sai cửa sổ không gửi phím nào, 40 lần đúng cửa sổ gửi đúng 20 phím F8 và 20 chữ số cho A, không gửi gì cho B. Đây là phần có giá trị chắc chắn nhất của lượt này, vì nó chặn đúng sự cố gõ nhầm cửa sổ.

Kết quả chỉ áp dụng cho hai kịch bản đã đo, không phải kết luận chung rằng phím tắt luôn chậm hơn. Còn một giới hạn của thiết kế phép đo: batch không có bước `key`, nên đường phím tắt tốn 4 lượt gọi một phần vì thiếu tính năng đó. Cổng được đặt chính vì lý do này, nhưng nó cho thấy kết luận "không đáng thêm" dựa trên cả đo lường lẫn thiết kế.

## Một chỉnh sửa còn lại: câu hướng dẫn phím tắt

Hướng dẫn A hiện nói "prefer a known ABSOLUTE shortcut…", trong khi số đo ở Edge cho thấy UIA batch nhanh hơn và ít lượt gọi hơn, và description của `windows` đã ghi thứ tự windows → phím tắt → ảnh chụp. Hai câu này có thể kéo model về hai phía khác nhau. Đây là việc đổi chữ, không cần đo thêm:

```text
Shortcuts: use windows (focus/invoke/set_value, batch) first. Use a known ABSOLUTE shortcut (ctrl+l address bar, ctrl+1..9 tab n, escape to close, ctrl+, settings where supported) only when no control is exposed or no UIA pattern fits, pass window_id so the foreground guard applies, and verify the result right after. Never use tab/ctrl+tab/alt+tab as blind navigation.
```

Sau khi sửa, build và chạy `check`, `test`, `test:windows` một lần, rồi **đóng băng bản build lần cuối** và ghi lại hash mới, vì hash cũ `71DC1E3F…` sẽ không còn khớp.

## Hai điều ghi nhận, không phải việc cần làm ngay

1. **Lỗi `0x80040201` khi control biến mất lúc chuyển màn hình:** có thể làm model dừng ở giữa luồng nếu gặp ở trình duyệt thật. Hiện chưa cần làm gì. Nếu bài test GitHub cho thấy AI dừng vì lỗi này, thì thêm một câu gợi ý "đọc lại một lần" vào thông báo lỗi là chỉnh sửa nhỏ và không phát lại input.
2. **Telex vẫn là rủi ro khi gõ chữ.** Hướng dẫn hiện có (ưu tiên `set_value`, kiểm tra lại) là đủ, không cần thêm cơ chế.

## Bước tiếp theo

Việc còn lại là bài test sản phẩm GitHub, vì chưa có bằng chứng AI tự nghĩ ra việc dùng tool. Sau khi agent sửa chữ và đóng băng build, chạy theo quy trình đã đưa: đăng xuất GitHub, layout tiếng Anh, mỗi lần một chat Codex mới, dán đúng một câu, chấm theo bảng 5 tiêu chí, 3 đến 5 lần. Gửi mình kết quả và nguyên văn câu trả lời ở các lần sai.
