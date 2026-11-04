/**
 * File: src/utils/simulasi.ts
 * Mesin Simulasi Live (Real-time Tick Engine) untuk Smart Room Ruang Tunggu SPKLU UP3.
 *
 * Cara kerja untuk pemula:
 * - Setiap 3 detik, fungsi `stepLiveSimulation()` dipanggil untuk memperbarui nilai sensor
 *   dan aktuator secara halus (bukan melompat acak liar).
 * - Ketika pengguna mengubah kontrol perangkat secara langsung (Lampu WiZ, AC Split, Fan K1,
 *   Prioritas Kontrol AUTO/MANUAL, Jam Layanan, Pintu, atau Okupansi), fungsi
 *   `recalculateInstantPhysics()` langsung menghitung ulang daya P_A, P_B, dan cahaya L_R
 *   tanpa jeda, serta mengunci override perangkat agar tidak tertimpa oleh siklus 3 detik.
 */

import { OperationMode, AcCommand } from "../data/dummyGenerator";

export type DataOriginTag = "pembacaan sensor" | "injeksi simulasi";

export interface ActionLogEntry {
  id: string;
  timeStr: string;
  actor:
    | "Sistem Otomasi"
    | "Injeksi Simulasi"
    | "Operator / More-Info"
    | "AI Asisten (Simulasi)";
  sourceTag: DataOriginTag;
  actionTitle: string;
  detail: string;
}

export interface SparklinePoint {
  time: string;
  T_R: number;
  RH_R: number;
  L_R: number;
  C_R: number;
  B_L: number;
  P_A: number;
  P_B: number;
  FAN_CMD: number;
}

export interface LiveRoomState {
  // Tag Sensor & Input
  T_R: number | "unavailable";
  RH_R: number | "unavailable";
  L_R: number | "unavailable";
  C_R: number | "unavailable";
  OCC: 0 | 1 | "unavailable";
  DOOR: 0 | 1;
  AUTO: 0 | 1;
  SERVICE: 0 | 1;

  // Tag Output Aktuator
  B_L: number; // 0 - 100 %
  AC_CMD: AcCommand; // "OFF" | "COOL_25"
  AC_SETPOINT_C: number; // Default 25 °C (bisa diatur 22-28 °C lewat kontrol manual/AI)
  AC_STATUS_TEXT: "Terverifikasi" | "Belum terverifikasi";
  acPendingVerifyTicks: number; // Menunggu CTB merespons perintah IR baru
  FAN_CMD: 0 | 1;

  // Flag Override Pengguna agar kontrol manual pada kartu perangkat tidak tertimpa loop 3 detik
  manualLightOverride: boolean;
  manualAcOverride: boolean;
  manualFanOverride: boolean;

  // Meter Shelly Pro EM-50
  P_A: number; // Daya total ruang (W)
  P_B: number; // Daya subbeban AC saja (W), P_B <= P_A
  E_A_TODAY: number; // Energi hari berjalan (kWh)

  // Variabel Fisik Latar & Timer
  naturalDaylightLux: number;
  emptyMinutesElapsed: number;
  co2ExtremeTicks: number; // Hitungan tunda histeresis CO2
  MODE: OperationMode;
  NODE_A_ONLINE: boolean;
  NODE_B_ONLINE: boolean;
  HA_ONLINE: boolean;
  ALARM_ACTIVE: boolean;
  ALARM_MESSAGE: string;

  // Penanda Sumber Data ("pembacaan sensor" vs "injeksi simulasi")
  lastDataOrigin: DataOriginTag;
  lastInjectionLabel: string | null;

  // Riwayat 20 titik terakhir untuk sparkline kartu sensor & mini-grafik dialog more-info
  sparklineHistory: SparklinePoint[];
}

export type DemoActionType =
  | "USER_ENTER"
  | "USER_LEAVE"
  | "RAISE_CO2"
  | "DIM_DAYLIGHT"
  | "NODE_B_OFFLINE"
  | "RESTART_HOST";

export function formatNowTime(): string {
  const now = new Date();
  return now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Menghitung ulang variabel fisik instan (Lux L_R, Daya AC P_B, Daya Total P_A, dan Sparkline)
 * setiap kali pengguna menekan tombol kontrol perangkat agar perubahan langsung terlihat 0ms.
 */
export function recalculateInstantPhysics(state: LiveRoomState): LiveRoomState {
  const next = { ...state };
  const nowStr = formatNowTime();

  // 1. Hitung Lux (L_R) jika Node B online
  if (next.NODE_B_ONLINE) {
    next.L_R = Math.round(
      Math.max(0, next.naturalDaylightLux + next.B_L * 2.55)
    );
  } else {
    next.L_R = "unavailable";
  }

  // 2. Hitung Daya AC (P_B) dan Daya Total Ruang (P_A)
  let powerAc = 5; // Standby 5 W saat AC OFF
  if (next.AC_CMD === "COOL_25") {
    const tempNum = typeof next.T_R === "number" ? next.T_R : 25.5;
    const thermalDiff = Math.max(0, tempNum - (next.AC_SETPOINT_C - 0.5));
    powerAc = Math.round(745 + thermalDiff * 28);
    powerAc = Math.min(910, Math.max(700, powerAc));
  }

  const powerLight = Math.round((next.B_L / 100) * 28);
  const powerFan = next.FAN_CMD === 1 ? 60 : 0;
  const powerBase = 14; // Beban standby router + ESP32 + Shelly

  // Invarian fisik: P_B selalu <= P_A
  next.P_B = powerAc;
  next.P_A = powerAc + powerLight + powerFan + powerBase;

  // 3. Perbarui titik terakhir sparklineHistory agar grafik langsung bergerak
  const sparkPoint: SparklinePoint = {
    time: nowStr,
    T_R: typeof next.T_R === "number" ? next.T_R : 25.2,
    RH_R: typeof next.RH_R === "number" ? next.RH_R : 56.0,
    L_R: typeof next.L_R === "number" ? next.L_R : 295,
    C_R: typeof next.C_R === "number" ? next.C_R : 750,
    B_L: next.B_L,
    P_A: next.P_A,
    P_B: next.P_B,
    FAN_CMD: next.FAN_CMD,
  };
  next.sparklineHistory = [...next.sparklineHistory.slice(-19), sparkPoint];

  return next;
}

/**
 * Membuat kondisi awal ruangan live yang realistis (Mode AUTO, Pengguna Hadir, Nyaman).
 */
export function createInitialLiveState(): LiveRoomState {
  const initialHistory: SparklinePoint[] = [];
  const baseTime = Date.now();
  for (let i = 19; i >= 0; i--) {
    const t = new Date(baseTime - i * 3000).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    initialHistory.push({
      time: t,
      T_R: Number((25.2 + Math.sin(i * 0.4) * 0.2).toFixed(1)),
      RH_R: Number((56.5 + Math.cos(i * 0.3) * 0.5).toFixed(1)),
      L_R: Math.round(298 + Math.sin(i * 0.5) * 6),
      C_R: Math.round(740 + i * 2),
      B_L: 65,
      P_A: 815,
      P_B: 780,
      FAN_CMD: 0,
    });
  }

  return {
    T_R: 25.2,
    RH_R: 56.4,
    L_R: 298,
    C_R: 765,
    OCC: 1,
    DOOR: 0,
    AUTO: 1,
    SERVICE: 1,
    B_L: 65,
    AC_CMD: "COOL_25",
    AC_SETPOINT_C: 25,
    AC_STATUS_TEXT: "Terverifikasi",
    acPendingVerifyTicks: 0,
    FAN_CMD: 0,
    manualLightOverride: false,
    manualAcOverride: false,
    manualFanOverride: false,
    P_A: 816,
    P_B: 780,
    E_A_TODAY: 4.28,
    naturalDaylightLux: 132,
    emptyMinutesElapsed: 0,
    co2ExtremeTicks: 0,
    MODE: "DIGUNAKAN",
    NODE_A_ONLINE: true,
    NODE_B_ONLINE: true,
    HA_ONLINE: true,
    ALARM_ACTIVE: false,
    ALARM_MESSAGE: "Seluruh subsistem beroperasi normal",
    lastDataOrigin: "pembacaan sensor",
    lastInjectionLabel: null,
    sparklineHistory: initialHistory,
  };
}

/**
 * Fungsi yang dipanggil setiap 3 detik untuk memperbarui simulasi live secara halus.
 */
export function stepLiveSimulation(prev: LiveRoomState): {
  nextState: LiveRoomState;
  autoLog?: ActionLogEntry;
} {
  const next: LiveRoomState = {
    ...prev,
    sparklineHistory: [...prev.sparklineHistory],
  };
  let autoLog: ActionLogEntry | undefined;
  const nowStr = formatNowTime();

  // Derau kecil alami pada cahaya matahari dari jendela
  const smallNoise = () => (Math.random() - 0.5) * 2;
  next.naturalDaylightLux = Math.max(
    15,
    Math.min(260, Math.round(next.naturalDaylightLux + smallNoise() * 2))
  );

  // 1. Evaluasi Timer Kosong & Mode Operasi (Jika AUTO = 1 dan tidak sedang gangguan Node B)
  if (!next.NODE_B_ONLINE) {
    next.MODE = "GANGGUAN";
    next.OCC = "unavailable";
    next.L_R = "unavailable";
    next.ALARM_ACTIVE = true;
    next.ALARM_MESSAGE =
      "Node B (LD2410C + BH1750) offline: Pemadaman berbasis kosong ditahan & alarm aktif.";
  } else if (next.AUTO === 0) {
    next.MODE = "MANUAL";
  } else if (next.SERVICE === 0) {
    next.MODE = "SIAP";
    if (!next.manualLightOverride) next.B_L = 0;
    if (!next.manualAcOverride) next.AC_CMD = "OFF";
  } else if (next.OCC === 1) {
    next.emptyMinutesElapsed = 0;
    next.MODE = "DIGUNAKAN";
    if (!next.manualAcOverride && next.AC_CMD !== "COOL_25") {
      next.AC_CMD = "COOL_25";
      next.acPendingVerifyTicks = 1;
      next.AC_STATUS_TEXT = "Belum terverifikasi";
    }
    if (!next.manualLightOverride && next.B_L === 0) {
      next.B_L = 60;
    }
  } else if (next.OCC === 0) {
    // Setiap tick 3 detik kita majukan timer simulasi sebesar 1 menit bila sedang mode demo kosong
    // agar transisi 5 menit dan 15 menit dapat diamati secara live oleh pengguna
    next.emptyMinutesElapsed += 1;

    if (next.emptyMinutesElapsed < 5) {
      next.MODE = "TUNDA_KOSONG";
      // < 5 menit: Lampu dan AC dipertahankan
    } else if (next.emptyMinutesElapsed >= 5 && next.emptyMinutesElapsed < 15) {
      next.MODE = "TUNDA_KOSONG";
      if (!next.manualLightOverride && next.B_L > 0) {
        next.B_L = 0;
        autoLog = {
          id: `log-${Date.now()}`,
          timeStr: nowStr,
          actor: "Sistem Otomasi",
          sourceTag: "pembacaan sensor",
          actionTitle: "Lampu WiZ Dimatikan (Kosong ≥ 5 Menit)",
          detail:
            "Ruang kosong mencapai 5 menit pada mode TUNDA_KOSONG. Lampu WiZ OFF (0%), AC masih dipertahankan.",
        };
      }
    } else {
      next.MODE = "SIAP";
      if (!next.manualLightOverride) next.B_L = 0;
      if (!next.manualAcOverride && next.AC_CMD !== "OFF") {
        next.AC_CMD = "OFF";
        autoLog = {
          id: `log-${Date.now()}`,
          timeStr: nowStr,
          actor: "Sistem Otomasi",
          sourceTag: "pembacaan sensor",
          actionTitle: "AC Split Dimatikan (Kosong ≥ 15 Menit)",
          detail:
            "Waktu tunda kosong 15 menit selesai. Perintah IR AC OFF dikirim, mode beralih ke SIAP.",
        };
      }
    }
  }

  // 2. Evaluasi Dimming Lampu WiZ (Deadband 270 - 330 lux, langkah 5%, batas 10-100%)
  // Hanya berjalan jika pengguna tidak sedang mengunci override lampu manual
  if (
    next.AUTO === 1 &&
    next.SERVICE === 1 &&
    next.OCC === 1 &&
    next.NODE_B_ONLINE &&
    !next.manualLightOverride &&
    typeof next.L_R === "number"
  ) {
    const currentEstimatedLux = Math.round(
      next.naturalDaylightLux + next.B_L * 2.55
    );
    if (currentEstimatedLux < 270 && next.B_L < 100) {
      next.B_L = Math.min(100, next.B_L + 5);
    } else if (currentEstimatedLux > 330 && next.B_L > 10) {
      next.B_L = Math.max(10, next.B_L - 5);
    }
  }

  // Hitung nilai sensor Lux terbaru
  if (next.NODE_B_ONLINE) {
    next.L_R = Math.round(
      Math.max(
        0,
        next.naturalDaylightLux + next.B_L * 2.55 + smallNoise() * 1.5
      )
    );
  }

  // 3. Dinamika CO2 & Evaluasi Histeresis Ventilasi (1.000 ppm ON / 800 ppm OFF)
  if (next.NODE_A_ONLINE && typeof next.C_R === "number") {
    const occRise = next.OCC === 1 ? 8 : -7;
    const fanDrop = next.FAN_CMD === 1 ? -22 : 0;
    const nextCo2 = Math.round(
      Math.max(
        415,
        Math.min(1450, next.C_R + occRise + fanDrop + smallNoise() * 2)
      )
    );
    next.C_R = nextCo2;

    if (next.AUTO === 1 && !next.manualFanOverride) {
      if (nextCo2 > 1000) {
        next.co2ExtremeTicks += 1;
        // Setelah 1 interval tunda, nyalakan Fan K1
        if (next.co2ExtremeTicks >= 1 && next.FAN_CMD === 0) {
          next.FAN_CMD = 1;
          autoLog = {
            id: `log-${Date.now()}`,
            timeStr: nowStr,
            actor: "Sistem Otomasi",
            sourceTag: "pembacaan sensor",
            actionTitle: "Fan Ventilasi K1 ON (CO₂ > 1.000 ppm)",
            detail: `Kadar CO₂ tercatat ${nextCo2} ppm melewati ambang 1.000 ppm. Relay Shelly mengaktifkan kontaktor K1.`,
          };
        }
      } else if (nextCo2 < 800) {
        next.co2ExtremeTicks += 1;
        if (next.co2ExtremeTicks >= 1 && next.FAN_CMD === 1) {
          next.FAN_CMD = 0;
          autoLog = {
            id: `log-${Date.now()}`,
            timeStr: nowStr,
            actor: "Sistem Otomasi",
            sourceTag: "pembacaan sensor",
            actionTitle: "Fan Ventilasi K1 OFF (CO₂ < 800 ppm)",
            detail: `Kadar CO₂ turun ke ${nextCo2} ppm di bawah ambang 800 ppm. Kipas ventilasi dimatikan.`,
          };
        }
      } else {
        // Di antara 800 - 1.000 ppm: pertahankan keadaan fan sebelumnya!
        next.co2ExtremeTicks = 0;
      }
    }
  }

  // 4. Dinamika Suhu (T_R) & Kelembapan (RH_R)
  if (
    next.NODE_A_ONLINE &&
    typeof next.T_R === "number" &&
    typeof next.RH_R === "number"
  ) {
    const targetTemp = next.AC_CMD === "COOL_25" ? next.AC_SETPOINT_C : 29.2;
    const targetRh = next.AC_CMD === "COOL_25" ? 55.0 : 65.5;

    const newTemp =
      next.T_R + (targetTemp - next.T_R) * 0.18 + smallNoise() * 0.06;
    const newRh = next.RH_R + (targetRh - next.RH_R) * 0.15 + smallNoise() * 0.2;

    next.T_R = Number(newTemp.toFixed(1));
    next.RH_R = Number(Math.max(40, Math.min(85, newRh)).toFixed(1));
  }

  // 5. Verifikasi Umpan Balik Daya CTB (P_B) & Total Ruang CTA (P_A)
  if (next.acPendingVerifyTicks > 0) {
    next.acPendingVerifyTicks -= 1;
    if (next.acPendingVerifyTicks === 0) {
      next.AC_STATUS_TEXT = "Terverifikasi";
    }
  }

  let powerAc = 5; // Standby 5 W
  if (next.AC_CMD === "COOL_25") {
    if (next.acPendingVerifyTicks > 0) {
      powerAc = 12;
    } else {
      const tempNum = typeof next.T_R === "number" ? next.T_R : 25.5;
      const thermalDiff = Math.max(0, tempNum - (next.AC_SETPOINT_C - 0.5));
      powerAc = Math.round(745 + thermalDiff * 28 + Math.random() * 25);
      powerAc = Math.min(910, Math.max(700, powerAc));
    }
  }

  const powerLight = Math.round((next.B_L / 100) * 28);
  const powerFan = next.FAN_CMD === 1 ? Math.round(59 + Math.random() * 3) : 0;
  const powerBase = 14;

  // Invarian fisik: P_A = P_B + beban non-AC, sehingga P_B selalu <= P_A
  next.P_B = powerAc;
  next.P_A = powerAc + powerLight + powerFan + powerBase;

  // Tambah energi kumulatif hari berjalan (3 detik = 3/3600 jam)
  next.E_A_TODAY = Number(
    (next.E_A_TODAY + (next.P_A * (3 / 3600)) / 1000).toFixed(3)
  );

  // 6. Simpan ke riwayat sparkline (maksimal 20 titik)
  const sparkPoint: SparklinePoint = {
    time: nowStr,
    T_R: typeof next.T_R === "number" ? next.T_R : 25.2,
    RH_R: typeof next.RH_R === "number" ? next.RH_R : 56.0,
    L_R: typeof next.L_R === "number" ? next.L_R : 295,
    C_R: typeof next.C_R === "number" ? next.C_R : 750,
    B_L: next.B_L,
    P_A: next.P_A,
    P_B: next.P_B,
    FAN_CMD: next.FAN_CMD,
  };
  next.sparklineHistory = [...next.sparklineHistory.slice(-19), sparkPoint];

  return { nextState: next, autoLog };
}

/**
 * Menjalankan injeksi skenario dari laci "Simulasi Demo".
 * Setiap injeksi ditandai secara eksplisit dengan `sourceTag: "injeksi simulasi"`.
 */
export function applyDemoInjection(
  prev: LiveRoomState,
  actionType: DemoActionType
): {
  nextState: LiveRoomState;
  logEntry: ActionLogEntry;
} {
  let next: LiveRoomState = {
    ...prev,
    lastDataOrigin: "injeksi simulasi",
    manualLightOverride: false,
    manualAcOverride: false,
    manualFanOverride: false,
  };
  const nowStr = formatNowTime();
  let actionTitle = "";
  let detail = "";

  switch (actionType) {
    case "USER_ENTER": {
      next.NODE_B_ONLINE = true;
      next.OCC = 1;
      next.DOOR = 1;
      next.SERVICE = 1;
      next.emptyMinutesElapsed = 0;
      if (next.AUTO === 1) {
        next.MODE = "DIGUNAKAN";
        next.AC_CMD = "COOL_25";
        next.acPendingVerifyTicks = 1;
        next.AC_STATUS_TEXT = "Belum terverifikasi";
        next.B_L = Math.max(60, next.B_L);
      }
      next.ALARM_ACTIVE = false;
      next.ALARM_MESSAGE =
        "Pengguna terdeteksi masuk; fasilitas ruang tunggu aktif";
      next.lastInjectionLabel =
        "Injeksi Simulasi: Pengguna Masuk (OCC=1, DOOR=1)";
      actionTitle = "Injeksi Simulasi: Pengguna Masuk Ruangan";
      detail =
        "Kontak pintu terbuka (DOOR=1), radar LD2410C mendeteksi hadir (OCC=1). Timer kosong dibatalkan, Lampu WiZ & perintah IR AC COOL 25 °C diaktifkan.";
      break;
    }

    case "USER_LEAVE": {
      next.NODE_B_ONLINE = true;
      next.OCC = 0;
      next.DOOR = 1;
      next.emptyMinutesElapsed = 1;
      if (next.AUTO === 1) {
        next.MODE = "TUNDA_KOSONG";
      }
      next.lastInjectionLabel =
        "Injeksi Simulasi: Pengguna Keluar (Mulai Timer TUNDA_KOSONG)";
      actionTitle = "Injeksi Simulasi: Pengguna Keluar Ruangan";
      detail =
        "OCC beralih ke 0. Mode masuk ke TUNDA_KOSONG; timer kosong dimulai (lampu akan OFF pada 5 menit, AC OFF pada 15 menit).";
      break;
    }

    case "RAISE_CO2": {
      next.NODE_A_ONLINE = true;
      next.C_R = 1120;
      next.co2ExtremeTicks = 2;
      if (next.AUTO === 1) {
        next.FAN_CMD = 1;
      }
      next.lastInjectionLabel =
        "Injeksi Simulasi: Lonjakan CO₂ ke 1.120 ppm (> 1.000 ppm)";
      actionTitle = "Injeksi Simulasi: Naikkan Kadar CO₂ (1.120 ppm)";
      detail =
        "Nilai CO₂ diinjeksi ke 1.120 ppm (> 1.000 ppm). Histeresis ventilasi mengaktifkan relay Shelly Pro EM-50 & kontaktor K1 (FAN_CMD=1).";
      break;
    }

    case "DIM_DAYLIGHT": {
      next.NODE_B_ONLINE = true;
      next.naturalDaylightLux = 35;
      if (next.AUTO === 1 && next.OCC === 1) {
        next.B_L = Math.min(100, next.B_L + 20);
      }
      next.L_R = Math.round(next.naturalDaylightLux + next.B_L * 2.55);
      next.lastInjectionLabel =
        "Injeksi Simulasi: Cahaya Alami Meredup (Mendung/Sore)";
      actionTitle = "Injeksi Simulasi: Redupkan Cahaya Alami";
      detail =
        "Cahaya alami jendela SPKLU diturunkan ke 35 lux. Kontrol dimming menaikkan brightness lampu WiZ bertahap untuk menjaga target 270–330 lux.";
      break;
    }

    case "NODE_B_OFFLINE": {
      next.NODE_B_ONLINE = false;
      next.OCC = "unavailable";
      next.L_R = "unavailable";
      next.MODE = "GANGGUAN";
      next.ALARM_ACTIVE = true;
      next.ALARM_MESSAGE =
        "GANGGUAN: Node B (LD2410C + BH1750) offline — pemadaman berbasis kosong ditahan & alarm diaktifkan.";
      next.lastInjectionLabel =
        "Injeksi Simulasi: Node B Offline (Fallback GANGGUAN)";
      actionTitle = "Injeksi Simulasi: Putus Koneksi Node B (Offline)";
      detail =
        "Entity radar LD2410C dan lux BH1750 menjadi 'unavailable'. Sistem beralih ke MODE=GANGGUAN, menahan pemadaman lampu/AC, dan membunyikan alarm.";
      break;
    }

    case "RESTART_HOST": {
      next.NODE_A_ONLINE = true;
      next.NODE_B_ONLINE = true;
      next.HA_ONLINE = true;
      next.OCC = 1;
      next.DOOR = 0;
      next.SERVICE = 1;
      next.T_R = 25.3;
      next.RH_R = 56.0;
      next.C_R = 740;
      next.B_L = 65;
      next.AC_CMD = "COOL_25";
      next.AC_STATUS_TEXT = "Terverifikasi";
      next.FAN_CMD = 0;
      next.L_R = Math.round(next.naturalDaylightLux + 65 * 2.55);
      next.emptyMinutesElapsed = 0;
      next.MODE = next.AUTO === 1 ? "DIGUNAKAN" : "MANUAL";
      next.ALARM_ACTIVE = false;
      next.ALARM_MESSAGE =
        "Sistem pulih dari Restart Host: Seluruh sensor dibaca ulang & timer kosong dimulai ulang dari 0.";
      next.lastInjectionLabel =
        "Injeksi Simulasi: Restart Host (Revalidasi Sensor & Reset Timer)";
      actionTitle = "Injeksi Simulasi: Restart Host Home Assistant";
      detail =
        "Host VirtualBox menyala kembali. Sistem membaca ulang state terbaru Node A & Node B serta mereset timer kosong ke 0 menit.";
      break;
    }
  }

  next = recalculateInstantPhysics(next);

  const logEntry: ActionLogEntry = {
    id: `inj-${Date.now()}`,
    timeStr: nowStr,
    actor: "Injeksi Simulasi",
    sourceTag: "injeksi simulasi",
    actionTitle,
    detail,
  };

  return { nextState: next, logEntry };
}
