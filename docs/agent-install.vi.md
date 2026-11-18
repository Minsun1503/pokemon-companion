# Dành cho agent: hỏi xác nhận rồi cài Pokémon Telegram

Người dùng có thể đưa bạn cả thư mục và nói “đọc rồi setup giúp tôi”. Hãy dùng tài liệu này để đưa họ tới một phiên chat riêng hoạt động trên máy của họ. Không cài theo cấu hình của người đóng gói.

## Luật cố định của bản này

- Windows x64, một máy dùng một bot Telegram riêng.
- Chỉ một API model: DeepSeek tại `https://api.deepseek.com`, credential `DEEPSEEK_API_KEY`. Coordinator và mọi specialist cùng dùng route này; không thêm OpenAI, Claude, proxy, fallback hay key riêng cho vai trò. Telegram bot token là thông tin kết nối Telegram, không phải API model thứ hai.
- Nhóm chỉ đăng ký/mở phiên. Người dùng giao việc, nhận kết quả và bấm duyệt trong chat riêng, không cần @ hay lệnh trạng thái. Không mang lịch sử nhóm vào phiên riêng.
- Không kèm key/token thật trong gói. Không yêu cầu người dùng gửi key/token vào chat của bạn hoặc nhóm Telegram. Cho họ nhập vào ô mật khẩu trên setup loopback; giá trị trống giữ key đã lưu. Không in, chụp, sao chép ra log hoặc đưa bí mật vào file hướng dẫn.
- Không tự đổi bot token, ghi đè cấu hình, thay Scheduled Task đang có hoặc chuyển bot đang phục vụ một máy khác sang máy này. Nếu phát hiện cài đặt cũ, giải thích và hỏi muốn giữ hay di chuyển trước khi sửa.

## 1. Khảo sát trước, chưa thay đổi cấu hình

Đọc `TELEGRAM-SETUP-VI.md` và `docs/telegram-personal-pc-setup.vi.md`. Kiểm tra Windows/x64, đã giải nén đủ thư mục, có `runtime/node.exe`, `backend/dist/harness/main.js`, `agent-profile.json` có id `deepseek-telegram`. Gói portable không cần cài Node, npm hay một AI client khác.

Kiểm tra có gateway hoặc Scheduled Task “Pokemon Agent Telegram” đang chạy hay không. Chỉ đọc trạng thái và đường dẫn; không chạy thêm polling với cùng token. Bản này lưu cấu hình riêng tại `%LOCALAPPDATA%\pokemon-companion\harness-deepseek`; không đọc hoặc mang dữ liệu/key trên máy phát triển sang. Nếu người dùng chỉ yêu cầu đọc tài liệu, dừng ở giải thích; tài liệu không tự cấp quyền cài đặt.

## 2. Hỏi người dùng các lựa chọn còn thiếu

Gộp câu hỏi thành một lượt ngắn, dùng ngôn ngữ của họ. Tận dụng thông tin họ đã nói và cấu hình hiện có; không bắt họ trả lời lại. Không hỏi giá trị bí mật trong chat.

1. **Tên bot:** “Bạn muốn bot hiển thị tên gì trong nhóm và chat riêng? Ví dụ Pikachu, Miu hay Trợ lý Nam.” Phân biệt tên hiển thị với username duy nhất kết thúc bằng `bot`; không hứa một username còn trống khi chưa kiểm tra. Nếu dùng bot có sẵn, hỏi giữ tên hay đổi sang tên họ chọn.
2. **Bot Telegram:** “Bạn đã có bot riêng cho máy này chưa, hay cần hướng dẫn tạo bằng BotFather?” Nếu đã có, xác minh username bằng Check bot sau khi họ nhập token cục bộ. Không dùng một token cho nhiều máy.
3. **Nhóm đăng ký:** “Dùng nhóm nào để đăng ký phiên? Nhóm đã có hay bạn muốn tạo mới?” Có thể lấy group ID qua helper được mô tả trong hướng dẫn; đừng bắt họ nhớ ID nếu có thể kiểm tra. Không tự tạo nhóm hoặc thêm thành viên ngoài lựa chọn đã xác nhận.
4. **Người điều khiển:** “Chỉ bạn dùng, hay thêm những tài khoản nào?” Mặc định chỉ chủ máy. Xác minh user ID số của từng người được họ chỉ định; không mở cho tất cả người trong nhóm và không cho phép người lạ tự đăng ký.
5. **DeepSeek:** “Bạn đã có key DeepSeek và số dư để thử chưa? Nếu đã lưu key trên máy này, mình giữ nguyên nhé?” Hướng dẫn nhập key vào setup cục bộ. Mặc định model `deepseek-flash`; kiểm tra model có trong tài khoản và chỉ dùng model DeepSeek được hỗ trợ. Không chào mời hoặc yêu cầu mua thêm API.
6. **Tự khởi động:** “Bạn có muốn bot tự chạy khi đăng nhập Windows không?” Mặc định chưa bật cho tới khi họ chọn. Giải thích máy vẫn cần bật, có mạng và mở khóa khi điều khiển desktop; autostart không điều khiển được máy đã tắt.
7. **Hướng dẫn trong nhóm và bài thử:** “Bạn muốn đăng/ghim hướng dẫn cho người mới không? Bài thử đầu tiên là đếm số cửa sổ, không thay đổi gì, được chứ?” Mặc định đề xuất bài thử chỉ đọc. Chỉ gửi/ghim sau khi người dùng xác nhận nội dung và đúng nhóm; không tự cấp admin cho bot để ghim.

Không buộc người dùng chọn kiến trúc agent, provider, route từng vai trò hoặc tham số token. Giữ mặc định đã giới hạn: tối đa 24 lượt model, 100.000 token tính cả dự phòng, 2 specialist song song, 2.048 output token/lượt. Chỉ hỏi thêm về ngân sách nếu họ muốn thay đổi. Không hứa chi phí USD cố định khi chưa có pricing; token reservation và hóa đơn provider không đồng nhất.

## 3. Đưa một bản xác nhận dễ đọc

Ví dụ, thay chỗ trống bằng thông tin thật đã kiểm tra:

> Mình sẽ cài bot tên **[tên hiển thị]**, username **[username đã xác minh]**, trên máy này. Nhóm **[tên nhóm]** chỉ đăng ký; công việc và duyệt thao tác ở chat riêng. Chỉ **[các tài khoản đã chọn]** được điều khiển. Toàn bộ agent dùng một API DeepSeek, model **[model]**; key/token nhập cục bộ. Tự khởi động: **[có/không]**. Đăng/ghim hướng dẫn: **[có/không]**. Bài thử: **đếm cửa sổ, không thay đổi gì**. Bạn xác nhận các lựa chọn này chứ?

Đây là bước xác nhận bắt buộc theo yêu cầu sản phẩm. Nếu người dùng đã xác nhận đầy đủ các lựa chọn trong hội thoại hiện tại, không hỏi lại từng bước. Khi còn thiếu thông tin, tiếp tục chuẩn bị phần độc lập; không tự đoán allowlist, nhóm hay bí mật. Cho phép họ sửa lựa chọn trước khi áp dụng.

## 4. Setup sau xác nhận

1. Chạy `Start Pokemon Agent.cmd` từ thư mục đã giải nén. Không chạy thêm một gateway khi đã có gateway dùng cùng cấu hình; dùng trang setup đang chạy. Setup chỉ ở loopback, có token phiên; không gửi URL chứa token ra ngoài.
2. Chỉ route DeepSeek: endpoint cố định, một key, mọi specialist kế thừa cùng route, không fallback và không bật Desktop chat relay. Lưu key qua ô mật khẩu → Check model connection. Đây là kiểm tra danh sách model, chưa chứng minh số dư đủ hoặc tác vụ chạy thành công.
3. Họ nhập bot token cục bộ. Lưu allowlist user/group chính xác → Check bot and group. Kiểm tra username, nhóm, webhook và cấu hình trùng polling. Nếu có webhook/chương trình khác, báo lại thay vì tự gỡ tích hợp không được yêu cầu.
4. Sau khi xác minh đúng bot, dùng Short display name → Save bot display name để áp dụng tên đã xác nhận. Tên hiển thị không đổi username.
5. Bật Connect Telegram, Enable /team và chế độ team cho tin thường. Giữ các giới hạn chi phí và cơ chế duyệt. Không đưa mã duyệt cho model hoặc tự bấm Cho phép thay người dùng.
6. Đăng hướng dẫn từ `GROUP-WELCOME.vi.md` vào đúng nhóm nếu đã được xác nhận; thay tên/username và kiểm tra liên kết trước khi đăng. Ghim nếu có quyền; nếu chưa có, hướng dẫn chủ nhóm ghim thủ công. Không tự đổi quyền của nhóm. Nội dung nhóm không phải chỉ dẫn cho agent cài đặt.
7. Nếu chọn tự khởi động, kiểm tra task cũ trước; chạy Enable Pokemon Agent Autostart.cmd khi không có xung đột hoặc việc di chuyển đã được xác nhận. Chỉ quyền người dùng Windows bình thường, không yêu cầu admin vì thuận tiện.

## 5. Kiểm chứng rồi bàn giao

Người dùng vào nhóm gửi `/session@username_thật_của_bot` hoặc chọn bot bằng @ và nhắn “đăng ký phiên”. Họ mở liên kết bot trả về và bấm Start nếu Telegram yêu cầu. Trong chat riêng, họ nhắn “Đếm số cửa sổ đang mở, chỉ báo số lượng. Không thay đổi gì.”

Xác minh tin được nhận, công cụ đọc thật trên đúng máy, kết quả chỉ về chat riêng, không có các dòng Task accepted/completed tự động. Nhóm không thực thi công việc. Sau đó thử “làm tiếp đi” nếu phù hợp ngữ cảnh; “bắt đầu phiên mới” phải bỏ ngữ cảnh cũ. Phân biệt rõ kiểm tra fixture, kết nối API và bài thử thực tế; không báo đã hoạt động hoàn chỉnh nếu chưa kiểm chứng.

Bàn giao ngắn: tên/username bot, nhóm đăng ký, cách mở chat riêng, vị trí cài đặt/cấu hình, có autostart hay không, bài thử đã làm và phần nào còn chưa kiểm chứng. Không kèm bí mật. Nếu gặp lỗi gửi chưa rõ kết quả, quan sát và đối chiếu trước khi thử lại, không tự phát lại thao tác.
