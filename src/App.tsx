/**
 * File: src/App.tsx
 * Komponen Induk Aplikasi Web Monitoring & Analitik:
 * "Smart Room Ruang Tunggu SPKLU di UP3 Berbasis Home Assistant" (Kelompok 9)
 *
 * Catatan untuk pemula:
 * - Mengatur tema gelap (#050B18 ke #0B1D3A) dengan pendar cahaya radial biru & ungu.
 * - Menyediakan Header dengan status koneksi (Node A, Node B, Home Assistant), jam live,
 *   dan chip "Mode Demo" yang dikendalikan konstanta `DEMO_BADGE` di `src/config/appConfig.tsx`.
 * - Menjalankan loop simulasi live setiap 3 detik (`stepLiveSimulation`) serta laci
 *   "Simulasi Demo" yang dapat dibuka-tutup untuk menguji respons ruangan secara langsung.
 * - Seluruh kontrol perangkat (Lampu WiZ, AC Split, Fan K1, Prioritas Kontrol AUTO/MANUAL,
 *   Jam Layanan, Okupansi, dan Pintu) dapat dikendalikan dua arah (ON <-> OFF) secara instan.
 */

import React, { useState, useEffect, useMemo } from "react";
import {
  DEMO_BADGE,
  DEFAULT_DATA_SOURCE_MODE,
  DEFAULT_TARIFF_PER_KWH,
  DEFAULT_SERVICE_HOURS,
  DataSourceMode,
  HaIcon,
  HA_ICONS,
} from "./config/appConfig";
import {
  loadSmartRoomDataSource,
  HOME_ASSISTANT_ENTITY_MAP,
} from "./data/dataSource";
import { TelemetryRow, DEFAULT_SIM_CONFIG } from "./data/dummyGenerator";
import {
  runDataProcessingPipeline,
  evaluateSixTestScenarios,
} from "./utils/pemrosesan";
import {
  LiveRoomState,
  ActionLogEntry,
  DemoActionType,
  createInitialLiveState,
  stepLiveSimulation,
  applyDemoInjection,
  recalculateInstantPhysics,
} from "./utils/simulasi";
import {
  RawFunctionCall,
  PendingAiCommand,
  validateAndPrepareAiCommand,
  detectFallbackFunctionCall,
} from "./utils/aiTools";
import {
  PredictorMethodName,
  runMonthlyEnergyPredictor,
} from "./utils/prediktor";
import { DashboardPage } from "./pages/DashboardPage";
import { DataProcessingPage } from "./pages/DataProcessingPage";
import { PredictorPage } from "./pages/PredictorPage";
import { AiIntegrationPage } from "./pages/AiIntegrationPage";
import { formatAngka, formatBulat, formatRupiah } from "./utils/formatters";

type MenuTab = "DASHBOARD" | "PROCESSING" | "PREDICTOR" | "AI";

export type ControllableDeviceType =
  | "LIGHT"
  | "AC"
  | "FAN"
  | "MODE"
  | "SERVICE"
  | "OCC"
  | "DOOR"
  | "RESET_OVERRIDES";

export default function App() {
  // Navigasi 4 Menu Utama
  const [activeTab, setActiveTab] = useState<MenuTab>("DASHBOARD");
  const [selectedDay, setSelectedDay] = useState<number>(10);

  // Pengaturan Sistem (Tarif Listrik, Jam Layanan, Mode Sumber Data)
  const [tariffPerKwh, setTariffPerKwh] = useState<number>(
    DEFAULT_TARIFF_PER_KWH
  );
  const [serviceHours, setServiceHours] = useState(DEFAULT_SERVICE_HOURS);
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>(
    DEFAULT_DATA_SOURCE_MODE
  );
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Laci "Simulasi Demo" yang dapat dibuka-tutup
  const [showDemoDrawer, setShowDemoDrawer] = useState(false);

  // Asisten AI Mengambang (Floating Chat) & Dialog Konfirmasi Perintah AI
  const [showFloatingAi, setShowFloatingAi] = useState(false);
  const [floatingPrompt, setFloatingPrompt] = useState("");
  const [floatingMessages, setFloatingMessages] = useState<
    Array<{ role: "user" | "assistant"; text: string; time: string }>
  >([
    {
      role: "assistant",
      text: "Halo! Saya Asisten AI Smart Room SPKLU. Ketik perintah seperti 'Atur lampu ke 80%', 'Set AC ke 24 derajat', 'Jalankan prediksi Kalman filter 6 bulan', atau tanya kondisi ruangan.",
      time: "Siap",
    },
  ]);
  const [isFloatingLoading, setIsFloatingLoading] = useState(false);
  const [pendingAiCommand, setPendingAiCommand] =
    useState<PendingAiCommand | null>(null);

  // Parameter eksternal untuk halaman Prediktor saat dipicu oleh fungsi AI `jalankan_prediksi`
  const [externalPredMethod, setExternalPredMethod] =
    useState<PredictorMethodName | null>(null);
  const [externalPredSteps, setExternalPredSteps] = useState<number | null>(
    null
  );

  // Jam Live di Header (diperbarui tiap 1 detik)
  const [liveClock, setLiveClock] = useState<string>(() =>
    new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setLiveClock(
        new Date().toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Muat Tiga Lapis Data Konsisten dari dataSource
  const baseBundle = useMemo(
    () =>
      loadSmartRoomDataSource(
        dataSourceMode,
        {
          ...DEFAULT_SIM_CONFIG,
          serviceStartHour: serviceHours.startHour,
          serviceEndHour: serviceHours.endHour,
        },
        tariffPerKwh
      ),
    [dataSourceMode, serviceHours.startHour, serviceHours.endHour, tariffPerKwh]
  );

  // Dukungan dataset CSV kustom apabila pengguna mengunggah CSV di Menu 2
  const [customRawRows, setCustomRawRows] = useState<TelemetryRow[] | null>(
    null
  );
  const [datasetName, setDatasetName] = useState<string>(
    "Generator Seeded 14 Hari (Default)"
  );

  const activeRawRows = customRawRows || baseBundle.telemetry14Days;

  // Jalankan Pipeline Pembersihan Data 6 Tahap
  const pipelineResult = useMemo(
    () => runDataProcessingPipeline(activeRawRows),
    [activeRawRows]
  );

  // Evaluasi Deterministik 6 Skenario Uji
  const testScenarios = useMemo(
    () =>
      evaluateSixTestScenarios(
        activeRawRows,
        pipelineResult.cleanedRows,
        pipelineResult.energyComparison
      ),
    [
      activeRawRows,
      pipelineResult.cleanedRows,
      pipelineResult.energyComparison,
    ]
  );

  // Prakiraan bulan depan (1 step) untuk kartu KPI ke-4 di Dashboard
  const nextMonthForecastSummary = useMemo(() => {
    const out = runMonthlyEnergyPredictor({
      all36Months: baseBundle.monthlyHistory36,
      method: externalPredMethod || "Kalman filter",
      basisMonths: 6,
      steps: 1,
      historyLength: 24,
      tariffPerKwh,
    });
    const firstCard = out.forecastCards[0];
    return {
      kwh: firstCard ? firstCard.kwh : 192.5,
      costRp: firstCard ? firstCard.costRp : Math.round(192.5 * tariffPerKwh),
      methodLabel: out.methodMeta.name,
    };
  }, [baseBundle.monthlyHistory36, externalPredMethod, tariffPerKwh]);

  // State Simulasi Live (diperbarui setiap 3 detik mengikuti aturan kontrol)
  const [liveState, setLiveState] = useState<LiveRoomState>(() =>
    createInitialLiveState()
  );
  const [actionLogs, setActionLogs] = useState<ActionLogEntry[]>([
    {
      id: "init-1",
      timeStr: "Baru saja",
      actor: "Sistem Otomasi",
      sourceTag: "pembacaan sensor",
      actionTitle: "Inisialisasi Sistem Smart Room SPKLU UP3",
      detail:
        "Node A (SHT31 + SCD41), Node B (LD2410C + BH1750), dan Shelly Pro EM-50 terhubung ke Home Assistant.",
    },
  ]);

  useEffect(() => {
    const simInterval = setInterval(() => {
      setLiveState((prev) => {
        const res = stepLiveSimulation(prev);
        if (res.autoLog) {
          setActionLogs((logs) => [res.autoLog!, ...logs].slice(0, 25));
        }
        return res.nextState;
      });
    }, 3000);
    return () => clearInterval(simInterval);
  }, []);

  // Handler tombol injeksi pada laci "Simulasi Demo"
  const handleDemoInjection = (action: DemoActionType) => {
    setLiveState((prev) => {
      const res = applyDemoInjection(prev, action);
      setActionLogs((logs) => [res.logEntry, ...logs].slice(0, 25));
      return res.nextState;
    });
  };

  /**
   * Handler terpadu untuk seluruh kontrol perangkat dari Dashboard (Kartu Perangkat,
   * Tombol Cepat, Dialog More-Info, Kartu Sensor, maupun Denah Ruangan).
   * Mendukung argumen berupa angka langsung (0, 1, 65), boolean, maupun objek payload.
   */
  const handleUpdateLiveDevice = (
    device: ControllableDeviceType,
    payload: any
  ) => {
    const timeStr = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    let logTitle = `Kendali Perangkat (${device})`;
    let logDetail = "";

    setLiveState((prev) => {
      let next: LiveRoomState = {
        ...prev,
        lastDataOrigin: "injeksi simulasi",
      };

      if (device === "LIGHT") {
        let targetBrightness = next.B_L;
        if (typeof payload === "number") {
          targetBrightness = payload;
        } else if (typeof payload === "boolean") {
          targetBrightness = payload ? (next.B_L > 0 ? next.B_L : 75) : 0;
        } else if (payload && typeof payload === "object") {
          if (payload.brightness !== undefined) {
            targetBrightness = Number(payload.brightness);
          } else if (payload.toggle !== undefined) {
            targetBrightness = payload.toggle ? 75 : 0;
          }
        }
        next.B_L = Math.max(0, Math.min(100, Math.round(targetBrightness)));
        next.manualLightOverride = true;
        logTitle =
          next.B_L > 0
            ? `Lampu WiZ Diatur ke ${next.B_L}%`
            : "Lampu WiZ Dimatikan (0%)";
        logDetail = `Brightness lampu WiZ diubah oleh pengguna menjadi ${next.B_L}% (Override aktif).`;
      } else if (device === "AC") {
        if (typeof payload === "string") {
          next.AC_CMD = payload === "OFF" ? "OFF" : "COOL_25";
        } else if (typeof payload === "boolean") {
          next.AC_CMD = payload ? "COOL_25" : "OFF";
        } else if (payload && typeof payload === "object") {
          if (payload.cmd !== undefined) {
            next.AC_CMD = payload.cmd === "OFF" ? "OFF" : "COOL_25";
          }
          if (payload.setpoint !== undefined) {
            next.AC_SETPOINT_C = Math.max(
              22,
              Math.min(28, Math.round(Number(payload.setpoint)))
            );
          }
        }
        next.AC_STATUS_TEXT =
          next.AC_CMD === "OFF" ? "Terverifikasi" : "Belum terverifikasi";
        next.acPendingVerifyTicks = next.AC_CMD === "OFF" ? 0 : 1;
        next.manualAcOverride = true;
        logTitle =
          next.AC_CMD === "COOL_25"
            ? `AC Split COOL ${next.AC_SETPOINT_C} °C`
            : "AC Split Dimatikan (OFF)";
        logDetail = `Perintah IR Broadlink RM4 mini dikirim (${next.AC_CMD}, Setpoint ${next.AC_SETPOINT_C} °C).`;
      } else if (device === "FAN") {
        let isOn = false;
        if (typeof payload === "number") {
          isOn = payload === 1;
        } else if (typeof payload === "boolean") {
          isOn = payload;
        } else if (payload && typeof payload === "object") {
          isOn = Boolean(payload.on ?? payload.status === "ON");
        }
        next.FAN_CMD = isOn ? 1 : 0;
        next.manualFanOverride = true;
        logTitle = isOn
          ? "Fan Ventilasi K1 Dinyalakan (ON)"
          : "Fan Ventilasi K1 Dimatikan (OFF)";
        logDetail = `Relay Shelly Pro EM-50 & kontaktor K1 diubah ke ${
          isOn ? "ON (1)" : "OFF (0)"
        }.`;
      } else if (device === "MODE") {
        let isAuto = true;
        if (typeof payload === "number") {
          isAuto = payload === 1;
        } else if (typeof payload === "boolean") {
          isAuto = payload;
        } else if (payload && typeof payload === "object") {
          isAuto = Boolean(payload.auto ?? payload.mode === "AUTO");
        }
        next.AUTO = isAuto ? 1 : 0;
        if (isAuto) {
          // Saat dikembalikan ke AUTO, bersihkan seluruh override manual agar otomasi bekerja penuh
          next.manualLightOverride = false;
          next.manualAcOverride = false;
          next.manualFanOverride = false;
          if (!next.NODE_B_ONLINE) {
            next.MODE = "GANGGUAN";
          } else if (next.SERVICE === 0) {
            next.MODE = "SIAP";
            next.B_L = 0;
            next.AC_CMD = "OFF";
          } else if (next.OCC === 1) {
            next.MODE = "DIGUNAKAN";
            if (next.B_L === 0) next.B_L = 65;
            next.AC_CMD = "COOL_25";
          } else {
            next.MODE =
              next.emptyMinutesElapsed > 0 && next.emptyMinutesElapsed < 15
                ? "TUNDA_KOSONG"
                : "SIAP";
          }
        } else {
          next.MODE = "MANUAL";
        }
        logTitle = isAuto
          ? "Prioritas Kontrol: MODE AUTO (1)"
          : "Prioritas Kontrol: MODE MANUAL (0)";
        logDetail = isAuto
          ? "Koordinasi otomatis Home Assistant diaktifkan kembali & override manual direset."
          : "Kendali dialihkan ke MODE MANUAL (Otomasi pusat ditahan).";
      } else if (device === "SERVICE") {
        let isServiceActive = true;
        if (typeof payload === "number") {
          isServiceActive = payload === 1;
        } else if (typeof payload === "boolean") {
          isServiceActive = payload;
        } else if (payload && typeof payload === "object") {
          isServiceActive = Boolean(payload.service);
        }
        next.SERVICE = isServiceActive ? 1 : 0;
        // Reset override agar perubahan jam layanan langsung berdampak ke ruangan
        next.manualLightOverride = false;
        next.manualAcOverride = false;

        if (!isServiceActive) {
          if (next.AUTO === 1) {
            next.MODE = "SIAP";
            next.B_L = 0;
            next.AC_CMD = "OFF";
          }
        } else {
          // Saat layanan diaktifkan kembali (1), nyalakan perangkat bila ruang sedang terisi & AUTO
          if (next.AUTO === 1) {
            if (next.OCC === 1) {
              next.MODE = "DIGUNAKAN";
              next.B_L = 65;
              next.AC_CMD = "COOL_25";
              next.AC_STATUS_TEXT = "Terverifikasi";
            } else {
              next.MODE = "SIAP";
            }
          }
        }
        logTitle = isServiceActive
          ? "Jam Layanan SPKLU: AKTIF (1)"
          : "Jam Layanan SPKLU: TUTUP (0)";
        logDetail = isServiceActive
          ? "Jam layanan diaktifkan kembali. Fasilitas ruang tunggu beroperasi normal."
          : "Di luar jam layanan. Perangkat otomatis masuk ke mode hemat (SIAP).";
      } else if (device === "OCC") {
        const isOccupied =
          typeof payload === "number" ? payload === 1 : Boolean(payload);
        next.NODE_B_ONLINE = true;
        next.OCC = isOccupied ? 1 : 0;
        next.DOOR = 1;
        next.manualLightOverride = false;
        next.manualAcOverride = false;
        if (isOccupied) {
          next.emptyMinutesElapsed = 0;
          if (next.AUTO === 1 && next.SERVICE === 1) {
            next.MODE = "DIGUNAKAN";
            if (next.B_L === 0) next.B_L = 65;
            next.AC_CMD = "COOL_25";
          }
        } else {
          next.emptyMinutesElapsed = 1;
          if (next.AUTO === 1 && next.SERVICE === 1) {
            next.MODE = "TUNDA_KOSONG";
          }
        }
        logTitle = isOccupied
          ? "Sensor Okupansi: Pengguna Hadir (OCC=1)"
          : "Sensor Okupansi: Ruang Kosong (OCC=0)";
        logDetail = isOccupied
          ? "Radar mmWave LD2410C mendeteksi kehadiran pengunjung."
          : "Ruang tunggu kosong; timer TUNDA_KOSONG dimulai.";
      } else if (device === "DOOR") {
        const isOpen =
          typeof payload === "number" ? payload === 1 : Boolean(payload);
        next.DOOR = isOpen ? 1 : 0;
        logTitle = isOpen
          ? "Kontak Pintu: Terbuka (DOOR=1)"
          : "Kontak Pintu: Tertutup (DOOR=0)";
        logDetail = `Sensor Reed Switch pintu diubah ke status ${
          isOpen ? "Terbuka" : "Tertutup"
        }.`;
      } else if (device === "RESET_OVERRIDES") {
        next.manualLightOverride = false;
        next.manualAcOverride = false;
        next.manualFanOverride = false;
        next.AUTO = 1;
        next.SERVICE = 1;
        if (next.OCC === 1) {
          next.MODE = "DIGUNAKAN";
          if (next.B_L === 0) next.B_L = 65;
          next.AC_CMD = "COOL_25";
        } else {
          next.MODE = "SIAP";
        }
        logTitle = "Reset Override ke Otomasi Penuh";
        logDetail =
          "Seluruh kunci override manual dilepas; Home Assistant kembali mengatur ruangan secara otomatis.";
      }

      next.lastInjectionLabel = logTitle;
      return recalculateInstantPhysics(next);
    });

    setActionLogs((logs) =>
      [
        {
          id: `ui-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          timeStr,
          actor: "Operator / More-Info" as const,
          sourceTag: "injeksi simulasi" as const,
          actionTitle: logTitle,
          detail: logDetail,
        },
        ...logs,
      ].slice(0, 25)
    );
  };

  // Handler saat AI mengusulkan panggilan fungsi (Function Calling)
  const handleProposeAiCommand = (rawCall: RawFunctionCall) => {
    const validated = validateAndPrepareAiCommand(rawCall, liveState);
    setPendingAiCommand(validated);
  };

  // Handler saat pengguna menekan tombol "Konfirmasi & Jalankan Simulasi" pada modal
  const handleConfirmAiCommand = () => {
    if (!pendingAiCommand) return;

    const { functionName, args, validationValid, requiresSwitchToManual } =
      pendingAiCommand;
    const timeStr = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    if (!validationValid) {
      setPendingAiCommand(null);
      return;
    }

    if (functionName === "buka_halaman") {
      setActiveTab(args.nama as MenuTab);
    } else if (functionName === "jalankan_prediksi") {
      setExternalPredMethod(args.metode as PredictorMethodName);
      setExternalPredSteps(Number(args.step) || 6);
      setActiveTab("PREDICTOR");
    } else if (functionName === "jelaskan_alarm") {
      setFloatingMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: liveState.ALARM_ACTIVE
            ? `Diagnostik Alarm Aktif: ${liveState.ALARM_MESSAGE}. Fallback sesuai rancangan telah diaktifkan.`
            : "Diagnostik Alarm: Saat ini TIDAK ADA alarm aktif (Node A, Node B, dan Home Assistant beroperasi normal).",
          time: timeStr,
        },
      ]);
      setShowFloatingAi(true);
    } else {
      // Fungsi aktuator atau mode (`set_lampu`, `set_ac`, `set_fan`, `set_mode`)
      setLiveState((prev) => {
        const next: LiveRoomState = {
          ...prev,
          lastDataOrigin: "injeksi simulasi",
        };
        if (requiresSwitchToManual) {
          next.AUTO = 0;
          next.MODE = "MANUAL";
        }
        if (functionName === "set_mode") {
          const isManual = args.mode === "MANUAL";
          next.AUTO = isManual ? 0 : 1;
          if (!isManual) {
            next.manualLightOverride = false;
            next.manualAcOverride = false;
            next.manualFanOverride = false;
          }
          next.MODE = isManual
            ? "MANUAL"
            : next.OCC === 1
            ? "DIGUNAKAN"
            : "SIAP";
        } else if (functionName === "set_lampu") {
          next.B_L = Number(args.persen);
          next.manualLightOverride = true;
        } else if (functionName === "set_ac") {
          next.AC_CMD = args.mode === "OFF" ? "OFF" : "COOL_25";
          next.AC_SETPOINT_C = Number(args.setpoint) || 25;
          next.AC_STATUS_TEXT =
            args.mode === "OFF" ? "Terverifikasi" : "Belum terverifikasi";
          next.acPendingVerifyTicks = args.mode === "OFF" ? 0 : 1;
          next.manualAcOverride = true;
        } else if (functionName === "set_fan") {
          next.FAN_CMD = args.status === "ON" ? 1 : 0;
          next.manualFanOverride = true;
        }
        next.lastInjectionLabel = `AI Function: ${functionName}`;
        return recalculateInstantPhysics(next);
      });

      setActionLogs((logs) =>
        [
          {
            id: `ai-${Date.now()}`,
            timeStr,
            actor: "AI Asisten (Simulasi)" as const,
            sourceTag: "injeksi simulasi" as const,
            actionTitle: `Eksekusi Fungsi AI: ${functionName}(${JSON.stringify(
              args
            )})`,
            detail: requiresSwitchToManual
              ? "Dikonfirmasi pengguna (Mode dialihkan dari AUTO ke MANUAL)."
              : "Dikonfirmasi pengguna melalui dialog keamanan.",
          },
          ...logs,
        ].slice(0, 25)
      );
    }

    setPendingAiCommand(null);
  };

  // Handler kirim pesan dari laci Asisten AI Mengambang (Floating Chat)
  const handleSendFloatingChat = async () => {
    const promptText = floatingPrompt.trim();
    if (!promptText || isFloatingLoading) return;

    const nowTime = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });
    setFloatingMessages((prev) => [
      ...prev,
      { role: "user", text: promptText, time: nowTime },
    ]);
    setFloatingPrompt("");
    setIsFloatingLoading(true);

    const tempVal = typeof liveState.T_R === "number" ? liveState.T_R : 25.2;
    const rhVal = typeof liveState.RH_R === "number" ? liveState.RH_R : 56.0;
    const luxVal = typeof liveState.L_R === "number" ? liveState.L_R : 295;
    const co2Val = typeof liveState.C_R === "number" ? liveState.C_R : 760;

    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Kondisi Live Ruang Tunggu SPKLU: Mode=${
            liveState.MODE
          }, Suhu=${formatAngka(tempVal, 1)}°C, RH=${formatAngka(
            rhVal,
            1
          )}%, Lux=${formatBulat(luxVal)}, CO2=${formatBulat(
            co2Val
          )} ppm, Lampu=${liveState.B_L}%, AC=${liveState.AC_CMD}, Fan=${
            liveState.FAN_CMD === 1 ? "ON" : "OFF"
          }, Daya Total P_A=${formatBulat(
            liveState.P_A
          )}W, Daya AC P_B=${formatBulat(
            liveState.P_B
          )}W.\n\nPerintah/Pertanyaan Pengguna: "${promptText}"`,
          enableTools: true,
          systemInstruction:
            "Kamu adalah Asisten AI Smart Room SPKLU UP3. Jawab singkat dalam bahasa Indonesia dan panggil fungsi jika pengguna meminta mengubah aktuator, mode, prediksi, halaman, atau alarm.",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.functionCalls && data.functionCalls.length > 0) {
          const fc = data.functionCalls[0];
          handleProposeAiCommand(fc);
          setFloatingMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text:
                data.text ||
                `Meminta konfirmasi untuk fungsi \`${fc.name}(${JSON.stringify(
                  fc.args
                )})\`...`,
              time: nowTime,
            },
          ]);
          setIsFloatingLoading(false);
          return;
        }
        if (data.text) {
          const fb = detectFallbackFunctionCall(promptText);
          if (fb) handleProposeAiCommand(fb);
          setFloatingMessages((prev) => [
            ...prev,
            { role: "assistant", text: data.text, time: nowTime },
          ]);
          setIsFloatingLoading(false);
          return;
        }
      }
    } catch {
      // Gunakan parser cadangan di bawah
    }

    const fallbackCall = detectFallbackFunctionCall(promptText);
    if (fallbackCall) {
      handleProposeAiCommand(fallbackCall);
      setFloatingMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Perintah dikenali sebagai \`${fallbackCall.name}\`. Silakan konfirmasi pada dialog yang muncul.`,
          time: nowTime,
        },
      ]);
    } else {
      setFloatingMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Saat ini ruangan dalam mode ${
            liveState.MODE
          }, suhu ${formatAngka(tempVal, 1)} °C, CO₂ ${formatBulat(
            co2Val
          )} ppm, lampu ${liveState.B_L}%, dan daya total CTA ${formatBulat(
            liveState.P_A
          )} W.`,
          time: nowTime,
        },
      ]);
    }
    setIsFloatingLoading(false);
  };

  const navItems: Array<{
    id: MenuTab;
    label: string;
    icon: string;
  }> = [
    { id: "DASHBOARD", label: "Dashboard", icon: HA_ICONS.dashboard },
    { id: "PROCESSING", label: "Data Processing", icon: HA_ICONS.database },
    { id: "PREDICTOR", label: "Prediktor", icon: HA_ICONS.chartLine },
    { id: "AI", label: "AI Integration", icon: HA_ICONS.ai },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#050B18] via-[#071226] to-[#0B1D3A] text-slate-100 relative overflow-x-hidden pb-20 sm:pb-10">
      {/* Cahaya Radial Futuristik Biru, Sian & Ungu di Sudut Layar */}
      <div className="pointer-events-none fixed -top-40 -left-40 w-[560px] h-[560px] rounded-full bg-cyan-500/15 blur-[140px]" />
      <div className="pointer-events-none fixed top-1/4 -right-40 w-[520px] h-[520px] rounded-full bg-purple-600/20 blur-[150px]" />
      <div className="pointer-events-none fixed -bottom-40 left-1/3 w-[540px] h-[540px] rounded-full bg-teal-500/15 blur-[150px]" />

      {/* =====================================================================
          HEADER UTAMA & NAVIGASI TAB PIL ATAS
         ===================================================================== */}
      <header className="sticky top-0 z-30 bg-[#050B18]/85 backdrop-blur-2xl border-b border-cyan-500/20 shadow-lg shadow-black/30">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* Kiri: Brand, Status Koneksi (Node A, Node B, HA), Jam Live, dan Chip Mode Demo */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-blue-600 flex items-center justify-center text-slate-950 shadow-lg shadow-cyan-500/30 ring-1 ring-white/30">
                <HaIcon path={HA_ICONS.energy} size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base sm:text-lg font-extrabold tracking-tight bg-gradient-to-r from-white via-cyan-100 to-teal-300 bg-clip-text text-transparent">
                    Smart Room SPKLU UP3
                  </h1>
                  {DEMO_BADGE && (
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-400/50 shadow-sm shadow-amber-500/20">
                      Mode Demo
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  Futuristic Building Telemetry • Kelompok 9 Gedung & Rumah Cerdas
                </p>
              </div>
            </div>

            {/* Indikator Status Koneksi & Jam Live */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[11px] border ${
                  liveState.NODE_A_ONLINE
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                    : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    liveState.NODE_A_ONLINE
                      ? "bg-emerald-400 animate-pulse"
                      : "bg-rose-400"
                  }`}
                />
                Node A
              </span>

              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[11px] border ${
                  liveState.NODE_B_ONLINE
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                    : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    liveState.NODE_B_ONLINE
                      ? "bg-emerald-400 animate-pulse"
                      : "bg-rose-400"
                  }`}
                />
                Node B
              </span>

              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[11px] border ${
                  liveState.HA_ONLINE
                    ? "bg-sky-500/10 text-sky-300 border-sky-500/30"
                    : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                }`}
              >
                <HaIcon path={HA_ICONS.wifi} size={13} />
                HA Core
              </span>

              <span className="px-3 py-1 rounded-full bg-[#0B1D3A] border border-cyan-400/30 font-mono text-[11px] text-cyan-200 shadow-inner">
                {liveClock} WIB
              </span>
            </div>
          </div>

          {/* Tengah: Navigasi Tab Pil di Laptop/Tablet */}
          <nav className="hidden sm:flex items-center bg-[#09152B]/95 p-1.5 rounded-full border border-white/15 shadow-inner">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    active
                      ? "bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 text-slate-950 shadow-lg shadow-teal-500/25"
                      : "text-slate-300 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <HaIcon path={item.icon} size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Kanan: Tombol Laci Simulasi Demo & Pengaturan */}
          <div className="flex items-center gap-2 self-end lg:self-auto">
            <button
              onClick={() => setShowDemoDrawer((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-xs font-bold border transition cursor-pointer ${
                showDemoDrawer
                  ? "bg-amber-400 text-slate-950 border-amber-300 shadow-lg shadow-amber-500/20"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/35 hover:bg-amber-500/25"
              }`}
            >
              <HaIcon path={HA_ICONS.play} size={15} />
              <span>Simulasi Demo</span>
            </button>

            <button
              onClick={() => setShowSettingsModal(true)}
              className="p-2 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition cursor-pointer"
              title="Pengaturan Tarif & Sumber Data"
            >
              <HaIcon path={HA_ICONS.settings} size={18} />
            </button>
          </div>
        </div>

        {/* Laci "Simulasi Demo" yang Dapat Dibuka-Tutup */}
        {showDemoDrawer && (
          <div className="bg-[#0B1D3A]/95 border-t border-amber-500/30 px-4 sm:px-6 py-3.5">
            <div className="max-w-[1440px] mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 font-bold uppercase tracking-wider">
                  Panel Injeksi Simulasi Live
                </span>
                <span className="text-slate-300">
                  Klik skenario di bawah untuk menguji respons langsung (nilai
                  ditandai sebagai{" "}
                  <strong className="text-amber-300">"injeksi simulasi"</strong>
                  ):
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleDemoInjection("USER_ENTER")}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition cursor-pointer"
                >
                  1. Pengguna Masuk
                </button>
                <button
                  onClick={() => handleDemoInjection("USER_LEAVE")}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 transition cursor-pointer"
                >
                  2. Pengguna Keluar
                </button>
                <button
                  onClick={() => handleDemoInjection("RAISE_CO2")}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition cursor-pointer"
                >
                  3. Naikkan CO₂ (&gt;1.000 ppm)
                </button>
                <button
                  onClick={() => handleDemoInjection("DIM_DAYLIGHT")}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 transition cursor-pointer"
                >
                  4. Redupkan Cahaya Alami
                </button>
                <button
                  onClick={() => handleDemoInjection("NODE_B_OFFLINE")}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition cursor-pointer"
                >
                  5. Node B Offline
                </button>
                <button
                  onClick={() => handleDemoInjection("RESTART_HOST")}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 border border-teal-500/40 transition cursor-pointer"
                >
                  6. Restart Host (Pulihkan)
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* =====================================================================
          KONTEN UTAMA (4 MENU)
         ===================================================================== */}
      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 pt-6 relative z-10">
        {activeTab === "DASHBOARD" && (
          <DashboardPage
            liveState={liveState}
            onUpdateLiveDevice={handleUpdateLiveDevice}
            actionLogs={actionLogs}
            rawRows={activeRawRows}
            cleanedRows={pipelineResult.cleanedRows}
            dailyStats={pipelineResult.dailyStats}
            hourlyStats={pipelineResult.hourlyStats}
            billingProjection={baseBundle.billingProjection}
            nextMonthForecastKwh={nextMonthForecastSummary.kwh}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
          />
        )}

        {activeTab === "PROCESSING" && (
          <DataProcessingPage
            rawRows={activeRawRows}
            cleanedRows={pipelineResult.cleanedRows}
            quality={pipelineResult.quality}
            dailyStats={pipelineResult.dailyStats}
            hourlyStats={pipelineResult.hourlyStats}
            energyComparison={pipelineResult.energyComparison}
            monthly36Records={baseBundle.monthlyHistory36}
            tariffPerKwh={tariffPerKwh}
            activeDatasetName={datasetName}
            onUploadCustomData={(rows, name) => {
              setCustomRawRows(rows);
              setDatasetName(`CSV Unggahan: ${name}`);
            }}
            onResetDefaultData={() => {
              setCustomRawRows(null);
              setDatasetName("Generator Seeded 14 Hari (Default)");
            }}
          />
        )}

        {activeTab === "PREDICTOR" && (
          <PredictorPage
            monthly36Records={baseBundle.monthlyHistory36}
            cleanedRows={pipelineResult.cleanedRows}
            tariffPerKwh={tariffPerKwh}
            externalMethod={externalPredMethod}
            externalSteps={externalPredSteps}
          />
        )}

        {activeTab === "AI" && (
          <AiIntegrationPage
            cleanedRows={pipelineResult.cleanedRows}
            energyComparison={pipelineResult.energyComparison}
            testScenarios={testScenarios}
            liveState={liveState}
            tariffPerKwh={tariffPerKwh}
            onProposeAiCommand={handleProposeAiCommand}
          />
        )}
      </main>

      {/* =====================================================================
          BAR NAVIGASI BAWAH UNTUK HP (MOBILE)
         ===================================================================== */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-[#050B18]/95 backdrop-blur-xl border-t border-white/10 px-2 py-2 flex items-center justify-around">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-2xl text-[11px] font-semibold transition ${
                active ? "text-teal-400" : "text-slate-400"
              }`}
            >
              <HaIcon path={item.icon} size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* =====================================================================
          TOMBOL & LACI ASISTEN AI MENGAMBANG (FLOATING CHAT DI SEMUA HALAMAN)
         ===================================================================== */}
      <div className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-40">
        {showFloatingAi ? (
          <div className="w-[340px] sm:w-[390px] h-[470px] bg-[#0B1D3A]/95 backdrop-blur-2xl rounded-3xl border border-teal-400/40 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-4 py-3.5 bg-gradient-to-r from-teal-500/25 to-sky-500/20 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-teal-400 text-slate-950 flex items-center justify-center">
                  <HaIcon path={HA_ICONS.ai} size={18} />
                </div>
                <div>
                  <div className="text-xs font-extrabold text-white">
                    Asisten Pintar SPKLU
                  </div>
                  <div className="text-[10px] text-teal-300 font-mono">
                    7 Fungsi Kendali & Tanya Data
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowFloatingAi(false)}
                className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 text-xs">
              {floatingMessages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${
                    m.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                      m.role === "user"
                        ? "bg-teal-400 text-slate-950 font-semibold"
                        : "bg-[#050B18]/90 border border-white/10 text-slate-100"
                    }`}
                  >
                    <div>{m.text}</div>
                    <div className="text-[9px] opacity-70 mt-1 text-right">
                      {m.time}
                    </div>
                  </div>
                </div>
              ))}
              {isFloatingLoading && (
                <div className="text-[11px] text-teal-300 font-mono animate-pulse">
                  Memproses perintah AI...
                </div>
              )}
            </div>

            <div className="p-2.5 border-t border-white/10 bg-[#050B18]/80 flex items-center gap-2">
              <input
                type="text"
                value={floatingPrompt}
                onChange={(e) => setFloatingPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendFloatingChat()}
                placeholder="Mis: Set AC ke 24 atau Lampu 80%..."
                className="flex-1 px-3 py-2 rounded-xl bg-[#0B1D3A] border border-white/15 text-xs text-white focus:outline-none focus:border-teal-400"
              />
              <button
                onClick={handleSendFloatingChat}
                className="px-3.5 py-2 rounded-xl bg-teal-400 hover:bg-teal-300 text-slate-950 font-bold text-xs cursor-pointer"
              >
                Kirim
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowFloatingAi(true)}
            className="flex items-center gap-2.5 px-4 py-3 rounded-full bg-gradient-to-r from-teal-400 to-sky-400 text-slate-950 font-extrabold text-xs shadow-xl shadow-teal-500/25 hover:scale-105 transition cursor-pointer"
          >
            <HaIcon path={HA_ICONS.ai} size={20} />
            <span>Asisten AI</span>
          </button>
        )}
      </div>

      {/* =====================================================================
          DIALOG KONFIRMASI KEAMANAN FUNCTION CALLING AI
         ===================================================================== */}
      {pendingAiCommand && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#0B1D3A] rounded-3xl border border-white/15 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Konfirmasi Perintah AI (Simulasi)
              </span>
              <button
                onClick={() => setPendingAiCommand(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <h3 className="text-lg font-bold text-white">
              {pendingAiCommand.summaryTitle}
            </h3>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {pendingAiCommand.summaryDescription}
            </p>

            <div
              className={`p-3.5 rounded-2xl border text-xs font-mono ${
                pendingAiCommand.validationValid
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-rose-500/15 border-rose-500/40 text-rose-300"
              }`}
            >
              <strong>Status Validasi Keamanan:</strong>{" "}
              {pendingAiCommand.validationMessage}
            </div>

            {pendingAiCommand.requiresSwitchToManual &&
              pendingAiCommand.validationValid && (
                <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-xs text-amber-200">
                  <strong>Perhatian Prioritas Mode:</strong> Sistem saat ini
                  berada pada mode <strong>AUTO</strong>. Menjalankan perintah
                  aktuator ini akan mengalihkan ruangan ke mode{" "}
                  <strong>MANUAL</strong>.
                </div>
              )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setPendingAiCommand(null)}
                className="px-4 py-2.5 rounded-2xl text-xs font-semibold bg-white/10 hover:bg-white/15 text-slate-200"
              >
                Batal
              </button>
              {pendingAiCommand.validationValid && (
                <button
                  onClick={handleConfirmAiCommand}
                  className="px-5 py-2.5 rounded-2xl text-xs font-bold bg-teal-400 hover:bg-teal-300 text-slate-950 shadow-lg"
                >
                  Konfirmasi & Jalankan Simulasi
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL PENGATURAN (TARIF LISTRIK, JAM LAYANAN, MODE DATA SOURCE)
         ===================================================================== */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-[#0B1D3A] rounded-3xl border border-white/15 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Pengaturan Sistem & Sumber Data
                </h3>
                <p className="text-xs text-slate-400">
                  Konfigurasi Tarif Listrik (Rp/kWh), Jam Layanan, dan Kerangka
                  Home Assistant
                </p>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs sm:text-sm">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                  Tarif Listrik per kWh (Rp)
                </label>
                <input
                  type="number"
                  value={tariffPerKwh}
                  onChange={(e) =>
                    setTariffPerKwh(
                      Math.max(100, Number(e.target.value) || 1445)
                    )
                  }
                  className="w-full px-4 py-2.5 rounded-2xl bg-[#050B18] border border-white/15 text-white font-mono"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Default PLN Non-Subsidi: {formatRupiah(1445)}/kWh.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                    Jam Buka Layanan
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={serviceHours.startHour}
                    onChange={(e) =>
                      setServiceHours((s) => ({
                        ...s,
                        startHour: Number(e.target.value),
                      }))
                    }
                    className="w-full px-4 py-2 rounded-2xl bg-[#050B18] border border-white/15 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                    Jam Tutup Layanan
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={serviceHours.endHour}
                    onChange={(e) =>
                      setServiceHours((s) => ({
                        ...s,
                        endHour: Number(e.target.value),
                      }))
                    }
                    className="w-full px-4 py-2 rounded-2xl bg-[#050B18] border border-white/15 text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                  Mode Lapisan Data (dataSource.ts)
                </label>
                <select
                  value={dataSourceMode}
                  onChange={(e) =>
                    setDataSourceMode(e.target.value as DataSourceMode)
                  }
                  className="w-full px-4 py-2.5 rounded-2xl bg-[#050B18] border border-white/15 text-white font-semibold"
                >
                  <option value="dummy">
                    Mode 'dummy' (Generator Seeded 14 Hari + 36 Bulan)
                  </option>
                  <option value="homeassistant">
                    Mode 'homeassistant' (Kerangka Entity Home Assistant)
                  </option>
                </select>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#050B18]/90 border border-white/10 max-h-40 overflow-y-auto text-[11px] font-mono text-slate-300 space-y-1">
                <div className="text-teal-300 font-bold mb-1">
                  Pemetaan Entity Home Assistant (Siap Integrasi):
                </div>
                {Object.entries(HOME_ASSISTANT_ENTITY_MAP).map(([tag, ent]) => (
                  <div key={tag} className="flex justify-between">
                    <span className="text-amber-300">{tag}</span>
                    <span className="text-slate-400">{ent}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-5 py-2.5 rounded-2xl bg-teal-400 hover:bg-teal-300 text-slate-950 font-bold text-xs cursor-pointer"
              >
                Simpan & Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
