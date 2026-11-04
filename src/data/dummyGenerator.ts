/**
 * File: src/data/dummyGenerator.ts
 * Generator data simulasi 14 hari untuk Smart Room Ruang Tunggu SPKLU di UP3.
 *
 * Catatan untuk pemula:
 * - Menggunakan "seeded random" (Mulberry32) agar hasil simulasi selalu konsisten.
 * - Hari 1–7 = mode MANUAL (baseline), Hari 8–14 = mode AUTO.
 * - Pada hari AUTO (Hari 8–14) pukul 11:00–11:10, disisipkan jendela resolusi 1 menit
 *   untuk memodelkan 7 episode pengguna keluar singkat (2–4 menit) lalu masuk kembali.
 * - Perbaikan Bug Histeresis CO2 (Skenario 3):
 *   Sebelumnya, status FAN_CMD dievaluasi sebelum nilai C_R terbaru dihitung pada langkah waktu
 *   yang sama, sehingga saat C_R masuk ke pita 800–1.000 ppm dari bawah 800 ppm (atau sebaliknya),
 *   FAN_CMD tampak berubah di dalam pita 800–1.000 ppm. Sekarang nilai C_R dihitung lebih dulu,
 *   lalu logika histeresis (dengan tunda >= 60 detik dan tahan state di 800–1.000 ppm) dievaluasi.
 */

export type OperationMode =
  | "SIAP"
  | "DIGUNAKAN"
  | "TUNDA_KOSONG"
  | "MANUAL"
  | "GANGGUAN";

export type AcCommand = "OFF" | "COOL_25";

export type FaultCategory =
  | "NONE"
  | "RADAR_OFFLINE"
  | "LUX_LOST"
  | "CO2_LOST"
  | "IR_FAIL"
  | "HOST_DOWN"
  | "HOST_RESTART_RECOVERY";

export interface TelemetryRow {
  id: string;
  timestamp: string; // Format: "YYYY-MM-DD HH:mm"
  dateStr: string; // Format: "YYYY-MM-DD"
  timeStr: string; // Format: "HH:mm"
  dayIndex: number; // 1 s/d 14
  dayName: string; // Senin, Selasa, dst.
  hour: number; // 0 s/d 23
  minute: number; // 0 s/d 59
  stepMinutes: number; // 5 menit (standar) atau 1 menit (pada jendela uji keluar singkat)

  // Tag Sensor Numerik
  T_R: number | "unavailable"; // Suhu ruang (°C) - SHT31 Node A
  RH_R: number | "unavailable"; // Kelembapan ruang (%RH) - SHT31 Node A
  L_R: number | "unavailable"; // Iluminansi cahaya (lux) - BH1750 Node B
  C_R: number | "unavailable"; // Kadar CO2 (ppm) - SCD41 Node A

  // Tag Input Biner
  OCC: 0 | 1 | "unavailable"; // Kehadiran (0 = kosong, 1 = hadir) - LD2410C Node B
  DOOR: 0 | 1; // Kontak magnet pintu (0 = tertutup, 1 = terbuka) - Node B

  // Tag Input Operator
  AUTO: 0 | 1; // Mode sistem (0 = MANUAL, 1 = AUTO)
  SERVICE: 0 | 1; // Jam layanan aktif (1 = buka, 0 = tutup)

  // Tag Output Perintah
  B_L: number; // Brightness lampu WiZ (0 - 100 %)
  AC_CMD: AcCommand; // Perintah IR Broadlink RM4 mini ke AC ("OFF" | "COOL_25")
  AC_STATUS_TEXT: "Terverifikasi" | "Belum terverifikasi";
  FAN_CMD: 0 | 1; // Perintah relay Shelly Pro EM-50 ke kontaktor K1 fan (0 | 1)

  // Tag Input Meter (Shelly Pro EM-50)
  // CTA = daya total ruang (P_A), CTB = subbeban AC (P_B). P_B selalu <= P_A.
  P_A: number; // Daya total ruang tunggu (W)
  P_B: number; // Daya AC split saja (W)
  E_A: number; // Energi kumulatif ruang tunggu (kWh)

  // Status Sistem, Node, dan Metadata Pengujian
  MODE: OperationMode;
  NODE_A_ONLINE: boolean;
  NODE_B_ONLINE: boolean;
  ALARM_ACTIVE: boolean;
  ALARM_MESSAGE: string;
  EMPTY_MINUTES?: number; // Durasi kosong berkelanjutan yang tercatat oleh timer Home Assistant
  FAULT_CATEGORY?: FaultCategory;
  RESTART_SENSOR_REVALIDATED?: boolean;
  RESTART_TIMER_RESET?: boolean;
}

export interface SimulationConfig {
  serviceStartHour: number; // Default: 8 (08:00)
  serviceEndHour: number; // Default: 20 (20:00)
  seed: number; // Default: 202609
}

export const DEFAULT_SIM_CONFIG: SimulationConfig = {
  serviceStartHour: 8,
  serviceEndHour: 20,
  seed: 202609,
};

function createSeededRandom(seed: number) {
  let a = seed;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HARI_INDO = [
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
  "Minggu",
];

/**
 * Durasi keluar singkat (2–4 menit) pada pukul 11:01 untuk masing-masing hari AUTO (Hari 8..14).
 * Total = 7 episode keluar singkat dengan resolusi 1 menit.
 */
const SHORT_EXIT_DURATION_BY_DAY: Record<number, number> = {
  8: 3, // Kosong 3 menit (11:01, 11:02, 11:03), kembali hadir 11:04
  9: 2, // Kosong 2 menit (11:01, 11:02), kembali hadir 11:03
  10: 4, // Kosong 4 menit (11:01..11:04), kembali hadir 11:05
  11: 3, // Kosong 3 menit (11:01..11:03), kembali hadir 11:04
  12: 2, // Kosong 2 menit (11:01..11:02), kembali hadir 11:03
  13: 4, // Kosong 4 menit (11:01..11:04), kembali hadir 11:05
  14: 3, // Kosong 3 menit (11:01..11:03), kembali hadir 11:04
};

function getOccupancyPattern(
  day: number,
  dayOfWeekIdx: number,
  hour: number,
  minute: number,
  serviceStart: number,
  serviceEnd: number,
  rand: () => number
): { occupied: boolean; personCountFactor: number; doorPulse: boolean } {
  const timeFloat = hour + minute / 60;

  if (timeFloat < serviceStart || timeFloat >= serviceEnd) {
    return { occupied: false, personCountFactor: 0, doorPulse: false };
  }

  // Jendela khusus episode keluar singkat (2–4 menit) pada hari AUTO pukul 11:00 - 11:09
  const shortExitDur = SHORT_EXIT_DURATION_BY_DAY[day];
  if (shortExitDur && hour === 11 && minute >= 0 && minute < 10) {
    if (minute === 0) {
      // Menit 11:00 masih hadir sebelum keluar
      return { occupied: true, personCountFactor: 0.6, doorPulse: false };
    }
    if (minute >= 1 && minute <= shortExitDur) {
      // Sedang keluar singkat (2-4 menit)
      return {
        occupied: false,
        personCountFactor: 0,
        doorPulse: minute === 1,
      };
    }
    // Kembali hadir sebelum 5 menit!
    return {
      occupied: true,
      personCountFactor: 0.65,
      doorPulse: minute === shortExitDur + 1,
    };
  }

  // Pada mode MANUAL (Hari 1-7), buat juga jeda kosong singkat pukul 11:00 agar pola setara
  if (day <= 7 && hour === 11 && minute === 0) {
    return { occupied: false, personCountFactor: 0, doorPulse: true };
  }

  const inWave1 = timeFloat >= 8.5 && timeFloat <= 10.85;
  const inWave2 = timeFloat >= 11.0 && timeFloat <= 14.25;
  const inWave3 = timeFloat >= 15.5 && timeFloat <= 18.15;
  const inWave4 = timeFloat >= 18.75 && timeFloat <= 19.65;

  const weekendBoost = dayOfWeekIdx >= 5 ? 0.15 : 0;
  let occupied = inWave1 || inWave2 || inWave3 || inWave4;

  if (dayOfWeekIdx === 1 && timeFloat >= 10.2 && timeFloat <= 10.8) {
    occupied = false;
  }
  if (dayOfWeekIdx === 3 && timeFloat >= 14.3 && timeFloat <= 14.9) {
    occupied = true;
  }

  if (!occupied) {
    return { occupied: false, personCountFactor: 0, doorPulse: false };
  }

  let baseCrowd = 0.55 + weekendBoost;
  if (inWave2 || inWave3) baseCrowd = 0.85 + weekendBoost;
  const personCountFactor = Math.min(
    1.2,
    Math.max(0.3, baseCrowd + (rand() - 0.5) * 0.25)
  );

  const doorPulse = minute === 30 || minute === 45 || rand() < 0.08;
  return { occupied: true, personCountFactor, doorPulse };
}

export function generateDummyDataset(
  config: SimulationConfig = DEFAULT_SIM_CONFIG
): TelemetryRow[] {
  const rand = createSeededRandom(config.seed);
  const rows: TelemetryRow[] = [];

  const startYear = 2026;
  const startMonth = 10; // Oktober

  let cumulativeEnergyKwh = 0;
  let currentCo2 = 435;
  let currentTemp = 27.5;
  let currentRh = 64.0;
  let currentFan: 0 | 1 = 0;
  let currentBrightness = 0;
  let emptyMinutes = 60; // Waktu kosong berkelanjutan dalam menit

  // Pencatat durasi CO2 di atas 1.000 ppm atau di bawah 800 ppm (untuk syarat tunda >= 60 detik)
  let co2Above1000Seconds = 0;
  let co2Below800Seconds = 0;

  for (let day = 1; day <= 14; day++) {
    const isAutoMode: 0 | 1 = day >= 8 ? 1 : 0;
    const dayOfWeekIdx = (day - 1) % 7;
    const dayName = HARI_INDO[dayOfWeekIdx];
    const dateStr = `${startYear}-${String(startMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    for (let hour = 0; hour < 24; hour++) {
      // Buat daftar menit untuk jam ini:
      // Standar adalah tiap 5 menit (0, 5, 10, ..., 55).
      // KHUSUS pada Hari AUTO (day >= 8) pukul 11:00 - 11:09, gunakan resolusi 1 menit (0,1,2,3,4,5,6,7,8,9,10,15,20...)
      const minuteSteps: Array<{ min: number; stepMin: number }> = [];
      if (isAutoMode === 1 && hour === 11) {
        for (let m = 0; m < 10; m += 1) {
          minuteSteps.push({ min: m, stepMin: 1 });
        }
        for (let m = 10; m < 60; m += 5) {
          minuteSteps.push({ min: m, stepMin: 5 });
        }
      } else {
        for (let m = 0; m < 60; m += 5) {
          minuteSteps.push({ min: m, stepMin: 5 });
        }
      }

      for (const { min: minute, stepMin } of minuteSteps) {
        const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        const timestamp = `${dateStr} ${timeStr}`;
        const serviceActive: 0 | 1 =
          hour >= config.serviceStartHour && hour < config.serviceEndHour
            ? 1
            : 0;

        // 1. Cek pola kehadiran pengguna
        const occInfo = getOccupancyPattern(
          day,
          dayOfWeekIdx,
          hour,
          minute,
          config.serviceStartHour,
          config.serviceEndHour,
          rand
        );
        const realOcc: 0 | 1 = occInfo.occupied ? 1 : 0;
        const doorState: 0 | 1 = occInfo.doorPulse ? 1 : 0;

        // 2. Identifikasi skenario gangguan & restart terprogram (5 Jenis pada Skenario 5)
        // (a) Node B / Radar Offline: Hari 10 jam 10:30 - 10:55
        const isNodeBOffline =
          day === 10 && hour === 10 && minute >= 30 && minute <= 55;

        // (b) Sensor Lux BH1750 Hilang saat hadir: Hari 12 jam 15:00 - 15:20
        const isLuxSensorFault =
          day === 12 && hour === 15 && minute >= 0 && minute <= 20;

        // (c) Sensor CO2 / Node A Offline: Hari 4 jam 14:00 - 14:25 (Manual) & Hari 13 jam 16:10 - 16:25 (Auto)
        const isNodeAOffline =
          (day === 4 && hour === 14 && minute >= 0 && minute <= 25) ||
          (day === 13 && hour === 16 && minute >= 10 && minute <= 25);

        // (d) IR Broadlink AC Gagal / Belum terverifikasi: Hari 11 jam 13:45 - 14:00
        const isIrFault =
          day === 11 && hour === 13 && minute >= 45 && minute <= 55;

        // (e) Host / VM Berhenti & Restart Sistem:
        // Hari 14 jam 09:30 - 09:35 Host berhenti (GANGGUAN), lalu jam 09:40 Host menyala kembali (baca ulang sensor & mulai ulang timer kosong)
        const isHostDown =
          day === 14 && hour === 9 && (minute === 30 || minute === 35);
        const isHostRestartRecovery =
          day === 14 && hour === 9 && minute === 40;

        // 3. Perbarui timer kosong berkelanjutan (emptyMinutes)
        // Jika radar offline, tahan timer kosong (jangan ditambah).
        // Jika sistem baru menyala kembali (restart recovery), mulai ulang timer kosong dari 0!
        if (isHostRestartRecovery) {
          emptyMinutes = 0;
        } else if (isNodeBOffline || isHostDown) {
          // Saat radar tidak valid atau host mati, timer kosong ditahan
        } else if (realOcc === 1) {
          emptyMinutes = 0;
        } else {
          emptyMinutes += stepMin;
        }

        // 4. Hitung Cahaya Alami (Daylight)
        const timeFloat = hour + minute / 60;
        let daylightLux = 0;
        if (timeFloat >= 6 && timeFloat <= 18) {
          const sunAngle = Math.sin(((timeFloat - 6) / 12) * Math.PI);
          daylightLux = Math.round(sunAngle * 145 + (rand() - 0.5) * 18);
        }

        // 5. HITUNG DINAMIKA CO2 LEBIH DULU (Perbaikan Bug Urutan Kausal Skenario 3!)
        // Dengan menghitung C_R terlebih dahulu sebelum mengevaluasi histeresis FAN_CMD,
        // maka nilai C_R dan keputusan FAN_CMD pada baris timestamp yang sama 100% sinkron.
        const scaleStep = stepMin / 5;
        if (realOcc === 1) {
          const co2Rise = occInfo.personCountFactor * 72 * scaleStep;
          const fanReduction = (currentFan === 1 ? 95 : 12) * scaleStep;
          currentCo2 =
            currentCo2 +
            co2Rise -
            fanReduction +
            (rand() - 0.5) * 14 * scaleStep;
        } else {
          const decayRate = (currentFan === 1 ? 0.35 : 0.14) * scaleStep;
          currentCo2 =
            420 +
            (currentCo2 - 420) * (1 - decayRate) +
            (rand() - 0.5) * 6 * scaleStep;
        }
        currentCo2 = Math.round(Math.max(410, Math.min(1320, currentCo2)));

        // Sekuens Uji Eksplisit Skenario 3 (1.100 -> 900 -> 750 ppm) pada Hari 9 (Mode AUTO) pukul 12:55 - 13:30:
        // - 12:55: C_R = 760 ppm (< 800) -> FAN_CMD = 0
        // - 13:00: C_R = 910 ppm (masuk 800-1000 dari bawah) -> FAN_CMD tetap 0 (tahan!)
        // - 13:05: C_R = 1045 ppm (> 1000 ppm awal)
        // - 13:10: C_R = 1100 ppm (> 1000 ppm selama >= 60 dtk) -> FAN_CMD = 1 (ON)
        // - 13:15: C_R = 900 ppm (masuk 800-1000 dari atas) -> FAN_CMD tetap 1 (tahan!)
        // - 13:20: C_R = 845 ppm (masih di 800-1000) -> FAN_CMD tetap 1 (tahan!)
        // - 13:25: C_R = 750 ppm (< 800 ppm selama >= 60 dtk) -> FAN_CMD = 0 (OFF)
        // - 13:30: C_R = 860 ppm (masuk 800-1000 dari bawah saat fan OFF) -> FAN_CMD tetap 0 (tahan!)
        if (day === 9 && hour === 12 && minute === 55) currentCo2 = 760;
        if (day === 9 && hour === 13 && minute === 0) currentCo2 = 910;
        if (day === 9 && hour === 13 && minute === 5) currentCo2 = 1045;
        if (day === 9 && hour === 13 && minute === 10) currentCo2 = 1100;
        if (day === 9 && hour === 13 && minute === 15) currentCo2 = 900;
        if (day === 9 && hour === 13 && minute === 20) currentCo2 = 845;
        if (day === 9 && hour === 13 && minute === 25) currentCo2 = 750;
        if (day === 9 && hour === 13 && minute === 30) currentCo2 = 860;

        // Pastikan puncak siang di hari-hari lain juga melewati 1.000 ppm secara alami
        if (day !== 9 && hour === 13 && minute === 5 && !isNodeAOffline) {
          currentCo2 = 1030;
        }
        if (day !== 9 && hour === 13 && minute === 10 && !isNodeAOffline) {
          currentCo2 = 1100;
        }
        if (day !== 9 && hour === 13 && minute === 15 && !isNodeAOffline) {
          currentCo2 = 900;
        }
        if (day !== 9 && hour === 13 && minute === 20 && !isNodeAOffline) {
          currentCo2 = 750;
        }

        // 6. Tentukan Mode Operasi & Keputusan Kontrol (Lampu, AC, Fan)
        let mode: OperationMode = "SIAP";
        let acCmd: AcCommand = "OFF";
        let alarmActive = false;
        let alarmMessage = "Sistem beroperasi normal";
        let faultCategory: FaultCategory = "NONE";
        let restartSensorRevalidated = false;
        let restartTimerReset = false;

        const stepSeconds = stepMin * 60;

        if (isAutoMode === 0) {
          // MODE MANUAL (Hari 1-7)
          mode = "MANUAL";
          if (serviceActive === 1) {
            currentBrightness = 100;
            acCmd = "COOL_25";
            currentFan = hour >= 12 && hour < 17 ? 1 : 0;
          } else {
            currentBrightness = 0;
            acCmd = "OFF";
            currentFan = 0;
          }
          if (isNodeAOffline) {
            alarmActive = true;
            faultCategory = "CO2_LOST";
            alarmMessage =
              "Node A (SHT31 + SCD41) offline — periksa koneksi ESPHome";
          }
        } else {
          // MODE AUTO (Hari 8-14)
          // Evaluasi kondisi gangguan terlebih dahulu (Tabel Halaman 21 PDF)
          if (isHostDown) {
            mode = "GANGGUAN";
            alarmActive = true;
            faultCategory = "HOST_DOWN";
            alarmMessage =
              "Host / VM / jaringan berhenti: Otomasi pusat berhenti; kontrol lokal (Selector MAN-0-AUTO) digunakan";
            // Pertahankan kondisi beban terakhir selama host restart singkat
            if (serviceActive === 1) {
              currentBrightness = Math.max(currentBrightness, 65);
              acCmd = "COOL_25";
            }
          } else if (isNodeBOffline) {
            mode = "GANGGUAN";
            alarmActive = true;
            faultCategory = "RADAR_OFFLINE";
            alarmMessage =
              "Radar LD2410C / Node B tidak valid: Tahan pemadaman berbasis kosong & aktifkan alarm";
            if (serviceActive === 1) {
              currentBrightness = Math.max(currentBrightness, 70);
              acCmd = "COOL_25";
            }
          } else if (isNodeAOffline) {
            mode = "GANGGUAN";
            alarmActive = true;
            faultCategory = "CO2_LOST";
            alarmMessage =
              "Sensor CO2 (Node A) tidak tersedia: Alarm aktif, petugas aktifkan ventilasi manual";
            // Saat CO2 hilang di jam layanan, petugas mengaktifkan ventilasi manual (FAN_CMD = 1)
            if (serviceActive === 1) {
              currentFan = 1;
            }
            if (realOcc === 1 && serviceActive === 1) {
              acCmd = "COOL_25";
              currentBrightness = 65;
            }
          } else if (isLuxSensorFault && realOcc === 1 && serviceActive === 1) {
            mode = "GANGGUAN";
            alarmActive = true;
            faultCategory = "LUX_LOST";
            alarmMessage =
              "Sensor BH1750 (Lux) tidak tersedia: Lampu diatur ke tingkat cadangan 70% saat hadir";
            currentBrightness = 70;
            acCmd = "COOL_25";
          } else if (serviceActive === 0) {
            mode = "SIAP";
            currentBrightness = 0;
            acCmd = "OFF";
          } else if (realOcc === 1) {
            // Pengguna HADIR di jam layanan
            mode = "DIGUNAKAN";
            acCmd = "COOL_25";

            if (isHostRestartRecovery) {
              faultCategory = "HOST_RESTART_RECOVERY";
              restartSensorRevalidated = true;
              restartTimerReset = true;
              alarmMessage =
                "Sistem menyala kembali (Restart selesai): Sensor dibaca ulang & timer kosong dimulai ulang dari 0";
            }

            if (currentBrightness === 0) currentBrightness = 60;
            for (let step10s = 0; step10s < 6; step10s++) {
              const estLux = daylightLux + currentBrightness * 2.55;
              if (estLux < 270) {
                currentBrightness = Math.min(100, currentBrightness + 5);
              } else if (estLux > 330) {
                currentBrightness = Math.max(10, currentBrightness - 5);
              }
            }
          } else {
            // Ruang KOSONG valid saat jam layanan aktif -> evaluasi timer kosong (emptyMinutes)
            // Mode TUNDA_KOSONG dilabel sejak OCC=0 valid (menit ke-1)
            if (emptyMinutes < 5) {
              mode = "TUNDA_KOSONG";
              // Kosong < 5 menit: Lampu dan AC tetap menyala!
              if (currentBrightness === 0) currentBrightness = 65;
              acCmd = "COOL_25";
            } else if (emptyMinutes >= 5 && emptyMinutes < 15) {
              mode = "TUNDA_KOSONG";
              // Kosong 5-15 menit: Lampu OFF (B_L = 0), AC tetap menyala (COOL_25)
              currentBrightness = 0;
              acCmd = "COOL_25";
            } else {
              // Kosong >= 15 menit: AC OFF dan Lampu OFF, kembali ke mode SIAP
              mode = "SIAP";
              currentBrightness = 0;
              acCmd = "OFF";
            }
          }

          // Evaluasi Histeresis CO2 (Skenario 3):
          // (a) Setelah C_R > 1.000 ppm selama >= 60 detik (1 interval tunda), FAN_CMD = 1
          // (b) Saat 800 <= C_R <= 1.000 ppm, FAN_CMD sama dengan keadaan sebelumnya (tahan)
          // (c) Setelah C_R < 800 ppm selama >= 60 detik (1 interval tunda), FAN_CMD = 0
          if (!isNodeAOffline && !isHostDown) {
            if (currentCo2 > 1000) {
              co2Above1000Seconds += stepSeconds;
              co2Below800Seconds = 0;
              if (co2Above1000Seconds >= 60) {
                currentFan = 1;
              }
            } else if (currentCo2 < 800) {
              co2Below800Seconds += stepSeconds;
              co2Above1000Seconds = 0;
              if (co2Below800Seconds >= 60) {
                currentFan = 0;
              }
            } else {
              // Pita deadband histeresis 800 - 1.000 ppm:
              // Reset penghitung tunda ekstrem dan PERTAHANKAN currentFan sama persis dengan state sebelumnya!
              co2Above1000Seconds = 0;
              co2Below800Seconds = 0;
            }
          }
        }

        // 7. Perubahan Suhu (T_R) dan Kelembapan (RH_R)
        const outdoorTemp =
          26.5 + Math.sin(((timeFloat - 6) / 12) * Math.PI) * 5.5;
        const acActuallyCooling = acCmd === "COOL_25" && !isIrFault;

        if (acActuallyCooling) {
          currentTemp =
            currentTemp +
            (24.8 + realOcc * 0.4 - currentTemp) * 0.32 * scaleStep +
            (rand() - 0.5) * 0.2 * scaleStep;
          currentRh =
            currentRh +
            (55.0 + realOcc * 2.5 - currentRh) * 0.25 * scaleStep +
            (rand() - 0.5) * 0.6 * scaleStep;
        } else {
          currentTemp =
            currentTemp +
            (outdoorTemp - currentTemp) * 0.18 * scaleStep +
            (rand() - 0.5) * 0.15 * scaleStep;
          currentRh =
            currentRh +
            (66.0 - currentRh) * 0.18 * scaleStep +
            (rand() - 0.5) * 0.6 * scaleStep;
        }
        currentTemp = Number(currentTemp.toFixed(1));
        currentRh = Number(Math.max(40, Math.min(85, currentRh)).toFixed(1));

        // Iluminansi Lux (L_R)
        const rawLux = Math.round(
          Math.max(
            0,
            daylightLux + currentBrightness * 2.55 + (rand() - 0.5) * 10
          )
        );

        // 8. Hitung Daya Meter CTA (P_A) dan CTB (P_B)
        let powerAc = 5;
        if (acActuallyCooling) {
          const thermalLoad = Math.max(0, currentTemp - 24.5) * 35;
          powerAc = Math.round(730 + thermalLoad + rand() * 95);
          powerAc = Math.min(910, Math.max(700, powerAc));
        }

        const acStatusText: "Terverifikasi" | "Belum terverifikasi" = isIrFault
          ? "Belum terverifikasi"
          : "Terverifikasi";

        if (isIrFault) {
          mode = "GANGGUAN";
          alarmActive = true;
          faultCategory = "IR_FAIL";
          alarmMessage =
            "Perintah IR AC COOL 25 °C terkirim, namun daya CTB rendah (Status AC: belum terverifikasi)";
        }

        const powerLight = Math.round((currentBrightness / 100) * 28);
        const powerFan = currentFan === 1 ? Math.round(58 + rand() * 5) : 0;
        const powerBase = Math.round(13 + rand() * 3);
        const powerTotal = powerAc + powerLight + powerFan + powerBase;

        // Integrasi energi sesuai durasi step (stepMin / 60 jam)
        const deltaHours = stepMin / 60;
        const stepEnergyKwh = (powerTotal * deltaHours) / 1000;
        cumulativeEnergyKwh = Number(
          (cumulativeEnergyKwh + stepEnergyKwh).toFixed(4)
        );

        // 9. Nilai sensor akhir + injeksi masalah data untuk Menu 2 (Data Processing)
        let finalTemp: number | "unavailable" = isNodeAOffline
          ? "unavailable"
          : currentTemp;
        let finalRh: number | "unavailable" = isNodeAOffline
          ? "unavailable"
          : currentRh;
        let finalCo2: number | "unavailable" = isNodeAOffline
          ? "unavailable"
          : currentCo2;
        let finalLux: number | "unavailable" =
          isNodeBOffline || isLuxSensorFault ? "unavailable" : rawLux;
        let finalOcc: 0 | 1 | "unavailable" = isNodeBOffline
          ? "unavailable"
          : realOcc;

        // Nilai unavailable acak untuk demo Data Processing (di luar jendela uji krusial)
        if (day === 2 && hour === 9 && minute === 15) finalTemp = "unavailable";
        if (day === 5 && hour === 11 && minute === 40) finalCo2 = "unavailable";
        if (day === 6 && hour === 16 && minute === 20) finalRh = "unavailable";
        if (day === 9 && hour === 14 && minute === 50) finalTemp = "unavailable";

        // Nilai outlier ekstrem untuk demo Data Processing (di luar jam sekuens CO2 & keluar singkat)
        if (day === 3 && hour === 10 && minute === 20) finalCo2 = 5450;
        if (day === 3 && hour === 10 && minute === 25) finalCo2 = 5120;
        if (day === 7 && hour === 13 && minute === 10) finalTemp = 46.8;
        if (day === 8 && hour === 15 && minute === 35) finalCo2 = 5280;
        if (day === 9 && hour === 10 && minute === 5) finalRh = 112.5;
        if (day === 11 && hour === 9 && minute === 45) finalTemp = 8.2;
        if (day === 14 && hour === 12 && minute === 30) finalCo2 = 250;

        const rowObj: TelemetryRow = {
          id: `${dateStr}-${timeStr}-${rows.length}`,
          timestamp,
          dateStr,
          timeStr,
          dayIndex: day,
          dayName,
          hour,
          minute,
          stepMinutes: stepMin,
          T_R: finalTemp,
          RH_R: finalRh,
          L_R: finalLux,
          C_R: finalCo2,
          OCC: finalOcc,
          DOOR: doorState,
          AUTO: isAutoMode,
          SERVICE: serviceActive,
          B_L: currentBrightness,
          AC_CMD: acCmd,
          AC_STATUS_TEXT: acStatusText,
          FAN_CMD: currentFan,
          P_A: powerTotal,
          P_B: powerAc,
          E_A: Number(cumulativeEnergyKwh.toFixed(3)),
          MODE: mode,
          NODE_A_ONLINE: !isNodeAOffline,
          NODE_B_ONLINE: !isNodeBOffline,
          ALARM_ACTIVE: alarmActive,
          ALARM_MESSAGE: alarmMessage,
          EMPTY_MINUTES: emptyMinutes,
          FAULT_CATEGORY: faultCategory,
          RESTART_SENSOR_REVALIDATED: restartSensorRevalidated,
          RESTART_TIMER_RESET: restartTimerReset,
        };

        rows.push(rowObj);

        // Sisipkan 6 baris duplikat untuk demo Tahap 4 Data Processing
        if (
          (day === 2 && hour === 10 && minute === 0) ||
          (day === 5 && hour === 15 && minute === 30) ||
          (day === 7 && hour === 18 && minute === 0) ||
          (day === 9 && hour === 12 && minute === 15) ||
          (day === 11 && hour === 16 && minute === 45) ||
          (day === 13 && hour === 11 && minute === 20)
        ) {
          rows.push({
            ...rowObj,
            id: `${dateStr}-${timeStr}-dup-${rows.length}`,
          });
        }
      }
    }
  }

  return rows;
}
