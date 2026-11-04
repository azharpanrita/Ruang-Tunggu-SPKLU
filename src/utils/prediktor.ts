/**
 * File: src/utils/prediktor.ts
 * Implementasi 10 Metode Prediksi Energi Bulanan (JavaScript Murni)
 * mengikuti desain contoh dosen "Smart Home Demonstrator", ditambah
 * Prediksi Okupansi Per Jam dan Prediksi Waktu CO2 Mencapai 1.000 ppm.
 *
 * Catatan untuk pemula:
 * - Semua metode ditulis dengan matematika JavaScript dasar tanpa library Machine Learning luar.
 * - Metode tingkat lanjut (RBF Network, Kalman Filter, Particle Filter, Theta Method, ARIMA(1,1,1))
 *   menggunakan "pendekatan sederhana" agar mudah dipelajari dan tetap berjalan instan di browser.
 */

import { MonthlyEnergyRecord } from "../data/dataSource";
export {
  predictHourlyOccupancy,
  predictCo2ThresholdTime,
} from "./dataProcessor";

export type PredictorMethodName =
  | "Regresi linear"
  | "Rata-rata"
  | "Bulan terakhir"
  | "Musim tahun lalu"
  | "Heuristik musiman"
  | "RBF network"
  | "Kalman filter"
  | "Particle filter"
  | "Theta method"
  | "ARIMA(1,1,1)";

export interface MethodMetadata {
  name: PredictorMethodName;
  isSimplifiedApproximation: boolean;
  beginnerExplanation: string; // Penjelasan satu kalimat untuk pemula
}

export const PREDICTOR_METHODS: MethodMetadata[] = [
  {
    name: "Regresi linear",
    isSimplifiedApproximation: false,
    beginnerExplanation:
      "Menarik garis lurus tren naik atau turun dari N bulan terakhir untuk memproyeksikan pemakaian bulan-bulan berikutnya.",
  },
  {
    name: "Rata-rata",
    isSimplifiedApproximation: false,
    beginnerExplanation:
      "Menjumlahkan pemakaian N bulan basis terakhir lalu membaginya rata sebagai nilai tebakan bulan depan.",
  },
  {
    name: "Bulan terakhir",
    isSimplifiedApproximation: false,
    beginnerExplanation:
      "Mengasumsikan pemakaian bulan depan akan sama persis dengan bulan terakhir yang baru saja tercatat (metode Naive).",
  },
  {
    name: "Musim tahun lalu",
    isSimplifiedApproximation: false,
    beginnerExplanation:
      "Menyalin pola pemakaian dari bulan yang sama persis pada satu tahun sebelumnya (12 bulan lalu).",
  },
  {
    name: "Heuristik musiman",
    isSimplifiedApproximation: false,
    beginnerExplanation:
      "Menggabungkan rata-rata tren terkini dengan indeks faktor musiman bulanan (apakah bulan tersebut biasanya panas atau sejuk).",
  },
  {
    name: "RBF network",
    isSimplifiedApproximation: true,
    beginnerExplanation:
      "Jaringan fungsi basis radial (pendekatan sederhana) yang mencocokkan kemiripan pola beberapa bulan terakhir menggunakan fungsi lonceng Gaussian.",
  },
  {
    name: "Kalman filter",
    isSimplifiedApproximation: true,
    beginnerExplanation:
      "Penyaring rekursif (pendekatan sederhana) yang terus-menerus memperbarui estimasi level dan laju tren setiap kali data bulan baru masuk.",
  },
  {
    name: "Particle filter",
    isSimplifiedApproximation: true,
    beginnerExplanation:
      "Metode simulasi sekelompok kandidat tebakan atau partikel berbobot (pendekatan sederhana) yang mengikuti pergerakan pemakaian energi.",
  },
  {
    name: "Theta method",
    isSimplifiedApproximation: true,
    beginnerExplanation:
      "Menguraikan data menjadi garis tren jangka panjang (theta=0) dan fluktuasi jangka pendek (theta=2) lalu menggabungkannya (pendekatan sederhana).",
  },
  {
    name: "ARIMA(1,1,1)",
    isSimplifiedApproximation: true,
    beginnerExplanation:
      "Model deret waktu (pendekatan sederhana) yang menghitung selisih antarbulan (diferensiasi) lalu menggabungkan efek bulan lalu (AR) dan koreksi galat (MA).",
  },
];

export interface MonthlyChartPoint {
  periodKey: string;
  label: string;
  fullLabel: string;
  actualKwh: number | null;
  forecastKwh: number | null;
  lower80Kwh: number | null;
  upper80Kwh: number | null;
  range80: [number, number] | null;
  isForecast: boolean;
}

export interface ForecastCardItem {
  stepNumber: number;
  label: string;
  fullLabel: string;
  kwh: number;
  costRp: number;
  lower80Kwh: number;
  upper80Kwh: number;
}

export interface MonthlyPredictionOutput {
  methodMeta: MethodMetadata;
  chartSeries: MonthlyChartPoint[];
  forecastCards: ForecastCardItem[];
  mae: number;
  rmse: number;
  residualStd: number;
  arimaWarning: string | null;
}

const BULAN_PENDEK = [
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

const BULAN_LENGKAP = [
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
 * Fungsi inti yang memprediksi `steps` bulan ke depan berdasarkan deret angka `historyValues`
 * dan pilihan `method` serta `basisMonths` (3 / 6 / 12 bulan).
 */
function computeMethodForecast(
  historyValues: number[],
  method: PredictorMethodName,
  basisMonths: number,
  steps: number
): number[] {
  const n = historyValues.length;
  if (n === 0) return Array(steps).fill(190);

  const basisSlice = historyValues.slice(-Math.min(n, Math.max(2, basisMonths)));
  const bLen = basisSlice.length;
  const lastVal = historyValues[n - 1];

  switch (method) {
    case "Bulan terakhir": {
      return Array(steps).fill(Number(lastVal.toFixed(1)));
    }

    case "Rata-rata": {
      const mean = basisSlice.reduce((a, b) => a + b, 0) / bLen;
      return Array(steps).fill(Number(mean.toFixed(1)));
    }

    case "Regresi linear": {
      // y = a + b*x pada jendela basisSlice
      let sumX = 0;
      let sumY = 0;
      let sumXY = 0;
      let sumXX = 0;
      for (let i = 0; i < bLen; i++) {
        const x = i + 1;
        const y = basisSlice[i];
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
      }
      const denom = bLen * sumXX - sumX * sumX;
      const slope = denom !== 0 ? (bLen * sumXY - sumX * sumY) / denom : 0;
      const intercept = (sumY - slope * sumX) / bLen;

      const preds: number[] = [];
      for (let h = 1; h <= steps; h++) {
        const val = intercept + slope * (bLen + h);
        preds.push(Number(Math.max(100, val).toFixed(1)));
      }
      return preds;
    }

    case "Musim tahun lalu": {
      const preds: number[] = [];
      for (let h = 1; h <= steps; h++) {
        // Ambil nilai dari 12 bulan sebelum titik masa depan
        const idx = n - 12 + ((h - 1) % 12);
        const fallbackIdx = Math.max(0, Math.min(n - 1, idx));
        preds.push(Number(historyValues[fallbackIdx].toFixed(1)));
      }
      return preds;
    }

    case "Heuristik musiman": {
      // Rata-rata basis + deviasi musiman 12-bulanan
      const overallMean =
        historyValues.reduce((a, b) => a + b, 0) / n;
      const basisMean = basisSlice.reduce((a, b) => a + b, 0) / bLen;
      const trendPerStep = (lastVal - basisSlice[0]) / Math.max(1, bLen - 1);

      const preds: number[] = [];
      for (let h = 1; h <= steps; h++) {
        const seasonIdx = n - 12 + ((h - 1) % 12);
        const seasonRef =
          seasonIdx >= 0 && seasonIdx < n
            ? historyValues[seasonIdx]
            : basisMean;
        const seasonalFactor = seasonRef - overallMean;
        const val =
          basisMean + seasonalFactor * 0.75 + trendPerStep * 0.25 * h;
        preds.push(Number(Math.max(100, val).toFixed(1)));
      }
      return preds;
    }

    case "RBF network": {
      // Pendekatan sederhana: Radial Basis Function dengan pusat pola lag (x_{t-1}, x_{t-2})
      const windowL = Math.min(3, bLen - 1);
      if (windowL < 1) return Array(steps).fill(Number(lastVal.toFixed(1)));

      const sigma = 22.0;
      const working = [...historyValues];
      const preds: number[] = [];

      for (let h = 1; h <= steps; h++) {
        const currentPattern = working.slice(-windowL);
        let weightedSum = 0;
        let weightTotal = 0;

        for (let i = windowL; i < working.length; i++) {
          const pastPattern = working.slice(i - windowL, i);
          let distSq = 0;
          for (let k = 0; k < windowL; k++) {
            distSq += Math.pow(currentPattern[k] - pastPattern[k], 2);
          }
          const rbfWeight = Math.exp(-distSq / (2 * sigma * sigma));
          weightedSum += rbfWeight * working[i];
          weightTotal += rbfWeight;
        }

        const nextVal =
          weightTotal > 1e-6 ? weightedSum / weightTotal : lastVal;
        const rounded = Number(Math.max(100, nextVal).toFixed(1));
        preds.push(rounded);
        working.push(rounded);
      }
      return preds;
    }

    case "Kalman filter": {
      // Pendekatan sederhana: Local Linear Trend Kalman Filter 1D (state: level L & trend T)
      let level = historyValues[0];
      let trend = n > 1 ? historyValues[1] - historyValues[0] : 0;
      let pVar = 10.0;
      const qProcessNoise = 2.2;
      const rMeasNoise = 6.5;

      for (let i = 1; i < n; i++) {
        // Tahap Prediksi (Predict)
        const predLevel = level + trend;
        pVar = pVar + qProcessNoise;

        // Tahap Koreksi (Update) dengan Kalman Gain K
        const kalmanGain = pVar / (pVar + rMeasNoise);
        const innovation = historyValues[i] - predLevel;
        level = predLevel + kalmanGain * innovation;
        trend = 0.75 * trend + 0.25 * kalmanGain * innovation;
        pVar = (1 - kalmanGain) * pVar;
      }

      const preds: number[] = [];
      for (let h = 1; h <= steps; h++) {
        // Tambahkan sedikit efek musiman lembut agar realistis pada horizon multi-step
        const seasonIdx = n - 12 + ((h - 1) % 12);
        const seasonAdj =
          seasonIdx >= 0 && seasonIdx < n
            ? (historyValues[seasonIdx] - level) * 0.22
            : 0;
        const val = level + trend * h + seasonAdj;
        preds.push(Number(Math.max(100, val).toFixed(1)));
      }
      return preds;
    }

    case "Particle filter": {
      // Pendekatan sederhana: Bootstrap Particle Filter deterministik (M = 40 partikel)
      const numParticles = 40;
      const particles: Array<{ level: number; drift: number; weight: number }> =
        [];
      const baseDrift =
        (basisSlice[bLen - 1] - basisSlice[0]) / Math.max(1, bLen - 1);

      for (let p = 0; p < numParticles; p++) {
        const offset = ((p - numParticles / 2) / numParticles) * 18;
        particles.push({
          level: lastVal + offset,
          drift: baseDrift * (0.5 + (p % 7) * 0.1),
          weight: 1 / numParticles,
        });
      }

      // Bobotkan partikel terhadap kecocokan 3 titik terakhir
      for (const pt of particles) {
        const err = Math.abs(pt.level - lastVal);
        pt.weight = Math.exp(-(err * err) / 90);
      }
      const wSum = particles.reduce((a, pt) => a + pt.weight, 0) || 1;
      particles.forEach((pt) => (pt.weight /= wSum));

      const preds: number[] = [];
      for (let h = 1; h <= steps; h++) {
        let est = 0;
        for (const pt of particles) {
          est += pt.weight * (pt.level + pt.drift * h * 0.6);
        }
        // Padukan dengan komponen musiman ringan
        const seasonIdx = n - 12 + ((h - 1) % 12);
        const seasonVal =
          seasonIdx >= 0 && seasonIdx < n ? historyValues[seasonIdx] : est;
        const blended = est * 0.72 + seasonVal * 0.28;
        preds.push(Number(Math.max(100, blended).toFixed(1)));
      }
      return preds;
    }

    case "Theta method": {
      // Pendekatan sederhana Assimakopoulos & Nikolopoulos:
      // Theta-line 0 (regresi linier murni) + Theta-line 2 (Simple Exponential Smoothing) dibagi 2
      let sumX = 0;
      let sumY = 0;
      let sumXY = 0;
      let sumXX = 0;
      for (let i = 0; i < bLen; i++) {
        const x = i + 1;
        const y = basisSlice[i];
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
      }
      const denom = bLen * sumXX - sumX * sumX;
      const slope = denom !== 0 ? (bLen * sumXY - sumX * sumY) / denom : 0;
      const intercept = (sumY - slope * sumX) / bLen;

      // SES pada deret untuk komponen Theta-2
      const alpha = 0.45;
      let sesLevel = basisSlice[0];
      for (let i = 1; i < bLen; i++) {
        sesLevel = alpha * basisSlice[i] + (1 - alpha) * sesLevel;
      }

      const preds: number[] = [];
      for (let h = 1; h <= steps; h++) {
        const theta0 = intercept + slope * (bLen + h);
        const theta2 = sesLevel + slope * 0.5 * h;
        const combined = 0.5 * theta0 + 0.5 * theta2;
        preds.push(Number(Math.max(100, combined).toFixed(1)));
      }
      return preds;
    }

    case "ARIMA(1,1,1)": {
      // Pendekatan sederhana: Diferensiasi orde-1 d_t = y_t - y_{t-1},
      // lalu estimasi d_t = c + phi * d_{t-1} + theta * e_{t-1}
      if (n < 3) return Array(steps).fill(Number(lastVal.toFixed(1)));

      const diffs: number[] = [];
      for (let i = 1; i < n; i++) {
        diffs.push(historyValues[i] - historyValues[i - 1]);
      }

      const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      // Autokorelasi lag-1 sederhana sebagai koefisien AR(1) phi
      let num = 0;
      let den = 0;
      for (let i = 1; i < diffs.length; i++) {
        num += (diffs[i] - meanDiff) * (diffs[i - 1] - meanDiff);
        den += Math.pow(diffs[i - 1] - meanDiff, 2);
      }
      const phi = den !== 0 ? Math.max(-0.7, Math.min(0.7, num / den)) : 0.25;
      const theta = -0.35; // Koefisien MA(1) stabil

      // Hitung residual terakhir e_{n-1}
      let prevError = 0;
      for (let i = 1; i < diffs.length; i++) {
        const predDiff = meanDiff + phi * (diffs[i - 1] - meanDiff) + theta * prevError;
        prevError = diffs[i] - predDiff;
      }

      const preds: number[] = [];
      let currY = lastVal;
      let lastDiff = diffs[diffs.length - 1];
      let errTerm = prevError;

      for (let h = 1; h <= steps; h++) {
        const nextDiff =
          meanDiff + phi * (lastDiff - meanDiff) + (h === 1 ? theta * errTerm : 0);
        currY = currY + nextDiff;
        lastDiff = nextDiff;
        errTerm = 0;
        preds.push(Number(Math.max(100, currY).toFixed(1)));
      }
      return preds;
    }
  }
}

/**
 * Fungsi utama untuk menjalankan prediksi bulanan sesuai pilihan kontrol pada Menu 3 (Prediktor).
 */
export function runMonthlyEnergyPredictor(params: {
  all36Months: MonthlyEnergyRecord[];
  method: PredictorMethodName;
  basisMonths: 3 | 6 | 12;
  steps: number; // 1 s/d 12
  historyLength: 12 | 24 | 36;
  tariffPerKwh: number;
}): MonthlyPredictionOutput {
  const {
    all36Months,
    method,
    basisMonths,
    steps,
    historyLength,
    tariffPerKwh,
  } = params;

  const methodMeta =
    PREDICTOR_METHODS.find((m) => m.name === method) || PREDICTOR_METHODS[0];

  // Peringatan khusus jika pengguna memilih ARIMA(1,1,1) tetapi riwayat < 24 bulan
  const arimaWarning =
    method === "ARIMA(1,1,1)" && historyLength < 24
      ? "Peringatan ARIMA(1,1,1): Panjang riwayat kurang dari 24 bulan (saat ini 12 bulan). Estimasi parameter AR dan MA pada deret pendek dapat kurang stabil; disarankan memilih RIWAYAT 24 atau 36 bulan."
      : null;

  const selectedHistory = all36Months.slice(-historyLength);
  const historyValues = selectedHistory.map((r) => r.kwh);

  // 1. Evaluasi MAE & RMSE menggunakan 3 bulan terakhir dari riwayat sebagai Data Uji (Holdout Test)
  const testCount = Math.min(3, Math.max(1, Math.floor(selectedHistory.length / 4)));
  const trainSlice = historyValues.slice(0, historyValues.length - testCount);
  const testActuals = historyValues.slice(-testCount);
  const testPreds = computeMethodForecast(
    trainSlice,
    method,
    basisMonths,
    testCount
  );

  let absErrSum = 0;
  let sqErrSum = 0;
  for (let i = 0; i < testCount; i++) {
    const err = testActuals[i] - testPreds[i];
    absErrSum += Math.abs(err);
    sqErrSum += err * err;
  }
  const mae = Number((absErrSum / testCount).toFixed(2));
  const rmse = Number(Math.sqrt(sqErrSum / testCount).toFixed(2));
  const residualStd = Math.max(4.5, rmse);

  // 2. Hitung Prakiraan `steps` bulan ke depan dari seluruh `historyValues`
  const futureKwhList = computeMethodForecast(
    historyValues,
    method,
    basisMonths,
    steps
  );

  // 3. Susun deret titik untuk Grafik Recharts (Riwayat Aktual + Titik Sambung + Prakiraan Putus-putus + Interval 80%)
  // z-score untuk interval kepercayaan 80% adalah z = 1.2816
  const z80 = 1.2816;
  const chartSeries: MonthlyChartPoint[] = selectedHistory.map((rec, idx) => {
    const isLastHistory = idx === selectedHistory.length - 1;
    return {
      periodKey: rec.periodKey,
      label: rec.label,
      fullLabel: rec.fullLabel,
      actualKwh: rec.kwh,
      // Titik terakhir riwayat juga diberi nilai forecastKwh agar garis putus-putus menyambung mulus!
      forecastKwh: isLastHistory ? rec.kwh : null,
      lower80Kwh: isLastHistory ? rec.kwh : null,
      upper80Kwh: isLastHistory ? rec.kwh : null,
      range80: isLastHistory ? [rec.kwh, rec.kwh] : null,
      isForecast: false,
    };
  });

  const lastRec = selectedHistory[selectedHistory.length - 1];
  let currYear = lastRec ? lastRec.year : 2026;
  let currMonth = lastRec ? lastRec.month : 9;

  const forecastCards: ForecastCardItem[] = [];

  for (let h = 1; h <= steps; h++) {
    currMonth++;
    if (currMonth > 12) {
      currMonth = 1;
      currYear++;
    }

    const predVal = futureKwhList[h - 1];
    // Lebar pita interval 80% melebar secara proporsional dengan akar langkah ke depan sqrt(h)
    const margin80 = z80 * residualStd * Math.sqrt(h) * 0.65;
    const lower80 = Number(Math.max(80, predVal - margin80).toFixed(1));
    const upper80 = Number((predVal + margin80).toFixed(1));

    const shortYear = String(currYear).slice(-2);
    const label = `${BULAN_PENDEK[currMonth - 1]} ${shortYear}`;
    const fullLabel = `${BULAN_LENGKAP[currMonth - 1]} ${currYear}`;
    const periodKey = `${currYear}-${String(currMonth).padStart(2, "0")}`;
    const costRp = Math.round(predVal * tariffPerKwh);

    chartSeries.push({
      periodKey,
      label,
      fullLabel,
      actualKwh: null,
      forecastKwh: predVal,
      lower80Kwh: lower80,
      upper80Kwh: upper80,
      range80: [lower80, upper80],
      isForecast: true,
    });

    forecastCards.push({
      stepNumber: h,
      label,
      fullLabel,
      kwh: predVal,
      costRp,
      lower80Kwh: lower80,
      upper80Kwh: upper80,
    });
  }

  return {
    methodMeta,
    chartSeries,
    forecastCards,
    mae,
    rmse,
    residualStd: Number(residualStd.toFixed(2)),
    arimaWarning,
  };
}
