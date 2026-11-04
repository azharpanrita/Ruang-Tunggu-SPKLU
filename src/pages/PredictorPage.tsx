/**
 * File: src/pages/PredictorPage.tsx
 * Menu 3: Prediktor (Pemakaian & Prediksi 10 Metode + Okupansi Jam + CO2 1.000 ppm)
 *
 * Catatan untuk pemula:
 * - Mengikuti tata letak contoh dosen "Pemakaian & Prediksi" dengan 5 kontrol utama:
 *   METODE (10 metode JavaScript murni), BASIS (3/6/12 bln), STEP (1–12 bln),
 *   RIWAYAT (12/24/36 bln), dan kotak centang "Interval 80%".
 * - Menampilkan peringatan apabila ARIMA(1,1,1) dipilih saat RIWAYAT < 24 bulan.
 * - Menyertakan sub-tab untuk:
 *   1. Prediksi Energi Bulanan (10 Metode)
 *   2. Prediksi Okupansi per Jam
 *   3. Prediksi Waktu CO₂ Mencapai 1.000 ppm
 */

import React, { useState, useMemo, useEffect } from "react";
import {
  ComposedChart,
  Line,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { MonthlyEnergyRecord } from "../data/dataSource";
import { CleanedTelemetryRow } from "../utils/pemrosesan";
import {
  PREDICTOR_METHODS,
  PredictorMethodName,
  runMonthlyEnergyPredictor,
  predictHourlyOccupancy,
  predictCo2ThresholdTime,
} from "../utils/prediktor";
import { formatAngka, formatBulat, formatRupiah } from "../utils/formatters";
import { HaIcon, HA_ICONS } from "../config/appConfig";

interface PredictorPageProps {
  monthly36Records: MonthlyEnergyRecord[];
  cleanedRows: CleanedTelemetryRow[];
  tariffPerKwh: number;
  externalMethod?: PredictorMethodName | null;
  externalSteps?: number | null;
}

export const PredictorPage: React.FC<PredictorPageProps> = ({
  monthly36Records,
  cleanedRows,
  tariffPerKwh,
  externalMethod,
  externalSteps,
}) => {
  // Sub-tab aktif
  const [activeSubTab, setActiveSubTab] = useState<
    "MONTHLY_ENERGY" | "HOURLY_OCCUPANCY" | "CO2_THRESHOLD"
  >("MONTHLY_ENERGY");

  // 5 Kontrol utama panel "Pemakaian & Prediksi" sesuai contoh dosen
  const [selectedMethod, setSelectedMethod] =
    useState<PredictorMethodName>("Kalman filter");
  const [basisMonths, setBasisMonths] = useState<3 | 6 | 12>(6);
  const [steps, setSteps] = useState<number>(6);
  const [historyLength, setHistoryLength] = useState<12 | 24 | 36>(24);
  const [showInterval80, setShowInterval80] = useState<boolean>(true);

  // State simulasi CO2 untuk Sub-Tab 3
  const [simCurrentCo2, setSimCurrentCo2] = useState<number>(795);
  const [simPrevCo2, setSimPrevCo2] = useState<number>(675);

  // Sinkronisasi apabila AI Asisten memanggil fungsi `jalankan_prediksi(metode, step)`
  useEffect(() => {
    if (externalMethod) {
      setSelectedMethod(externalMethod);
      setActiveSubTab("MONTHLY_ENERGY");
    }
    if (externalSteps && externalSteps >= 1 && externalSteps <= 12) {
      setSteps(externalSteps);
    }
  }, [externalMethod, externalSteps]);

  // 1. Jalankan prediksi energi bulanan dengan 10 metode
  const monthlyPrediction = useMemo(
    () =>
      runMonthlyEnergyPredictor({
        all36Months: monthly36Records,
        method: selectedMethod,
        basisMonths,
        steps,
        historyLength,
        tariffPerKwh,
      }),
    [
      monthly36Records,
      selectedMethod,
      basisMonths,
      steps,
      historyLength,
      tariffPerKwh,
    ]
  );

  // 2. Jalankan prediksi okupansi per jam (00:00 - 23:00)
  const occupancyForecast = useMemo(
    () => predictHourlyOccupancy(cleanedRows),
    [cleanedRows]
  );

  // 3. Jalankan prediksi waktu CO2 mencapai 1.000 ppm
  const co2Prediction = useMemo(
    () => predictCo2ThresholdTime(simCurrentCo2, simPrevCo2, 15),
    [simCurrentCo2, simPrevCo2]
  );

  return (
    <div className="space-y-6 pb-10">
      {/* Header Halaman + Pilihan 3 Sub-Tab Prediktor */}
      <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5 sm:p-6 shadow-xl flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30 uppercase tracking-wider">
              <HaIcon path={HA_ICONS.chartLine} size={14} />
              Menu 3 • Prediktor & Peramalan
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mt-2">
            Pemakaian & Prediksi Energi (10 Metode), Okupansi, dan CO₂
          </h2>
          <p className="text-sm text-slate-300 mt-1">
            Seluruh model berjalan secara instan dengan JavaScript murni pada
            data riwayat 36 bulan dan telemetri 14 hari.
          </p>
        </div>

        {/* Sub-Tab Selector */}
        <div className="inline-flex flex-wrap rounded-2xl bg-[#050B18]/80 p-1.5 border border-white/10 gap-1">
          <button
            onClick={() => setActiveSubTab("MONTHLY_ENERGY")}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
              activeSubTab === "MONTHLY_ENERGY"
                ? "bg-gradient-to-r from-purple-500 to-sky-500 text-white shadow-md"
                : "text-slate-300 hover:text-white hover:bg-white/5"
            }`}
          >
            <HaIcon path={HA_ICONS.energy} size={15} />
            <span>1. Energi Bulanan (10 Metode)</span>
          </button>
          <button
            onClick={() => setActiveSubTab("HOURLY_OCCUPANCY")}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
              activeSubTab === "HOURLY_OCCUPANCY"
                ? "bg-gradient-to-r from-purple-500 to-sky-500 text-white shadow-md"
                : "text-slate-300 hover:text-white hover:bg-white/5"
            }`}
          >
            <HaIcon path={HA_ICONS.occupancy} size={15} />
            <span>2. Okupansi per Jam</span>
          </button>
          <button
            onClick={() => setActiveSubTab("CO2_THRESHOLD")}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 ${
              activeSubTab === "CO2_THRESHOLD"
                ? "bg-gradient-to-r from-purple-500 to-sky-500 text-white shadow-md"
                : "text-slate-300 hover:text-white hover:bg-white/5"
            }`}
          >
            <HaIcon path={HA_ICONS.co2} size={15} />
            <span>3. Waktu CO₂ &rarr; 1.000 ppm</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          SUB-TAB 1: PREDIKSI ENERGI BULANAN (10 METODE CONTOH DOSEN)
         ===================================================================== */}
      {activeSubTab === "MONTHLY_ENERGY" && (
        <div className="space-y-6">
          {/* Bar Kontrol "Pemakaian & Prediksi" */}
          <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5 sm:p-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-white/10">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-widest text-purple-400">
                  PANEL KONTROL PERAMALAN DERET WAKTU
                </span>
                <h3 className="text-lg font-bold text-white mt-0.5">
                  Pemakaian & Prediksi Energi Ruang Tunggu SPKLU
                </h3>
              </div>

              {/* Metrik Evaluasi MAE & RMSE di kanan atas */}
              <div className="flex items-center gap-3">
                <div className="px-4 py-2 rounded-2xl bg-[#050B18]/80 border border-white/10">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                    MAE (Galat Absolut)
                  </span>
                  <span className="text-base font-extrabold font-mono text-amber-400">
                    {formatAngka(monthlyPrediction.mae, 2)} kWh
                  </span>
                </div>
                <div className="px-4 py-2 rounded-2xl bg-[#050B18]/80 border border-white/10">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                    RMSE (Akar Galat Kuadrat)
                  </span>
                  <span className="text-base font-extrabold font-mono text-teal-400">
                    {formatAngka(monthlyPrediction.rmse, 2)} kWh
                  </span>
                </div>
              </div>
            </div>

            {/* 5 Kontrol Dropdown & Checkbox sesuai Contoh Dosen */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mt-5">
              {/* 1. METODE */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">
                  METODE PREDIKSI
                </label>
                <select
                  value={selectedMethod}
                  onChange={(e) =>
                    setSelectedMethod(e.target.value as PredictorMethodName)
                  }
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-[#050B18] border border-white/15 text-sm font-semibold text-white focus:outline-none focus:border-purple-400"
                >
                  {PREDICTOR_METHODS.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                      {m.isSimplifiedApproximation
                        ? " (pendekatan sederhana)"
                        : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. BASIS */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">
                  BASIS JENDELA
                </label>
                <select
                  value={basisMonths}
                  onChange={(e) =>
                    setBasisMonths(Number(e.target.value) as 3 | 6 | 12)
                  }
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-[#050B18] border border-white/15 text-sm font-semibold text-white focus:outline-none focus:border-purple-400"
                >
                  <option value={3}>3 bln terakhir</option>
                  <option value={6}>6 bln terakhir</option>
                  <option value={12}>12 bln terakhir</option>
                </select>
              </div>

              {/* 3. STEP */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">
                  STEP (HORIZON)
                </label>
                <select
                  value={steps}
                  onChange={(e) => setSteps(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-[#050B18] border border-white/15 text-sm font-semibold text-white focus:outline-none focus:border-purple-400"
                >
                  {Array.from({ length: 12 }, (_, idx) => idx + 1).map(
                    (stepNum) => (
                      <option key={stepNum} value={stepNum}>
                        {stepNum} bulan ke depan
                      </option>
                    )
                  )}
                </select>
              </div>

              {/* 4. RIWAYAT */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1.5">
                  RIWAYAT DITAMPILKAN
                </label>
                <select
                  value={historyLength}
                  onChange={(e) =>
                    setHistoryLength(Number(e.target.value) as 12 | 24 | 36)
                  }
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-[#050B18] border border-white/15 text-sm font-semibold text-white focus:outline-none focus:border-purple-400"
                >
                  <option value={12}>12 bln</option>
                  <option value={24}>24 bln</option>
                  <option value={36}>36 bln</option>
                </select>
              </div>

              {/* 5. Kotak centang Interval 80% */}
              <div className="flex flex-col justify-end">
                <label className="cursor-pointer flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-[#050B18] border border-white/15 hover:border-purple-400/60 transition">
                  <input
                    type="checkbox"
                    checked={showInterval80}
                    onChange={(e) => setShowInterval80(e.target.checked)}
                    className="w-4 h-4 accent-purple-500 rounded"
                  />
                  <span className="text-sm font-semibold text-slate-200">
                    Interval 80%
                  </span>
                </label>
              </div>
            </div>

            {/* Keterangan 1 Kalimat Metode untuk Pemula */}
            <div className="mt-4 p-4 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <HaIcon
                  path={HA_ICONS.info}
                  size={20}
                  className="text-purple-300 shrink-0 mt-0.5"
                />
                <div className="text-xs sm:text-sm text-slate-200">
                  <strong className="text-purple-300">
                    Cara Kerja {monthlyPrediction.methodMeta.name}:
                  </strong>{" "}
                  {monthlyPrediction.methodMeta.beginnerExplanation}
                </div>
              </div>
              {monthlyPrediction.methodMeta.isSimplifiedApproximation && (
                <span className="shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  Pendekatan Sederhana (JS Murni)
                </span>
              )}
            </div>

            {/* Peringatan Khusus ARIMA jika Riwayat < 24 bulan */}
            {monthlyPrediction.arimaWarning && (
              <div className="mt-3 p-4 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center gap-3 text-amber-200 text-xs sm:text-sm">
                <HaIcon
                  path={HA_ICONS.alert}
                  size={20}
                  className="text-amber-400 shrink-0"
                />
                <span>{monthlyPrediction.arimaWarning}</span>
              </div>
            )}

            {/* Grafik Utama: Garis Riwayat (Utuh) + Garis Prakiraan (Putus-putus) + Pita Interval 80% */}
            <div className="mt-6 h-96">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyPrediction.chartSeries}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.08)"
                  />
                  <XAxis
                    dataKey="label"
                    stroke="#94a3b8"
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    unit=" kWh"
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0B1D3A",
                      borderColor: "rgba(255,255,255,0.15)",
                      borderRadius: "14px",
                      color: "#f8fafc",
                    }}
                    formatter={(value: any, name: any) => {
                      const safeName = String(name ?? "");
                      if (Array.isArray(value)) {
                        return [
                          `${formatAngka(Number(value[0]), 1)} – ${formatAngka(
                            Number(value[1]),
                            1
                          )} kWh`,
                          safeName,
                        ];
                      }
                      return [`${formatAngka(Number(value), 1)} kWh`, safeName];
                    }}
                  />
                  <Legend />

                  {showInterval80 && (
                    <Area
                      type="monotone"
                      dataKey="range80"
                      name="Pita Interval Kepercayaan 80%"
                      fill="#a855f7"
                      fillOpacity={0.22}
                      stroke="none"
                    />
                  )}

                  <Line
                    type="monotone"
                    dataKey="actualKwh"
                    name="Riwayat Aktual (kWh)"
                    stroke="#38bdf8"
                    strokeWidth={3}
                    dot={{ r: 3, fill: "#38bdf8" }}
                    connectNulls={false}
                  />

                  <Line
                    type="monotone"
                    dataKey="forecastKwh"
                    name={`Prakiraan (${selectedMethod})`}
                    stroke="#f59e0b"
                    strokeWidth={3}
                    strokeDasharray="6 6"
                    dot={{ r: 4, fill: "#f59e0b" }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Kartu Prakiraan Per Bulan (kWh dan Rp) */}
          <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-widest text-amber-400">
                  RINCIAN HORIZON {steps} BULAN KE DEPAN
                </span>
                <h3 className="text-lg font-bold text-white mt-0.5">
                  Kartu Prakiraan Energi Bulanan (kWh) & Proyeksi Tagihan (Rp)
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                Tarif aktif: {formatRupiah(tariffPerKwh)}/kWh
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
              {monthlyPrediction.forecastCards.map((card) => (
                <div
                  key={card.stepNumber}
                  className="p-4 rounded-2xl bg-[#050B18]/75 border border-white/10 hover:border-amber-400/40 transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      {card.fullLabel}
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      Step +{card.stepNumber}
                    </span>
                  </div>

                  <div className="text-2xl font-extrabold text-amber-400 font-mono mt-2">
                    {formatAngka(card.kwh, 1)}{" "}
                    <span className="text-xs font-normal text-slate-400">
                      kWh
                    </span>
                  </div>

                  <div className="text-sm font-bold text-teal-300 font-mono mt-1">
                    {formatRupiah(card.costRp)}
                  </div>

                  {showInterval80 && (
                    <div className="mt-2 pt-2 border-t border-white/5 text-[11px] text-slate-400 font-mono">
                      Interval 80%: {formatAngka(card.lower80Kwh, 1)} –{" "}
                      {formatAngka(card.upper80Kwh, 1)} kWh
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 2: PREDIKSI OKUPANSI PER JAM (00:00 - 23:00)
         ===================================================================== */}
      {activeSubTab === "HOURLY_OCCUPANCY" && (
        <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-teal-400">
                PROFIL PROBABILITAS KEHADIRAN PENGGUNA SPKLU
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">
                Prediksi Okupansi Ruang Tunggu per Jam (00:00 – 23:00)
              </h3>
              <p className="text-xs text-slate-300 mt-1">
                Dihitung dari distribusi historis sensor radar mmWave LD2410C
                selama 14 hari untuk membantu penjadwalan pra-pendinginan AC.
              </p>
            </div>
          </div>

          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={occupancyForecast.byHour}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.08)"
                />
                <XAxis
                  dataKey="timeLabel"
                  stroke="#94a3b8"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                />
                <YAxis
                  stroke="#94a3b8"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  unit="%"
                  domain={[0, 100]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0B1D3A",
                    borderColor: "rgba(255,255,255,0.15)",
                    borderRadius: "14px",
                    color: "#f8fafc",
                  }}
                  formatter={(value: any) => [
                    `${formatAngka(Number(value), 1)}%`,
                    "Probabilitas Hadir",
                  ]}
                />
                <Bar
                  dataKey="avgOccupancyPct"
                  name="Probabilitas Kehadiran (%)"
                  fill="#14b8a6"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {occupancyForecast.byHour.slice(8, 20).map((item) => (
              <div
                key={item.hour}
                className="p-3 rounded-2xl bg-[#050B18]/75 border border-white/10 text-center"
              >
                <div className="text-xs font-mono text-slate-400">
                  {item.timeLabel}
                </div>
                <div className="text-lg font-extrabold text-white font-mono mt-1">
                  {formatAngka(item.avgOccupancyPct, 0)}%
                </div>
                <span
                  className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                    item.category.includes("Sibuk")
                      ? "bg-amber-500/20 text-amber-300"
                      : item.category.includes("Ramai")
                      ? "bg-sky-500/20 text-sky-300"
                      : "bg-slate-700 text-slate-300"
                  }`}
                >
                  {item.category}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 3: PREDIKSI WAKTU CO2 MENCAPAI 1.000 PPM
         ===================================================================== */}
      {activeSubTab === "CO2_THRESHOLD" && (
        <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-6 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-amber-400">
                PERAMALAN KUALITAS UDARA DALAM RUANG (SCD41)
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">
                Prediksi Waktu Konsentrasi CO₂ Mencapai Ambang 1.000 ppm
              </h3>
              <p className="text-xs text-slate-300 mt-1">
                Menggunakan ekstrapolasi laju kenaikan CO₂ (ppm/menit) ketika
                ruang tunggu sedang terisi pengunjung dan fan ventilasi belum
                menyala.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="px-4 py-2.5 rounded-2xl bg-[#050B18] border border-white/10">
                <span className="text-[10px] uppercase text-slate-400 block">
                  CO₂ Saat Ini
                </span>
                <span className="text-lg font-extrabold font-mono text-sky-400">
                  {formatBulat(simCurrentCo2)} ppm
                </span>
              </div>
              <div className="px-4 py-2.5 rounded-2xl bg-[#050B18] border border-white/10">
                <span className="text-[10px] uppercase text-slate-400 block">
                  Laju Kenaikan
                </span>
                <span className="text-lg font-extrabold font-mono text-amber-400">
                  +{formatAngka(co2Prediction.ratePerMinute, 1)} ppm/mnt
                </span>
              </div>
              <div className="px-4 py-2.5 rounded-2xl bg-teal-500/15 border border-teal-500/30">
                <span className="text-[10px] uppercase text-teal-300 block">
                  Estimasi Waktu ke 1.000 ppm
                </span>
                <span className="text-lg font-extrabold font-mono text-teal-300">
                  {co2Prediction.minutesTo1000 !== null
                    ? `${formatAngka(co2Prediction.minutesTo1000, 1)} menit`
                    : "Stabil < 1.000 ppm"}
                </span>
              </div>
            </div>
          </div>

          {/* Slider Simulasi Interaktif CO2 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-2xl bg-[#050B18]/75 border border-white/10">
            <div>
              <label className="block text-xs text-slate-300 mb-1">
                CO₂ 15 Menit Lalu:{" "}
                <strong className="font-mono text-sky-300">
                  {simPrevCo2} ppm
                </strong>
              </label>
              <input
                type="range"
                min={420}
                max={950}
                value={simPrevCo2}
                onChange={(e) => setSimPrevCo2(Number(e.target.value))}
                className="w-full accent-sky-400"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-300 mb-1">
                CO₂ Saat Ini:{" "}
                <strong className="font-mono text-amber-300">
                  {simCurrentCo2} ppm
                </strong>
              </label>
              <input
                type="range"
                min={450}
                max={1150}
                value={simCurrentCo2}
                onChange={(e) => setSimCurrentCo2(Number(e.target.value))}
                className="w-full accent-amber-400"
              />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-xs sm:text-sm text-slate-200">
            <strong>Status Prediksi:</strong> {co2Prediction.statusText}
          </div>

          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={co2Prediction.projectedSeries}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.08)"
                />
                <XAxis
                  dataKey="label"
                  stroke="#94a3b8"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                />
                <YAxis
                  stroke="#94a3b8"
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  unit=" ppm"
                  domain={[400, 1300]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0B1D3A",
                    borderColor: "rgba(255,255,255,0.15)",
                    borderRadius: "14px",
                    color: "#f8fafc",
                  }}
                />
                <Legend />
                <ReferenceLine
                  y={1000}
                  stroke="#f43f5e"
                  strokeDasharray="4 4"
                  label={{
                    value: "Ambang ON Fan (1.000 ppm)",
                    fill: "#fda4af",
                    fontSize: 11,
                  }}
                />
                <ReferenceLine
                  y={800}
                  stroke="#14b8a6"
                  strokeDasharray="4 4"
                  label={{
                    value: "Ambang OFF Fan (800 ppm)",
                    fill: "#5eead4",
                    fontSize: 11,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="projectedCo2"
                  name="Proyeksi Linier CO₂ (ppm)"
                  stroke="#f59e0b"
                  strokeWidth={3}
                  strokeDasharray="6 6"
                  dot={{ r: 4, fill: "#f59e0b" }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
};
