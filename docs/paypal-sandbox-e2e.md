# Panduan uji manual PayPal Sandbox E2E

Panduan ini menguji alur nyata melawan PayPal Sandbox: membuat order, capture, lalu capture ulang. Referensi kontrak lengkap ada di [`api.md`](api.md).

**Backend hanya bisa memakai Sandbox.** Host PayPal Live tidak ada di kode, dan nilai `PAYPAL_ENVIRONMENT` selain `sandbox` ditolak sebelum request apa pun dikirim. Pembeli harus memakai akun **Sandbox Personal**, bukan akun PayPal asli.

## Prasyarat

1. File `.env` di worktree ini berisi:
   - `DATABASE_URL`, `DIRECT_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `PAYPAL_ENVIRONMENT="sandbox"`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` dari Sandbox app
   - `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, nilainya harus sama dengan `PAYPAL_CLIENT_ID`. Tombol PayPal di browser memakai nilai ini, dan perubahannya baru berlaku setelah server di-restart
   - `APP_BASE_URL="http://localhost:3000"`
2. Migrasi `20261103*` sudah diterapkan, karena Prisma membaca kolom `payments.review_reason`. Cek statusnya (hanya membaca):

   ```bash
   npx prisma migrate status
   ```

   Jika masih ada migrasi tertunda, terapkan dulu dengan persetujuan pemilik database. Panduan ini tidak menjalankan migrasi.
3. **Site URL** di Supabase (Dashboard → Authentication → URL Configuration) mengarah ke origin aplikasi, karena link konfirmasi email kembali ke sana lalu diteruskan ke `/auth/callback`.
4. Ada user uji di Supabase (Dashboard → Authentication → Users → Add user, centang auto confirm) dan akun Sandbox Personal (developer.paypal.com → Testing Tools → Sandbox Accounts).
5. Server berjalan di terminal lain:

   ```bash
   npm run dev
   ```

Jalankan semua perintah di bawah dalam **satu terminal yang sama**, karena nilainya disimpan di variabel shell. Perlu `curl` dan `jq`.

## Langkah

### 0. Ambil cookie sesi freelancer

Panduan curl ini mengambil cookie dengan skrip. Untuk uji lewat browser, masuk lewat halaman `/login`. Cookie ini adalah sesi aktif: jangan dibagikan atau di-commit.

```bash
read -rs "TEST_USER_PASSWORD?Password user uji: " && export TEST_USER_PASSWORD
```

(Di bash, pakai `read -rsp "Password user uji: " TEST_USER_PASSWORD && export TEST_USER_PASSWORD`.)

```bash
export COOKIE="$(TEST_USER_EMAIL='user-uji@example.com' npm run -s sandbox:cookie)"
```

```bash
export BASE=http://localhost:3000
```

### 1. Buat proposal USD 1,00

```bash
export PROPOSAL_ID="$(curl -sS -X POST "$BASE/api/proposals" -H 'content-type: application/json' -H "Cookie: $COOKIE" -d '{"title":"Sandbox E2E","currency":"USD","hourlyRateCents":100,"items":[{"title":"Item uji","estimatedHours":1}]}' | jq -r '.data.id')" && echo "$PROPOSAL_ID"
```

Harapan: tercetak UUID. Jika `null`, ulangi tanpa `jq` untuk melihat errornya.

### 2. Kirim proposal dan ambil token klien

```bash
export TOKEN="$(curl -sS -X POST "$BASE/api/proposals/$PROPOSAL_ID/send" -H "Cookie: $COOKIE" | jq -r '.data.shareUrl' | sed 's#.*/##')" && echo "${#TOKEN}"
```

Harapan: tercetak `43`, yaitu panjang token. Token adalah rahasia link klien.

### 3. Setujui proposal sebagai klien

```bash
curl -sS -X POST "$BASE/api/public/proposals/$TOKEN/approve" | jq '.data | {status, totalCents, currency}'
```

Harapan: `status` `approved`, `totalCents` `100`, `currency` `USD`.

### 4. Inisiasi order pembayaran

Body berikut sengaja mencoba mengganti nominal.

```bash
export ORDER_ID="$(curl -sS -X POST "$BASE/api/public/proposals/$TOKEN/paypal/orders" -H 'content-type: application/json' -d '{"amountCents":1,"currency":"EUR"}' | tee /dev/stderr | jq -r '.data.orderId')"
```

Harapan: respons `201` berisi `orderId`, `approveUrl`, `amountCents: 100`, `currency: "USD"`. Nominal dari body diabaikan.

Ulangi perintah yang sama. `orderId` harus **sama**, karena order terbuka dipakai ulang, bukan dibuat baru.

### 5. Setujui sebagai pembeli

Buka `approveUrl` dari langkah 4 di browser, login dengan akun Sandbox Personal, lalu setujui pembayaran. Halaman boleh tidak kembali ke aplikasi, karena order ini dirancang untuk tombol PayPal JS SDK dan tidak punya `return_url`.

### 6. Capture order

```bash
curl -sS -X POST "$BASE/api/public/proposals/$TOKEN/paypal/capture" -H 'content-type: application/json' -d "{\"orderId\":\"$ORDER_ID\"}" | tee capture-1.json | jq
```

Harapan (`200`):

```json
{ "data": { "paymentStatus": "completed", "proposalStatus": "paid", "orderId": "…", "captureId": "…", "amountCents": 100, "currency": "USD", "paidAt": "…" } }
```

### 7. Pastikan proposal `PAID` dan payment `COMPLETED`

Jalankan di Supabase SQL Editor (hanya membaca), dengan id dari langkah 1:

```sql
select pr.status as proposal_status, pr.paid_at, p.status as payment_status,
       p.paypal_capture_id, p.verified_at, p.amount_cents, p.currency, p.updated_at
from proposals pr join payments p on p.proposal_id = pr.id
where pr.id = '<PROPOSAL_ID>';
```

Harapan: **satu baris**, dengan `proposal_status = PAID`, `payment_status = COMPLETED`, serta `paypal_capture_id`, `verified_at`, dan `paid_at` terisi. Catat `updated_at`.

### 8. Capture duplikat (idempotensi)

```bash
curl -sS -X POST "$BASE/api/public/proposals/$TOKEN/paypal/capture" -H 'content-type: application/json' -d "{\"orderId\":\"$ORDER_ID\"}" | tee capture-2.json | jq
```

```bash
diff capture-1.json capture-2.json && echo "IDENTIK"
```

Harapan:
- Respons `200` dan `IDENTIK`.
- Query langkah 7 tetap satu baris, dengan `updated_at` tidak berubah.
- Di dashboard Sandbox hanya ada **satu** transaksi USD 1,00.

Hapus `capture-1.json` dan `capture-2.json` setelah selesai.

### 9. Penjagaan setelah lunas

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/public/proposals/$TOKEN/paypal/orders"
```

Harapan: `409`, karena proposal sudah dibayar.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/public/proposals/$TOKEN/paypal/capture" -H 'content-type: application/json' -d '{"orderId":"9ZZ99999ZZ999999Z"}'
```

Harapan: `404`, karena order itu bukan milik proposal ini.

## Alur klien di browser

Setelah langkah 0–2, sisanya bisa diuji lewat halaman klien, sebagai pengganti langkah 3–6:

1. Cetak link klien, lalu buka di browser:

   ```bash
   echo "$BASE/proposals/view/$TOKEN"
   ```

2. Tekan **Setujui Proposal**. Tombol PayPal muncul setelah status menjadi `approved`.
3. Bayar lewat tombol PayPal dengan akun Sandbox Personal. Harapan: halaman menampilkan "Pembayaran telah dikonfirmasi". Lanjutkan dengan langkah 7 dan 8. `ORDER_ID` untuk langkah 8 bisa dilihat di kolom `paypal_order_id` tabel `payments`.
4. Muat ulang halaman. Harapan: status tetap `paid` dan tombol PayPal tidak muncul.

Jika tab tertutup setelah capture, status tercatat saat webhook `PAYMENT.CAPTURE.COMPLETED` tiba, atau saat klien membuka link lagi dan menekan tombol PayPal; server menolak order baru dan halaman menampilkan status `paid`. Webhook butuh URL publik dan `PAYPAL_WEBHOOK_ID`, jadi di localhost hanya jalur kedua yang berjalan.

## Postman

Pakai method, URL, dan body yang sama dengan curl di atas.

| Langkah | Request | Header tambahan |
|---|---|---|
| 1 | `POST /api/proposals` | `Cookie: <nilai COOKIE>` |
| 2 | `POST /api/proposals/{id}/send` | `Cookie: <nilai COOKIE>` |
| 3 | `POST /api/public/proposals/{token}/approve` | — |
| 4 | `POST /api/public/proposals/{token}/paypal/orders` | — |
| 6, 8 | `POST /api/public/proposals/{token}/paypal/capture` | — |

Simpan `id`, `token`, dan `orderId` sebagai variabel environment Postman. Matikan cookie jar otomatis agar cookie tidak tercampur.

## Jika hasilnya berbeda

| Gejala | Arti | Tindakan |
|---|---|---|
| `502 PAYMENT_PROVIDER_ERROR` saat capture | PayPal gagal menjawab, koneksi putus, atau status gagal disimpan | **Jangan buat order baru.** Periksa order di dashboard Sandbox, lalu ulangi langkah 6 dengan `orderId` yang sama. Server membaca order lebih dulu, jadi tidak ada capture ganda |
| `502` saat order dibuat, log `PayPal Live is disabled` | `PAYPAL_ENVIRONMENT` bukan `sandbox` | Perbaiki `.env`, restart server |
| `409 PAYMENT_NOT_APPROVED` | Pembeli belum menyetujui | Selesaikan langkah 5 |
| `409 CONFLICT` "needs review" | Ada payment `REVIEW` dan order di PayPal belum `COMPLETED`, atau PayPal tidak terbaca; order baru diblokir | Lihat `review_reason` di tabel `payments`, lalu coba capture ulang dengan `orderId` lama |
| `500 INTERNAL_ERROR` | Database tidak terjangkau, atau migrasi belum diterapkan | Lihat log server. Jangan membuat order baru sebelum status order di PayPal dipastikan |
| `401 UNAUTHORIZED` di langkah 1–2 | Cookie kosong atau kedaluwarsa | Ulangi langkah 0 |

## Yang tidak dicakup panduan ini

- Webhook nyata, karena butuh URL publik yang terdaftar di PayPal. Verifikasi tanda tangan dan rekonsiliasinya diuji dengan mock.
- Status `REVIEW` dan kegagalan database tidak bisa dipicu dengan aman lewat alur nyata. Keduanya diuji di `payment-flow.test.ts` dan `service.test.ts`.
- Invarian PostgreSQL (index unik, capture bersamaan) diuji lewat `npm run test:integration`; lihat [`api.md`](api.md#pengujian-integrasi-postgresql).
