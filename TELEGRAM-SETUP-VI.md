# Bắt đầu: Pokémon điều khiển máy qua Telegram

Cách cài giống Hermes Agent: **3 lệnh trên terminal, không cần trang web, không cần nhóm, không cần tự tìm user ID.** Mỗi máy dùng một bot riêng.

## 1. Cài đặt (một lần)

```powershell
npm run agent -- setup
```

Wizard hỏi lần lượt:

1. **API key** (DeepSeek mặc định) → kiểm tra key và liệt kê model → chọn model (Enter = gợi ý).
2. **Bot token**: mở **@BotFather → /newbot**, đặt tên (ví dụ *Antwork*), copy token, dán vào. Wizard kiểm tra bằng `getMe`.
3. Hỏi có cài **chạy nền khi đăng nhập Windows** không (Enter = có). Có thì bot khởi động ngay.

Key và token không hiện trên màn hình khi gõ và được mã hóa trên máy; không lưu trong repo hay config.

## 2. Ghép cặp (pairing)

1. Mở Telegram, nhắn **riêng** cho bot bất kỳ câu gì.
2. Bot trả về **mã ghép cặp** 8 ký tự.
3. Trên máy, chạy:

```powershell
npm run agent -- pairing approve MÃ
```

Xong. Nhắn việc cho bot như chat bình thường. Mã hết hạn sau 1 giờ; người lạ không có mã được duyệt thì bot không làm gì.

## 3. Dùng hằng ngày

- Nhắn việc bình thường: “đếm số cửa sổ đang mở”, “mở Notepad và gõ …”.
- “dừng lại” hoặc `/stop`: dừng việc đang chạy. “bắt đầu phiên mới” hoặc `/new`: bỏ ngữ cảnh cũ.
- `/team <việc>`: dùng nhóm chuyên gia. `/status`, `/help`.
- Bot làm luôn, **không hỏi duyệt từng thao tác** (giống Hermes). Chỉ ghép cặp người bạn tin tưởng.

## Lệnh quản lý

| Lệnh | Việc |
| --- | --- |
| `npm run agent -- gateway` | Chạy bot trong cửa sổ hiện tại |
| `npm run agent -- gateway install` / `uninstall` | Cài/gỡ chạy nền khi đăng nhập Windows |
| `npm run agent -- gateway start` / `stop` / `status` | Điều khiển bản chạy nền |
| `npm run agent -- pairing list` | Xem người được phép và mã đang chờ |
| `npm run agent -- pairing revoke USER_ID` | Thu hồi quyền |
| `npm run agent -- status` | Trạng thái cấu hình (không lộ key) |

Muốn chạy lại `setup` khi bot đang chạy nền: `npm run agent -- gateway stop` trước, setup xong thì `gateway start`.

## Nhóm (tùy chọn)

Không cần nhóm. Nếu muốn gọi bot trong nhóm: thêm group ID (số âm) vào `telegram.allowedGroups` trong `config.json` của agent; chỉ người đã ghép cặp, khi @mention hoặc reply bot, mới được trả lời. Bot có privacy mode thì cần @mention hoặc reply.

Máy cần bật, có mạng và **mở khóa** khi thao tác desktop.
