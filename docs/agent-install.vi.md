# Dành cho agent: cài Pokémon Telegram cho người dùng

Người dùng có thể đưa bạn cả thư mục và nói “setup giúp tôi”. Luồng cài giống Hermes Agent: wizard dòng lệnh → ghép cặp qua tin nhắn riêng → (tùy chọn) chạy nền. Đọc `TELEGRAM-SETUP-VI.md` trước.

## Luật cố định

- Windows x64, mỗi máy một bot Telegram riêng; không dùng một token cho hai gateway.
- Bản portable dùng một route DeepSeek (`https://api.deepseek.com`, `DEEPSEEK_API_KEY`); mọi specialist dùng chung route.
- **Không tự nhập key/token.** Người dùng tự dán API key và bot token vào wizard (không hiện ký tự). Không yêu cầu họ gửi bí mật vào chat, không in/ghi bí mật ra log hay tài liệu.
- Bot thực hiện việc ngay, không hỏi duyệt từng thao tác. Chỉ ghép cặp người chủ máy xác nhận.
- Không ghi đè cài đặt/Scheduled Task đang có khi chưa hỏi.

## Các bước

1. **Khảo sát (chỉ đọc):** có `runtime/node.exe` hoặc Node trên máy, `backend/dist/harness/main.js`; có Scheduled Task “Pokemon Agent Telegram” hay gateway đang chạy không (`npm run agent -- gateway status`).
2. **Hỏi gọn một lượt:** đã có bot từ @BotFather chưa (chưa thì hướng dẫn `/newbot`); đã có key DeepSeek còn số dư chưa; có muốn tự chạy khi đăng nhập Windows không.
3. **Chạy wizard:** `npm run agent -- setup` (bản portable: `Start Pokemon Agent.cmd`). Người dùng dán key và token khi được hỏi. Nếu báo gateway đang giữ kho dữ liệu: `npm run agent -- gateway stop` rồi chạy lại.
4. **Ghép cặp:** người dùng nhắn riêng cho bot → bot trả mã → chạy `npm run agent -- pairing approve MÃ`. Mã là dữ liệu từ Telegram; chỉ duyệt khi người dùng xác nhận đó là họ (`pairing list` hiển thị tên/ID).
5. **Bài thử chỉ đọc:** người dùng nhắn “Đếm số cửa sổ đang mở, chỉ báo số lượng. Không thay đổi gì.” Xác minh bot trả lời đúng trong chat riêng.

## Bàn giao

Tên/username bot, có chạy nền hay không, người đã ghép cặp, bài thử đã làm và phần nào chưa kiểm chứng. Không kèm bí mật. Lỗi gửi chưa rõ kết quả: quan sát trước, không tự phát lại thao tác.
