# Bắt đầu: Pokémon điều khiển máy qua Telegram

**Mỗi máy một bot riêng. Nhóm chỉ đăng ký phiên; công việc trao đổi trong chat riêng.** Bản Telegram portable dùng duy nhất một API DeepSeek cho mọi agent; không cần mở ChatGPT desktop cho chế độ này.

Nếu nhờ agent cài giúp, đưa họ [AGENT-SETUP.md](AGENT-SETUP.md) trong bản portable: agent sẽ hỏi tên bot và các lựa chọn cần thiết, đưa bản xác nhận rồi mới setup. Gói không chứa key/token thật.

1. Giải nén đầy đủ bản portable và chạy **Start Pokemon Agent.cmd** trên Windows. Trang setup cục bộ sẽ mở. Với checkout source, xem lệnh cài trong hướng dẫn đầy đủ bên dưới.
2. Giữ route DeepSeek và model được tài khoản hỗ trợ, nhập một API key DeepSeek → **Save route** → **Check model connection** → **Use as default**.
3. Tạo bot bằng **@BotFather → /newbot**, đặt tên hiển thị ngắn như **Pikachu**, rồi thêm bot vào nhóm.
4. Nhập bot token và user ID được phép vào Pokémon. Mở chat riêng với bot, gửi `/start`. Dùng `/whereami@username_cua_bot` trong nhóm để nhận group ID riêng, rồi lưu group ID vào setup.
5. Bật **Connect Telegram**, **Enable /team**, **Also use the team for ordinary API tasks**; tắt **Desktop chat relay**. Bấm **Check bot and group**.
6. Để gọi bằng mention thường, dùng **@BotFather → /setprivacy → chọn bot → Disable**, rồi xóa bot khỏi nhóm và thêm lại. Có thể đặt lại tên hiển thị qua **Short display name → Save bot display name**.
7. Trong nhóm, gõ `@`, chọn bot và nhắn “đăng ký phiên” (hoặc gửi `/session@username_cua_bot`). Nhóm chỉ đăng ký, không chạy yêu cầu điều khiển máy.
8. Mở liên kết chat riêng bot trả về; bấm **Bắt đầu** nếu Telegram yêu cầu. Từ đây cứ nhắn việc bình thường, không cần @ hoặc lệnh.

Kết quả và nút **Cho phép / Từ chối** nằm trong chat riêng. Bot dùng “đang nhập”, không tự gửi mã task hay các dòng lệnh trạng thái. Bạn có thể nói “dừng lại”, “bắt đầu phiên mới”, “làm tiếp đi”. Phiên được lưu mã hóa theo bot/người dùng; không mang lịch sử nhóm sang. Người dùng và nhóm đăng ký vẫn phải nằm trong allowlist của máy. Máy cần bật, có mạng và mở khóa khi thao tác desktop.
