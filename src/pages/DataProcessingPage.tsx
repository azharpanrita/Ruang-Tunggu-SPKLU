/**
 * File: src/pages/DataProcessingPage.tsx
 * Menu 2: Data Processing (Pemrosesan Data 6 Tahap & Perhitungan Energi)
 *
 * Catatan untuk pemula:
 * - Menampilkan alur pembersihan data (Data Cleaning Pipeline) dari Tahap 1 sampai Tahap 6
 *   dengan tampilan gelap bergaya kaca (glassmorphism) sesuai acuan desain contoh dosen.
 * - Setiap tahap menampilkan jumlah data berubah dan perbandingan tabel Sebelum vs Sesudah.
 * - Tahap 6 mendukung pilihan tampilan agregasi per Jam, per Hari, dan per Bulan (36 bulan).
 * - Dilengkapi Skor Kualitas Data, jumlah baris dibuang (duplikat), jumlah sel diperbaiki,
 *   durasi node offline, perhitungan energi Manual vs Auto, unggah CSV, dan unduh CSV bersih.
 */

import React, { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { TelemetryRow } from "../data/dummyGenerator";
import { MonthlyEnergyRecord } from "../data/dataSource";
import {
  REQUIRED_COLUMNS,
  CleanedTelemetryRow,
  DataQualitySummary,
  DailyAggregation,
  HourlyAggregation,
  EnergyComparisonResult,
  exportRowsToCsv,
  parseCsvToTelemetryRows,
  buildMonthlyAggregationView,
  calculateDataQualityScore,
} from "../utils/pemrosesan";
import {
  formatAngka,
  formatBulat,
  formatTanggalIndo,
  formatRupiah,
} from "../utils/formatters";
import { HaIcon, HA_ICONS } from "../config/appConfig";

interface DataProcessingPageProps {
  rawRows: TelemetryRow[];
  cleanedRows: CleanedTelemetryRow[];
  quality: DataQualitySummary;
  dailyStats: DailyAggregation[];
  hourlyStats: HourlyAggregation[];
  energyComparison: EnergyComparisonResult;
  monthly36Records: MonthlyEnergyRecord[];
  tariffPerKwh: number;
  onUploadCustomData: (rows: TelemetryRow[], fileName: string) => void;
  onResetDefaultData: () => void;
  activeDatasetName: string;
}

export const DataProcessingPage: React.FC<DataProcessingPageProps> = ({
  rawRows,
  cleanedRows,
  quality,
  dailyStats,
  hourlyStats,
  energyComparison,
  monthly36Records,
  tariffPerKwh,
  onUploadCustomData,
  onResetDefaultData,
  activeDatasetName,
}) => {
  // Tahap aktif pada stepper (1 s/d 6)
  const [activeStep, setActiveStep] = useState<number>(1);
  // Pilihan tampilan agregasi pada Tahap 6 (Jam / Hari / Bulan)
  const [aggView, setAggView] = useState<"HOURLY" | "DAILY" | "MONTHLY">(
    "DAILY"
  );
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Skor kualitas data + baris dibuang + sel diperbaiki
  const qualityMetrics = useMemo(
    () => calculateDataQualityScore(quality),
    [quality]
  );

  // Agregasi bulanan dari 36 bulan
  const monthlyAggregates = useMemo(
    () => buildMonthlyAggregationView(monthly36Records, tariffPerKwh),
    [monthly36Records, tariffPerKwh]
  );

  // Daftar definisi 6 tahap pembersihan data
  const steps = [
    {
      step: 1,
      title: "1. Validasi Kolom",
      subtitle: `${REQUIRED_COLUMNS.length} tag wajib`,
      badge: quality.columnsValid ? "Lengkap 100%" : "Kolom Kurang",
      statusOk: quality.columnsValid,
      description:
        "Memastikan seluruh 15 kolom tag telemetri (T_R, RH_R, L_R, C_R, OCC, DOOR, AUTO, SERVICE, B_L, AC_CMD, FAN_CMD, P_A, E_A, P_B) tersedia pada dataset.",
    },
    {
      step: 2,
      title: "2. Deteksi Unavailable",
      subtitle: "Nilai hilang / NaN",
      badge: `${formatBulat(quality.missingValueCount)} sel`,
      statusOk: true,
      description:
        'Mendeteksi baris sensor yang bernilai kosong, NaN, atau "unavailable" ketika simulasi sensor dicabut atau kehilangan komunikasi I2C/UART.',
    },
    {
      step: 3,
      title: "3. Deteksi Outlier Fisik",
      subtitle: "Di luar batas wajar",
      badge: `${formatBulat(quality.outlierCount)} titik`,
      statusOk: true,
      description:
        "Menyaring lonjakan angka di luar batas fisik ruang tunggu (T_R di luar 15–40 °C, RH_R di luar 0–100%, C_R di luar 400–5.000 ppm, L_R < 0 atau > 2.000 lux, P_B > P_A).",
    },
    {
      step: 4,
      title: "4. Hapus Duplikat Waktu",
      subtitle: "Timestamp ganda",
      badge: `${formatBulat(quality.duplicateCount)} baris`,
      statusOk: true,
      description:
        "Menghapus pengiriman pesan MQTT/Home Assistant ganda yang memiliki stempel waktu (timestamp) identik agar integrasi energi tidak terhitung dua kali.",
    },
    {
      step: 5,
      title: "5. Interpolasi Nilai Kosong",
      subtitle: "Linear / Forward-fill",
      badge: `${formatBulat(
        quality.missingValueCount + quality.outlierCount
      )} diperbaiki`,
      statusOk: true,
      description:
        "Mengisi sel yang hilang atau terkena outlier memakai interpolasi linier antar-titik valid serta menjamin konstrain fisik CTB <= CTA (P_B <= P_A).",
    },
    {
      step: 6,
      title: "6. Agregasi Jam / Hari / Bulan",
      subtitle: "Ringkasan multi-skala",
      badge: `${hourlyStats.length} jam | ${dailyStats.length} hr | ${monthlyAggregates.length} bln`,
      statusOk: true,
      description:
        "Mengelompokkan sampel bersih menjadi statistik per jam, per hari (14 hari), dan per bulan (36 bulan) untuk kebutuhan analitik serta prediktor.",
    },
  ];

  // Ambil sampel baris yang terkena masalah untuk ditampilkan pada tabel "Sebelum vs Sesudah"
  const problematicSamplePairs = useMemo(() => {
    const pairs: { raw: TelemetryRow; clean: CleanedTelemetryRow }[] = [];
    const cleanMap = new Map(cleanedRows.map((c) => [c.timestamp, c]));

    for (const r of rawRows) {
      const c = cleanMap.get(r.timestamp);
      if (!c) continue;
      if (activeStep === 2 && c.wasInterpolated) {
        pairs.push({ raw: r, clean: c });
      } else if (activeStep === 3 && c.wasOutlierFixed) {
        pairs.push({ raw: r, clean: c });
      } else if (activeStep === 5 && (c.wasInterpolated || c.wasOutlierFixed)) {
        pairs.push({ raw: r, clean: c });
      }
      if (pairs.length >= 8) break;
    }

    if (pairs.length === 0) {
      for (let i = 0; i < Math.min(8, cleanedRows.length); i++) {
        pairs.push({ raw: rawRows[i], clean: cleanedRows[i] });
      }
    }
    return pairs;
  }, [rawRows, cleanedRows, activeStep]);

  // Handler unggah file CSV
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result || "");
        const parsed = parseCsvToTelemetryRows(text);
        if (parsed.length < 5) {
          setUploadError(
            "File CSV terlalu pendek atau format kolom tidak sesuai standar Smart Room."
          );
          return;
        }
        onUploadCustomData(parsed, file.name);
      } catch (err: any) {
        setUploadError(
          err?.message ||
            "Gagal membaca file CSV. Pastikan pemisah koma (,) dan header sesuai."
        );
      }
    };
    reader.readAsText(file);
  };

  // Handler unduh CSV bersih
  const handleDownloadCsv = () => {
    const csvContent = exportRowsToCsv(cleanedRows);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "smart_room_spklu_up3_cleaned.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Data grafik perbandingan harian Manual vs Auto
  const dailyChartData = dailyStats.map((d) => ({
    name: `H-${d.dayIndex} (${d.modeLabel === "MANUAL" ? "Man" : "Auto"})`,
    totalKwh: d.energyTotalKwh,
    acKwh: d.energyAcKwh,
    nonAcKwh: d.energyOtherKwh,
    occHours: d.occupancyHours,
  }));

  return (
    <div className="space-y-6 pb-10">
      {/* Header Halaman + Tombol Unggah & Unduh CSV */}
      <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5 sm:p-6 shadow-xl flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-teal-500/15 text-teal-300 border border-teal-500/30 uppercase tracking-wider">
              <HaIcon path={HA_ICONS.database} size={14} />
              Menu 2 • Data Processing
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Sumber: {activeDatasetName}
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mt-2">
            Alur Pembersihan Data (6 Tahap) & Evaluasi Energi
          </h2>
          <p className="text-sm text-slate-300 mt-1">
            Memvalidasi kualitas telemetri sensor sebelum dihitung dengan rumus
            energi{" "}
            <span className="font-mono text-amber-300">
              E = Σ(P × Δt) / 1.000
            </span>{" "}
            dan dimasukkan ke model Prediktor.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-slate-100 border border-white/15 transition">
            <HaIcon path={HA_ICONS.upload} size={16} className="text-sky-400" />
            <span>Unggah CSV</span>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          {activeDatasetName !== "Generator Seeded 14 Hari (Default)" && (
            <button
              onClick={onResetDefaultData}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition"
            >
              Reset ke Data Default
            </button>
          )}

          <button
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-semibold bg-teal-500 hover:bg-teal-400 text-slate-950 shadow-lg shadow-teal-500/20 transition"
          >
            <HaIcon path={HA_ICONS.download} size={16} />
            <span>Unduh CSV Bersih</span>
          </button>
        </div>
      </div>

      {uploadError && (
        <div className="bg-rose-500/15 border border-rose-500/40 rounded-2xl p-4 flex items-center gap-3 text-rose-200 text-sm">
          <HaIcon
            path={HA_ICONS.alert}
            size={20}
            className="text-rose-400 shrink-0"
          />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Ringkasan Kualitas Data (Skor Kualitas, Baris Dibuang, Sel Diperbaiki, Durasi Offline) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            SKOR KUALITAS DATA
          </span>
          <div className="text-3xl font-extrabold text-teal-400 font-mono mt-2">
            {formatAngka(qualityMetrics.score, 1)}%
          </div>
          <p className="text-xs text-slate-300 mt-1">
            {qualityMetrics.gradeLabel}
          </p>
        </div>

        <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            SAMPEL MENTAH → BERSIH
          </span>
          <div className="text-2xl font-extrabold text-white font-mono mt-2">
            {formatBulat(quality.totalRawRows)} →{" "}
            <span className="text-sky-400">
              {formatBulat(quality.totalCleanRows)}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            14 hari interval 5m + episode 1m
          </p>
        </div>

        <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            BARIS DIBUANG (DUPLIKAT)
          </span>
          <div className="text-3xl font-extrabold text-amber-400 font-mono mt-2">
            {formatBulat(qualityMetrics.rowsDiscarded)}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Baris timestamp ganda dihapus
          </p>
        </div>

        <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            SEL DATA DIPERBAIKI
          </span>
          <div className="text-3xl font-extrabold text-purple-400 font-mono mt-2">
            {formatBulat(qualityMetrics.cellsRepaired)}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {formatBulat(quality.missingValueCount)} unavailable +{" "}
            {formatBulat(quality.outlierCount)} outlier
          </p>
        </div>

        <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            DURASI NODE OFFLINE
          </span>
          <div className="text-2xl font-extrabold text-rose-400 font-mono mt-2">
            {formatBulat(quality.totalOfflineMinutes)} mnt
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Node A: {formatBulat(quality.nodeAOfflineMinutes)}m • Node B:{" "}
            {formatBulat(quality.nodeBOfflineMinutes)}m
          </p>
        </div>
      </div>

      {/* Stepper Interaktif 6 Tahap Pembersihan Data */}
      <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-teal-400">
              PIPELINE PEMROSESAN BERTAHAP
            </span>
            <h3 className="text-lg font-bold text-white mt-0.5">
              Klik Tahap 1–6 untuk Melihat Detail Sebelum & Sesudah Pembersihan
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            Tahap aktif:{" "}
            <strong className="text-white">Tahap {activeStep}</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {steps.map((s) => {
            const isSelected = activeStep === s.step;
            return (
              <button
                key={s.step}
                onClick={() => setActiveStep(s.step)}
                className={`text-left p-4 rounded-2xl border transition-all ${
                  isSelected
                    ? "bg-gradient-to-br from-teal-500/25 to-sky-500/15 border-teal-400/60 shadow-lg shadow-teal-500/10"
                    : "bg-white/5 border-white/10 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
                      isSelected
                        ? "bg-teal-400 text-slate-950"
                        : "bg-white/10 text-slate-300"
                    }`}
                  >
                    {s.step}
                  </span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white/10 text-amber-300">
                    {s.badge}
                  </span>
                </div>
                <div className="font-semibold text-sm text-white mt-2.5">
                  {s.title.replace(/^\d+\.\s*/, "")}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{s.subtitle}</div>
              </button>
            );
          })}
        </div>

        {/* Panel Penjelasan & Bukti Sebelum/Sesudah untuk Tahap yang Dipilih */}
        <div className="mt-6 bg-[#050B18]/70 rounded-2xl border border-white/10 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-white/10">
            <div>
              <h4 className="text-base font-bold text-teal-300">
                {steps[activeStep - 1].title}
              </h4>
              <p className="text-xs sm:text-sm text-slate-300 mt-1">
                {steps[activeStep - 1].description}
              </p>
            </div>
            <div className="shrink-0">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono bg-teal-500/15 text-teal-300 border border-teal-500/30">
                <HaIcon path={HA_ICONS.checkCircle} size={14} />
                {steps[activeStep - 1].badge}
              </span>
            </div>
          </div>

          {/* Konten Spesifik Tahap 1: Daftar 15 Kolom */}
          {activeStep === 1 && (
            <div className="mt-4">
              <p className="text-xs text-slate-400 mb-3">
                Daftar pemeriksaan kelengkapan kolom wajib pada dataset:
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                {REQUIRED_COLUMNS.map((col: string) => {
                  const isPresent = quality.detectedColumns.includes(col);
                  return (
                    <div
                      key={col}
                      className={`px-3 py-2 rounded-xl border flex items-center justify-between text-xs font-mono ${
                        !isPresent
                          ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                          : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                      }`}
                    >
                      <span>{col}</span>
                      <span>{isPresent ? "OK" : "HILANG"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Konten Spesifik Tahap 2, 3, 4, 5: Tabel Perbandingan Sebelum vs Sesudah */}
          {activeStep >= 2 && activeStep <= 5 && (
            <div className="mt-4 overflow-x-auto">
              <p className="text-xs text-slate-400 mb-3">
                Contoh perbandingan baris data <strong>SEBELUM (Mentah)</strong>{" "}
                dan <strong>SESUDAH (Bersih)</strong> pada tahap ini:
              </p>
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400 uppercase">
                    <th className="py-2.5 px-3">Waktu</th>
                    <th className="py-2.5 px-3">T_R (Mentah → Bersih)</th>
                    <th className="py-2.5 px-3">L_R Lux (Mentah → Bersih)</th>
                    <th className="py-2.5 px-3">C_R CO₂ (Mentah → Bersih)</th>
                    <th className="py-2.5 px-3">P_A / P_B (Mentah → Bersih)</th>
                    <th className="py-2.5 px-3">Status Perbaikan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-mono">
                  {problematicSamplePairs.map(({ raw, clean }, idx) => (
                    <tr key={idx} className="hover:bg-white/5">
                      <td className="py-2.5 px-3 text-slate-300">
                        {formatTanggalIndo(clean.timestamp)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-amber-300">{String(raw.T_R)}</span>
                        {" → "}
                        <span className="text-teal-300">
                          {formatAngka(clean.T_R, 1)} °C
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-amber-300">{String(raw.L_R)}</span>
                        {" → "}
                        <span className="text-teal-300">
                          {formatBulat(clean.L_R)} lx
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-amber-300">{String(raw.C_R)}</span>
                        {" → "}
                        <span className="text-teal-300">
                          {formatBulat(clean.C_R)} ppm
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-slate-400">
                          {String(raw.P_A)}/{String(raw.P_B)}
                        </span>
                        {" → "}
                        <span className="text-sky-300">
                          {formatBulat(clean.P_A)}W / {formatBulat(clean.P_B)}W
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {clean.wasInterpolated && (
                          <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 mr-1">
                            Interpolasi
                          </span>
                        )}
                        {clean.wasOutlierFixed && (
                          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            Outlier Diperbaiki
                          </span>
                        )}
                        {!clean.wasInterpolated && !clean.wasOutlierFixed && (
                          <span className="text-emerald-400">Normal Valid</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Konten Spesifik Tahap 6: Pilihan Agregasi Jam / Hari / Bulan */}
          {activeStep === 6 && (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-300">
                  Pilih resolusi waktu agregasi untuk melihat hasil
                  pengelompokan:
                </p>
                <div className="inline-flex rounded-xl bg-white/5 p-1 border border-white/10">
                  <button
                    onClick={() => setAggView("HOURLY")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      aggView === "HOURLY"
                        ? "bg-teal-500 text-slate-950"
                        : "text-slate-300 hover:text-white"
                    }`}
                  >
                    Per Jam ({hourlyStats.length} jam)
                  </button>
                  <button
                    onClick={() => setAggView("DAILY")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      aggView === "DAILY"
                        ? "bg-teal-500 text-slate-950"
                        : "text-slate-300 hover:text-white"
                    }`}
                  >
                    Per Hari (14 hari)
                  </button>
                  <button
                    onClick={() => setAggView("MONTHLY")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      aggView === "MONTHLY"
                        ? "bg-teal-500 text-slate-950"
                        : "text-slate-300 hover:text-white"
                    }`}
                  >
                    Per Bulan (36 bulan)
                  </button>
                </div>
              </div>

              {aggView === "HOURLY" && (
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="sticky top-0 bg-[#0B1D3A] text-slate-300 uppercase">
                      <tr>
                        <th className="py-2 px-3">Tanggal & Jam</th>
                        <th className="py-2 px-3">Suhu Rata-rata</th>
                        <th className="py-2 px-3">CO₂ Rata-rata</th>
                        <th className="py-2 px-3">Rasio Hadir</th>
                        <th className="py-2 px-3">Daya Rata-rata CTA</th>
                        <th className="py-2 px-3">Energi Jam (kWh)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono">
                      {hourlyStats.slice(0, 24).map((h: HourlyAggregation, i: number) => (
                        <tr key={`${h.dateStr}-${h.hour}-${i}`} className="hover:bg-white/5">
                          <td className="py-2 px-3 text-slate-300">
                            {h.dateStr} {h.timeLabel}
                          </td>
                          <td className="py-2 px-3 text-slate-200">
                            {formatAngka(h.avgTemp, 1)} °C
                          </td>
                          <td className="py-2 px-3 text-slate-200">
                            {formatBulat(h.avgCo2)} ppm
                          </td>
                          <td className="py-2 px-3 text-sky-300">
                            {formatAngka(h.occupancyRatio, 0)}%
                          </td>
                          <td className="py-2 px-3 text-amber-300">
                            {formatBulat(h.avgPowerA)} W
                          </td>
                          <td className="py-2 px-3 text-teal-300">
                            {formatAngka(h.energyKwh, 3)} kWh
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {aggView === "DAILY" && (
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="sticky top-0 bg-[#0B1D3A] text-slate-300 uppercase">
                      <tr>
                        <th className="py-2 px-3">Hari</th>
                        <th className="py-2 px-3">Kelompok</th>
                        <th className="py-2 px-3">Total (CTA)</th>
                        <th className="py-2 px-3">AC (CTB)</th>
                        <th className="py-2 px-3">Non-AC (CTA-CTB)</th>
                        <th className="py-2 px-3">Jam Hadir</th>
                        <th className="py-2 px-3">CO₂ Puncak</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono">
                      {dailyStats.map((d: DailyAggregation) => (
                        <tr key={d.dateStr} className="hover:bg-white/5">
                          <td className="py-2 px-3 text-slate-200">
                            Hari {d.dayIndex} ({d.dateStr})
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] ${
                                d.modeLabel === "AUTO"
                                  ? "bg-teal-500/20 text-teal-300"
                                  : "bg-amber-500/20 text-amber-300"
                              }`}
                            >
                              {d.modeLabel}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-amber-300 font-semibold">
                            {formatAngka(d.energyTotalKwh, 2)} kWh
                          </td>
                          <td className="py-2 px-3 text-sky-300">
                            {formatAngka(d.energyAcKwh, 2)} kWh
                          </td>
                          <td className="py-2 px-3 text-purple-300">
                            {formatAngka(d.energyOtherKwh, 2)} kWh
                          </td>
                          <td className="py-2 px-3 text-slate-300">
                            {formatAngka(d.occupancyHours, 1)} jam
                          </td>
                          <td className="py-2 px-3 text-slate-300">
                            {formatBulat(d.maxCo2)} ppm
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {aggView === "MONTHLY" && (
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="sticky top-0 bg-[#0B1D3A] text-slate-300 uppercase">
                      <tr>
                        <th className="py-2 px-3">Periode Bulan</th>
                        <th className="py-2 px-3">Total Energi (CTA)</th>
                        <th className="py-2 px-3">AC (CTB)</th>
                        <th className="py-2 px-3">Non-AC (CTA-CTB)</th>
                        <th className="py-2 px-3">Rata-rata / Hari</th>
                        <th className="py-2 px-3">Tagihan (Rp)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono">
                      {monthlyAggregates.slice(-12).map((m) => (
                        <tr key={m.periodKey} className="hover:bg-white/5">
                          <td className="py-2 px-3 text-slate-200">
                            {m.fullLabel}
                          </td>
                          <td className="py-2 px-3 text-amber-300 font-semibold">
                            {formatAngka(m.totalKwh, 1)} kWh
                          </td>
                          <td className="py-2 px-3 text-sky-300">
                            {formatAngka(m.acKwh, 1)} kWh
                          </td>
                          <td className="py-2 px-3 text-purple-300">
                            {formatAngka(m.nonAcKwh, 1)} kWh
                          </td>
                          <td className="py-2 px-3 text-slate-300">
                            {formatAngka(m.avgDailyKwh, 2)} kWh/hr
                          </td>
                          <td className="py-2 px-3 text-teal-300">
                            {formatRupiah(m.costRp)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bagian Perhitungan Rumus Energi & Perbandingan 7 Hari MANUAL vs 7 Hari AUTO */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-6 flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-amber-400">
              PERHITUNGAN ENERGI & KONSTRAIN METER
            </span>
            <h3 className="text-lg font-bold text-white mt-1">
              Evaluasi Simulasi: Baseline Manual vs Otomasi
            </h3>

            {/* Kotak Rumus */}
            <div className="mt-4 p-4 rounded-2xl bg-[#050B18]/80 border border-white/10 space-y-2 text-xs font-mono">
              <div className="text-slate-400">
                Rumus Integrasi Energi Numerik:
              </div>
              <div className="text-amber-300 text-sm font-bold">
                E (kWh) = Σ (P × Δt) / 1.000
              </div>
              <div className="text-slate-400 pt-1">
                Rumus Selisih Simulasi (%):
              </div>
              <div className="text-teal-300 text-sm font-bold">
                Penghematan (%) = ((E_manual − E_auto) / E_manual) × 100
              </div>
            </div>

            {/* Tabel Ringkas Manual vs Auto */}
            <div className="mt-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="text-slate-300">
                  Total Energi Manual (Hari 1–7):
                </span>
                <span className="font-mono font-bold text-amber-300 text-sm">
                  {formatAngka(energyComparison.manualTotalKwh, 2)} kWh
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="text-slate-300">
                  Total Energi Auto (Hari 8–14):
                </span>
                <span className="font-mono font-bold text-teal-300 text-sm">
                  {formatAngka(energyComparison.autoTotalKwh, 2)} kWh
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-teal-500/15 border border-teal-500/30">
                <span className="text-teal-200 font-semibold">
                  Selisih Energi (Hasil Simulasi):
                </span>
                <span className="font-mono font-extrabold text-teal-300 text-base">
                  {formatAngka(energyComparison.savingsKwh, 2)} kWh (
                  {formatAngka(energyComparison.savingsPercentage, 1)}%)
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-xs text-sky-200">
            <strong>Catatan Kesetaraan Pengujian:</strong> Jam okupansi periode
            MANUAL ({formatAngka(energyComparison.manualOccupancyHours, 1)} jam)
            setara dengan periode AUTO (
            {formatAngka(energyComparison.autoOccupancyHours, 1)} jam) pada lama
            layanan {formatAngka(energyComparison.manualServiceHours, 1)} jam.
            Konstrain <span className="font-mono">P_B &le; P_A</span> terpenuhi{" "}
            <strong>100% Valid</strong> (CTA dan CTB tidak pernah dijumlahkan).
          </div>
        </div>

        {/* Grafik Batang Harian Manual vs Auto */}
        <div className="lg:col-span-7 bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-sky-400">
                PROFIL ENERGI 14 HARI
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">
                Perbandingan Harian: Beban AC (CTB) vs Non-AC (CTA − CTB)
              </h3>
            </div>
          </div>

          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyChartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.08)"
                />
                <XAxis
                  dataKey="name"
                  stroke="#94a3b8"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                />
                <YAxis
                  stroke="#94a3b8"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  unit=" kWh"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0B1D3A",
                    borderColor: "rgba(255,255,255,0.15)",
                    borderRadius: "14px",
                    color: "#f8fafc",
                  }}
                  formatter={(value: any, name: any) => [
                    `${formatAngka(Number(value), 2)} kWh`,
                    String(name ?? ""),
                  ]}
                />
                <Legend />
                <Bar
                  dataKey="acKwh"
                  name="AC Split (CTB)"
                  stackId="a"
                  fill="#38bdf8"
                  radius={[0, 0, 4, 4]}
                />
                <Bar
                  dataKey="nonAcKwh"
                  name="Non-AC: Lampu + Fan + Rak (CTA − CTB)"
                  stackId="a"
                  fill="#f59e0b"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
