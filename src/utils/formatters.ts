/**
 * File: src/utils/formatters.ts
 * Fungsi pembantu untuk memformat angka, mata uang Rupiah, dan tanggal
 * sesuai standar Bahasa Indonesia (koma untuk desimal dan titik untuk ribuan).
 */

/**
 * Memformat angka menggunakan format Indonesia (koma desimal, titik ribuan).
 * Contoh: 1234.56 -> "1.234,56"
 */
export function formatAngka(
  nilai: number | string | null | undefined,
  desimal: number = 1
): string {
  if (
    nilai === null ||
    nilai === undefined ||
    nilai === "unavailable" ||
    nilai === ""
  ) {
    return "Tidak tersedia";
  }
  const num = typeof nilai === "string" ? parseFloat(nilai) : nilai;
  if (isNaN(num)) {
    return "Tidak tersedia";
  }
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: desimal,
    maximumFractionDigits: desimal,
  }).format(num);
}

/**
 * Memformat angka bulat ribuan dengan titik (tanpa desimal).
 * Contoh: 1200 -> "1.200"
 */
export function formatBulat(nilai: number | string | null | undefined): string {
  return formatAngka(nilai, 0);
}

/**
 * Memformat angka ke dalam mata uang Rupiah (Rp) standar Indonesia.
 * Contoh: 245000 -> "Rp 245.000"
 */
export function formatRupiah(
  nilai: number | string | null | undefined,
  desimal: number = 0
): string {
  if (nilai === null || nilai === undefined || nilai === "") return "Rp 0";
  const num = typeof nilai === "string" ? parseFloat(nilai) : nilai;
  if (isNaN(num)) return "Rp 0";
  return `Rp ${new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: desimal,
    maximumFractionDigits: desimal,
  }).format(num)}`;
}

/**
 * Memformat tanggal YYYY-MM-DD menjadi label Bahasa Indonesia yang mudah dibaca.
 * Contoh: "2026-10-01" -> "1 Okt 2026"
 */
export function formatTanggalIndo(dateStr: string): string {
  const bulanIndo = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agu",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const tahun = parts[0];
  const bulanIdx = parseInt(parts[1], 10) - 1;
  const hari = parseInt(parts[2], 10);
  return `${hari} ${bulanIndo[bulanIdx] || parts[1]} ${tahun}`;
}
