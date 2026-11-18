# Đăng ký phiên trong nhóm, điều khiển máy qua chat riêng

Mỗi máy cài Pokémon dùng **một bot riêng**, một nhóm cố định và danh sách người được phép. Công việc được xử lý trên chính máy đó qua Pokémon MCP; kết quả về chat riêng. Không dùng cùng một bot token cho hai gateway, vì các máy sẽ tranh nhau nhận cập nhật. Không cần ChatGPT desktop khi dùng model API.

## Cách dùng hằng ngày

1. Trong nhóm đăng ký, gõ @ và chọn bot, rồi nhắn “đăng ký phiên”, hoặc dùng `/session@username_cua_bot`.
2. Bot gửi liên kết chat riêng. Nếu bot chưa được phép nhắn cho bạn, mở liên kết rồi bấm **Bắt đầu** một lần.
3. Trong chat riêng, nhắn việc như với chatbot, không cần mention. Kết quả và các nút duyệt đều ở đây. “Dừng lại” dừng tác vụ; “bắt đầu phiên mới” bỏ ngữ cảnh trước.

Nhóm không nhận công việc và không chuyển nội dung yêu cầu trong nhóm sang model. Phiên riêng tách theo bot và người dùng, lưu mã hóa qua khởi động lại. Lần gọi bot tiếp theo trong cùng nhóm mở lại phiên hiện có. Đổi sang nhóm đăng ký khác tạo phiên riêng mới. User ID và nhóm vẫn phải được chủ máy cho phép; đăng ký không tự cấp quyền người lạ. Bỏ nhóm khỏi allowlist cũng chặn phiên riêng đã đăng ký qua nhóm đó. Các lệnh kỹ thuật vẫn dùng được khi chủ động yêu cầu, nhưng bot không tự chèn mã task hay hướng dẫn trạng thái vào mỗi câu trả lời.

Trước khi bắt đầu, chuẩn bị: API key đã nạp tiền, bot token riêng cho máy, Telegram user ID của người điều khiển, và một nhóm có bot tham gia. Việc tạo tài khoản, bot và API key vẫn do chủ máy thực hiện; cài app không tự tạo các tài khoản này.

## 1. Cài và chạy

Các nút setup mô tả dưới đây có trong bản build chứa cập nhật này. Nếu đang dùng ZIP cũ và không thấy nút, cần cập nhật hoặc build lại; sửa tài liệu trong repo không tự nâng cấp một ZIP đã tải trước đó.

- Bản portable: chạy **Start Pokemon Agent.cmd** trên Windows. Giữ nguyên các thư mục đi cùng bản phát hành.
- Checkout mã nguồn: tại checkout `.publish`, chạy `npm run setup`, `npm run build`, rồi `npm run agent -- setup`.
- Trang setup chỉ lắng nghe trên loopback của máy; nhập key/token ở đây. Không lưu key vào repository hay gửi vào nhóm Telegram.

## 2. Model

Chọn route DeepSeek, định dạng OpenAI-compatible và endpoint `https://api.deepseek.com`. Nhập model ID được tài khoản hỗ trợ (ví dụ `deepseek-flash`, kiểm tra lại danh sách model hiện hành). Nhập API key, bấm **Save route**, **Check model connection**, rồi **Use as default**. Kiểm tra kết nối chỉ đọc danh sách model, không yêu cầu sinh văn bản. Key được chấp nhận và model được liệt kê chưa chứng minh công việc thực tế đã hoàn thành.

## 3. Bot và nhóm

1. Trong Telegram mở **@BotFather**, gửi `/newbot`. Chọn tên hiển thị ngắn như **Pikachu**; chọn username còn trống và kết thúc bằng `bot`, ví dụ `pika_mayban_bot` nếu tên đó còn trống. Lưu bot token để nhập vào Pokémon. Tạo một nhóm rồi thêm bot vào nhóm.
2. Nếu dùng tiện ích lấy group ID ở bước 4, mở chat riêng với bot và gửi `/start` một lần. Công việc và phê duyệt hằng ngày đều ở chat riêng.
3. Trong setup, nhập bot token và Telegram user ID số của những người được phép, bật **Connect Telegram**, lưu. Có thể xem user ID qua chức năng tài khoản/ứng dụng Telegram bạn tin cậy; Pokémon không tự cho người lạ quyền điều khiển.
4. Người đã nằm trong allowlist gửi `/whereami@ten_bot` trong nhóm. Bot trả user ID và group ID vào **chat riêng**, kể cả khi nhóm chưa được thêm vào allowlist. Lệnh này không chạy model, không điều khiển máy và không tự cấp quyền cho nhóm.
5. Điền chính xác group ID âm vào **Allowed group IDs**, lưu; dùng một nhóm cố định cho bot này.
6. Bấm **Check bot and group** để kiểm tra bot, nhóm và xung đột webhook. Kiểm tra này không gửi tin và không gọi `getUpdates`, tránh tranh cập nhật với gateway đang chạy.
7. Muốn rút gọn tên hiển thị: nhập **Pikachu** vào **Short display name**, bấm **Save bot display name**. Có thể kiểm tra lại bằng **Check bot and group**. Người dùng trong nhóm chỉ cần gõ `@` rồi chọn bot vừa đặt tên.

### Bật nhận yêu cầu bằng @mention thường

Với cách dùng `@bot mở Notepad`, thực hiện một lần trong **@BotFather**:

1. Gửi `/setprivacy`.
2. Chọn đúng bot của máy này.
3. Chọn **Disable**.
4. Xóa bot khỏi nhóm rồi thêm lại để thay đổi có hiệu lực với nhóm hiện tại.
5. Quay lại Pokémon, bấm **Check bot and group**. Setup sẽ báo trạng thái privacy; thử mention từ một user đã có trong allowlist.

Không cần cấp quyền admin chỉ để Pokémon nhận tin nếu privacy đã tắt. Gateway vẫn chỉ xử lý user và nhóm được cho phép, và bỏ qua hội thoại không gọi bot. Khi giữ privacy mode bật, hãy **Reply** vào tin của bot hoặc dùng slash command có username; mention thường có thể không được Telegram chuyển tới gateway. Pokémon không thể xử lý một tin mà Telegram không gửi cho nó.

Không chạy đồng thời một chương trình khác đang dùng token của bot này để polling hoặc nhận webhook.

## 4. Chọn chế độ chạy trên máy

- Tắt **Desktop chat relay** để yêu cầu không được chuyển sang một cuộc chat desktop.
- Bật **Enable /team** và **Also use the team for ordinary API tasks**. Cấu hình số chuyên gia, token và số lượt gọi phù hợp ngân sách.
- Native input vẫn dùng phê duyệt của Pokémon, nhưng yêu cầu hiện **ngay trong chat riêng**, kèm nút **Cho phép / Từ chối**. Chỉ người đã giao việc được bấm; người khác, nhóm khác và nút đã hết hạn không cấp được quyền. Không cần chép mã hoặc quay về nhóm. Kết quả cũng về chat riêng.

## 5. Bài thử đầu tiên

Sau khi đăng ký trong nhóm và mở chat riêng, gửi một yêu cầu chỉ đọc:

```text
@Pikachu đếm số cửa sổ đang mở, chỉ báo số lượng. Không thay đổi gì.
```

Sau đó **Reply** vào phản hồi của bot: `Mở Notepad và nhập “Xin chào từ Pokémon”, rồi kiểm tra nội dung.` Bấm Cho phép / Từ chối ngay trong nhóm nếu được yêu cầu. Dùng `/stop` để dừng việc của chat này. `/tasks`, `/taskstatus ID` và `/budget` cho biết trạng thái và usage. Nếu nhóm có nhiều bot hoặc privacy còn bật, dùng dạng `/stop@username_that_cua_bot` khi cần chỉ rõ bot nhận lệnh.

## Khi chưa chạy được

| Hiện tượng | Kiểm tra |
| --- | --- |
| `@tên` không có phản hồi | Chọn bot từ gợi ý thay vì gõ bí danh; kiểm tra `/setprivacy`, thêm lại bot, user ID và group ID |
| Slash command chạy nhưng mention không chạy | Telegram privacy có thể còn bật; thử Reply và xem kết quả Check bot and group |
| Bot nhận việc nhưng không thao tác | Máy bật/mở khóa, gateway đang chạy; xem nút phê duyệt trong chat riêng; chủ động dùng `/tasks` nếu cần chẩn đoán |
| Model báo lỗi key hoặc model | Save route → Check model connection; kiểm tra nạp tiền/quota nếu gọi model bị từ chối |
| Kết nối Telegram chập chờn | Kiểm tra không có gateway thứ hai dùng cùng token và không có webhook cạnh tranh |

Máy cần đang bật, có mạng, Pokémon gateway chạy; các thao tác native cần phiên desktop đã đăng nhập và mở khóa. Autostart là theo phiên người dùng, không điều khiển được máy đã tắt. Bản Windows portable có **Enable Pokemon Agent Autostart.cmd**; checkout có `scripts/install-agent-autostart.ps1`. Không cấp quyền admin cho bot chỉ để chạy tác vụ thông thường.

## Phân biệt các mức kiểm chứng

- “Telegram connected”: gateway đã poll thành công, chưa chứng minh một lệnh điều khiển đã chạy.
- “API key accepted”: endpoint đã nhận key, chưa chứng minh số dư/quota đủ cho mọi yêu cầu.
- Hoàn thành bài thử: cần thấy kết quả được kiểm chứng trên đúng máy và tin phản hồi trong đúng chat riêng. Các fixture test trong repo không thay thế phép thử này.

Hướng dẫn kỹ thuật: [Pokémon Agent](pokemon-agent.md). Cơ chế team và nguồn tham khảo: [agent-team-sources.md](agent-team-sources.md).
