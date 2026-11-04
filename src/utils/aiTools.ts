/**
 * File: src/utils/aiTools.ts
 * Definisi 7 Fungsi (Function Calling) yang Diizinkan untuk AI Asisten
 * beserta Aturan Keamanan, Validasi Rentang Parameter, dan Parser Cadangan.
 *
 * Catatan untuk pemula:
 * - AI TIDAK boleh langsung mengubah aktuator secara diam-diam.
 * - Semua perintah dari AI wajib melewati daftar fungsi resmi (whitelist) di file ini:
 *   1. set_lampu(persen)        -> wajib 10–100%
 *   2. set_ac(mode, setpoint)   -> mode OFF/COOL, setpoint wajib 22–28 °C
 *   3. set_fan(status)          -> ON / OFF
 *   4. set_mode(mode)           -> AUTO / MANUAL
 *   5. jalankan_prediksi(metode, step) -> 10 metode, step 1–12 bulan
 *   6. buka_halaman(nama)       -> DASHBOARD / PROCESSING / PREDICTOR / AI
 *   7. jelaskan_alarm()         -> menjelaskan alarm & fallback aktif
 * - Jika ruangan sedang dalam mode AUTO dan pengguna meminta ubah lampu/AC/fan,
 *   sistem meminta konfirmasi untuk berpindah ke mode MANUAL terlebih dahulu.
 */

import { PredictorMethodName, PREDICTOR_METHODS } from "./prediktor";
import { LiveRoomState } from "./simulasi";

export type AllowedAiFunctionName =
  | "set_lampu"
  | "set_ac"
  | "set_fan"
  | "set_mode"
  | "jalankan_prediksi"
  | "buka_halaman"
  | "jelaskan_alarm";

export interface RawFunctionCall {
  name: string;
  args: Record<string, any>;
}

export interface PendingAiCommand {
  id: string;
  functionName: AllowedAiFunctionName;
  args: Record<string, any>;
  isActuatorCommand: boolean;
  requiresSwitchToManual: boolean; // True jika sedang AUTO dan meminta ubah lampu/AC/fan
  validationValid: boolean;
  validationMessage: string;
  summaryTitle: string;
  summaryDescription: string;
}

export const ALLOWED_FUNCTION_NAMES: AllowedAiFunctionName[] = [
  "set_lampu",
  "set_ac",
  "set_fan",
  "set_mode",
  "jalankan_prediksi",
  "buka_halaman",
  "jelaskan_alarm",
];

/**
 * Memvalidasi panggilan fungsi dari Gemini (atau dari parser cadangan) terhadap
 * aturan keamanan Smart Room SPKLU UP3.
 */
export function validateAndPrepareAiCommand(
  call: RawFunctionCall,
  liveState: LiveRoomState
): PendingAiCommand {
  const fnName = call.name as AllowedAiFunctionName;
  const args = call.args || {};
  const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  if (!ALLOWED_FUNCTION_NAMES.includes(fnName)) {
    return {
      id,
      functionName: "jelaskan_alarm",
      args,
      isActuatorCommand: false,
      requiresSwitchToManual: false,
      validationValid: false,
      validationMessage: `Fungsi '${call.name}' ditolak karena tidak ada dalam daftar fungsi yang diizinkan.`,
      summaryTitle: "Perintah Ditolak (Di Luar Whitelist)",
      summaryDescription:
        "Demi keamanan, asisten hanya mengizinkan 7 fungsi resmi.",
    };
  }

  const isCurrentlyAuto = liveState.AUTO === 1;

  switch (fnName) {
    case "set_lampu": {
      const persen = Number(args.persen);
      if (Number.isNaN(persen) || persen < 10 || persen > 100) {
        return {
          id,
          functionName: "set_lampu",
          args,
          isActuatorCommand: true,
          requiresSwitchToManual: isCurrentlyAuto,
          validationValid: false,
          validationMessage: `Nilai kecerahan lampu (${args.persen}%) ditolak! Sesuai aturan keamanan rancangan, tingkat brightness lampu WiZ hanya diizinkan pada rentang 10–100%.`,
          summaryTitle: `Validasi Gagal: set_lampu(${args.persen}%)`,
          summaryDescription: "Rentang yang diizinkan adalah 10% sampai 100%.",
        };
      }
      return {
        id,
        functionName: "set_lampu",
        args: { persen: Math.round(persen) },
        isActuatorCommand: true,
        requiresSwitchToManual: isCurrentlyAuto,
        validationValid: true,
        validationMessage: "Rentang kecerahan lampu valid (10–100%).",
        summaryTitle: `Simulasi Perintah: set_lampu(${Math.round(persen)}%)`,
        summaryDescription: isCurrentlyAuto
          ? `Mengatur brightness lampu WiZ ke ${Math.round(persen)}%. Karena sistem sedang dalam mode AUTO, konfirmasi ini juga akan mengalihkan sistem ke mode MANUAL (mode manual memiliki prioritas).`
          : `Mengatur brightness lampu WiZ ke ${Math.round(persen)}% (Mode Simulasi).`,
      };
    }

    case "set_ac": {
      const rawMode = String(args.mode || "COOL").toUpperCase();
      const mode = rawMode.includes("OFF") ? "OFF" : "COOL";
      const setpoint =
        args.setpoint !== undefined ? Number(args.setpoint) : 25;

      if (
        mode === "COOL" &&
        (Number.isNaN(setpoint) || setpoint < 22 || setpoint > 28)
      ) {
        return {
          id,
          functionName: "set_ac",
          args,
          isActuatorCommand: true,
          requiresSwitchToManual: isCurrentlyAuto,
          validationValid: false,
          validationMessage: `Setpoint suhu AC (${args.setpoint} °C) ditolak! Sesuai aturan keamanan, setpoint AC hanya diizinkan pada rentang 22–28 °C.`,
          summaryTitle: `Validasi Gagal: set_ac(${mode}, ${args.setpoint} °C)`,
          summaryDescription: "Setpoint AC wajib berada di antara 22 °C dan 28 °C.",
        };
      }

      return {
        id,
        functionName: "set_ac",
        args: { mode, setpoint: Math.round(setpoint) },
        isActuatorCommand: true,
        requiresSwitchToManual: isCurrentlyAuto,
        validationValid: true,
        validationMessage: "Parameter mode dan setpoint AC valid (22–28 °C).",
        summaryTitle:
          mode === "OFF"
            ? "Simulasi Perintah: set_ac(OFF)"
            : `Simulasi Perintah: set_ac(COOL, ${Math.round(setpoint)} °C)`,
        summaryDescription: isCurrentlyAuto
          ? `Mengirim perintah IR Broadlink RM4 mini (${mode === "OFF" ? "OFF" : `COOL ${Math.round(setpoint)} °C`}). Karena mode sedang AUTO, konfirmasi ini sekaligus mengalihkan sistem ke mode MANUAL.`
          : `Mengirim perintah IR Broadlink RM4 mini (${mode === "OFF" ? "OFF" : `COOL ${Math.round(setpoint)} °C`}) pada mode Simulasi. Status AC akan 'Belum terverifikasi' hingga daya CTB berubah.`,
      };
    }

    case "set_fan": {
      const rawStatus = String(args.status ?? args.on ?? "ON").toUpperCase();
      const isOn =
        rawStatus === "ON" || rawStatus === "1" || rawStatus === "TRUE";
      const statusLabel = isOn ? "ON" : "OFF";

      return {
        id,
        functionName: "set_fan",
        args: { status: statusLabel },
        isActuatorCommand: true,
        requiresSwitchToManual: isCurrentlyAuto,
        validationValid: true,
        validationMessage: "Perintah relay fan ventilasi K1 valid.",
        summaryTitle: `Simulasi Perintah: set_fan(${statusLabel})`,
        summaryDescription: isCurrentlyAuto
          ? `Mengubah relay Shelly Pro EM-50 & kontaktor K1 fan ventilasi ke ${statusLabel}. Karena mode sedang AUTO, konfirmasi ini juga akan mengalihkan sistem ke mode MANUAL.`
          : `Mengubah relay Shelly Pro EM-50 & kontaktor K1 fan ventilasi ke ${statusLabel} (Simulasi).`,
      };
    }

    case "set_mode": {
      const rawMode = String(args.mode || "AUTO").toUpperCase();
      const targetMode = rawMode.includes("MAN") ? "MANUAL" : "AUTO";
      return {
        id,
        functionName: "set_mode",
        args: { mode: targetMode },
        isActuatorCommand: false,
        requiresSwitchToManual: false,
        validationValid: true,
        validationMessage: `Perpindahan ke mode ${targetMode} valid.`,
        summaryTitle: `Simulasi Perintah: set_mode(${targetMode})`,
        summaryDescription:
          targetMode === "MANUAL"
            ? "Mengalihkan prioritas kendali ke petugas (MANUAL). Seluruh aturan otomasi pusat ditahan."
            : "Mengaktifkan kembali koordinasi otomatis Home Assistant (AUTO). Sensor dibaca ulang untuk menentukan mode.",
      };
    }

    case "jalankan_prediksi": {
      const rawMethod = String(args.metode || "Regresi linear");
      const matched =
        PREDICTOR_METHODS.find(
          (m) => m.name.toLowerCase() === rawMethod.toLowerCase()
        ) ||
        PREDICTOR_METHODS.find((m) =>
          m.name.toLowerCase().includes(rawMethod.toLowerCase())
        ) ||
        PREDICTOR_METHODS[0];
      const step = Math.max(1, Math.min(12, Number(args.step) || 6));

      return {
        id,
        functionName: "jalankan_prediksi",
        args: { metode: matched.name, step },
        isActuatorCommand: false,
        requiresSwitchToManual: false,
        validationValid: true,
        validationMessage: `Metode '${matched.name}' dengan horizon ${step} bulan valid.`,
        summaryTitle: `Simulasi Fungsi: jalankan_prediksi("${matched.name}", ${step} bln)`,
        summaryDescription: `Membuka halaman Prediktor dan menjalankan metode ${matched.name} untuk memproyeksikan ${step} bulan ke depan.`,
      };
    }

    case "buka_halaman": {
      const rawPage = String(args.nama || "DASHBOARD").toUpperCase();
      let pageKey: "DASHBOARD" | "PROCESSING" | "PREDICTOR" | "AI" =
        "DASHBOARD";
      if (rawPage.includes("PROC") || rawPage.includes("DATA")) {
        pageKey = "PROCESSING";
      } else if (rawPage.includes("PRED")) {
        pageKey = "PREDICTOR";
      } else if (rawPage.includes("AI") || rawPage.includes("LAPORAN")) {
        pageKey = "AI";
      }

      return {
        id,
        functionName: "buka_halaman",
        args: { nama: pageKey },
        isActuatorCommand: false,
        requiresSwitchToManual: false,
        validationValid: true,
        validationMessage: `Navigasi ke halaman ${pageKey} valid.`,
        summaryTitle: `Simulasi Navigasi: buka_halaman("${pageKey}")`,
        summaryDescription: `Berpindah ke menu ${pageKey}.`,
      };
    }

    case "jelaskan_alarm": {
      return {
        id,
        functionName: "jelaskan_alarm",
        args: {},
        isActuatorCommand: false,
        requiresSwitchToManual: false,
        validationValid: true,
        validationMessage: "Fungsi diagnostik alarm valid.",
        summaryTitle: `Fungsi Diagnostik: jelaskan_alarm()`,
        summaryDescription:
          "Menampilkan penjelasan rinci mengenai status alarm saat ini beserta prosedur fallback sesuai tabel rancangan.",
      };
    }
  }
}

/**
 * Parser cadangan di sisi klien (Rule-Based Intent Parser) apabila koneksi Gemini API
 * sedang tidak tersedia, sehingga pengguna tetap dapat menguji ketujuh fungsi lewat chat!
 */
export function detectFallbackFunctionCall(
  userText: string
): RawFunctionCall | null {
  const t = userText.toLowerCase();

  // 1. Cek perintah lampu: misal "lampu 80%", "atur lampu ke 50", "redupkan lampu 5%"
  if (t.includes("lampu") && (t.includes("atur") || t.includes("set") || t.includes("ubah") || t.includes("%") || /\d+/.test(t))) {
    const match = t.match(/(\d+)/);
    if (match) {
      return { name: "set_lampu", args: { persen: Number(match[1]) } };
    }
  }

  // 2. Cek perintah AC: misal "set ac 24", "atur ac ke 25", "matikan ac"
  if (t.includes("ac") && (t.includes("atur") || t.includes("set") || t.includes("matikan") || t.includes("nyalakan") || t.includes("derajat"))) {
    if (t.includes("matikan") || t.includes("off")) {
      return { name: "set_ac", args: { mode: "OFF", setpoint: 25 } };
    }
    const match = t.match(/(\d+)/);
    return {
      name: "set_ac",
      args: { mode: "COOL", setpoint: match ? Number(match[1]) : 25 },
    };
  }

  // 3. Cek perintah Fan / Kipas
  if ((t.includes("fan") || t.includes("kipas") || t.includes("ventilasi")) && (t.includes("nyalakan") || t.includes("matikan") || t.includes("on") || t.includes("off") || t.includes("set"))) {
    const isOff = t.includes("matikan") || t.includes("off");
    return { name: "set_fan", args: { status: isOff ? "OFF" : "ON" } };
  }

  // 4. Cek perintah Mode AUTO / MANUAL
  if (t.includes("mode") && (t.includes("manual") || t.includes("auto") || t.includes("otomatis"))) {
    const isMan = t.includes("manual");
    return { name: "set_mode", args: { mode: isMan ? "MANUAL" : "AUTO" } };
  }

  // 5. Cek perintah jalankan prediksi
  if (t.includes("jalankan prediksi") || (t.includes("prediksi") && (t.includes("kalman") || t.includes("arima") || t.includes("theta") || t.includes("rbf") || t.includes("regresi") || t.includes("musim") || t.includes("particle")))) {
    let method: PredictorMethodName = "Regresi linear";
    for (const m of PREDICTOR_METHODS) {
      if (t.includes(m.name.toLowerCase())) {
        method = m.name;
        break;
      }
    }
    if (t.includes("kalman")) method = "Kalman filter";
    else if (t.includes("arima")) method = "ARIMA(1,1,1)";
    else if (t.includes("theta")) method = "Theta method";
    else if (t.includes("rbf")) method = "RBF network";
    else if (t.includes("particle")) method = "Particle filter";

    const stepMatch = t.match(/(\d+)\s*(bulan|step|bln)/);
    const step = stepMatch ? Number(stepMatch[1]) : 6;
    return { name: "jalankan_prediksi", args: { metode: method, step } };
  }

  // 6. Cek perintah buka halaman
  if (t.includes("buka halaman") || t.includes("pindah ke") || t.includes("ke menu")) {
    if (t.includes("prediktor") || t.includes("prediksi")) {
      return { name: "buka_halaman", args: { nama: "PREDICTOR" } };
    }
    if (t.includes("processing") || t.includes("pemrosesan") || t.includes("data")) {
      return { name: "buka_halaman", args: { nama: "PROCESSING" } };
    }
    if (t.includes("ai") || t.includes("laporan")) {
      return { name: "buka_halaman", args: { nama: "AI" } };
    }
    return { name: "buka_halaman", args: { nama: "DASHBOARD" } };
  }

  // 7. Cek perintah jelaskan alarm
  if (t.includes("jelaskan alarm") || t.includes("status alarm") || t.includes("kenapa alarm")) {
    return { name: "jelaskan_alarm", args: {} };
  }

  return null;
}
