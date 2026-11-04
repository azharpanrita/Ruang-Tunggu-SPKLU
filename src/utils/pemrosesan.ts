/**
 * File: src/utils/pemrosesan.ts
 * Modul Pemrosesan Data (Data Cleaning Pipeline 6 Tahap, Perhitungan Rumus Energi,
 * Agregasi Jam/Hari/Bulan, dan Evaluasi Deterministik 6 Skenario Uji).
 *
 * Catatan untuk pemula:
 * - File ini menyediakan seluruh fungsi pembersihan data (validasi kolom, deteksi unavailable,
 *   deteksi outlier, hapus duplikat, interpolasi nilai kosong, serta agregasi per jam, hari, dan bulan).
 * - Juga mengekspor fungsi evaluasi 6 skenario uji dengan status 3 nilai (LULUS / GAGAL / TIDAK DIUJI).
 */

export * from "./dataProcessor";

import { MonthlyEnergyRecord } from "../data/dataSource";
import { DataQualitySummary } from "./dataProcessor";

export interface MonthlyAggregationView {
  periodKey: string;
  label: string;
  fullLabel: string;
  totalKwh: number;
  acKwh: number;
  nonAcKwh: number;
  avgDailyKwh: number;
  costRp: number;
}

/**
 * Mengonversi riwayat bulanan 36 bulan menjadi tabel agregasi bulanan untuk Tahap 6 Data Processing.
 */
export function buildMonthlyAggregationView(
  monthlyRecords: MonthlyEnergyRecord[],
  tariffPerKwh: number
): MonthlyAggregationView[] {
  return monthlyRecords.map((m) => ({
    periodKey: m.periodKey,
    label: m.label,
    fullLabel: m.fullLabel,
    totalKwh: m.kwh,
    acKwh: m.acKwh,
    nonAcKwh: m.nonAcKwh,
    avgDailyKwh: m.avgDailyKwh,
    costRp: Math.round(m.kwh * tariffPerKwh),
  }));
}

/**
 * Menghitung Skor Kualitas Data (0–100) beserta jumlah baris yang dibuang (duplikat)
 * dan jumlah baris/sel yang diperbaiki (interpolasi + perbaikan outlier).
 */
export function calculateDataQualityScore(quality: DataQualitySummary): {
  score: number;
  gradeLabel: string;
  rowsDiscarded: number;
  cellsRepaired: number;
} {
  const rowsDiscarded = quality.duplicateCount;
  const cellsRepaired = quality.missingValueCount + quality.outlierCount;

  // Skor dasar dari validPercentage, ditambah bonus kelengkapan kolom
  const baseScore = quality.columnsValid ? quality.validPercentage : quality.validPercentage - 25;
  const score = Number(Math.max(0, Math.min(100, baseScore)).toFixed(1));

  let gradeLabel = "Sangat Baik (Siap Analitik)";
  if (score < 85) gradeLabel = "Perlu Pembersihan";
  else if (score < 95) gradeLabel = "Baik (Setelah Interpolasi)";

  return {
    score,
    gradeLabel,
    rowsDiscarded,
    cellsRepaired,
  };
}
