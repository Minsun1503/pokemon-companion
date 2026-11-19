# Pokémon Telegram portable — hướng dẫn cho agent

Khi người dùng yêu cầu bạn đọc và cài gói này, đọc toàn bộ [AGENT-SETUP.md](AGENT-SETUP.md) trước. Khảo sát môi trường, hỏi các lựa chọn còn thiếu, rồi mới chạy cài đặt. Đừng tự cài chỉ vì đang đọc thư mục.

Bản này chỉ dùng một API DeepSeek cho toàn bộ agent. Không xin thêm provider/key, không chia sẻ key của máy đóng gói. Cài đặt theo kiểu Hermes: `Start Pokemon Agent.cmd` mở wizard dòng lệnh (người dùng tự dán API key và bot token), sau đó người dùng nhắn riêng cho bot để nhận mã ghép cặp và chủ máy duyệt mã. Không cần nhóm. Không sao chép bí mật, lịch sử hoặc ID người dùng từ máy khác.

Đây là gói Windows x64 đã kèm runtime, không phải source checkout: không chạy npm install/build trong gói. Xem TELEGRAM-SETUP-VI.md cho người dùng và GROUP-WELCOME.vi.md cho mẫu tin giới thiệu. Các tác vụ trên máy vẫn cần kiểm chứng.
