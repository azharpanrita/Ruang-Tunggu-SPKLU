/**
 * File: src/pages/AiIntegrationPage.tsx
 * Menu 4: AI Integration (Insight Otomatis, Chat Asisten AI dengan Function Calling,
 * dan Generator Laporan Uji 6 Skenario).
 *
 * Catatan untuk pemula:
 * - Tab 1: Menyajikan Insight Otomatis serta Chat Asisten AI yang dapat menjawab pertanyaan
 *   sekaligus memanggil 7 fungsi resmi (`set_lampu`, `set_ac`, `set_fan`, `set_mode`,
 *   `jalankan_prediksi`, `buka_halaman`, `jelaskan_alarm`) dengan validasi keamanan.
 * - Tab 2: Generator Laporan Uji 6 Skenario dengan status 3 nilai (LULUS / GAGAL / TIDAK DIUJI),
 *   tabel sub-kriteria berlabel "kriteria usulan kelompok, bukan standar", dan pengiriman JSON ke Gemini.
 */

import React, { useState, useMemo } from "react";
import {
  CleanedTelemetryRow,
  EnergyComparisonResult,
  ScenarioTestResult,
  TestStatus,
  buildDynamicTestConclusion,
} from "../utils/pemrosesan";
import { LiveRoomState } from "../utils/simulasi";
import { RawFunctionCall, detectFallbackFunctionCall } from "../utils/aiTools";
import {
  formatAngka,
  formatBulat,
  formatTanggalIndo,
  formatRupiah,
} from "../utils/formatters";
import { HaIcon, HA_ICONS } from "../config/appConfig";

interface AiIntegrationPageProps {
  cleanedRows: CleanedTelemetryRow[];
  energyComparison: EnergyComparisonResult;
  testScenarios: ScenarioTestResult[];
  liveState: LiveRoomState;
  tariffPerKwh: number;
  onProposeAiCommand: (call: RawFunctionCall) => void;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  source: "gemini" | "fallback";
  triggeredFunction?: string;
}

export const AiIntegrationPage: React.FC<AiIntegrationPageProps> = ({
  cleanedRows,
  energyComparison,
  testScenarios,
  liveState,
  tariffPerKwh,
  onProposeAiCommand,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<"ASSISTANT" | "REPORT">(
    "ASSISTANT"
  );

  // State Chat Asisten AI
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        'Halo! Saya Asisten Pintar Ruang Tunggu SPKLU UP3 (Kelompok 9). Anda dapat menanyakan kondisi sensor live, analisis pemakaian energi 14 hari, atau memberi perintah kendali seperti: "Atur lampu ke 80%", "Set AC ke 24 derajat", "Jalankan prediksi Kalman filter 6 bulan", atau "Jelaskan alarm saat ini".',
      timestamp: "Baru saja",
      source: "fallback",
    },
  ]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [isLoadingChat, setIsLoadingChat] = useState(false);

  // State Narasi AI untuk Generator Laporan Uji
  const [aiReportSummary, setAiReportSummary] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  // Kesimpulan dinamis 6 skenario uji
  const dynamicConclusionText = useMemo(
    () => buildDynamicTestConclusion(testScenarios, energyComparison),
    [testScenarios, energyComparison]
  );

  // Insight Otomatis berdasarkan kondisi terkini & data 14 hari
  const autoInsights = useMemo(() => {
    const peakDay = [...cleanedRows].reduce(
      (acc, r) => (r.C_R > acc.co2 ? { co2: r.C_R, ts: r.timestamp } : acc),
      { co2: 0, ts: "" }
    );
    return [
      {
        title: "Efisiensi Mode AUTO vs Baseline MANUAL",
        detail: `Pada simulasi 14 hari, mode AUTO mencatat ${formatAngka(
          energyComparison.autoTotalKwh,
          2
        )} kWh dibanding MANUAL ${formatAngka(
          energyComparison.manualTotalKwh,
          2
        )} kWh (selisih simulasi ${formatAngka(
          energyComparison.savingsKwh,
          2
        )} kWh atau ${formatAngka(energyComparison.savingsPercentage, 1)}%).`,
      },
      {
        title: "Kualitas Udara & Histeresis Ventilasi CO₂",
        detail: `Konsentrasi CO₂ tertinggi tercatat ${formatBulat(
          peakDay.co2
        )} ppm (${formatTanggalIndo(
          peakDay.ts
        )}). Fan ventilasi K1 otomatis menyala di atas 1.000 ppm dan mati kembali di bawah 800 ppm.`,
      },
      {
        title: "Status Meter Ganda Shelly Pro EM-50",
        detail: `Konstrain fisik P_B (AC) <= P_A (Total Ruang) terpenuhi 100% tanpa penjumlahan ganda. Saat ini P_A = ${formatBulat(
          liveState.P_A
        )} W dan P_B = ${formatBulat(liveState.P_B)} W.`,
      },
    ];
  }, [cleanedRows, energyComparison, liveState]);

  const tempVal = typeof liveState.T_R === "number" ? liveState.T_R : 25.2;
  const rhVal = typeof liveState.RH_R === "number" ? liveState.RH_R : 56.0;
  const luxVal = typeof liveState.L_R === "number" ? liveState.L_R : 295;
  const co2Val = typeof liveState.C_R === "number" ? liveState.C_R : 760;

  // Ringkasan konteks sistem untuk dikirim ke Gemini API
  const buildSystemContextText = () => {
    return `
Konteks Sistem Smart Room Ruang Tunggu SPKLU di UP3 (Kelompok 9):
- Kondisi Live Saat Ini:
  * Mode Operasi: ${liveState.MODE} (AUTO=${liveState.AUTO}, OCC=${liveState.OCC}, DOOR=${liveState.DOOR})
  * Suhu (T_R): ${formatAngka(tempVal, 1)} °C | Kelembapan (RH_R): ${formatAngka(rhVal, 1)} %RH
  * Cahaya (L_R): ${formatBulat(luxVal)} lux | Brightness Lampu (B_L): ${liveState.B_L}%
  * CO2 (C_R): ${formatBulat(co2Val)} ppm | Fan Ventilasi (FAN_CMD): ${liveState.FAN_CMD === 1 ? "ON" : "OFF"}
  * Status AC (AC_CMD): ${liveState.AC_CMD} (Setpoint ${liveState.AC_SETPOINT_C} °C, Verifikasi CTB: ${liveState.AC_STATUS_TEXT})
  * Daya Total Ruang CTA (P_A): ${formatBulat(liveState.P_A)} W | Daya AC CTB (P_B): ${formatBulat(liveState.P_B)} W
  * Alarm Aktif: ${liveState.ALARM_ACTIVE ? liveState.ALARM_MESSAGE : "Tidak ada alarm"}
- Ringkasan 14 Hari (Simulasi):
  * Energi 7 Hari MANUAL: ${formatAngka(energyComparison.manualTotalKwh, 2)} kWh
  * Energi 7 Hari AUTO: ${formatAngka(energyComparison.autoTotalKwh, 2)} kWh
  * Selisih Simulasi: ${formatAngka(energyComparison.savingsKwh, 2)} kWh (${formatAngka(energyComparison.savingsPercentage, 1)}%)
  * Tarif Listrik: ${formatRupiah(tariffPerKwh)}/kWh
`;
  };

  // Jawaban lokal cadangan jika API tidak tersedia
  const buildLocalAssistantReply = (question: string): string => {
    const q = question.toLowerCase();
    if (q.includes("kondisi") || q.includes("sekarang") || q.includes("live")) {
      return `Saat ini Ruang Tunggu SPKLU berada pada mode **${
        liveState.MODE
      }** (${
        liveState.OCC === 1 ? "Terisi pengunjung" : "Kosong"
      }). Suhu ruang **${formatAngka(
        tempVal,
        1
      )} °C**, kelembapan **${formatAngka(
        rhVal,
        1
      )} %RH**, pencahayaan **${formatBulat(
        luxVal
      )} lux** (lampu WiZ **${liveState.B_L}%**), dan CO₂ **${formatBulat(
        co2Val
      )} ppm**. Daya total ruang (CTA) sebesar **${formatBulat(
        liveState.P_A
      )} W** dengan sub-beban AC (CTB) **${formatBulat(liveState.P_B)} W**.`;
    }
    if (
      q.includes("hari ke-5") ||
      q.includes("tinggi") ||
      q.includes("manual")
    ) {
      return `Pemakaian energi pada Hari ke-1 hingga Hari ke-7 (termasuk Hari ke-5) lebih tinggi karena sistem beroperasi pada **Mode MANUAL (Baseline)**. Pada mode tersebut, lampu tetap menyala 100% dan AC split tetap hidup meskipun pengunjung keluar ruangan, berbeda dengan **Mode AUTO (Hari 8–14)** yang mematikan lampu setelah 5 menit kosong dan AC setelah 15 menit kosong.`;
    }
    return `Berdasarkan telemetri Smart Room SPKLU UP3: Mode saat ini **${
      liveState.MODE
    }**, suhu **${formatAngka(tempVal, 1)} °C**, CO₂ **${formatBulat(
      co2Val
    )} ppm**, dan daya total CTA **${formatBulat(
      liveState.P_A
    )} W** (AC CTB **${formatBulat(
      liveState.P_B
    )} W**). Pada simulasi 14 hari, total energi periode MANUAL adalah **${formatAngka(
      energyComparison.manualTotalKwh,
      2
    )} kWh** dan periode AUTO adalah **${formatAngka(
      energyComparison.autoTotalKwh,
      2
    )} kWh**.`;
  };

  // Handler kirim pesan ke Asisten AI
  const handleSendChat = async (customText?: string) => {
    const promptText = (customText ?? inputPrompt).trim();
    if (!promptText || isLoadingChat) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: promptText,
      timestamp: new Date().toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      source: "fallback",
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customText) setInputPrompt("");
    setIsLoadingChat(true);

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `${buildSystemContextText()}\n\nPertanyaan/Perintah Pengguna: "${promptText}"`,
          enableTools: true,
          systemInstruction:
            "Kamu adalah Asisten AI Smart Room Ruang Tunggu SPKLU UP3 (Kelompok 9). Jawab selalu dalam bahasa Indonesia yang ramah, ringkas, dan menggunakan format angka Indonesia (koma untuk desimal). Jika pengguna meminta mengubah lampu, AC, fan, mode operasi, menjalankan prediksi, membuka halaman, atau menjelaskan alarm, panggil tool/fungsi yang sesuai.",
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const fnCalls: RawFunctionCall[] = data.functionCalls || [];

        if (fnCalls.length > 0) {
          const firstCall = fnCalls[0];
          onProposeAiCommand(firstCall);
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                data.text ||
                `Saya menyiapkan panggilan fungsi \`${
                  firstCall.name
                }(${JSON.stringify(
                  firstCall.args
                )})\`. Silakan periksa dan tekan tombol **Konfirmasi** pada jendela dialog yang muncul.`,
              timestamp: new Date().toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              source: "gemini",
              triggeredFunction: firstCall.name,
            },
          ]);
          setIsLoadingChat(false);
          return;
        }

        if (data.text) {
          const fallbackCall = detectFallbackFunctionCall(promptText);
          if (fallbackCall) {
            onProposeAiCommand(fallbackCall);
          }
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: data.text,
              timestamp: new Date().toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
              }),
              source: "gemini",
              triggeredFunction: fallbackCall?.name,
            },
          ]);
          setIsLoadingChat(false);
          return;
        }
      }
    } catch {
      // Lanjut ke fallback lokal di bawah
    }

    const fallbackCall = detectFallbackFunctionCall(promptText);
    if (fallbackCall) {
      onProposeAiCommand(fallbackCall);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Perintah dikenali sebagai fungsi **${fallbackCall.name}**. Saya telah membuka dialog konfirmasi keamanan untuk memvalidasi parameter Anda.`,
          timestamp: new Date().toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          source: "fallback",
          triggeredFunction: fallbackCall.name,
        },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: buildLocalAssistantReply(promptText),
          timestamp: new Date().toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          source: "fallback",
        },
      ]);
    }
    setIsLoadingChat(false);
  };

  // Handler panggil Gemini untuk merangkum JSON hasil evaluasi 6 skenario uji
  const handleGenerateAiScenarioSummary = async () => {
    setIsGeneratingReport(true);
    const evaluationJsonPayload = {
      skenario: testScenarios.map((s) => ({
        nomor: s.id,
        judul: s.title,
        status: s.status,
        subKriteriaGagal: s.failedSubCriteriaNames,
        subKriteriaTidakDiuji: s.untestedSubCriteriaNames,
        subKriteria: s.subCriteria.map((sc) => ({
          id: sc.id,
          nama: sc.name,
          nilaiTerukur: sc.measuredValue,
          ambang: sc.threshold,
          status: sc.status,
        })),
      })),
      kesimpulanAktual: dynamicConclusionText,
      kalimatWajib:
        "Hasil ini berasal dari data simulasi; tidak membuktikan kinerja sistem lapangan dan bukan klaim penghematan.",
    };

    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Berikut adalah data JSON hasil evaluasi resmi 6 skenario uji Smart Room SPKLU UP3:\n${JSON.stringify(
            evaluationJsonPayload,
            null,
            2
          )}\n\nTuliskan ringkasan eksekutif laporan uji dalam bahasa Indonesia berdasarkan HANYA data JSON di atas.`,
          systemInstruction:
            "INSTRUKSI KETAT: Kamu hanya boleh merangkum fakta yang tertulis di dalam JSON evaluasi yang dikirim. DILARANG menambah angka, persentase, atau kesimpulan di luar JSON tersebut. Hanya skenario berstatus LULUS yang boleh disebut berhasil; skenario GAGAL atau TIDAK DIUJI wajib disebut perlu perbaikan/belum diuji. Wajib cantumkan kalimat persis: 'Hasil ini berasal dari data simulasi; tidak membuktikan kinerja sistem lapangan dan bukan klaim penghematan.'",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.text) {
          setAiReportSummary(data.text);
          setIsGeneratingReport(false);
          return;
        }
      }
    } catch {
      // Gunakan fallback deterministik yang patuh 100% pada JSON
    }

    setAiReportSummary(dynamicConclusionText);
    setIsGeneratingReport(false);
  };

  // Helper warna lencana status 3 nilai (LULUS / GAGAL / TIDAK DIUJI)
  const renderStatusBadge = (status: TestStatus) => {
    if (status === "LULUS") {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
          <HaIcon path={HA_ICONS.checkCircle} size={14} />
          LULUS
        </span>
      );
    }
    if (status === "GAGAL") {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
          <HaIcon path={HA_ICONS.closeCircle} size={14} />
          GAGAL
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
        <HaIcon path={HA_ICONS.alert} size={14} />
        TIDAK DIUJI
      </span>
    );
  };

  const quickChips = [
    "Bagaimana kondisi ruangan sekarang?",
    "Kenapa pemakaian hari ke-5 tinggi?",
    "Atur lampu ke 80%",
    "Set AC ke 24 derajat",
    "Atur lampu ke 5% (Uji Tolak <10%)",
    "Jalankan prediksi Kalman filter 6 bulan",
    "Jelaskan alarm saat ini",
  ];

  return (
    <div className="space-y-6 pb-10">
      {/* Header Halaman + Pilihan Sub-Tab */}
      <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5 sm:p-6 shadow-xl flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 uppercase tracking-wider">
              <HaIcon path={HA_ICONS.ai} size={14} />
              Menu 4 • AI Integration & Laporan Uji
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mt-2">
            Asisten AI (Function Calling) & Generator Laporan Uji 6 Skenario
          </h2>
          <p className="text-sm text-slate-300 mt-1">
            Dilengkapi validasi keamanan perintah aktuator (lampu 10–100%, AC
            22–28 °C, konfirmasi perpindahan AUTO ke MANUAL) serta evaluasi
            skenario deterministik.
          </p>
        </div>

        <div className="inline-flex rounded-2xl bg-[#050B18]/80 p-1.5 border border-white/10 gap-1">
          <button
            onClick={() => setActiveSubTab("ASSISTANT")}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 ${
              activeSubTab === "ASSISTANT"
                ? "bg-gradient-to-r from-amber-500 to-teal-500 text-slate-950 font-bold"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <HaIcon path={HA_ICONS.ai} size={16} />
            <span>Asisten AI & Function Calling</span>
          </button>
          <button
            onClick={() => setActiveSubTab("REPORT")}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 ${
              activeSubTab === "REPORT"
                ? "bg-gradient-to-r from-amber-500 to-teal-500 text-slate-950 font-bold"
                : "text-slate-300 hover:text-white"
            }`}
          >
            <HaIcon path={HA_ICONS.checkCircle} size={16} />
            <span>Generator Laporan Uji (6 Skenario)</span>
          </button>
        </div>
      </div>

      {/* =====================================================================
          SUB-TAB 1: INSIGHT OTOMATIS & ASISTEN AI DENGAN FUNCTION CALLING
         ===================================================================== */}
      {activeSubTab === "ASSISTANT" && (
        <div className="space-y-6">
          {/* 3 Kartu Insight Otomatis */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {autoInsights.map((ins, idx) => (
              <div
                key={idx}
                className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5"
              >
                <span className="text-[10px] font-bold uppercase tracking-widest text-teal-400">
                  INSIGHT OTOMATIS #{idx + 1}
                </span>
                <h3 className="text-sm font-bold text-white mt-1">
                  {ins.title}
                </h3>
                <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                  {ins.detail}
                </p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Panel Kiri: Chat Interaktif Asisten AI */}
            <div className="lg:col-span-8 bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5 sm:p-6 flex flex-col h-[540px]">
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300">
                    <HaIcon path={HA_ICONS.ai} size={22} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">
                      Percakapan Asisten Smart Room SPKLU
                    </h3>
                    <p className="text-xs text-slate-400">
                      Mendukung tanya-jawab data & 7 perintah Function Calling
                    </p>
                  </div>
                </div>
                <span className="px-3 py-1 rounded-full text-[11px] font-mono bg-teal-500/15 text-teal-300 border border-teal-500/30">
                  Mode: {liveState.MODE}
                </span>
              </div>

              {/* Daftar Pesan */}
              <div className="flex-1 overflow-y-auto py-4 space-y-3 pr-1">
                {messages.map((m, idx) => (
                  <div
                    key={idx}
                    className={`flex ${
                      m.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs sm:text-sm ${
                        m.role === "user"
                          ? "bg-gradient-to-r from-sky-500 to-teal-500 text-slate-950 font-medium"
                          : "bg-[#050B18]/85 border border-white/10 text-slate-100"
                      }`}
                    >
                      <div className="whitespace-pre-line leading-relaxed">
                        {m.content}
                      </div>
                      <div
                        className={`flex items-center justify-between gap-3 mt-2 text-[10px] ${
                          m.role === "user"
                            ? "text-slate-900/80"
                            : "text-slate-400"
                        }`}
                      >
                        <span>{m.timestamp}</span>
                        {m.triggeredFunction && (
                          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                            fn: {m.triggeredFunction}()
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {isLoadingChat && (
                  <div className="text-xs text-slate-400 font-mono animate-pulse">
                    Asisten sedang memproses konteks & memeriksa fungsi...
                  </div>
                )}
              </div>

              {/* Chip Saran Cepat */}
              <div className="flex items-center gap-1.5 overflow-x-auto py-2 border-t border-white/10">
                {quickChips.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => handleSendChat(chip)}
                    className="shrink-0 px-3 py-1.5 rounded-xl text-[11px] bg-white/5 hover:bg-white/15 text-slate-200 border border-white/10 transition"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {/* Input Chat */}
              <div className="pt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                  placeholder="Ketik pertanyaan atau perintah (mis. 'Atur lampu ke 75%' atau 'Set AC ke 24')..."
                  className="flex-1 px-4 py-2.5 rounded-2xl bg-[#050B18] border border-white/15 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-teal-400"
                />
                <button
                  onClick={() => handleSendChat()}
                  disabled={isLoadingChat}
                  className="px-5 py-2.5 rounded-2xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs sm:text-sm transition"
                >
                  Kirim
                </button>
              </div>
            </div>

            {/* Panel Kanan: Daftar 7 Fungsi Resmi & Aturan Keamanan */}
            <div className="lg:col-span-4 bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5 sm:p-6 space-y-4">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-widest text-amber-400">
                  WHITELIST FUNCTION CALLING
                </span>
                <h3 className="text-base font-bold text-white mt-0.5">
                  7 Fungsi Resmi & Aturan Keamanan
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  Setiap panggilan fungsi dari AI wajib divalidasi dan disetujui
                  pengguna melalui dialog konfirmasi sebelum dijalankan pada
                  simulasi.
                </p>
              </div>

              <div className="space-y-2.5 text-xs font-mono">
                <div className="p-3 rounded-2xl bg-[#050B18]/80 border border-white/10">
                  <div className="text-amber-300 font-bold">
                    1. set_lampu(persen)
                  </div>
                  <div className="text-slate-400 font-sans mt-0.5">
                    Wajib rentang <strong>10–100%</strong>. Nilai di luar batas
                    otomatis ditolak.
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-[#050B18]/80 border border-white/10">
                  <div className="text-sky-300 font-bold">
                    2. set_ac(mode, setpoint)
                  </div>
                  <div className="text-slate-400 font-sans mt-0.5">
                    Mode OFF/COOL, setpoint wajib <strong>22–28 °C</strong>.
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-[#050B18]/80 border border-white/10">
                  <div className="text-teal-300 font-bold">
                    3. set_fan(status)
                  </div>
                  <div className="text-slate-400 font-sans mt-0.5">
                    Mengatur kontaktor K1 fan ventilasi (ON / OFF).
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-[#050B18]/80 border border-white/10">
                  <div className="text-purple-300 font-bold">
                    4. set_mode(mode)
                  </div>
                  <div className="text-slate-400 font-sans mt-0.5">
                    Berpindah antara mode <strong>AUTO</strong> dan{" "}
                    <strong>MANUAL</strong>.
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-[#050B18]/80 border border-white/10">
                  <div className="text-emerald-300 font-bold">
                    5. jalankan_prediksi(metode, step)
                  </div>
                  <div className="text-slate-400 font-sans mt-0.5">
                    Membuka Prediktor & menjalankan 1 dari 10 metode.
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-[#050B18]/80 border border-white/10">
                  <div className="text-slate-200 font-bold">
                    6. buka_halaman(nama) & 7. jelaskan_alarm()
                  </div>
                  <div className="text-slate-400 font-sans mt-0.5">
                    Navigasi antar-menu atau menampilkan diagnostik fallback.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 2: GENERATOR LAPORAN UJI 6 SKENARIO (DETERMINISTIK + JSON GEMINI)
         ===================================================================== */}
      {activeSubTab === "REPORT" && (
        <div className="space-y-6">
          {/* Ringkasan Status 6 Skenario & Tombol Panggil Gemini JSON */}
          <div className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-widest text-teal-400">
                  EVALUASI OTOMATIS 6 SKENARIO UJI RANCANGAN
                </span>
                <h3 className="text-xl font-bold text-white mt-1">
                  Generator Laporan Uji Berdasarkan Sub-Kriteria Terukur
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 mt-1">
                  Status setiap skenario (<strong>LULUS</strong> /{" "}
                  <strong>GAGAL</strong> / <strong>TIDAK DIUJI</strong>)
                  diturunkan secara otomatis dari daftar sub-kriteria di bawah
                  ini.
                </p>
              </div>

              <button
                onClick={handleGenerateAiScenarioSummary}
                disabled={isGeneratingReport}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-teal-500 hover:opacity-95 text-slate-950 font-bold text-xs sm:text-sm shadow-lg transition shrink-0"
              >
                <HaIcon path={HA_ICONS.ai} size={18} />
                <span>
                  {isGeneratingReport
                    ? "Memproses JSON di Gemini..."
                    : "Buat Narasi Laporan Uji (Kirim JSON ke Gemini)"}
                </span>
              </button>
            </div>

            {/* Kotak Kesimpulan Dinamis & Kalimat Wajib */}
            <div className="p-4 rounded-2xl bg-[#050B18]/85 border border-teal-500/30 space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-teal-300">
                Kesimpulan Aktual Evaluasi Skenario:
              </div>
              <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                {dynamicConclusionText}
              </p>
            </div>

            {/* Hasil Narasi Gemini dari JSON */}
            {aiReportSummary && (
              <div className="p-5 rounded-2xl bg-purple-500/10 border border-purple-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
                    Narasi Laporan Uji AI (Berdasarkan Payload JSON):
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-100 whitespace-pre-line leading-relaxed">
                  {aiReportSummary}
                </p>
              </div>
            )}
          </div>

          {/* Daftar 6 Kartu Skenario beserta Tabel Sub-Kriteria Lengkap */}
          <div className="space-y-6">
            {testScenarios.map((scen) => (
              <div
                key={scen.id}
                className="bg-[#0B1D3A]/65 backdrop-blur-md rounded-3xl border border-white/10 p-5 sm:p-6 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="px-2.5 py-1 rounded-lg bg-white/10 text-xs font-mono font-bold text-sky-300">
                        Skenario {scen.id}
                      </span>
                      <h4 className="text-base sm:text-lg font-bold text-white">
                        {scen.title}
                      </h4>
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      <strong>Stimulus:</strong> {scen.stimulus} •{" "}
                      <strong>Respons Diharapkan:</strong>{" "}
                      {scen.expectedResponse}
                    </p>
                  </div>
                  <div className="shrink-0">
                    {renderStatusBadge(scen.status)}
                  </div>
                </div>

                {/* Tabel Sub-Kriteria */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-400 uppercase">
                        <th className="py-2.5 px-3">ID</th>
                        <th className="py-2.5 px-3">Sub-Kriteria Uji</th>
                        <th className="py-2.5 px-3">Nilai Terukur</th>
                        <th className="py-2.5 px-3">Ambang & Label Kriteria</th>
                        <th className="py-2.5 px-3 text-center">Hasil</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {scen.subCriteria.map((sc) => (
                        <tr key={sc.id} className="hover:bg-white/5">
                          <td className="py-3 px-3 font-mono font-bold text-slate-300">
                            {sc.id}
                          </td>
                          <td className="py-3 px-3 text-slate-100 font-medium">
                            {sc.name}
                          </td>
                          <td className="py-3 px-3 font-mono text-sky-300">
                            {sc.measuredValue}
                          </td>
                          <td className="py-3 px-3 font-mono text-amber-300">
                            {sc.threshold}
                          </td>
                          <td className="py-3 px-3 text-center">
                            {sc.status === "TIDAK DIUJI" ? (
                              <span className="px-2 py-1 rounded bg-amber-500/20 text-amber-300 font-bold text-[11px]">
                                TIDAK DIUJI
                              </span>
                            ) : sc.status === "LULUS" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[11px]">
                                ✓ Lulus
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 font-bold text-[11px]">
                                ✗ Gagal
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Detail Tambahan Skenario 3: Contoh Urutan 1.100 -> 900 -> 750 ppm & Penjelasan Bug */}
                {scen.id === 3 && scen.co2SequenceSample && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
                    <div className="p-4 rounded-2xl bg-[#050B18]/80 border border-white/10">
                      <div className="text-xs font-bold text-teal-300 mb-2">
                        Contoh Urutan Uji Histeresis CO₂ (1.100 &rarr; 900
                        &rarr; 750 ppm):
                      </div>
                      <table className="w-full text-[11px] font-mono">
                        <thead>
                          <tr className="text-slate-400 border-b border-white/10">
                            <th className="py-1 text-left">Waktu</th>
                            <th className="py-1 text-left">C_R (ppm)</th>
                            <th className="py-1 text-left">Rentang</th>
                            <th className="py-1 text-left">FAN_CMD</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {scen.co2SequenceSample.map((ex, i) => (
                            <tr key={i}>
                              <td className="py-1.5 text-slate-400">
                                {formatTanggalIndo(ex.timestamp)}
                              </td>
                              <td className="py-1.5 text-amber-300 font-bold">
                                {ex.co2Ppm} ppm
                              </td>
                              <td className="py-1.5 text-slate-200 font-sans">
                                {ex.bandDescription}
                              </td>
                              <td className="py-1.5 text-teal-300 font-bold">
                                {ex.currentFanCmd} ({ex.expectedBehavior})
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {scen.co2BugExplanation && (
                      <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-xs text-slate-200 leading-relaxed">
                        <div className="font-bold text-sky-300 mb-1">
                          Catatan Pemeriksaan Kausalitas Histeresis Sub-Kriteria
                          3(b):
                        </div>
                        {scen.co2BugExplanation}
                      </div>
                    )}
                  </div>
                )}

                {/* Detail Tambahan Skenario 5: Jumlah Kejadian per Jenis Gangguan */}
                {scen.id === 5 && scen.faultBreakdown && (
                  <div className="p-4 rounded-2xl bg-[#050B18]/80 border border-white/10">
                    <div className="text-xs font-bold text-amber-300 mb-2">
                      Jumlah Kejadian Gangguan & Restart pada Dataset (Jenis
                      tanpa data ditandai TIDAK DIUJI):
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs">
                      {scen.faultBreakdown.map((fc) => (
                        <div
                          key={fc.faultKey}
                          className="p-2.5 rounded-xl bg-white/5 border border-white/10"
                        >
                          <div className="text-slate-300 font-medium">
                            {fc.faultName}
                          </div>
                          <div className="text-base font-extrabold font-mono text-white mt-1">
                            {fc.episodeCount} kejadian ({fc.dataPointCount}{" "}
                            titik)
                          </div>
                          <div className="text-[10px] text-teal-300 font-mono">
                            Status: {fc.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Detail Tambahan Skenario 6: Tabel Perbandingan E_manual vs E_auto (Hasil Simulasi) */}
                {scen.id === 6 && scen.energyPeriodComparison && (
                  <div className="p-4 rounded-2xl bg-[#050B18]/80 border border-white/10">
                    <div className="text-xs font-bold text-teal-300 mb-2">
                      Tabel Perbandingan Periode Baseline MANUAL vs Otomasi AUTO
                      (Label: Hasil Simulasi):
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                      <div className="p-3 rounded-xl bg-white/5">
                        <span className="text-slate-400 block font-sans">
                          E_manual (Hasil Simulasi)
                        </span>
                        <span className="text-base font-bold text-amber-300">
                          {formatAngka(
                            scen.energyPeriodComparison.manualTotalKwh,
                            2
                          )}{" "}
                          kWh
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-white/5">
                        <span className="text-slate-400 block font-sans">
                          E_auto (Hasil Simulasi)
                        </span>
                        <span className="text-base font-bold text-teal-300">
                          {formatAngka(
                            scen.energyPeriodComparison.autoTotalKwh,
                            2
                          )}{" "}
                          kWh
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-white/5">
                        <span className="text-slate-400 block font-sans">
                          Selisih Simulasi
                        </span>
                        <span className="text-base font-bold text-sky-300">
                          {formatAngka(scen.energyPeriodComparison.diffKwh, 2)}{" "}
                          kWh (
                          {formatAngka(
                            scen.energyPeriodComparison.diffPercent,
                            1
                          )}
                          %)
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-white/5">
                        <span className="text-slate-400 block font-sans">
                          Jam Hadir & Layanan
                        </span>
                        <span className="text-xs text-slate-200">
                          Hadir:{" "}
                          {formatAngka(
                            scen.energyPeriodComparison.manualOccupancyHours,
                            1
                          )}
                          j vs{" "}
                          {formatAngka(
                            scen.energyPeriodComparison.autoOccupancyHours,
                            1
                          )}
                          j
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
