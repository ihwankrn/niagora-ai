# Niagora AI — Kontrak API (v1)

Dokumen ini adalah kesepakatan request/response antara Frontend dan Backend, disetujui di [issue #2](https://github.com/ihwankrn/niagora-ai/issues/2).
Sumber kebenaran ada di Zod schema [`src/lib/contracts/`](../src/lib/contracts/); tipe TypeScript bisa diimpor langsung dari sana (menggantikan `src/types/analysis.ts` setelah branch digabung):

```ts
import type { AnalyzeBriefResponse, BriefAnalysis, DeliverableItem } from "@/lib/contracts/briefs";
import type { Quote, CalculateQuoteRequest } from "@/lib/contracts/quotes";
import type { Proposal, CreateProposalRequest, ListProposalsResponse } from "@/lib/contracts/proposals";
import type { ApiErrorBody } from "@/lib/contracts/errors";
```

Status implementasi (route handler belum ada; endpoint di bawah belum bisa dipanggil):

| Endpoint | Kontrak | Implementasi |
|---|---|---|
| `POST /api/briefs/analyze` | ✅ disepakati | Route handler ada, unit-tested; belum diuji live (Claude + sesi login) |
| `POST /api/quotes/calculate` | ✅ disepakati | ✅ Route handler ada, unit-tested, 401 diuji live |
| `POST /api/proposals` | ✅ disepakati | ✅ Route handler ada, unit-tested, query diuji ke Supabase, 401 diuji live |
| `GET /api/proposals` | ✅ disepakati | ✅ Route handler ada, unit-tested, query diuji ke Supabase, 401 diuji live |
| `GET /api/proposals/:id` | rencana | — |
| `POST /api/proposals/:id/send` | 🆕 perlu review FE | Unit-tested |
| `GET /api/public/proposals/:token` | 🆕 perlu review FE | Unit-tested |
| `POST /api/public/proposals/:token/approve` | 🆕 perlu review FE | Unit-tested |
| `POST /api/public/proposals/:token/paypal/orders` | 🆕 perlu review FE | Unit-tested; belum diuji ke PayPal Sandbox |
| `POST /api/public/proposals/:token/paypal/capture` | 🆕 perlu review FE | Unit-tested; belum diuji ke PayPal Sandbox |

## Aturan umum

- **Base URL:** same-origin (`/api/...`). Semua body `Content-Type: application/json`, maksimal 64 KB.
- **Autentikasi:** Supabase Auth. Sesi dibaca server dari cookie (`@supabase/ssr`), jadi `fetch` dari halaman Next.js yang sama tidak perlu header tambahan. Identitas user **tidak pernah** diambil dari body. Tanpa sesi valid → `401 UNAUTHORIZED`.
- **Uang:** selalu **integer dalam satuan terkecil (cents)**. `5000` = 50.00. Frontend yang memformat untuk tampilan, mis. `new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100)`.
- **Mata uang:** `USD`, `EUR`, `GBP`, `AUD`, `CAD`, `SGD` (didukung PayPal, 2 desimal). IDR tidak didukung PayPal checkout.
- **Jam kerja:** angka `> 0`, maks `1000` per item, maksimal 2 desimal (`1.5`, `2.25`).
- **Teks:** di-trim oleh server.
- **Key tidak dikenal ditolak** (`400 VALIDATION_ERROR`). Khususnya: field harga/total seperti `amountCents`, `subtotalCents`, `totalCents`, `status` **tidak boleh** dikirim browser — server selalu menghitung ulang.
- **Tanggal:** ISO 8601 UTC, mis. `"2026-10-25T11:28:59.023Z"`.

### Format sukses

```json
{ "data": { ... } }
```

### Format error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body is invalid",
    "details": [
      { "path": "items.0.estimatedHours", "message": "Must have at most 2 decimal places" }
    ]
  }
}
```

`details` hanya ada untuk `VALIDATION_ERROR`. `path` memakai notasi titik ke field di body (`""` = root, mis. key tak dikenal).

| HTTP | `code` | Kapan |
|---|---|---|
| 400 | `INVALID_JSON` | Body bukan JSON valid |
| 400 | `VALIDATION_ERROR` | Body gagal validasi schema |
| 401 | `UNAUTHORIZED` | Tidak ada sesi login yang valid |
| 403 | `FORBIDDEN` | Login, tapi bukan pemilik data |
| 404 | `NOT_FOUND` | Data tidak ditemukan |
| 409 | `CONFLICT` | Status tidak mengizinkan aksi (mis. proposal sudah dibayar) |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 64 KB |
| 429 | `RATE_LIMITED` | Terlalu banyak request |
| 502 | `AI_UNAVAILABLE` | LLM gagal atau output tidak valid — tampilkan pesan & tombol coba lagi |
| 409 | `PAYMENT_NOT_APPROVED` | Pembayar belum menyetujui order di PayPal |
| 422 | `PAYMENT_DECLINED` | Metode pembayaran ditolak PayPal — panggil `actions.restart()` di tombol PayPal |
| 502 | `PAYMENT_PROVIDER_ERROR` | PayPal API gagal, atau pembayaran tidak lolos verifikasi (ditandai untuk ditinjau) |
| 500 | `INTERNAL_ERROR` | Error tak terduga (detail tidak pernah dikirim ke browser) |

---

## `POST /api/briefs/analyze`

Menganalisis brief klien menjadi deliverables, pertanyaan klarifikasi, asumsi, dan estimasi jam. Brief dan hasil analisis disimpan. **Tidak ada harga** di respons ini — harga dihitung dari tarif freelancer lewat `/api/quotes/calculate`.

### Request

| Field | Tipe | Aturan |
|---|---|---|
| `brief` | string | 20–10.000 karakter setelah trim |
| `serviceType` | enum | `web_development` \| `graphic_design` \| `content_writing` |

```json
{
  "brief": "Saya butuh website company profile 5 halaman untuk usaha katering, ada form kontak dan galeri foto.",
  "serviceType": "web_development"
}
```

### Response `200`

```json
{
  "data": {
    "briefId": "6c1d4e2f-9a7b-4c2d-8e4f-5a6b3f0e5b8a",
    "serviceType": "web_development",
    "analysis": {
      "summary": "Website company profile 5 halaman untuk usaha katering.",
      "deliverables": [
        { "id": "a1b2c3d4-0001-4e2f-9a7b-1c2d3e4f5a6b", "title": "Desain & layout 5 halaman", "description": "Home, Tentang, Menu, Galeri, Kontak", "estimatedHours": 10 },
        { "id": "a1b2c3d4-0002-4e2f-9a7b-1c2d3e4f5a6b", "title": "Form kontak", "description": "Validasi dan notifikasi email", "estimatedHours": 3 },
        { "id": "a1b2c3d4-0003-4e2f-9a7b-1c2d3e4f5a6b", "title": "Galeri foto", "description": "Grid responsif dengan lightbox", "estimatedHours": 4.5 }
      ],
      "clarificationQuestions": [
        "Apakah konten dan foto sudah disediakan klien?",
        "Apakah perlu fitur pemesanan online? Belum bisa diestimasi tanpa detail alur pemesanan."
      ],
      "assumptions": ["Hosting dan domain disediakan klien."]
    },
    "totalEstimatedHours": 17.5,
    "createdAt": "2026-10-25T11:30:00.000Z"
  }
}
```

Aturan:

- Setiap deliverable **selalu** punya `id` (UUID dibuat server), `title`, `description`, dan `estimatedHours`.
- Pekerjaan yang belum bisa diestimasi secara wajar dari brief **tidak** dimasukkan ke `deliverables` dengan angka karangan. Pekerjaan itu ditanyakan di `clarificationQuestions`. Jadi `deliverables` boleh kosong asalkan `clarificationQuestions` tidak kosong.
- `totalEstimatedHours` = jumlah `estimatedHours` semua deliverable, dihitung server.
- Batas: `deliverables` maks 30 item, `clarificationQuestions` dan `assumptions` maks 15 item.

Error khusus:

- `401 UNAUTHORIZED` — dicek sebelum body dibaca.
- `429 RATE_LIMITED` — maksimal 20 analisis per user per jam (termasuk percobaan yang gagal).
- `502 AI_UNAVAILABLE` — LLM gagal, menolak, atau output tidak lolos validasi. Brief tetap tersimpan dengan status `FAILED`; tampilkan tombol coba lagi.

Catatan implementasi: analisis memakai Claude (`claude-opus-5-5`) dengan structured output. Server menetapkan `id`, membulatkan jam ke 2 desimal, membuang deliverable tanpa estimasi yang wajar, lalu memvalidasi hasil dengan schema kontrak sebelum menyimpan.

---

## `POST /api/quotes/calculate`

Kalkulasi harga deterministik. Tidak menyimpan apa pun — dipakai untuk preview saat freelancer mengubah jam/tarif.

### Request

| Field | Tipe | Aturan |
|---|---|---|
| `currency` | enum | lihat daftar mata uang |
| `hourlyRateCents` | integer | `> 0`, maks `10000000`; tarif default |
| `items` | array | 1–50 item |
| `items[].title` | string | 1–200 karakter |
| `items[].description` | string? | maks 2.000 karakter |
| `items[].estimatedHours` | number | `> 0`, maks 1000, ≤ 2 desimal |
| `items[].hourlyRateCents` | integer? | override tarif untuk item ini |

```json
{
  "currency": "USD",
  "hourlyRateCents": 5000,
  "items": [
    { "title": "Desain & layout 5 halaman", "estimatedHours": 10 },
    { "title": "Form kontak", "description": "Validasi dan notifikasi email", "estimatedHours": 2.5, "hourlyRateCents": 6000 }
  ]
}
```

### Response `200`

```json
{
  "data": {
    "currency": "USD",
    "hourlyRateCents": 5000,
    "items": [
      { "position": 0, "title": "Desain & layout 5 halaman", "description": null, "estimatedHours": 10, "hourlyRateCents": 5000, "amountCents": 50000 },
      { "position": 1, "title": "Form kontak", "description": "Validasi dan notifikasi email", "estimatedHours": 2.5, "hourlyRateCents": 6000, "amountCents": 15000 }
    ],
    "totalHours": 12.5,
    "subtotalCents": 65000,
    "totalCents": 65000
  }
}
```

### Aturan perhitungan

- `amountCents = round_half_up(estimatedHours × hourlyRateCents)`, dihitung dengan integer (jam diubah ke per-seratus jam dulu) sehingga tidak ada error floating point. Contoh: `1.33 × 3333 = 4432.89` → `4433`.
- `subtotalCents = Σ amountCents`.
- `totalCents = subtotalCents` (MVP belum ada pajak/diskon).
- `position` mengikuti urutan array request, mulai 0.
- Pembulatan dilakukan **per item**, lalu dijumlahkan; total tidak dibulatkan ulang.
- Total maksimal `100000000` cents (1.000.000,00). Di atas itu → `400 VALIDATION_ERROR` dengan `path: "items"`.
- Endpoint ini tidak menyimpan apa pun dan wajib login (`401` tanpa sesi).

---

## `POST /api/proposals`

Membuat proposal (status `draft`). Server menghitung ulang quote dengan aturan yang sama seperti `/api/quotes/calculate` lalu menyimpan proposal dan item-itemnya.

### Request

Semua field `/api/quotes/calculate`, ditambah:

| Field | Tipe | Aturan |
|---|---|---|
| `briefId` | uuid? | brief milik user yang sama |
| `title` | string | 1–200 karakter |
| `summary` | string? | maks 5.000 karakter |
| `clientName` | string? | maks 200 karakter |
| `clientEmail` | string? | email valid |

```json
{
  "briefId": "6c1d4e2f-9a7b-4c2d-8e4f-5a6b3f0e5b8a",
  "title": "Website Company Profile Katering",
  "summary": "Website 5 halaman dengan form kontak dan galeri.",
  "clientName": "Katering Bu Sari",
  "clientEmail": "client@example.com",
  "currency": "USD",
  "hourlyRateCents": 5000,
  "items": [
    { "title": "Desain & layout 5 halaman", "estimatedHours": 10 },
    { "title": "Form kontak", "estimatedHours": 2.5, "hourlyRateCents": 6000 }
  ]
}
```

### Response `201`

```json
{
  "data": {
    "id": "0b8a6c1d-4e2f-4a7b-9c2d-3e4f5a6b3f0e",
    "briefId": "6c1d4e2f-9a7b-4c2d-8e4f-5a6b3f0e5b8a",
    "title": "Website Company Profile Katering",
    "summary": "Website 5 halaman dengan form kontak dan galeri.",
    "clientName": "Katering Bu Sari",
    "clientEmail": "client@example.com",
    "status": "draft",
    "currency": "USD",
    "hourlyRateCents": 5000,
    "items": [
      { "position": 0, "title": "Desain & layout 5 halaman", "description": null, "estimatedHours": 10, "hourlyRateCents": 5000, "amountCents": 50000 },
      { "position": 1, "title": "Form kontak", "description": null, "estimatedHours": 2.5, "hourlyRateCents": 6000, "amountCents": 15000 }
    ],
    "totalHours": 12.5,
    "subtotalCents": 65000,
    "totalCents": 65000,
    "approvedAt": null,
    "paidAt": null,
    "createdAt": "2026-10-25T11:35:00.000Z",
    "updatedAt": "2026-10-25T11:35:00.000Z"
  }
}
```

`status`: `draft` \| `sent` \| `approved` \| `rejected` \| `paid` \| `cancelled`. Status `paid` hanya di-set server setelah capture PayPal terverifikasi.

Error khusus:

- `401 UNAUTHORIZED` tanpa sesi.
- `404 NOT_FOUND` jika `briefId` tidak ada atau bukan milik user (respons sama untuk keduanya).
- `400 VALIDATION_ERROR` jika total melebihi batas quote (`path: "items"`).

Item, nominal, dan total disimpan dari hasil quote engine server, lalu dibaca kembali dari database untuk respons. Server juga membuat token acak untuk link klien (dipakai di tahap persetujuan/pembayaran; tidak dikembalikan di respons ini).

---

## `GET /api/proposals`

Daftar proposal milik user yang sedang login (terbaru dulu) beserta statistik dashboard. Server memfilter berdasarkan sesi; tidak ada parameter untuk memilih user lain.

### Query

| Param | Tipe | Aturan |
|---|---|---|
| `limit` | integer? | 1–100, default 20 |

Parameter lain ditolak `400 VALIDATION_ERROR`. Respons membawa header `Cache-Control: private, no-store`.

### Response `200`

```json
{
  "data": {
    "items": [
      {
        "id": "0b8a6c1d-4e2f-4a7b-9c2d-3e4f5a6b3f0e",
        "title": "Website Company Profile Katering",
        "clientName": "Katering Bu Sari",
        "status": "paid",
        "currency": "USD",
        "totalCents": 65000,
        "createdAt": "2026-10-25T11:35:00.000Z"
      }
    ],
    "stats": {
      "totalProjects": 3,
      "pendingProposals": 1,
      "paidProjects": 1,
      "revenueReceived": [{ "currency": "USD", "amountCents": 65000 }]
    }
  }
}
```

Definisi `stats` (dihitung dari **semua** proposal user, bukan hanya `items` yang dikembalikan):

| Field | Kartu dashboard | Definisi |
|---|---|---|
| `totalProjects` | Total projects | Jumlah semua proposal |
| `pendingProposals` | Pending proposals | Proposal berstatus `sent` (menunggu respons klien) |
| `paidProjects` | Paid projects | Proposal dengan pembayaran PayPal `COMPLETED` yang sudah diverifikasi server |
| `revenueReceived` | Revenue received | Jumlah capture PayPal terverifikasi, **satu entri per mata uang**; nominal beda mata uang tidak pernah dijumlahkan. Array kosong jika belum ada pembayaran |

---

## Alur persetujuan & pembayaran PayPal (🆕 perlu review Frontend)

```
Freelancer (login)                Klien (link /p/<token>, tanpa login)         Server ↔ PayPal
POST /api/proposals/:id/send  →   draft → sent, dapat shareUrl
                                  GET  /api/public/proposals/:token   (lihat)
                                  POST /api/public/proposals/:token/approve    sent → approved
                                  Tombol PayPal JS SDK:
                                    createOrder → POST .../paypal/orders  →   buat order (nominal dari DB)
                                    onApprove   → POST .../paypal/capture →   capture + GET order + verifikasi
                                                                               → payment COMPLETED, proposal paid
```

Aturan keamanan:

- **Nominal tidak pernah dari browser.** `paypal/orders` tidak menerima body; nominal & mata uang diambil dari proposal tersimpan.
- **Redirect/`onApprove` bukan bukti bayar.** Setelah capture, server mengambil ulang order dari PayPal dan mencocokkan order id, `reference_id` (= proposal), `custom_id` (= payment), mata uang, dan nominal order maupun capture. Hanya capture `COMPLETED` yang lolos verifikasi yang menandai proposal `paid`.
- **Tidak ada capture ganda.** Capture memakai `PayPal-Request-Id` yang tetap per pembayaran; capture ulang untuk pembayaran yang sudah selesai langsung mengembalikan hasil tersimpan tanpa memanggil PayPal. Database hanya mengizinkan satu order terbuka dan satu pembayaran selesai per proposal.
- **Rekonsiliasi setelah error jaringan.** Server selalu membaca order dari PayPal sebelum capture. Jika PayPal sudah meng-capture order (misalnya respons capture sebelumnya hilang), server memverifikasi dan mencatatnya **tanpa mengirim capture lagi**. Jadi setelah `502 PAYMENT_PROVIDER_ERROR`, Frontend aman memanggil endpoint capture lagi dengan `orderId` yang sama. Request capture ke PayPal tidak pernah di-retry otomatis; pembacaan order dan pembuatan order di-retry otomatis untuk error sementara.
- Token di link klien adalah rahasia (32 byte acak). Token salah format atau tidak dikenal → `404`. Proposal `draft` tidak bisa dilihat klien.

Frontend butuh `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (client id Sandbox, publik) untuk memuat PayPal JS SDK.

### `POST /api/proposals/:id/send` (login)

Tanpa body. `draft` → `sent` (idempoten untuk `sent`/`approved`/`paid`). `404` jika bukan milik user, `409` jika `rejected`/`cancelled`.

```json
{ "data": { "proposal": { "id": "…", "status": "sent", "…": "…" }, "shareUrl": "http://localhost:3000/p/<token>" } }
```

### `GET /api/public/proposals/:token`

Tampilan klien. Tidak memuat id internal, email klien, atau akun freelancer.

```json
{
  "data": {
    "title": "Website Company Profile Katering",
    "summary": null,
    "clientName": "Katering Bu Sari",
    "freelancerName": null,
    "status": "sent",
    "currency": "USD",
    "items": [{ "position": 0, "title": "Desain & layout 5 halaman", "description": null, "estimatedHours": 10, "hourlyRateCents": 5000, "amountCents": 50000 }],
    "totalHours": 10,
    "subtotalCents": 50000,
    "totalCents": 50000,
    "approvedAt": null,
    "paidAt": null
  }
}
```

### `POST /api/public/proposals/:token/approve`

Tanpa body. `sent` → `approved`. Idempoten untuk `approved`/`paid`; `409` untuk `rejected`/`cancelled`. Respons: tampilan klien seperti di atas.

### `POST /api/public/proposals/:token/paypal/orders`

Tanpa body (body apa pun diabaikan). Proposal harus `approved` (`409` jika belum atau sudah `paid`). Order terbuka yang masih berlaku dipakai ulang. Respons `201`:

```json
{ "data": { "orderId": "5O190127TN364715T", "approveUrl": "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T", "amountCents": 50000, "currency": "USD" } }
```

Untuk tombol PayPal JS SDK, `createOrder` mengembalikan `orderId`.

### `POST /api/public/proposals/:token/paypal/capture`

```json
{ "orderId": "5O190127TN364715T" }
```

Respons `200`:

```json
{ "data": { "paymentStatus": "completed", "proposalStatus": "paid", "orderId": "5O190127TN364715T", "captureId": "3C679366HH908993F", "amountCents": 50000, "currency": "USD", "paidAt": "2026-10-25T12:00:00.000Z" } }
```

- `paymentStatus: "pending"` → PayPal menerima capture tetapi belum selesai; proposal tetap `approved`, tampilkan "pembayaran diproses".
- `404` jika order bukan milik proposal ini; `409 PAYMENT_NOT_APPROVED`; `422 PAYMENT_DECLINED`; `502 PAYMENT_PROVIDER_ERROR` (aman untuk dicoba ulang kecuali pesannya menyebut "flagged for review").

---

## Keputusan yang disepakati ([issue #2](https://github.com/ihwankrn/niagora-ai/issues/2))

1. Nama field kategori layanan adalah `serviceType`, dengan nilai lowercase sesuai opsi form.
2. Semua nominal uang memakai integer cents. Frontend mengonversi input dan memformat tampilan, server menghitung ulang semua nilai finansial, dan mata uang divalidasi sesuai dukungan PayPal.
3. Nama field pertanyaan adalah `clarificationQuestions`, mengikuti `src/types/analysis.ts`.
4. Total jam bernama `totalEstimatedHours` dan dihitung server.
5. Deliverable final selalu memiliki `id` UUID dari server, `title`, `description`, dan `estimatedHours`. Pekerjaan yang belum bisa diestimasi secara wajar ditanyakan lewat `clarificationQuestions`.
6. `GET /api/proposals` masuk MVP: daftar proposal dan statistik dashboard, revenue dipisah per mata uang dan hanya dari pembayaran terverifikasi, data dibatasi milik user yang login.
