/**
 * File: src/data/dataSource.ts
 * Lapisan sumber data terpadu (Data Source Layer) yang menyediakan antarmuka yang sama
 * untuk mode 'dummy' (simulasi) dan mode 'homeassistant' (kerangka integrasi nyata).
 *
 * Menyediakan 3 lapis data yang saling konsisten:
 * (a) Detail 14 hari interval 5 menit (Hari 1–7 MANUAL, Hari 8–14 AUTO), lengkap dengan
 *     gangguan, outlier, nilai unavailable, duplikat, dan 7 episode keluar singkat 1-menit.
 * (b) Riwayat bulanan 36 bulan (kWh) dengan pola musiman tropis dan tren ringan untuk Prediktor.
 * (c) Perhitungan tagihan & proyeksi bulan berjalan (Tagihan = kWh × Tarif, default Rp 1.445/kWh).
 */

import {
  generateDummyDataset,
  TelemetryRow,
  SimulationConfig,
  DEFAULT_SIM_CONFIG,
} from "./dummyGenerator";
import {
  DataSourceMode,
  DEFAULT_DATA_SOURCE_MODE,
  DEFAULT_TARIFF_PER_KWH,
} from "../config/appConfig";

export interface MonthlyEnergyRecord {
  index: number; // 1 s/d 36
  year: number;
  month: number; // 1 s/d 12
  periodKey: string; // "2024-01"
  label: string; // "Jan 24"
  fullLabel: string; // "Januari 2024"
  kwh: number; // Konsumsi energi bulanan (kWh)
  acKwh: number; // Bagian subbeban AC (CTB)
  nonAcKwh: number; // Bagian non-AC (CTA - CTB)
  costRp: number; // Tagihan (kWh * tarif)
  avgDailyKwh: number;
}

export interface CurrentMonthProjection {
  currentMonthLabel: string; // "Oktober 2026"
  recordedDays: number; // misal: hari ke-14
  totalDaysInMonth: number; // 31 hari
  recordedKwhSoFar: number; // kWh tercatat sampai hari ke-n
  projectedMonthKwh: number; // Proyeksi sampai akhir bulan
  projectedMonthCostRp: number; // Proyeksi tagihan bulan berjalan (Rp)
  lastMonthKwh: number; // Bulan ke-36 (September 2026)
  lastMonthCostRp: number;
  dailyAverageKwh: number;
  dailyAverageCostRp: number;
  changePercentVsLastMonth: number; // negatif = turun (hemat), positif = naik
  tariffPerKwh: number;
}

export interface SmartRoomDatasetBundle {
  mode: DataSourceMode;
  telemetry14Days: TelemetryRow[];
  monthlyHistory36: MonthlyEnergyRecord[];
  billingProjection: CurrentMonthProjection;
  haConnectionNote?: string;
}

/**
 * Daftar pemetaan Entity ID Home Assistant yang disiapkan untuk mode 'homeassistant'
 * (Sesuai dokumen rancangan Halaman 9 & 12 PDF).
 */
export const HOME_ASSISTANT_ENTITY_MAP = {
  // Sensor Node A (ESP32-DevKitC V4 via ESPHome Native API)
  T_R: "sensor.node_a_sht31_temperature", // Suhu ruang (°C)
  RH_R: "sensor.node_a_sht31_humidity", // Kelembapan (%RH)
  C_R: "sensor.node_a_scd41_co2", // Kadar CO2 (ppm)

  // Sensor Node B (ESP32-DevKitC V4 via ESPHome Native API)
  OCC: "binary_sensor.node_b_ld2410c_occupancy", // Kehadiran duduk diam (on/off)
  L_R: "sensor.node_b_bh1750_illuminance", // Iluminansi cahaya (lux)
  DOOR: "binary_sensor.node_b_door_contact", // Kontak magnet pintu (GPIO27)

  // Input Operator & Jadwal Layanan di Home Assistant
  AUTO: "input_boolean.ruang_tunggu_mode_auto", // Prioritas mode AUTO (1) vs MANUAL (0)
  SERVICE: "binary_sensor.ruang_tunggu_jam_layanan", // Jam layanan aktif (08:00-20:00)

  // Aktuator Keluaran
  B_L: "light.ruang_tunggu_wiz_dimmable", // Atribut brightness_pct (0-100%)
  AC_CMD: "climate.ruang_tunggu_ac_broadlink_rm4", // Perintah IR (off / cool 25°C)
  FAN_CMD: "switch.shelly_pro_em50_relay_k1", // Relay kontaktor K1 kipas ventilasi

  // Meter Energi Shelly Pro EM-50 (Dual CT)
  P_A: "sensor.shelly_pro_em50_channel_a_power", // CTA = Daya total ruang (W)
  E_A: "sensor.shelly_pro_em50_channel_a_energy", // CTA = Energi kumulatif ruang (kWh)
  P_B: "sensor.shelly_pro_em50_channel_b_power", // CTB = Daya subbeban AC saja (W)
};

const NAMA_BULAN_PENDEK = [
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

const NAMA_BULAN_LENGKAP = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/**
 * Menghasilkan riwayat konsumsi energi bulanan selama 36 bulan terakhir
 * (Oktober 2023 s/d September 2026) yang konsisten dengan skala konsumsi ruang tunggu SPKLU
 * (~175 s/d 245 kWh/bulan, atau ~6–8 kWh/hari), memiliki pola musiman (kemarau/panas = AC lebih tinggi)
 * dan tren ringan.
 */
export function generate36MonthsHistory(
  tariffPerKwh: number = DEFAULT_TARIFF_PER_KWH,
  seed: number = 202609
): MonthlyEnergyRecord[] {
  let s = seed + 99;
  const rand = () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const records: MonthlyEnergyRecord[] = [];
  // Mulai dari Oktober 2023 (bulan 10, tahun 2023) sebanyak 36 bulan hingga September 2026
  let year = 2023;
  let month = 10; // 1..12

  for (let i = 1; i <= 36; i++) {
    // Pola musiman 12 bulanan: bulan panas/pancaroba (Apr-Mei & Sep-Nov) beban AC sedikit lebih tinggi
    const seasonalWave =
      Math.sin(((month - 2) / 12) * 2 * Math.PI) * 18 +
      Math.cos(((month - 9) / 6) * 2 * Math.PI) * 11;

    // Tren pertumbuhan kunjungan kendaraan listrik ke SPKLU (+0,45 kWh per bulan),
    // lalu mulai melandai di 4 bulan terakhir karena uji coba manajemen beban
    const trendComponent = i <= 32 ? i * 0.48 : 32 * 0.48 - (i - 32) * 3.2;

    const noise = (rand() - 0.5) * 9.5;
    const baseMonthlyKwh = 198 + seasonalWave + trendComponent + noise;
    const kwh = Number(Math.max(150, baseMonthlyKwh).toFixed(1));

    // Proporsi AC (CTB) sekitar 82% - 86% dari total ruang (CTA)
    const acRatio = 0.83 + (rand() - 0.5) * 0.03;
    const acKwh = Number((kwh * acRatio).toFixed(1));
    const nonAcKwh = Number((kwh - acKwh).toFixed(1));
    const costRp = Math.round(kwh * tariffPerKwh);

    const shortYear = String(year).slice(-2);
    records.push({
      index: i,
      year,
      month,
      periodKey: `${year}-${String(month).padStart(2, "0")}`,
      label: `${NAMA_BULAN_PENDEK[month - 1]} ${shortYear}`,
      fullLabel: `${NAMA_BULAN_LENGKAP[month - 1]} ${year}`,
      kwh,
      acKwh,
      nonAcKwh,
      costRp,
      avgDailyKwh: Number((kwh / 30).toFixed(2)),
    });

    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return records;
}

/**
 * Menghitung proyeksi bulan berjalan (Oktober 2026) yang konsisten dengan
 * data 14 hari tercatat (7 hari MANUAL + 7 hari AUTO) dan riwayat bulan lalu (September 2026).
 */
export function calculateCurrentMonthProjection(
  telemetry14Days: TelemetryRow[],
  monthlyHistory36: MonthlyEnergyRecord[],
  tariffPerKwh: number = DEFAULT_TARIFF_PER_KWH
): CurrentMonthProjection {
  // Deduplikasi baris untuk menghitung energi 14 hari secara akurat
  const seen = new Set<string>();
  let recordedKwhSoFar = 0;
  for (const r of telemetry14Days) {
    if (!seen.has(r.timestamp)) {
      seen.add(r.timestamp);
      const dtHours = (r.stepMinutes ?? 5) / 60;
      recordedKwhSoFar += (r.P_A * dtHours) / 1000;
    }
  }
  recordedKwhSoFar = Number(recordedKwhSoFar.toFixed(1));

  const recordedDays = 14;
  const totalDaysInMonth = 31; // Oktober memiliki 31 hari

  // Sisa 17 hari di bulan Oktober beroperasi dengan mode AUTO (rata-rata harian minggu ke-2)
  let autoWeekKwh = 0;
  const seenAuto = new Set<string>();
  for (const r of telemetry14Days) {
    if (r.dayIndex >= 8 && !seenAuto.has(r.timestamp)) {
      seenAuto.add(r.timestamp);
      const dtHours = (r.stepMinutes ?? 5) / 60;
      autoWeekKwh += (r.P_A * dtHours) / 1000;
    }
  }
  const autoDailyAvg = autoWeekKwh / 7;
  const remainingDays = totalDaysInMonth - recordedDays;

  const projectedMonthKwh = Number(
    (recordedKwhSoFar + remainingDays * autoDailyAvg).toFixed(1)
  );
  const projectedMonthCostRp = Math.round(projectedMonthKwh * tariffPerKwh);

  const lastMonthRecord = monthlyHistory36[monthlyHistory36.length - 1];
  const lastMonthKwh = lastMonthRecord ? lastMonthRecord.kwh : 218.5;
  const lastMonthCostRp = Math.round(lastMonthKwh * tariffPerKwh);

  const dailyAverageKwh = Number(
    (projectedMonthKwh / totalDaysInMonth).toFixed(2)
  );
  const dailyAverageCostRp = Math.round(dailyAverageKwh * tariffPerKwh);

  const changePercentVsLastMonth =
    lastMonthKwh > 0
      ? Number(
          (((projectedMonthKwh - lastMonthKwh) / lastMonthKwh) * 100).toFixed(1)
        )
      : 0;

  return {
    currentMonthLabel: "Oktober 2026",
    recordedDays,
    totalDaysInMonth,
    recordedKwhSoFar,
    projectedMonthKwh,
    projectedMonthCostRp,
    lastMonthKwh,
    lastMonthCostRp,
    dailyAverageKwh,
    dailyAverageCostRp,
    changePercentVsLastMonth,
    tariffPerKwh,
  };
}

/**
 * Kerangka sumber data untuk mode 'homeassistant'.
 * Menjelaskan bagaimana aplikasi dihubungkan ke Home Assistant OS (VM VirtualBox) nantinya.
 */
export function getHomeAssistantSkeletonDataset(
  simConfig: SimulationConfig,
  tariffPerKwh: number
): SmartRoomDatasetBundle {
  /*
   * ==========================================================================
   * PANDUAN INTEGRASI MODE 'homeassistant' (UNTUK IMPLEMENTASI LAPANGAN):
   * ==========================================================================
   * 1. Buat Long-Lived Access Token di profil Home Assistant (http://homeassistant.local:8123).
   * 2. Hubungkan WebSocket ke `ws://<IP_HA_VIRTUALBOX>:8123/api/websocket` atau REST API `/api/states`.
   * 3. Petakan setiap entity di `HOME_ASSISTANT_ENTITY_MAP` ke dalam struktur `TelemetryRow`:
   *    - T_R     <- parseFloat(states[HOME_ASSISTANT_ENTITY_MAP.T_R].state)
   *    - RH_R    <- parseFloat(states[HOME_ASSISTANT_ENTITY_MAP.RH_R].state)
   *    - C_R     <- parseFloat(states[HOME_ASSISTANT_ENTITY_MAP.C_R].state)
   *    - L_R     <- parseFloat(states[HOME_ASSISTANT_ENTITY_MAP.L_R].state)
   *    - OCC     <- states[HOME_ASSISTANT_ENTITY_MAP.OCC].state === 'on' ? 1 : 0
   *    - DOOR    <- states[HOME_ASSISTANT_ENTITY_MAP.DOOR].state === 'on' ? 1 : 0
   *    - B_L     <- states[HOME_ASSISTANT_ENTITY_MAP.B_L].attributes.brightness_pct
   *    - AC_CMD  <- states[HOME_ASSISTANT_ENTITY_MAP.AC_CMD].state === 'cool' ? 'COOL_25' : 'OFF'
   *    - FAN_CMD <- states[HOME_ASSISTANT_ENTITY_MAP.FAN_CMD].state === 'on' ? 1 : 0
   *    - P_A     <- parseFloat(states[HOME_ASSISTANT_ENTITY_MAP.P_A].state)
   *    - P_B     <- parseFloat(states[HOME_ASSISTANT_ENTITY_MAP.P_B].state)
   *    - E_A     <- parseFloat(states[HOME_ASSISTANT_ENTITY_MAP.E_A].state)
   * 4. Untuk riwayat historis 14 hari, panggil endpoint `/api/history/period/<start_timestamp>`.
   */
  const fallbackTelemetry = generateDummyDataset(simConfig);
  const monthlyHistory36 = generate36MonthsHistory(tariffPerKwh, simConfig.seed);
  const billingProjection = calculateCurrentMonthProjection(
    fallbackTelemetry,
    monthlyHistory36,
    tariffPerKwh
  );

  return {
    mode: "homeassistant",
    telemetry14Days: fallbackTelemetry,
    monthlyHistory36,
    billingProjection,
    haConnectionNote:
      "Mode Kerangka Home Assistant Aktif: Menampilkan struktur entity HA (sensor.node_a_*, sensor.node_b_*, shelly_pro_em50_*) dengan data cadangan lokal hingga URL & Token HA dihubungkan.",
  };
}

/**
 * Fungsi utama pengambil dataset berdasarkan mode ('dummy' | 'homeassistant').
 */
export function loadSmartRoomDataSource(
  mode: DataSourceMode = DEFAULT_DATA_SOURCE_MODE,
  simConfig: SimulationConfig = DEFAULT_SIM_CONFIG,
  tariffPerKwh: number = DEFAULT_TARIFF_PER_KWH
): SmartRoomDatasetBundle {
  if (mode === "homeassistant") {
    return getHomeAssistantSkeletonDataset(simConfig, tariffPerKwh);
  }

  const telemetry14Days = generateDummyDataset(simConfig);
  const monthlyHistory36 = generate36MonthsHistory(tariffPerKwh, simConfig.seed);
  const billingProjection = calculateCurrentMonthProjection(
    telemetry14Days,
    monthlyHistory36,
    tariffPerKwh
  );

  return {
    mode: "dummy",
    telemetry14Days,
    monthlyHistory36,
    billingProjection,
  };
}
