# 🎴 Baccarat Vision Monitor v2

Bot tự động **screenshot** badge cầu màu vàng trên lobby và dùng **AI Vision** để đọc tên cầu.
Phát hiện **cầu 1-1** và **cầu bệt** → gửi Telegram + ảnh chụp bàn đó.

## Cách hoạt động

```
Login → Vào lobby → Screenshot badge vàng từng bàn
→ Đọc text bằng AI Vision → Phân loại cầu → Telegram alert
```

## Deploy lên Vercel

### 1. Cài Vercel CLI
```bash
npm i -g vercel
```

### 2. Deploy
```bash
cd baccarat-vision-bot
npm install
vercel
```

### 3. Environment Variables (Vercel Dashboard → Settings → Env)

| Key | Value |
|-----|-------|
| `TELEGRAM_BOT_TOKEN` | Token từ @BotFather |
| `TELEGRAM_CHAT_ID` | Chat ID của bạn |
| `ANTHROPIC_API_KEY` | API key của Claude (tùy chọn, để Vision đọc badge chính xác hơn) |
| `COOLDOWN_SEC` | `120` (giây giữa các alert cùng bàn) |

### 4. Dùng cron-job.org để tự động quét 15 giây

Vào https://cron-job.org → Tạo cron job:
- URL: `https://your-app.vercel.app/api/scan?token=BOT_TOKEN&chatId=CHAT_ID`
- Schedule: `* * * * *` (mỗi phút) — hoặc tạo 4 job cách nhau 15 giây

## Dashboard Web

Sau khi deploy, vào `https://your-app.vercel.app` để dùng dashboard:
- Điền Bot Token + Chat ID
- Chọn tần suất 15 giây
- Nhấn **Bắt đầu** → bot chạy tự động
- Alert được hiển thị realtime trên feed

## Tin nhắn Telegram

```
🔁 Cầu 1-1
📍 Bàn: Baccarat C09
🕐 08/03/2026, 17:30:00
[kèm ảnh chụp bàn đó]

🔥 Cầu bệt Cái
📍 Bàn: Baccarat 2  
🕐 08/03/2026, 17:30:15
```

## Ghi chú

- Platform dùng dynamic rendering → Puppeteer cần login thật trước
- Badge màu vàng được detect qua CSS computed style
- Nếu có ANTHROPIC_API_KEY: dùng Claude Haiku để đọc badge bằng Vision (chính xác hơn)
- Nếu không có key: đọc text trực tiếp từ DOM (cũng hoạt động tốt)
