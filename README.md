# Luyện nói tiếng Anh giao tiếp cùng Emma — bản web đầy đủ

Bản web đầy đủ của app luyện nói tiếng Anh giao tiếp với nhân vật ảo Emma.
Khác với bản web tĩnh trước đây (bị cấm script module nên không nạp được
giọng neural), bản này dùng Vite + ES module nên gắn được giọng neural thật
chạy ngay trên máy người dùng, không cần API key, không cần máy chủ.

## App có gì

- **Nhân vật 3D Emma** (Three.js, vẽ bằng code — không cần file model):
  miệng cử động theo âm thanh thật (qua WebAudio analyser), chớp mắt, gật đầu,
  biểu cảm theo tính cách; trang phục/phụ kiện đổi theo vai (tạp dề, kính,
  ống nghe). Nếu máy không có WebGL thì hiện mặt CSS dự phòng.
- **Vào app là Emma chào bằng tiếng Việt** và hỏi chọn chủ đề (trình duyệt chặn
  tiếng tự phát khi chưa có thao tác — lời chào sẽ phát ngay ở lần chạm/gõ
  phím đầu tiên, kèm nút nghe nhấp nháy nếu bị chặn; chọn chủ đề thì lời chào
  chờ tự hủy để không chồng tiếng).
- **6 chủ đề × 5 lượt**: làm quen bạn mới, gọi món ở quán cà phê, hỏi đường,
  mua sắm, nhận phòng khách sạn, đi khám bệnh. Mỗi chủ đề một tính cách riêng
  (bạn mới vui vẻ, chủ quán cáu kỉnh, bà Lan ân cần, anh bán hàng hay đùa,
  lễ tân trang trọng, bác sĩ nghiêm khắc). Nhân vật cáu/nghiêm có "đồng hồ
  tâm trạng": trả lời đúng và lịch sự liên tiếp thì dịu dần.
- **Trả lời bằng mic** (Web Speech API, nhận diện tiếng Anh) **hoặc gõ chữ**.
  Chấm theo ý bắt buộc (khớp từ theo ranh giới từ, nhận cả dạng rút gọn
  I'd/I've…), điểm 10/6/2, cuối buổi có sao và danh sách câu cần ôn.
- **Sửa lỗi bằng tiếng Việt**: khung trò chuyện, động viên, giải thích đều
  tiếng Việt; chỉ câu luyện tập và câu mẫu là tiếng Anh, hiện dạng phụ đề
  kèm nút nghe lại.
- **Tiến trình lưu localStorage** trên máy người dùng (v1 chưa có backend,
  chưa có tài khoản).

## Giọng đọc (phần quan trọng nhất của bản này)

| Giọng | Dùng cho | Ghi chú |
|---|---|---|
| Piper `en_US-lessac-medium` | Câu tiếng Anh | Mặc định. Tải model ~60MB một lần, lưu vào OPFS của trình duyệt, lần sau không tải nữa. |
| Piper `vi_VN-vais1000-medium` | Mọi câu tiếng Việt | Giọng Việt tốt nhất của Piper. Cũng ~60MB, tải một lần. |
| Kokoro-82M `af_heart` | Câu tiếng Anh, lựa chọn chất lượng cao | Chỉ khi người dùng chọn trong ô "Giọng đọc". Dùng WebGPU + fp32 nếu máy có WebGPU, không thì WASM + q8. Model ~80MB, cache qua IndexedDB. Kokoro không có giọng Việt nên câu Việt vẫn dùng Piper Việt. |
| Giọng hệ thống | Dự phòng | Khi Piper/Kokoro tải lỗi hoặc không hỗ trợ — app luôn báo rõ trong dòng trạng thái giọng, không im lặng giả vờ. |

Dòng trạng thái giọng luôn hiển thị trên đầu app; khi tải model lần đầu có
thanh tiến trình phần trăm rõ ràng.

## Chạy local

```bash
npm install
npm run dev     # chạy thử ở máy local
npm run build   # build ra dist/
npm run preview # xem thử bản build
```

## Đẩy lên Vercel (đủ dùng hosting tĩnh, chưa cần serverless)

Cách 1 — kéo thả: chạy `npm run build`, kéo thư mục `dist/` vào
https://vercel.com/new (mục drag & drop) là có link công khai.

Cách 2 — nối GitHub (khuyên dùng, tự deploy mỗi lần push):
1. Đẩy thư mục này lên một repo GitHub.
2. Vào https://vercel.com/new → Import repo → Framework Preset chọn **Vite**.
3. Build Command: `npm run build`, Output Directory: `dist`, Install Command:
   `npm install`. Không cần biến môi trường nào.
4. Deploy là có link công khai dạng `https://ten-app.vercel.app`.

Lưu ý:
- Không bật header COEP `require-corp`: model giọng tải từ jsDelivr /
  HuggingFace, bật COEP có thể chặn tải model. Không có COEP thì WASM vẫn
  chạy (chế độ đơn luồng, hơi chậm hơn một chút nhưng vẫn dùng tốt).
- Model giọng tải từ mạng ở lần đầu dùng (Piper ~60MB/giọng, Kokoro ~80MB)
  nên người dùng cần mạng ở lần đầu; sau khi cache thì dùng offline được
  (trừ phần nhận diện mic vốn thuộc về trình duyệt).

## Chưa kiểm chứng được ở môi trường build (cần thử trên máy thật)

- **Mic trên Chrome**: bấm mic, nói câu tiếng Anh, xem app có nghe đúng
  và chấm đúng không.
- **Emma chào khi vào app**: xem lời chào tự phát hay phải chạm một cái
  mới nói (tùy chính sách autoplay của từng trình duyệt).
- **Phát giọng Piper/Kokoro**: lần đầu tải model có hiện đúng % không, nghe
  có phải giọng neural không (khác hẳn giọng hệ thống), miệng nhân vật có
  cử động khớp tiếng không.
- **Kokoro trên máy có WebGPU** so với máy chỉ có WASM.
