# Niagora AI — Kontrak API (v1, draft)

Dokumen ini adalah kesepakatan request/response antara Frontend dan Backend.
Sumber kebenaran ada di Zod schema [`src/lib/contracts/`](../src/lib/contracts/); tipe TypeScript bisa diimpor langsung dari sana:

```ts
import type { AnalyzeBriefResponse } from "@/lib/contracts/briefs";
import type { Quote, CalculateQuoteRequest } from "@/lib/contracts/quotes";
import type { Proposal, CreateProposalRequest } from "@/lib/contracts/proposals";
import type { ApiErrorBody } from "@/lib/contracts/errors";
```

Status implementasi:

| Endpoint | Kontrak | Implementasi |
|---|---|---|
| `POST /api/briefs/analyze` | ✅ draft | Tahap 4 |
| `POST /api/quotes/calculate` | ✅ draft | Tahap 5 |
| `POST /api/proposals` | ✅ draft | Tahap 6 |
| `GET /api/proposals/:id` | rencana | Tahap 6 |
| Endpoint PayPal | rencana | Tahap 7 |

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
| 502 | `PAYMENT_PROVIDER_ERROR` | PayPal API gagal |
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
        { "title": "Desain & layout 5 halaman", "description": "Home, Tentang, Menu, Galeri, Kontak", "estimatedHours": 10 },
        { "title": "Form kontak", "description": "Validasi dan notifikasi email", "estimatedHours": 3 },
        { "title": "Galeri foto", "description": "Grid responsif dengan lightbox", "estimatedHours": 4.5 }
      ],
      "clarifyingQuestions": ["Apakah konten dan foto sudah disediakan klien?"],
      "assumptions": ["Hosting dan domain disediakan klien."]
    },
    "totalEstimatedHours": 17.5,
    "createdAt": "2026-10-25T11:30:00.000Z"
  }
}
```

Batas: `deliverables` 1–30 item, `clarifyingQuestions` dan `assumptions` maks 15 item. `totalEstimatedHours` dihitung server.

Error khusus: `502 AI_UNAVAILABLE`.

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

Error khusus: `404 NOT_FOUND` jika `briefId` tidak ada atau bukan milik user.

---

## Pertanyaan terbuka untuk Frontend

1. Nama field `serviceType` (bukan `service`) dan nilai lowercase sesuai opsi form — OK?
2. Tarif diinput dalam satuan mata uang di UI lalu dikonversi ke cents sebelum dikirim — OK?
3. Perlu endpoint daftar proposal (`GET /api/proposals`) untuk kartu statistik dashboard di MVP?
