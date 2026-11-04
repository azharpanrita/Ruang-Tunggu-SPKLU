/**
 * File: src/pages/DashboardPage.tsx
 * Halaman Menu 1: Dashboard Utama Futuristik "Smart Home Demonstrator" & Home Assistant.
 *
 * Fitur Utama:
 * - Baris Atas: Kartu HUD Futuristik "KONDISI RUANG" & "PROYEKSI TAGIHAN BULAN INI".
 * - 4 Kartu KPI: BULAN BERJALAN (kWh), BULAN LALU, PER HARI (Rp), PRAKIRAAN BULAN DEPAN (Rp).
 * - Deck Kendali Perangkat Interaktif ala Home Assistant (Lampu WiZ, AC Split, Fan K1,
 *   Prioritas Kontrol AUTO/MANUAL, Jam Layanan):
 *   * Memiliki tombol/slider kendali langsung di atas kartu (1-klik ON/OFF dua arah)
 *   * Sekaligus tombol untuk membuka dialog "More-Info" lengkap dengan grafik riwayat live.
 * - 6 Kartu Sensor (Suhu, Kelembapan, Lux, CO2, Okupansi, Pintu) dengan sparkline & tombol uji cepat.
 * - "Profil Harian" (batang kWh rata-rata per jam berlabel "DATA METERAN") dan
 *   "Rincian Pemakaian" (bar persentase 2 bagian: AC [CTB] dan Non-AC [CTA - CTB]).
 * - Denah Digital Twin 5 m × 4 m (SVG) interaktif (klik perangkat di denah untuk mengontrol!)
 *   + Panel Alarm Gangguan + Log Aksi Terbaru + 5 Grafik Historis 14 Hari.
 */

import React, { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  AreaChart,
  BarChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  Cell,
} from "recharts";
import { HaIcon, HA_ICONS } from "../config/appConfig";
import { TelemetryRow, OperationMode } from "../data/dummyGenerator";
import { CurrentMonthProjection } from "../data/dataSource";
import {
  CleanedTelemetryRow,
  DailyAggregation,
  HourlyAggregation,
} from "../utils/pemrosesan";
import { LiveRoomState, ActionLogEntry } from "../utils/simulasi";
import {
  formatAngka,
  formatBulat,
  formatRupiah,
  formatTanggalIndo,
} from "../utils/formatters";
import { ControllableDeviceType } from "../App";

interface DashboardPageProps {
  liveState: LiveRoomState;
  onUpdateLiveDevice: (device: ControllableDeviceType, payload: any) => void;
  actionLogs: ActionLogEntry[];
  rawRows: TelemetryRow[];
  cleanedRows: CleanedTelemetryRow[];
  dailyStats: DailyAggregation[];
  hourlyStats: HourlyAggregation[];
  billingProjection: CurrentMonthProjection;
  nextMonthForecastKwh: number;
  selectedDay: number;
  onSelectDay: (day: number) => void;
}

type MoreInfoDeviceType = "LIGHT" | "AC" | "FAN" | "MODE" | "SERVICE" | null;

export const DashboardPage: React.FC<DashboardPageProps> = ({
  liveState,
  onUpdateLiveDevice,
  actionLogs,
  cleanedRows,
  dailyStats,
  hourlyStats,
  billingProjection,
  nextMonthForecastKwh,
  selectedDay,
  onSelectDay,
}) => {
  // Dialog "more-info" ala Home Assistant saat tombol detail kartu perangkat diklik
  const [moreInfoDevice, setMoreInfoDevice] =
    useState<MoreInfoDeviceType>(null);

  // Filter untuk grafik historis 14 hari (Semua / Manual / Auto)
  const [modeFilter, setModeFilter] = useState<"ALL" | "MANUAL" | "AUTO">(
    "ALL"
  );

  const filteredDays = useMemo(() => {
    if (modeFilter === "MANUAL")
      return dailyStats.filter((d) => d.modeLabel === "MANUAL");
    if (modeFilter === "AUTO")
      return dailyStats.filter((d) => d.modeLabel === "AUTO");
    return dailyStats;
  }, [dailyStats, modeFilter]);

  const handleModeFilterChange = (newFilter: "ALL" | "MANUAL" | "AUTO") => {
    setModeFilter(newFilter);
    if (newFilter === "MANUAL" && selectedDay > 7) {
      onSelectDay(1);
    } else if (newFilter === "AUTO" && selectedDay <= 7) {
      onSelectDay(8);
    }
  };

  const dayCleanRows = useMemo(
    () => cleanedRows.filter((r) => r.dayIndex === selectedDay),
    [cleanedRows, selectedDay]
  );

  const currentDaySummary = useMemo(
    () =>
      dailyStats.find((d) => d.dayIndex === selectedDay) || dailyStats[0],
    [dailyStats, selectedDay]
  );

  // Data grafik harian (sampel tiap 15 menit agar tajam dan responsif)
  const chartData = useMemo(() => {
    return dayCleanRows
      .filter((_, idx) => idx % 3 === 0)
      .map((r) => {
        let modeNum = 1;
        if (r.MODE === "SIAP") modeNum = 1;
        else if (r.MODE === "TUNDA_KOSONG") modeNum = 2;
        else if (r.MODE === "DIGUNAKAN") modeNum = 3;
        else if (r.MODE === "MANUAL") modeNum = 4;
        else if (r.MODE === "GANGGUAN") modeNum = 5;

        return {
          timeStr: r.timeStr,
          T_R: r.T_R,
          RH_R: r.RH_R,
          L_R: r.L_R,
          C_R: r.C_R,
          P_A: r.P_A,
          P_B: r.P_B,
          B_L: r.B_L,
          OCC: r.OCC,
          FAN_CMD: r.FAN_CMD,
          MODE: r.MODE,
          modeNum,
        };
      });
  }, [dayCleanRows]);

  // Data "Profil Harian" (Rata-rata kWh per jam 00:00 - 23:00 dari seluruh hari tercatat)
  const hourlyProfileData = useMemo(() => {
    const byHour: Array<{ hour: number; label: string; avgKwh: number }> = [];
    for (let h = 0; h < 24; h++) {
      const items = hourlyStats.filter((item) => item.hour === h);
      const avgKwh =
        items.length > 0
          ? items.reduce((a, b) => a + b.energyKwh, 0) / items.length
          : 0;
      byHour.push({
        hour: h,
        label: `${String(h).padStart(2, "0")}:00`,
        avgKwh: Number(avgKwh.toFixed(3)),
      });
    }
    return byHour;
  }, [hourlyStats]);

  // Data "Rincian Pemakaian" (Hanya 2 bagian: AC [CTB] dan Non-AC [CTA dikurangi CTB])
  const usageBreakdown = useMemo(() => {
    const totalCtaKwh = dailyStats.reduce((a, d) => a + d.energyTotalKwh, 0);
    const totalCtbAcKwh = dailyStats.reduce((a, d) => a + d.energyAcKwh, 0);
    const totalNonAcKwh = Math.max(0, totalCtaKwh - totalCtbAcKwh);

    const acPct =
      totalCtaKwh > 0
        ? Number(((totalCtbAcKwh / totalCtaKwh) * 100).toFixed(1))
        : 84;
    const nonAcPct = Number((100 - acPct).toFixed(1));

    return {
      totalCtaKwh: Number(totalCtaKwh.toFixed(2)),
      totalCtbAcKwh: Number(totalCtbAcKwh.toFixed(2)),
      totalNonAcKwh: Number(totalNonAcKwh.toFixed(2)),
      acPct,
      nonAcPct,
    };
  }, [dailyStats]);

  const nextMonthForecastCostRp = Math.round(
    nextMonthForecastKwh * billingProjection.tariffPerKwh
  );

  // Warna badge & cahaya futuristik Mode Operasi
  const getModeVisual = (mode: OperationMode) => {
    switch (mode) {
      case "DIGUNAKAN":
        return {
          badgeClass:
            "bg-teal-500/20 text-teal-300 border border-teal-400/50 shadow-lg shadow-teal-500/10",
          accentText:
            "bg-gradient-to-r from-teal-300 via-cyan-300 to-emerald-300 bg-clip-text text-transparent",
          glowBorder: "border-teal-400/30 shadow-teal-500/10",
          desc: "Ruang sedang digunakan — Dimming lampu WiZ adaptif & AC COOL aktif",
        };
      case "SIAP":
        return {
          badgeClass:
            "bg-slate-700/60 text-slate-200 border border-slate-500/50",
          accentText: "text-slate-100",
          glowBorder: "border-white/15",
          desc: "Siap menerima pengguna — Ruang kosong valid, aktuator dalam mode hemat",
        };
      case "TUNDA_KOSONG":
        return {
          badgeClass:
            "bg-amber-500/20 text-amber-300 border border-amber-400/50",
          accentText: "text-amber-300",
          glowBorder: "border-amber-400/30 shadow-amber-500/10",
          desc: `Waktu tunda kosong berjalan (${liveState.emptyMinutesElapsed} mnt) — Lampu OFF ≥5m, AC OFF ≥15m`,
        };
      case "MANUAL":
        return {
          badgeClass:
            "bg-purple-500/20 text-purple-300 border border-purple-400/50",
          accentText: "text-purple-300",
          glowBorder: "border-purple-400/35 shadow-purple-500/10",
          desc: "Kendali Manual Petugas — Otomasi pusat ditahan sementara",
        };
      case "GANGGUAN":
        return {
          badgeClass: "bg-rose-500/20 text-rose-300 border border-rose-500/50",
          accentText: "text-rose-400",
          glowBorder: "border-rose-500/40 shadow-rose-500/15",
          desc: "Kondisi Gangguan Sensor / Node — Menjalankan prosedur fallback keselamatan",
        };
    }
  };

  const modeVisual = getModeVisual(liveState.MODE);
  const isUp = billingProjection.changePercentVsLastMonth > 0;
  const hasAnyOverride =
    liveState.manualLightOverride ||
    liveState.manualAcOverride ||
    liveState.manualFanOverride;

  const billingProgressPct = Math.min(
    100,
    Math.round(
      (billingProjection.recordedDays / billingProjection.totalDaysInMonth) *
        100
    )
  );

  return (
    <div className="space-y-6">
      {/* =================================================================== */}
      {/* BARIS 1: KARTU HUD FUTURISTIK "KONDISI RUANG" & "PROYEKSI TAGIHAN"  */}
      {/* =================================================================== */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Kartu Besar 1: KONDISI RUANG (7 Kolom) */}
        <div
          className={`lg:col-span-7 bg-gradient-to-br from-[#0B1D3A]/90 via-[#08152C]/90 to-[#0D254C]/80 backdrop-blur-xl border ${modeVisual.glowBorder} rounded-3xl p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden transition-all duration-300`}
        >
          {/* Aksen garis sian futuristik di bagian atas kartu */}
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-teal-400 via-cyan-400 to-purple-500 opacity-80" />

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-ping" />
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">
                  KONDISI RUANG TUNGGU SPKLU (LIVE TELEMETRY)
                </span>
              </div>
              <div className="flex items-center gap-2">
                {hasAnyOverride && (
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("RESET_OVERRIDES", true)}
                    className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-400 text-slate-950 hover:bg-amber-300 transition shadow-md cursor-pointer"
                    title="Lepas semua kunci override manual dan kembalikan ke otomasi penuh"
                  >
                    ↺ Reset ke Otomasi
                  </button>
                )}
                <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-[#050B18]/80 border border-white/10 text-slate-300">
                  Sumber:{" "}
                  <strong
                    className={
                      liveState.lastDataOrigin === "injeksi simulasi"
                        ? "text-amber-400"
                        : "text-teal-400"
                    }
                  >
                    {liveState.lastDataOrigin.toUpperCase()}
                  </strong>
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <div
                    className={`text-3xl sm:text-4xl font-extrabold tracking-tight transition-all duration-300 ${modeVisual.accentText}`}
                  >
                    {liveState.MODE}
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-[11px] font-mono font-bold ${modeVisual.badgeClass}`}
                  >
                    {liveState.AUTO === 1 ? "AUTO ON" : "MANUAL OVERRIDE"}
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                  {modeVisual.desc}
                </p>
              </div>

              {/* Kotak Interaktif Status Pengguna (Bisa Diklik Langsung untuk Toggle Hadir/Kosong) */}
              <div className="flex items-center gap-3 bg-[#050B18]/85 border border-cyan-500/25 rounded-2xl px-4 py-3 shrink-0 shadow-inner">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                    liveState.OCC === 1
                      ? "bg-teal-500/25 text-teal-300 ring-1 ring-teal-400/50 shadow-lg shadow-teal-500/20"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  <HaIcon
                    path={
                      liveState.OCC === 1
                        ? HA_ICONS.okupansiHadir
                        : HA_ICONS.okupansiKosong
                    }
                    sizePx={28}
                  />
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    STATUS PENGGUNA (OCC)
                  </div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {liveState.OCC === "unavailable"
                      ? "Radar Offline"
                      : liveState.OCC === 1
                      ? "Pengguna Hadir (1)"
                      : `Kosong (${liveState.emptyMinutesElapsed} mnt)`}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <button
                      type="button"
                      onClick={() => onUpdateLiveDevice("OCC", 1)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                        liveState.OCC === 1
                          ? "bg-teal-400 text-slate-950"
                          : "bg-white/10 text-slate-300 hover:bg-white/20"
                      }`}
                    >
                      Hadir
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateLiveDevice("OCC", 0)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                        liveState.OCC === 0
                          ? "bg-amber-400 text-slate-950"
                          : "bg-white/10 text-slate-300 hover:bg-white/20"
                      }`}
                    >
                      Kosong
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 4 Metrik Kenyamanan Cepat dengan Bar Indikator */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-white/10">
            <div className="bg-[#050B18]/60 rounded-2xl p-3 border border-white/5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                SUHU (T_R)
              </div>
              <div className="text-xl font-extrabold font-mono text-amber-400 mt-1">
                {liveState.T_R === "unavailable"
                  ? "N/A"
                  : `${formatAngka(liveState.T_R, 1)} °C`}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Setpoint: {liveState.AC_SETPOINT_C} °C
              </div>
            </div>

            <div className="bg-[#050B18]/60 rounded-2xl p-3 border border-white/5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                KELEMBAPAN (RH_R)
              </div>
              <div className="text-xl font-extrabold font-mono text-sky-400 mt-1">
                {liveState.RH_R === "unavailable"
                  ? "N/A"
                  : `${formatAngka(liveState.RH_R, 1)} %`}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Ideal: 45–65 %RH
              </div>
            </div>

            <div className="bg-[#050B18]/60 rounded-2xl p-3 border border-white/5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                CAHAYA (L_R)
              </div>
              <div className="text-xl font-extrabold font-mono text-amber-300 mt-1">
                {liveState.L_R === "unavailable"
                  ? "N/A"
                  : `${formatBulat(liveState.L_R)} lux`}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Target: 270–330 lux
              </div>
            </div>

            <div className="bg-[#050B18]/60 rounded-2xl p-3 border border-white/5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                KADAR CO₂ (C_R)
              </div>
              <div
                className={`text-xl font-extrabold font-mono mt-1 ${
                  typeof liveState.C_R === "number" && liveState.C_R > 1000
                    ? "text-rose-400"
                    : "text-teal-400"
                }`}
              >
                {liveState.C_R === "unavailable"
                  ? "N/A"
                  : `${formatBulat(liveState.C_R)} ppm`}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Batas ON: 1.000 ppm
              </div>
            </div>
          </div>
        </div>

        {/* Kartu Besar 2: PROYEKSI TAGIHAN BULAN INI (5 Kolom — Mengikuti Desain Contoh Dosen) */}
        <div className="lg:col-span-5 bg-gradient-to-br from-[#0B1D3A]/95 via-[#111C38]/90 to-[#1E1B4B]/80 backdrop-blur-xl border border-purple-400/25 rounded-3xl p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-purple-400 via-fuchsia-400 to-sky-400 opacity-80" />

          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-purple-300">
                PROYEKSI TAGIHAN BULAN INI
              </span>
              <div className="w-10 h-10 rounded-2xl bg-purple-500/20 text-purple-300 border border-purple-400/30 flex items-center justify-center shadow-lg shadow-purple-500/10">
                <HaIcon path={HA_ICONS.tagihan} sizePx={24} />
              </div>
            </div>

            <div className="text-3xl sm:text-4xl font-extrabold font-mono text-white mt-3 tracking-tight">
              {formatRupiah(billingProjection.projectedMonthCostRp)}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span
                className={`px-2.5 py-0.5 rounded-full font-mono ${
                  isUp
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : "bg-teal-500/20 text-teal-300 border border-teal-500/30"
                }`}
              >
                {isUp ? "▲ Naik" : "▼ Turun"}{" "}
                {formatAngka(
                  Math.abs(billingProjection.changePercentVsLastMonth),
                  1
                )}
                % vs bulan lalu
              </span>
              <span className="text-slate-300 font-mono">
                Est. {formatAngka(billingProjection.projectedMonthKwh, 1)} kWh
              </span>
            </div>

            {/* Progress Bar Siklus Bulan Berjalan */}
            <div className="mt-4">
              <div className="flex items-center justify-between text-[11px] text-slate-300 font-mono mb-1">
                <span>
                  Progress {billingProjection.currentMonthLabel}: Hari ke-
                  {billingProjection.recordedDays}/
                  {billingProjection.totalDaysInMonth}
                </span>
                <span className="text-purple-300 font-bold">
                  {billingProgressPct}%
                </span>
              </div>
              <div className="w-full h-2 bg-[#050B18] rounded-full overflow-hidden border border-white/10">
                <div
                  style={{ width: `${billingProgressPct}%` }}
                  className="h-full bg-gradient-to-r from-purple-500 via-fuchsia-400 to-cyan-400 rounded-full"
                />
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed mt-4 pt-4 border-t border-white/10">
            Dihitung dengan tarif{" "}
            <strong className="text-amber-300 font-mono">
              {formatRupiah(billingProjection.tariffPerKwh)}/kWh
            </strong>
            . Bulan lalu tercatat{" "}
            <strong className="text-white font-mono">
              {formatAngka(billingProjection.lastMonthKwh, 1)} kWh (
              {formatRupiah(billingProjection.lastMonthCostRp)})
            </strong>
            ; bulan ini diproyeksikan{" "}
            <strong className="text-teal-300">
              {isUp ? "naik" : "turun"}{" "}
              {formatAngka(
                Math.abs(billingProjection.changePercentVsLastMonth),
                1
              )}
              %
            </strong>{" "}
            berdasarkan{" "}
            <strong className="text-white font-mono">
              {formatAngka(billingProjection.recordedKwhSoFar, 1)} kWh
            </strong>{" "}
            yang tercatat sampai hari ke-
            <strong className="font-mono">
              {billingProjection.recordedDays}
            </strong>{" "}
            dari{" "}
            <strong className="font-mono">
              {billingProjection.totalDaysInMonth}
            </strong>{" "}
            hari ({billingProjection.currentMonthLabel}).
          </p>
        </div>
      </section>

      {/* =================================================================== */}
      {/* BARIS 2: EMPAT KARTU KPI ENERGI & BIAYA (ALA CONTOH DOSEN)          */}
      {/* =================================================================== */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1: BULAN BERJALAN */}
        <div className="bg-[#0B1D3A]/75 backdrop-blur-md border border-teal-500/25 rounded-2xl p-5 hover:border-teal-400/60 transition-all shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
              BULAN BERJALAN
            </span>
            <div className="w-9 h-9 rounded-xl bg-teal-500/15 text-teal-400 flex items-center justify-center">
              <HaIcon path={HA_ICONS.energi} sizePx={22} />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-teal-400 mt-3">
            {formatAngka(billingProjection.recordedKwhSoFar, 1)}{" "}
            <span className="text-base font-semibold text-slate-300">kWh</span>
          </div>
          <p className="text-xs text-slate-400 mt-1.5 font-mono">
            Hari ke-{billingProjection.recordedDays} dari{" "}
            {billingProjection.totalDaysInMonth} · Proyeksi:{" "}
            {formatAngka(billingProjection.projectedMonthKwh, 1)} kWh
          </p>
        </div>

        {/* KPI 2: BULAN LALU */}
        <div className="bg-[#0B1D3A]/75 backdrop-blur-md border border-purple-500/25 rounded-2xl p-5 hover:border-purple-400/60 transition-all shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
              BULAN LALU
            </span>
            <div className="w-9 h-9 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center">
              <HaIcon path={HA_ICONS.daya} sizePx={22} />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-purple-300 mt-3">
            {formatAngka(billingProjection.lastMonthKwh, 1)}{" "}
            <span className="text-base font-semibold text-slate-300">kWh</span>
          </div>
          <p className="text-xs text-slate-400 mt-1.5 font-mono">
            Tagihan Sep 2026: {formatRupiah(billingProjection.lastMonthCostRp)}
          </p>
        </div>

        {/* KPI 3: PER HARI (Rp) */}
        <div className="bg-[#0B1D3A]/75 backdrop-blur-md border border-amber-500/25 rounded-2xl p-5 hover:border-amber-400/60 transition-all shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
              RATA-RATA PER HARI
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
              <HaIcon path={HA_ICONS.tagihan} sizePx={22} />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-amber-400 mt-3">
            {formatRupiah(billingProjection.dailyAverageCostRp)}
          </div>
          <p className="text-xs text-slate-400 mt-1.5 font-mono">
            Setara {formatAngka(billingProjection.dailyAverageKwh, 2)} kWh/hari
            · Live P_A: {formatBulat(liveState.P_A)} W
          </p>
        </div>

        {/* KPI 4: PRAKIRAAN BULAN DEPAN (Rp) */}
        <div className="bg-[#0B1D3A]/75 backdrop-blur-md border border-sky-500/25 rounded-2xl p-5 hover:border-sky-400/60 transition-all shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
              PRAKIRAAN BULAN DEPAN
            </span>
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center">
              <HaIcon path={HA_ICONS.menuPredictor} sizePx={22} />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-white mt-3">
            {formatRupiah(nextMonthForecastCostRp)}
          </div>
          <p className="text-xs text-slate-400 mt-1.5 font-mono">
            Prakiraan Prediktor: {formatAngka(nextMonthForecastKwh, 1)} kWh
          </p>
        </div>
      </section>

      {/* =================================================================== */}
      {/* BARIS 3: DECK KENDALI PERANGKAT FUTURISTIK ALA HOME ASSISTANT       */}
      {/* (Memiliki Kontrol Langsung 1-Klik di Kartu + Tombol More-Info)      */}
      {/* =================================================================== */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
              KENDALI PERANGKAT INTERAKTIF HOME ASSISTANT (KONTROL LANGSUNG &
              DIALOG MORE-INFO)
            </h3>
          </div>
          <div className="flex items-center gap-3 text-xs bg-[#0B1D3A]/80 border border-white/10 px-3.5 py-1.5 rounded-full">
            <span className="text-slate-300">
              Total Ruang CTA:{" "}
              <strong className="text-amber-300 font-mono">
                {formatBulat(liveState.P_A)} W
              </strong>
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-300">
              Subbeban AC CTB:{" "}
              <strong className="text-sky-400 font-mono">
                {formatBulat(liveState.P_B)} W
              </strong>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* =============================================================== */}
          {/* 1. KARTU LAMPU WIZ DIMMABLE (B_L)                               */}
          {/* =============================================================== */}
          <div
            className={`bg-gradient-to-b from-[#0B1D3A]/90 to-[#071226]/90 backdrop-blur-xl border rounded-3xl p-4 flex flex-col justify-between transition-all shadow-xl ${
              liveState.B_L > 0
                ? "border-amber-400/50 shadow-amber-500/10"
                : "border-white/10"
            }`}
          >
            <div>
              {/* Baris Atas: Ikon + Nama + Sakelar Cepat ON/OFF */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLiveDevice("LIGHT", liveState.B_L > 0 ? 0 : 75)
                    }
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                      liveState.B_L > 0
                        ? "bg-amber-400/25 text-amber-300 ring-1 ring-amber-400/50 shadow-lg shadow-amber-500/20"
                        : "bg-slate-800/90 text-slate-500 hover:text-slate-300"
                    }`}
                    title="Klik untuk menyalakan/mematikan Lampu WiZ"
                  >
                    <HaIcon
                      path={
                        liveState.B_L > 0
                          ? HA_ICONS.lampuOn
                          : HA_ICONS.lampuOff
                      }
                      sizePx={26}
                    />
                  </button>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      LAMPU WIZ (B_L)
                    </div>
                    <div className="text-lg font-extrabold font-mono text-white">
                      {liveState.B_L > 0 ? `ON · ${liveState.B_L}%` : "OFF (0%)"}
                    </div>
                  </div>
                </div>

                {/* Tombol Toggle ON / OFF Langsung */}
                <button
                  type="button"
                  onClick={() =>
                    onUpdateLiveDevice("LIGHT", liveState.B_L > 0 ? 0 : 75)
                  }
                  className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider transition cursor-pointer ${
                    liveState.B_L > 0
                      ? "bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20"
                      : "bg-slate-800 text-slate-300 border border-white/15 hover:bg-slate-700"
                  }`}
                >
                  {liveState.B_L > 0 ? "ON" : "OFF"}
                </button>
              </div>

              {/* Slider Kecerahan Langsung di Kartu */}
              <div className="mt-3.5">
                <input
                  type="range"
                  aria-label="Brightness Lampu WiZ"
                  min={0}
                  max={100}
                  step={5}
                  value={liveState.B_L}
                  onChange={(e) =>
                    onUpdateLiveDevice("LIGHT", Number(e.target.value))
                  }
                  className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                />
                <div className="grid grid-cols-5 gap-1 mt-2">
                  {[0, 25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => onUpdateLiveDevice("LIGHT", pct)}
                      className={`py-1 rounded-lg text-[10px] font-mono font-bold transition cursor-pointer ${
                        liveState.B_L === pct
                          ? "bg-amber-400 text-slate-950"
                          : "bg-[#050B18] text-slate-300 hover:bg-white/10 border border-white/5"
                      }`}
                    >
                      {pct === 0 ? "OFF" : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-mono">
                Daya: {Math.round((liveState.B_L / 100) * 28)} W
              </span>
              <button
                type="button"
                onClick={() => setMoreInfoDevice("LIGHT")}
                className="text-amber-300 hover:text-amber-200 font-semibold cursor-pointer"
              >
                Detail Grafik &rarr;
              </button>
            </div>
          </div>

          {/* =============================================================== */}
          {/* 2. KARTU AC SPLIT BROADLINK RM4 MINI (AC_CMD)                   */}
          {/* =============================================================== */}
          <div
            className={`bg-gradient-to-b from-[#0B1D3A]/90 to-[#071226]/90 backdrop-blur-xl border rounded-3xl p-4 flex flex-col justify-between transition-all shadow-xl ${
              liveState.AC_CMD === "COOL_25"
                ? "border-sky-400/50 shadow-sky-500/10"
                : "border-white/10"
            }`}
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLiveDevice("AC", {
                        cmd: liveState.AC_CMD === "COOL_25" ? "OFF" : "COOL_25",
                        setpoint: liveState.AC_SETPOINT_C,
                      })
                    }
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                      liveState.AC_CMD === "COOL_25"
                        ? "bg-sky-500/25 text-sky-300 ring-1 ring-sky-400/50 shadow-lg shadow-sky-500/20"
                        : "bg-slate-800/90 text-slate-500 hover:text-slate-300"
                    }`}
                    title="Klik untuk menyalakan/mematikan AC Split"
                  >
                    <HaIcon path={HA_ICONS.ac} sizePx={26} />
                  </button>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      AC SPLIT (AC_CMD)
                    </div>
                    <div className="text-lg font-extrabold font-mono text-white">
                      {liveState.AC_CMD === "COOL_25"
                        ? `COOL ${liveState.AC_SETPOINT_C}°C`
                        : "OFF"}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateLiveDevice("AC", {
                      cmd: liveState.AC_CMD === "COOL_25" ? "OFF" : "COOL_25",
                      setpoint: liveState.AC_SETPOINT_C,
                    })
                  }
                  className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider transition cursor-pointer ${
                    liveState.AC_CMD === "COOL_25"
                      ? "bg-sky-400 text-slate-950 shadow-md shadow-sky-500/20"
                      : "bg-slate-800 text-slate-300 border border-white/15 hover:bg-slate-700"
                  }`}
                >
                  {liveState.AC_CMD === "COOL_25" ? "COOL" : "OFF"}
                </button>
              </div>

              {/* Kontrol Setpoint Suhu (- / +) & Mode Langsung di Kartu */}
              <div className="mt-3.5 space-y-2">
                <div className="flex items-center justify-between bg-[#050B18] border border-white/10 rounded-xl px-2.5 py-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLiveDevice("AC", {
                        cmd: "COOL_25",
                        setpoint: Math.max(22, liveState.AC_SETPOINT_C - 1),
                      })
                    }
                    className="w-7 h-7 rounded-lg bg-white/10 hover:bg-sky-500/30 text-white font-bold text-sm cursor-pointer"
                  >
                    −
                  </button>
                  <span className="font-mono text-xs font-bold text-sky-300">
                    Setpoint: {liveState.AC_SETPOINT_C} °C
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLiveDevice("AC", {
                        cmd: "COOL_25",
                        setpoint: Math.min(28, liveState.AC_SETPOINT_C + 1),
                      })
                    }
                    className="w-7 h-7 rounded-lg bg-white/10 hover:bg-sky-500/30 text-white font-bold text-sm cursor-pointer"
                  >
                    +
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLiveDevice("AC", {
                        cmd: "COOL_25",
                        setpoint: liveState.AC_SETPOINT_C,
                      })
                    }
                    className={`py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      liveState.AC_CMD === "COOL_25"
                        ? "bg-sky-400 text-slate-950"
                        : "bg-[#050B18] text-slate-300 hover:bg-white/10 border border-white/5"
                    }`}
                  >
                    NYALAKAN COOL
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLiveDevice("AC", {
                        cmd: "OFF",
                        setpoint: liveState.AC_SETPOINT_C,
                      })
                    }
                    className={`py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      liveState.AC_CMD === "OFF"
                        ? "bg-rose-500 text-white"
                        : "bg-[#050B18] text-slate-300 hover:bg-white/10 border border-white/5"
                    }`}
                  >
                    MATIKAN AC
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[11px]">
              <span
                className={`font-mono font-semibold ${
                  liveState.AC_STATUS_TEXT === "Belum terverifikasi"
                    ? "text-amber-400"
                    : "text-teal-400"
                }`}
              >
                {liveState.AC_STATUS_TEXT} ({liveState.P_B}W)
              </span>
              <button
                type="button"
                onClick={() => setMoreInfoDevice("AC")}
                className="text-sky-300 hover:text-sky-200 font-semibold cursor-pointer"
              >
                Detail Grafik &rarr;
              </button>
            </div>
          </div>

          {/* =============================================================== */}
          {/* 3. KARTU FAN VENTILASI SHELLY + K1 (FAN_CMD)                    */}
          {/* =============================================================== */}
          <div
            className={`bg-gradient-to-b from-[#0B1D3A]/90 to-[#071226]/90 backdrop-blur-xl border rounded-3xl p-4 flex flex-col justify-between transition-all shadow-xl ${
              liveState.FAN_CMD === 1
                ? "border-teal-400/50 shadow-teal-500/10"
                : "border-white/10"
            }`}
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLiveDevice("FAN", liveState.FAN_CMD === 1 ? 0 : 1)
                    }
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                      liveState.FAN_CMD === 1
                        ? "bg-teal-500/25 text-teal-300 ring-1 ring-teal-400/50 shadow-lg shadow-teal-500/20"
                        : "bg-slate-800/90 text-slate-500 hover:text-slate-300"
                    }`}
                    title="Klik untuk menyalakan/mematikan Fan Ventilasi K1"
                  >
                    <HaIcon
                      path={HA_ICONS.fan}
                      sizePx={26}
                      spin={liveState.FAN_CMD === 1}
                    />
                  </button>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      FAN VENTILASI K1
                    </div>
                    <div className="text-lg font-extrabold font-mono text-white">
                      {liveState.FAN_CMD === 1 ? "ON (1)" : "OFF (0)"}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateLiveDevice("FAN", liveState.FAN_CMD === 1 ? 0 : 1)
                  }
                  className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider transition cursor-pointer ${
                    liveState.FAN_CMD === 1
                      ? "bg-teal-400 text-slate-950 shadow-md shadow-teal-500/20"
                      : "bg-slate-800 text-slate-300 border border-white/15 hover:bg-slate-700"
                  }`}
                >
                  {liveState.FAN_CMD === 1 ? "ON" : "OFF"}
                </button>
              </div>

              {/* Tombol Segmented ON / OFF Dua Arah */}
              <div className="mt-4 space-y-2">
                <div className="text-[11px] text-slate-400">
                  Histeresis CO₂: &gt;1.000 ppm ON · &lt;800 ppm OFF
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("FAN", 1)}
                    className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      liveState.FAN_CMD === 1
                        ? "bg-teal-400 text-slate-950 shadow-md"
                        : "bg-[#050B18] text-slate-300 hover:bg-white/10 border border-white/10"
                    }`}
                  >
                    NYALAKAN (ON)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("FAN", 0)}
                    className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      liveState.FAN_CMD === 0
                        ? "bg-slate-700 text-white border border-slate-500"
                        : "bg-[#050B18] text-slate-300 hover:bg-white/10 border border-white/10"
                    }`}
                  >
                    MATIKAN (OFF)
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-mono">
                Daya K1: {liveState.FAN_CMD === 1 ? "60 W" : "0 W"}
              </span>
              <button
                type="button"
                onClick={() => setMoreInfoDevice("FAN")}
                className="text-teal-300 hover:text-teal-200 font-semibold cursor-pointer"
              >
                Detail Grafik &rarr;
              </button>
            </div>
          </div>

          {/* =============================================================== */}
          {/* 4. KARTU PRIORITAS KONTROL (MODE AUTO / MANUAL)                 */}
          {/* =============================================================== */}
          <div
            className={`bg-gradient-to-b from-[#0B1D3A]/90 to-[#071226]/90 backdrop-blur-xl border rounded-3xl p-4 flex flex-col justify-between transition-all shadow-xl ${
              liveState.AUTO === 1
                ? "border-cyan-400/40"
                : "border-purple-400/50 shadow-purple-500/10"
            }`}
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLiveDevice("MODE", liveState.AUTO === 1 ? 0 : 1)
                    }
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                      liveState.AUTO === 1
                        ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-400/40"
                        : "bg-purple-500/25 text-purple-300 ring-1 ring-purple-400/50"
                    }`}
                    title="Klik untuk beralih antara Mode AUTO dan Mode MANUAL"
                  >
                    <HaIcon path={HA_ICONS.simulasi} sizePx={26} />
                  </button>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      PRIORITAS KONTROL
                    </div>
                    <div className="text-lg font-extrabold font-mono text-white">
                      {liveState.AUTO === 1 ? "AUTO (1)" : "MANUAL (0)"}
                    </div>
                  </div>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                    liveState.AUTO === 1
                      ? "bg-cyan-400/20 text-cyan-300 border border-cyan-400/40"
                      : "bg-purple-500/25 text-purple-300 border border-purple-400/40"
                  }`}
                >
                  {liveState.AUTO === 1 ? "OTOMATIS" : "PETUGAS"}
                </span>
              </div>

              {/* Tombol Segmented AUTO vs MANUAL Dua Arah */}
              <div className="mt-4 space-y-2">
                <div className="text-[11px] text-slate-400">
                  Pilih mode koordinasi Home Assistant:
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("MODE", 1)}
                    className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      liveState.AUTO === 1
                        ? "bg-cyan-400 text-slate-950 shadow-md"
                        : "bg-[#050B18] text-slate-300 hover:bg-white/10 border border-white/10"
                    }`}
                  >
                    MODE AUTO (1)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("MODE", 0)}
                    className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      liveState.AUTO === 0
                        ? "bg-purple-500 text-white shadow-md"
                        : "bg-[#050B18] text-slate-300 hover:bg-white/10 border border-white/10"
                    }`}
                  >
                    MANUAL (0)
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-mono">
                State: {liveState.MODE}
              </span>
              <button
                type="button"
                onClick={() => setMoreInfoDevice("MODE")}
                className="text-purple-300 hover:text-purple-200 font-semibold cursor-pointer"
              >
                Info Mode &rarr;
              </button>
            </div>
          </div>

          {/* =============================================================== */}
          {/* 5. KARTU JAM LAYANAN SPKLU (SERVICE)                            */}
          {/* =============================================================== */}
          <div
            className={`bg-gradient-to-b from-[#0B1D3A]/90 to-[#071226]/90 backdrop-blur-xl border rounded-3xl p-4 flex flex-col justify-between transition-all shadow-xl ${
              liveState.SERVICE === 1
                ? "border-emerald-400/40"
                : "border-rose-500/40"
            }`}
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLiveDevice(
                        "SERVICE",
                        liveState.SERVICE === 1 ? 0 : 1
                      )
                    }
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                      liveState.SERVICE === 1
                        ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
                        : "bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/40"
                    }`}
                    title="Klik untuk mengubah status Jam Layanan (Aktif vs Tutup)"
                  >
                    <HaIcon path={HA_ICONS.clock} sizePx={26} />
                  </button>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      JAM LAYANAN
                    </div>
                    <div className="text-lg font-extrabold font-mono text-white">
                      {liveState.SERVICE === 1 ? "AKTIF (1)" : "TUTUP (0)"}
                    </div>
                  </div>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                    liveState.SERVICE === 1
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
                      : "bg-rose-500/20 text-rose-300 border border-rose-400/40"
                  }`}
                >
                  {liveState.SERVICE === 1 ? "BUKA" : "TUTUP"}
                </span>
              </div>

              {/* Tombol Segmented AKTIF vs TUTUP Dua Arah */}
              <div className="mt-4 space-y-2">
                <div className="text-[11px] text-slate-400">
                  Jadwal operasional SPKLU (08:00–20:00):
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("SERVICE", 1)}
                    className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      liveState.SERVICE === 1
                        ? "bg-emerald-400 text-slate-950 shadow-md"
                        : "bg-[#050B18] text-slate-300 hover:bg-white/10 border border-white/10"
                    }`}
                  >
                    AKTIF (1)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("SERVICE", 0)}
                    className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                      liveState.SERVICE === 0
                        ? "bg-rose-500 text-white shadow-md"
                        : "bg-[#050B18] text-slate-300 hover:bg-white/10 border border-white/10"
                    }`}
                  >
                    TUTUP (0)
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-mono">08:00 – 20:00 WIB</span>
              <button
                type="button"
                onClick={() => setMoreInfoDevice("SERVICE")}
                className="text-emerald-300 hover:text-emerald-200 font-semibold cursor-pointer"
              >
                Info Jadwal &rarr;
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* BARIS 4: 6 KARTU SENSOR FUTURISTIK DENGAN SPARKLINE & TOMBOL UJI    */}
      {/* =================================================================== */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
          TELEMETRI SENSOR NODE A (SHT31 + SCD41) & NODE B (LD2410C + BH1750 +
          PINTU)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          {/* Sensor 1: Suhu */}
          <div className="bg-[#0B1D3A]/70 backdrop-blur-md border border-white/10 hover:border-amber-400/40 rounded-2xl p-4 flex flex-col justify-between transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                SUHU (T_R)
              </span>
              <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center">
                <HaIcon path={HA_ICONS.suhu} sizePx={20} />
              </div>
            </div>
            <div className="text-xl font-extrabold font-mono text-white mt-2">
              {liveState.T_R === "unavailable"
                ? "Unavailable"
                : `${formatAngka(liveState.T_R, 1)} °C`}
            </div>
            <div className="h-10 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={liveState.sparklineHistory}>
                  <Line
                    type="monotone"
                    dataKey="T_R"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Sensor 2: Kelembapan */}
          <div className="bg-[#0B1D3A]/70 backdrop-blur-md border border-white/10 hover:border-sky-400/40 rounded-2xl p-4 flex flex-col justify-between transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                KELEMBAPAN (RH_R)
              </span>
              <div className="w-8 h-8 rounded-lg bg-sky-500/15 text-sky-400 flex items-center justify-center">
                <HaIcon path={HA_ICONS.kelembapan} sizePx={20} />
              </div>
            </div>
            <div className="text-xl font-extrabold font-mono text-white mt-2">
              {liveState.RH_R === "unavailable"
                ? "Unavailable"
                : `${formatAngka(liveState.RH_R, 1)} %RH`}
            </div>
            <div className="h-10 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={liveState.sparklineHistory}>
                  <Line
                    type="monotone"
                    dataKey="RH_R"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Sensor 3: Iluminansi Lux */}
          <div className="bg-[#0B1D3A]/70 backdrop-blur-md border border-white/10 hover:border-yellow-400/40 rounded-2xl p-4 flex flex-col justify-between transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                CAHAYA (L_R)
              </span>
              <div className="w-8 h-8 rounded-lg bg-amber-400/15 text-amber-300 flex items-center justify-center">
                <HaIcon path={HA_ICONS.lux} sizePx={20} />
              </div>
            </div>
            <div className="text-xl font-extrabold font-mono text-white mt-2">
              {liveState.L_R === "unavailable"
                ? "Unavailable"
                : `${formatBulat(liveState.L_R)} lux`}
            </div>
            <div className="h-10 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={liveState.sparklineHistory}>
                  <Line
                    type="monotone"
                    dataKey="L_R"
                    stroke="#fde047"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Sensor 4: CO2 */}
          <div className="bg-[#0B1D3A]/70 backdrop-blur-md border border-white/10 hover:border-teal-400/40 rounded-2xl p-4 flex flex-col justify-between transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                KARBON DIOKSIDA
              </span>
              <div className="w-8 h-8 rounded-lg bg-teal-500/15 text-teal-400 flex items-center justify-center">
                <HaIcon path={HA_ICONS.co2} sizePx={20} />
              </div>
            </div>
            <div className="text-xl font-extrabold font-mono text-white mt-2">
              {liveState.C_R === "unavailable"
                ? "Unavailable"
                : `${formatBulat(liveState.C_R)} ppm`}
            </div>
            <div className="h-10 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={liveState.sparklineHistory}>
                  <Line
                    type="monotone"
                    dataKey="C_R"
                    stroke="#2dd4bf"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Sensor 5: Okupansi (Dilengkapi Tombol Toggle Hadir / Kosong) */}
          <div className="bg-[#0B1D3A]/70 backdrop-blur-md border border-white/10 hover:border-teal-400/40 rounded-2xl p-4 flex flex-col justify-between transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                OKUPANSI (OCC)
              </span>
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  liveState.OCC === 1
                    ? "bg-teal-500/20 text-teal-400"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                <HaIcon
                  path={
                    liveState.OCC === 1
                      ? HA_ICONS.okupansiHadir
                      : HA_ICONS.okupansiKosong
                  }
                  sizePx={20}
                />
              </div>
            </div>
            <div className="text-xl font-extrabold font-mono text-white mt-2">
              {liveState.OCC === "unavailable"
                ? "Offline"
                : liveState.OCC === 1
                ? "1 (Hadir)"
                : "0 (Kosong)"}
            </div>
            <div className="grid grid-cols-2 gap-1 mt-2">
              <button
                type="button"
                onClick={() => onUpdateLiveDevice("OCC", 1)}
                className={`py-1 rounded text-[10px] font-bold cursor-pointer ${
                  liveState.OCC === 1
                    ? "bg-teal-400 text-slate-950"
                    : "bg-[#050B18] text-slate-300 hover:bg-white/10"
                }`}
              >
                Hadir (1)
              </button>
              <button
                type="button"
                onClick={() => onUpdateLiveDevice("OCC", 0)}
                className={`py-1 rounded text-[10px] font-bold cursor-pointer ${
                  liveState.OCC === 0
                    ? "bg-amber-400 text-slate-950"
                    : "bg-[#050B18] text-slate-300 hover:bg-white/10"
                }`}
              >
                Kosong (0)
              </button>
            </div>
          </div>

          {/* Sensor 6: Kontak Pintu (Dilengkapi Tombol Toggle Buka / Tutup) */}
          <div className="bg-[#0B1D3A]/70 backdrop-blur-md border border-white/10 hover:border-amber-400/40 rounded-2xl p-4 flex flex-col justify-between transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                KONTAK PINTU
              </span>
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  liveState.DOOR === 1
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                <HaIcon
                  path={
                    liveState.DOOR === 1
                      ? HA_ICONS.pintuBuka
                      : HA_ICONS.pintuTutup
                  }
                  sizePx={20}
                />
              </div>
            </div>
            <div className="text-xl font-extrabold font-mono text-white mt-2">
              {liveState.DOOR === 1 ? "Terbuka (1)" : "Tertutup (0)"}
            </div>
            <div className="grid grid-cols-2 gap-1 mt-2">
              <button
                type="button"
                onClick={() => onUpdateLiveDevice("DOOR", 1)}
                className={`py-1 rounded text-[10px] font-bold cursor-pointer ${
                  liveState.DOOR === 1
                    ? "bg-amber-400 text-slate-950"
                    : "bg-[#050B18] text-slate-300 hover:bg-white/10"
                }`}
              >
                Buka (1)
              </button>
              <button
                type="button"
                onClick={() => onUpdateLiveDevice("DOOR", 0)}
                className={`py-1 rounded text-[10px] font-bold cursor-pointer ${
                  liveState.DOOR === 0
                    ? "bg-teal-400 text-slate-950"
                    : "bg-[#050B18] text-slate-300 hover:bg-white/10"
                }`}
              >
                Tutup (0)
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* BARIS 5: "PROFIL HARIAN" (DATA METERAN) & "RINCIAN PEMAKAIAN"       */}
      {/* =================================================================== */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Profil Harian (7 Kolom) */}
        <div className="lg:col-span-7 bg-[#0B1D3A]/65 backdrop-blur-md border border-white/10 rounded-3xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                PROFIL HARIAN (RATA-RATA KWH PER JAM)
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Distribusi konsumsi energi jam layanan (08:00–20:00) vs jam tutup
              </p>
            </div>
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-teal-300 bg-teal-500/15 border border-teal-500/30 px-2.5 py-1 rounded-md">
              DATA METERAN
            </span>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyProfileData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  unit=" kWh"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    borderRadius: "12px",
                    color: "#f8fafc",
                  }}
                  formatter={(value: any) => [
                    `${formatAngka(Number(value), 3)} kWh`,
                    "Rata-rata per Jam",
                  ]}
                />
                <Bar
                  dataKey="avgKwh"
                  name="Rata-rata Energi (kWh)"
                  fill="#14b8a6"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Rincian Pemakaian: HANYA 2 Bagian (AC [CTB] vs Non-AC [CTA - CTB]) (5 Kolom) */}
        <div className="lg:col-span-5 bg-[#0B1D3A]/65 backdrop-blur-md border border-white/10 rounded-3xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                RINCIAN PEMAKAIAN (2 KANAL METER)
              </span>
              <span className="text-xs font-mono text-slate-300">
                Total CTA: {formatAngka(usageBreakdown.totalCtaKwh, 2)} kWh
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Shelly Pro EM-50 hanya mengukur <strong>CTA (Total Ruang)</strong>{" "}
              dan <strong>CTB (Subbeban AC)</strong>. Keduanya tidak boleh
              dijumlahkan.
            </p>

            {/* Stacked Progress Bar 2 Bagian */}
            <div className="mt-5">
              <div className="w-full h-5 bg-slate-800 rounded-full overflow-hidden flex">
                <div
                  style={{ width: `${usageBreakdown.acPct}%` }}
                  className="bg-sky-500 h-full transition-all duration-500"
                  title={`AC Split (CTB): ${usageBreakdown.acPct}%`}
                />
                <div
                  style={{ width: `${usageBreakdown.nonAcPct}%` }}
                  className="bg-amber-400 h-full transition-all duration-500"
                  title={`Non-AC (CTA - CTB): ${usageBreakdown.nonAcPct}%`}
                />
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between bg-[#050B18]/60 border border-white/10 rounded-xl p-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-sm bg-sky-500 shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-white">
                        1. Subbeban AC Split (Kanal CTB / P_B)
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Diukur langsung oleh transformator arus CTB
                      </div>
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-sm font-bold text-sky-400">
                      {formatAngka(usageBreakdown.acPct, 1)}%
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {formatAngka(usageBreakdown.totalCtbAcKwh, 2)} kWh
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-[#050B18]/60 border border-white/10 rounded-xl p-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-sm bg-amber-400 shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-white">
                        2. Beban Non-AC (CTA dikurangi CTB)
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Lampu WiZ + Fan Ventilasi K1 + Catu Kontrol ESP32
                      </div>
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-sm font-bold text-amber-400">
                      {formatAngka(usageBreakdown.nonAcPct, 1)}%
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {formatAngka(usageBreakdown.totalNonAcKwh, 2)} kWh
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 text-[11px] text-slate-400 font-mono">
            Invarian Meter: P_B ({liveState.P_B} W) ≤ P_A ({liveState.P_A} W)
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* BARIS 6: DENAH DIGITAL TWIN 5m x 4m (INTERAKTIF) & PANEL ALARM      */}
      {/* =================================================================== */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Denah Ruang Tunggu 5 m x 4 m Interaktif (7 Kolom) */}
        <div className="lg:col-span-7 bg-[#0B1D3A]/65 backdrop-blur-md border border-cyan-500/20 rounded-3xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">
                DIGITAL TWIN RUANG TUNGGU SPKLU (5 M × 4 M — KLIK OBJEK DI DENAH)
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Klik AC, Lampu, Fan K1, Kursi, atau Pintu pada denah untuk
                menguji kendali secara langsung!
              </p>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              Mode: {liveState.MODE}
            </span>
          </div>

          <div className="bg-[#050B18]/90 border border-white/10 rounded-2xl p-3 flex justify-center">
            <svg
              viewBox="0 0 640 420"
              className="w-full max-w-2xl h-auto select-none"
              role="img"
              aria-label="Denah Digital Twin Ruang Tunggu SPKLU 5m x 4m"
            >
              <text
                x="320"
                y="22"
                textAnchor="middle"
                className="fill-sky-400 font-bold text-[12px]"
              >
                JENDELA KACA KE AREA SPKLU (Lebar 5,0 m · Daylight{" "}
                {liveState.naturalDaylightLux} lx)
              </text>

              {/* Dinding 5m x 4m */}
              <rect
                x="60"
                y="34"
                width="520"
                height="340"
                rx="12"
                fill="#081226"
                stroke="#334155"
                strokeWidth="3"
              />

              {/* Jendela SPKLU */}
              <line
                x1="60"
                y1="34"
                x2="580"
                y2="34"
                stroke="#38bdf8"
                strokeWidth="6"
              />

              {/* Pendaran Lampu WiZ saat ON */}
              {liveState.B_L > 0 && (
                <rect
                  x="64"
                  y="38"
                  width="512"
                  height="332"
                  fill="#fbbf24"
                  fillOpacity={Math.min(0.24, (liveState.B_L / 100) * 0.2)}
                />
              )}

              {/* 2 Titik Luminer Lampu WiZ Plafon (Bisa Diklik untuk Toggle Lampu) */}
              {[220, 420].map((cx, i) => (
                <g
                  key={`wiz-${i}`}
                  transform={`translate(${cx}, 115)`}
                  onClick={() =>
                    onUpdateLiveDevice("LIGHT", liveState.B_L > 0 ? 0 : 75)
                  }
                  className="cursor-pointer"
                >
                  <circle
                    cx="0"
                    cy="0"
                    r="24"
                    fill={liveState.B_L > 0 ? "#f59e0b" : "#1e293b"}
                    fillOpacity={liveState.B_L > 0 ? 0.25 : 0.6}
                    stroke={liveState.B_L > 0 ? "#fbbf24" : "#475569"}
                    strokeWidth="2"
                  />
                  <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    className="fill-amber-300 font-mono font-bold text-[9px]"
                  >
                    WiZ {liveState.B_L}%
                  </text>
                </g>
              ))}

              {/* Unit AC Split di Tengah Atas (Bisa Diklik untuk Toggle AC) */}
              <g
                transform="translate(230, 46)"
                onClick={() =>
                  onUpdateLiveDevice("AC", {
                    cmd: liveState.AC_CMD === "COOL_25" ? "OFF" : "COOL_25",
                    setpoint: liveState.AC_SETPOINT_C,
                  })
                }
                className="cursor-pointer"
              >
                <rect
                  x="0"
                  y="0"
                  width="180"
                  height="46"
                  rx="8"
                  fill={liveState.AC_CMD === "COOL_25" ? "#0c4a6e" : "#1e293b"}
                  stroke={
                    liveState.AC_CMD === "COOL_25" ? "#38bdf8" : "#475569"
                  }
                  strokeWidth="2"
                />
                <text
                  x="90"
                  y="19"
                  textAnchor="middle"
                  className="fill-white font-bold text-[12px]"
                >
                  AC SPLIT + RM4 mini (Klik)
                </text>
                <text
                  x="90"
                  y="35"
                  textAnchor="middle"
                  className="fill-sky-300 font-mono text-[10px]"
                >
                  {liveState.AC_CMD === "COOL_25"
                    ? `COOL ${liveState.AC_SETPOINT_C}°C (${liveState.P_B} W)`
                    : "OFF (Standby 5 W)"}
                </text>
              </g>

              {/* Node A (SHT31 + SCD41) Kiri */}
              <g transform="translate(76, 130)">
                <rect
                  x="0"
                  y="0"
                  width="145"
                  height="82"
                  rx="10"
                  fill={liveState.NODE_A_ONLINE ? "#0f2942" : "#450a0a"}
                  stroke={liveState.NODE_A_ONLINE ? "#38bdf8" : "#ef4444"}
                  strokeWidth="2"
                />
                <text
                  x="72"
                  y="21"
                  textAnchor="middle"
                  className="fill-white font-bold text-[12px]"
                >
                  Node A (ESP32)
                </text>
                <text
                  x="72"
                  y="37"
                  textAnchor="middle"
                  className="fill-sky-300 font-semibold text-[10px]"
                >
                  SHT31 + SCD41
                </text>
                <text
                  x="72"
                  y="54"
                  textAnchor="middle"
                  className="fill-slate-200 font-mono text-[10px]"
                >
                  {liveState.T_R === "unavailable"
                    ? "T: N/A"
                    : `${formatAngka(liveState.T_R, 1)}°C`}{" "}
                  ·{" "}
                  {liveState.RH_R === "unavailable"
                    ? "RH: N/A"
                    : `${formatAngka(liveState.RH_R, 0)}%`}
                </text>
                <text
                  x="72"
                  y="70"
                  textAnchor="middle"
                  className="fill-teal-300 font-mono font-bold text-[10px]"
                >
                  CO₂:{" "}
                  {liveState.C_R === "unavailable"
                    ? "N/A"
                    : `${liveState.C_R} ppm`}
                </text>
              </g>

              {/* 6 Kursi Ruang Tunggu (Klik untuk Toggle Hadir/Kosong) */}
              {[0, 1, 2].map((col) =>
                [0, 1].map((row) => {
                  const seatIdx = row * 3 + col;
                  const isOccupied = liveState.OCC === 1 && seatIdx < 4;
                  const xPos = 248 + col * 76;
                  const yPos = 148 + row * 78;
                  return (
                    <g
                      key={`seat-${seatIdx}`}
                      transform={`translate(${xPos}, ${yPos})`}
                      onClick={() =>
                        onUpdateLiveDevice("OCC", liveState.OCC === 1 ? 0 : 1)
                      }
                      className="cursor-pointer"
                    >
                      <rect
                        x="0"
                        y="0"
                        width="62"
                        height="48"
                        rx="8"
                        fill={isOccupied ? "#0f766e" : "#1e293b"}
                        stroke={isOccupied ? "#2dd4bf" : "#475569"}
                        strokeWidth="2"
                      />
                      <text
                        x="31"
                        y="23"
                        textAnchor="middle"
                        className="fill-white font-semibold text-[11px]"
                      >
                        Kursi {seatIdx + 1}
                      </text>
                      <text
                        x="31"
                        y="38"
                        textAnchor="middle"
                        className={
                          isOccupied
                            ? "fill-teal-200 text-[9px]"
                            : "fill-slate-400 text-[9px]"
                        }
                      >
                        {isOccupied ? "Terisi" : "Kosong"}
                      </text>
                    </g>
                  );
                })
              )}

              {/* Udara Masuk */}
              <g transform="translate(60, 255)">
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="60"
                  stroke="#2dd4bf"
                  strokeWidth="7"
                />
                <text
                  x="12"
                  y="26"
                  className="fill-teal-300 font-semibold text-[11px]"
                >
                  Udara masuk
                </text>
              </g>

              {/* Udara Keluar + Fan K1 (Klik untuk Toggle Fan K1) */}
              <g
                transform="translate(580, 165)"
                onClick={() =>
                  onUpdateLiveDevice("FAN", liveState.FAN_CMD === 1 ? 0 : 1)
                }
                className="cursor-pointer"
              >
                <rect
                  x="-115"
                  y="0"
                  width="115"
                  height="64"
                  rx="8"
                  fill={liveState.FAN_CMD === 1 ? "#115e59" : "#1e293b"}
                  stroke={liveState.FAN_CMD === 1 ? "#2dd4bf" : "#475569"}
                  strokeWidth="2"
                />
                <text
                  x="-57"
                  y="25"
                  textAnchor="middle"
                  className="fill-white font-bold text-[11px]"
                >
                  FAN K1 (Klik)
                </text>
                <text
                  x="-57"
                  y="45"
                  textAnchor="middle"
                  className="fill-teal-300 font-mono font-bold text-[11px]"
                >
                  {liveState.FAN_CMD === 1 ? "ON (60 W)" : "OFF (0 W)"}
                </text>
              </g>

              {/* Node B (LD2410C + BH1750) Kanan Bawah */}
              <g transform="translate(415, 292)">
                <rect
                  x="0"
                  y="0"
                  width="150"
                  height="68"
                  rx="10"
                  fill={liveState.NODE_B_ONLINE ? "#0f2942" : "#450a0a"}
                  stroke={liveState.NODE_B_ONLINE ? "#38bdf8" : "#ef4444"}
                  strokeWidth="2"
                />
                <text
                  x="75"
                  y="20"
                  textAnchor="middle"
                  className="fill-white font-bold text-[12px]"
                >
                  Node B (ESP32)
                </text>
                <text
                  x="75"
                  y="36"
                  textAnchor="middle"
                  className="fill-sky-300 font-semibold text-[10px]"
                >
                  LD2410C + BH1750
                </text>
                <text
                  x="75"
                  y="54"
                  textAnchor="middle"
                  className="fill-amber-300 font-mono font-bold text-[10px]"
                >
                  OCC: {String(liveState.OCC)} · Lux:{" "}
                  {liveState.L_R === "unavailable"
                    ? "N/A"
                    : `${liveState.L_R}`}
                </text>
              </g>

              {/* Pintu + Kontak (Klik untuk Toggle Buka/Tutup Pintu) */}
              <g
                transform="translate(115, 374)"
                onClick={() =>
                  onUpdateLiveDevice("DOOR", liveState.DOOR === 1 ? 0 : 1)
                }
                className="cursor-pointer"
              >
                <line
                  x1="0"
                  y1="0"
                  x2={liveState.DOOR === 1 ? "65" : "85"}
                  y2={liveState.DOOR === 1 ? "-25" : "0"}
                  stroke="#fbbf24"
                  strokeWidth="5"
                />
                <text
                  x="42"
                  y="20"
                  textAnchor="middle"
                  className="fill-amber-300 font-semibold text-[11px]"
                >
                  Pintu (Klik: {liveState.DOOR === 1 ? "Terbuka" : "Tertutup"})
                </text>
              </g>
            </svg>
          </div>
        </div>

        {/* Panel Alarm Gangguan & Log Aksi Terbaru (5 Kolom) */}
        <div className="lg:col-span-5 bg-[#0B1D3A]/65 backdrop-blur-md border border-white/10 rounded-3xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                PANEL ALARM & LOG AKSI TERBARU
              </span>
              <HaIcon
                path={
                  liveState.ALARM_ACTIVE
                    ? HA_ICONS.alarmActive
                    : HA_ICONS.alarmNormal
                }
                sizePx={22}
                className={
                  liveState.ALARM_ACTIVE ? "text-rose-400" : "text-teal-400"
                }
              />
            </div>

            {/* Kotak Status Alarm */}
            <div
              className={`mt-3 rounded-2xl p-4 border ${
                liveState.ALARM_ACTIVE
                  ? "bg-rose-950/60 border-rose-500/50 text-rose-200"
                  : "bg-teal-950/40 border-teal-500/30 text-teal-200"
              }`}
            >
              <div className="text-xs font-bold uppercase tracking-wider">
                {liveState.ALARM_ACTIVE
                  ? "ALARM GANGGUAN AKTIF (FALLBACK)"
                  : "TIDAK ADA ALARM GANGGUAN"}
              </div>
              <p className="text-xs mt-1 leading-relaxed">
                {liveState.ALARM_MESSAGE}
              </p>
            </div>

            {/* Daftar Log Aksi Terbaru (Membedakan Pembacaan Sensor vs Injeksi Simulasi) */}
            <div className="mt-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                RIWAYAT LOG AKSI & KENDALI PERANGKAT
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {actionLogs.length === 0 ? (
                  <div className="text-xs text-slate-400 bg-[#050B18]/60 rounded-xl p-3">
                    Belum ada aksi manual atau injeksi simulasi. Mesin live
                    berjalan otomatis tiap 3 detik.
                  </div>
                ) : (
                  actionLogs.slice(0, 10).map((log) => (
                    <div
                      key={log.id}
                      className="bg-[#050B18]/75 border border-white/10 rounded-xl p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-white">
                          {log.actionTitle}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">
                          {log.timeStr}
                        </span>
                      </div>
                      <p className="text-slate-300 text-[11px] mt-1 leading-relaxed">
                        {log.detail}
                      </p>
                      <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono">
                        <span className="text-slate-400">{log.actor}</span>
                        <span
                          className={
                            log.sourceTag === "injeksi simulasi"
                              ? "text-amber-400 font-semibold"
                              : "text-teal-400"
                          }
                        >
                          Sumber: {log.sourceTag}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* BARIS 7: 5 GRAFIK HISTORIS 14 HARI (FILTER TANGGAL & MANUAL/AUTO)   */}
      {/* =================================================================== */}
      <section className="bg-[#0B1D3A]/65 backdrop-blur-md border border-white/10 rounded-3xl p-5 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
              GRAFIK TELEMETRI HARIAN (14 HARI SIMULASI · INTERVAL 5 MENIT)
            </div>
            <h3 className="text-base font-bold text-white mt-0.5">
              Hari ke-{selectedDay} — {currentDaySummary.dayName},{" "}
              {formatTanggalIndo(currentDaySummary.dateStr)} (Mode{" "}
              {currentDaySummary.modeLabel})
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 bg-[#050B18] border border-white/10 rounded-xl">
              <button
                type="button"
                onClick={() => handleModeFilterChange("ALL")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  modeFilter === "ALL"
                    ? "bg-teal-500 text-slate-950 font-bold"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                Semua (14 Hari)
              </button>
              <button
                type="button"
                onClick={() => handleModeFilterChange("MANUAL")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  modeFilter === "MANUAL"
                    ? "bg-blue-500 text-white font-bold"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                Manual (H1–H7)
              </button>
              <button
                type="button"
                onClick={() => handleModeFilterChange("AUTO")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  modeFilter === "AUTO"
                    ? "bg-teal-500 text-slate-950 font-bold"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                Auto (H8–H14)
              </button>
            </div>

            <select
              aria-label="Pilih Tanggal Grafik"
              value={selectedDay}
              onChange={(e) => onSelectDay(Number(e.target.value))}
              className="bg-[#050B18] border border-white/15 text-white text-xs font-semibold rounded-xl px-3.5 py-2 focus:outline-none focus:border-teal-400"
            >
              {filteredDays.map((d) => (
                <option key={d.dayIndex} value={d.dayIndex}>
                  Hari {d.dayIndex} — {d.dayName},{" "}
                  {formatTanggalIndo(d.dateStr)} ({d.modeLabel})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Grafik 1: Suhu + Kelembapan */}
          <div className="bg-[#050B18]/60 border border-white/10 rounded-2xl p-4">
            <div className="text-xs font-bold text-white mb-1">
              1. Suhu (T_R) & Kelembapan (RH_R)
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Target pendinginan AC COOL 25,0 °C saat ruang digunakan
            </p>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="timeStr"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                  />
                  <YAxis
                    yAxisId="left"
                    domain={[20, 35]}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    unit="°C"
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[40, 85]}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    unit="%"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: "12px",
                      color: "#f8fafc",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine
                    yAxisId="left"
                    y={25}
                    stroke="#2dd4bf"
                    strokeDasharray="4 4"
                  />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="T_R"
                    name="Suhu T_R (°C)"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="RH_R"
                    name="Kelembapan RH_R (%)"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Grafik 2: Lux dengan pita 270-330 */}
          <div className="bg-[#050B18]/60 border border-white/10 rounded-2xl p-4">
            <div className="text-xs font-bold text-white mb-1">
              2. Iluminansi (L_R) & Pita Deadband (270–330 lux)
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Evaluasi dimming WiZ langkah 5% menjaga target 300 lux
            </p>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="timeStr"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                  />
                  <YAxis
                    domain={[0, 450]}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    unit=" lx"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: "12px",
                      color: "#f8fafc",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceArea
                    y1={270}
                    y2={330}
                    fill="#14b8a6"
                    fillOpacity={0.2}
                  />
                  <Area
                    type="monotone"
                    dataKey="L_R"
                    name="Iluminansi L_R (lux)"
                    stroke="#2dd4bf"
                    fill="#14b8a6"
                    fillOpacity={0.25}
                    strokeWidth={2}
                  />
                  <Line
                    type="stepAfter"
                    dataKey="B_L"
                    name="Brightness B_L (%)"
                    stroke="#fbbf24"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Grafik 3: CO2 dengan garis 800 dan 1.000 ppm */}
          <div className="bg-[#050B18]/60 border border-white/10 rounded-2xl p-4">
            <div className="text-xs font-bold text-white mb-1">
              3. Kadar CO₂ (C_R) & Garis Histeresis (800 / 1.000 ppm)
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Fan K1 ON saat &gt; 1.000 ppm · OFF saat &lt; 800 ppm
            </p>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="timeStr"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                  />
                  <YAxis
                    domain={[350, 1300]}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    unit=" ppm"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: "12px",
                      color: "#f8fafc",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine
                    y={1000}
                    stroke="#f43f5e"
                    strokeDasharray="4 4"
                  />
                  <ReferenceLine
                    y={800}
                    stroke="#2dd4bf"
                    strokeDasharray="4 4"
                  />
                  <Line
                    type="monotone"
                    dataKey="C_R"
                    name="Kadar CO₂ (ppm)"
                    stroke="#a855f7"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Grafik 4: Daya P_A vs P_B */}
          <div className="bg-[#050B18]/60 border border-white/10 rounded-2xl p-4">
            <div className="text-xs font-bold text-white mb-1">
              4. Daya Listrik: CTA Total Ruang (P_A) vs CTB Subbeban AC (P_B)
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Invarian P_B ≤ P_A; kedua kanal tidak dijumlahkan
            </p>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="timeStr"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                  />
                  <YAxis
                    domain={[0, 1050]}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    unit=" W"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      borderColor: "#334155",
                      borderRadius: "12px",
                      color: "#f8fafc",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    type="stepAfter"
                    dataKey="P_A"
                    name="CTA Daya Total P_A (W)"
                    stroke="#38bdf8"
                    fill="#38bdf8"
                    fillOpacity={0.25}
                    strokeWidth={2}
                  />
                  <Area
                    type="stepAfter"
                    dataKey="P_B"
                    name="CTB Daya AC P_B (W)"
                    stroke="#2dd4bf"
                    fill="#2dd4bf"
                    fillOpacity={0.35}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Grafik 5: Timeline Mode Operasi */}
        <div className="bg-[#050B18]/60 border border-white/10 rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="text-xs font-bold text-white">
              5. Timeline Mode Operasi Sistem (24 Jam)
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
              <span className="text-slate-400">1=SIAP</span>
              <span className="text-amber-400">2=TUNDA_KOSONG</span>
              <span className="text-teal-400">3=DIGUNAKAN</span>
              <span className="text-blue-400">4=MANUAL</span>
              <span className="text-rose-400">5=GANGGUAN</span>
            </div>
          </div>
          <div className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="timeStr"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                />
                <YAxis
                  domain={[0, 5]}
                  ticks={[1, 2, 3, 4, 5]}
                  tickFormatter={(v) => {
                    if (v === 1) return "SIAP";
                    if (v === 2) return "TUNDA";
                    if (v === 3) return "HADIR";
                    if (v === 4) return "MANUAL";
                    if (v === 5) return "FAULT";
                    return "";
                  }}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    borderRadius: "12px",
                    color: "#f8fafc",
                  }}
                  formatter={(_val: any, _name: any, props: any) => [
                    props?.payload?.MODE || "",
                    "Mode Operasi",
                  ]}
                />
                <Bar dataKey="modeNum" name="Mode Operasi">
                  {chartData.map((entry, index) => {
                    let color = "#475569";
                    if (entry.MODE === "DIGUNAKAN") color = "#14b8a6";
                    else if (entry.MODE === "TUNDA_KOSONG") color = "#f59e0b";
                    else if (entry.MODE === "MANUAL") color = "#3b82f6";
                    else if (entry.MODE === "GANGGUAN") color = "#f43f5e";
                    return <Cell key={`c-${index}`} fill={color} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* =================================================================== */}
      {/* DIALOG MODAL "MORE-INFO" ALA HOME ASSISTANT SAAT KARTU DIKLIK       */}
      {/* =================================================================== */}
      {moreInfoDevice && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0B1D3A] border border-cyan-400/30 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center">
                  <HaIcon
                    path={
                      moreInfoDevice === "LIGHT"
                        ? HA_ICONS.lampuOn
                        : moreInfoDevice === "AC"
                        ? HA_ICONS.ac
                        : moreInfoDevice === "FAN"
                        ? HA_ICONS.fan
                        : moreInfoDevice === "MODE"
                        ? HA_ICONS.simulasi
                        : HA_ICONS.clock
                    }
                    sizePx={24}
                  />
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-teal-400">
                    HOME ASSISTANT MORE-INFO DIALOG
                  </div>
                  <h4 className="text-base font-bold text-white">
                    {moreInfoDevice === "LIGHT" &&
                      "Lampu WiZ Dimmable (light.ruang_tunggu_wiz)"}
                    {moreInfoDevice === "AC" &&
                      "AC Split RM4 mini (climate.ruang_tunggu_ac)"}
                    {moreInfoDevice === "FAN" &&
                      "Fan Ventilasi K1 (switch.shelly_em50_k1)"}
                    {moreInfoDevice === "MODE" &&
                      "Mode Koordinasi (input_boolean.mode_auto)"}
                    {moreInfoDevice === "SERVICE" &&
                      "Status Jam Layanan (binary_sensor.layanan)"}
                  </h4>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMoreInfoDevice(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                <HaIcon path={HA_ICONS.close} sizePx={22} />
              </button>
            </div>

            {/* Konten Kontrol Spesifik Perangkat */}
            {moreInfoDevice === "LIGHT" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">Brightness Saat Ini:</span>
                  <span className="font-mono font-bold text-amber-400 text-lg">
                    {liveState.B_L}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={liveState.B_L}
                  onChange={(e) =>
                    onUpdateLiveDevice("LIGHT", Number(e.target.value))
                  }
                  className="w-full accent-amber-400 cursor-pointer"
                />
                <div className="flex items-center gap-2">
                  {[0, 25, 50, 75, 100].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => onUpdateLiveDevice("LIGHT", val)}
                      className={`flex-1 py-1.5 text-xs font-mono font-semibold border rounded-lg cursor-pointer ${
                        liveState.B_L === val
                          ? "bg-amber-400 text-slate-950 border-amber-300"
                          : "bg-[#050B18] hover:bg-slate-800 border-white/10 text-white"
                      }`}
                    >
                      {val === 0 ? "OFF" : `${val}%`}
                    </button>
                  ))}
                </div>
                <div className="h-36 bg-[#050B18]/80 rounded-xl p-3 border border-white/10">
                  <div className="text-[10px] text-slate-400 mb-1">
                    Mini-Grafik Riwayat Brightness Live (%)
                  </div>
                  <ResponsiveContainer width="100%" height="85%">
                    <AreaChart data={liveState.sparklineHistory}>
                      <Area
                        type="stepAfter"
                        dataKey="B_L"
                        stroke="#fbbf24"
                        fill="#fbbf24"
                        fillOpacity={0.25}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {moreInfoDevice === "AC" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">Status Verifikasi CTB:</span>
                  <span
                    className={`font-mono font-bold ${
                      liveState.AC_STATUS_TEXT === "Belum terverifikasi"
                        ? "text-amber-400"
                        : "text-teal-400"
                    }`}
                  >
                    {liveState.AC_STATUS_TEXT} (Daya P_B: {liveState.P_B} W)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLiveDevice("AC", {
                        cmd: "COOL_25",
                        setpoint: liveState.AC_SETPOINT_C,
                      })
                    }
                    className={`py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                      liveState.AC_CMD === "COOL_25"
                        ? "bg-sky-500 text-slate-950 border-sky-400"
                        : "bg-[#050B18] text-slate-300 border-white/10"
                    }`}
                  >
                    COOL ({liveState.AC_SETPOINT_C} °C)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateLiveDevice("AC", {
                        cmd: "OFF",
                        setpoint: liveState.AC_SETPOINT_C,
                      })
                    }
                    className={`py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                      liveState.AC_CMD === "OFF"
                        ? "bg-rose-500 text-white border-rose-400"
                        : "bg-[#050B18] text-slate-300 border-white/10"
                    }`}
                  >
                    MATIKAN (OFF)
                  </button>
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Setpoint Suhu IR (22–28 °C):{" "}
                    <strong className="font-mono text-sky-400">
                      {liveState.AC_SETPOINT_C} °C
                    </strong>
                  </label>
                  <input
                    type="range"
                    min={22}
                    max={28}
                    step={1}
                    value={liveState.AC_SETPOINT_C}
                    onChange={(e) =>
                      onUpdateLiveDevice("AC", {
                        cmd: "COOL_25",
                        setpoint: Number(e.target.value),
                      })
                    }
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>
                <div className="h-36 bg-[#050B18]/80 rounded-xl p-3 border border-white/10">
                  <div className="text-[10px] text-slate-400 mb-1">
                    Mini-Grafik Daya Subbeban AC CTB (W)
                  </div>
                  <ResponsiveContainer width="100%" height="85%">
                    <AreaChart data={liveState.sparklineHistory}>
                      <Area
                        type="monotone"
                        dataKey="P_B"
                        stroke="#38bdf8"
                        fill="#38bdf8"
                        fillOpacity={0.25}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {moreInfoDevice === "FAN" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("FAN", 1)}
                    className={`py-2.5 rounded-xl text-xs font-bold border cursor-pointer ${
                      liveState.FAN_CMD === 1
                        ? "bg-teal-500 text-slate-950 border-teal-400"
                        : "bg-[#050B18] text-slate-300 border-white/10"
                    }`}
                  >
                    NYALAKAN FAN (ON)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("FAN", 0)}
                    className={`py-2.5 rounded-xl text-xs font-bold border cursor-pointer ${
                      liveState.FAN_CMD === 0
                        ? "bg-slate-700 text-white border-slate-500"
                        : "bg-[#050B18] text-slate-300 border-white/10"
                    }`}
                  >
                    MATIKAN FAN (OFF)
                  </button>
                </div>
                <div className="h-36 bg-[#050B18]/80 rounded-xl p-3 border border-white/10">
                  <div className="text-[10px] text-slate-400 mb-1">
                    Mini-Grafik Kadar CO₂ Live (ppm)
                  </div>
                  <ResponsiveContainer width="100%" height="85%">
                    <LineChart data={liveState.sparklineHistory}>
                      <Line
                        type="monotone"
                        dataKey="C_R"
                        stroke="#2dd4bf"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {moreInfoDevice === "MODE" && (
              <div className="space-y-3">
                <p className="text-xs text-slate-300 leading-relaxed">
                  Pilih apakah ruangan dikendalikan otomatis oleh Home Assistant
                  (<strong>AUTO</strong>) atau diambil alih oleh petugas (
                  <strong>MANUAL</strong>).
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("MODE", 1)}
                    className={`py-2.5 rounded-xl text-xs font-bold border cursor-pointer ${
                      liveState.AUTO === 1
                        ? "bg-teal-500 text-slate-950 border-teal-400"
                        : "bg-[#050B18] text-slate-300 border-white/10"
                    }`}
                  >
                    MODE AUTO (1)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("MODE", 0)}
                    className={`py-2.5 rounded-xl text-xs font-bold border cursor-pointer ${
                      liveState.AUTO === 0
                        ? "bg-purple-500 text-white border-purple-400"
                        : "bg-[#050B18] text-slate-300 border-white/10"
                    }`}
                  >
                    MODE MANUAL (0)
                  </button>
                </div>
              </div>
            )}

            {moreInfoDevice === "SERVICE" && (
              <div className="space-y-3">
                <p className="text-xs text-slate-300 leading-relaxed">
                  Simulasikan status jam layanan ruang tunggu SPKLU (Buka vs
                  Tutup).
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("SERVICE", 1)}
                    className={`py-2.5 rounded-xl text-xs font-bold border cursor-pointer ${
                      liveState.SERVICE === 1
                        ? "bg-teal-500 text-slate-950 border-teal-400"
                        : "bg-[#050B18] text-slate-300 border-white/10"
                    }`}
                  >
                    LAYANAN AKTIF (1)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateLiveDevice("SERVICE", 0)}
                    className={`py-2.5 rounded-xl text-xs font-bold border cursor-pointer ${
                      liveState.SERVICE === 0
                        ? "bg-rose-500 text-white border-rose-400"
                        : "bg-[#050B18] text-slate-300 border-white/10"
                    }`}
                  >
                    LAYANAN TUTUP (0)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
