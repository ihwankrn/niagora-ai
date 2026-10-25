/**
 * Kontrak tipe sementara untuk integrasi respons analisis AI pada brief klien.
 * Digunakan sebagai acuan koordinasi antara tim Frontend dan Backend.
 *
 * Catatan:
 * - Belum memuat penetapan harga final/rate karena belum disepakati dengan tim Backend.
 * - Nilai dan struktur ini bersifat sementara dan disesuaikan saat endpoint AI tersedia.
 */

export interface DeliverableItem {
  id: string;
  title: string;
  description: string;
  estimatedHours?: number;
}

export interface AnalysisResult {
  deliverables: DeliverableItem[];
  clarificationQuestions: string[];
  assumptions: string[];
  estimatedHours: number;
}
