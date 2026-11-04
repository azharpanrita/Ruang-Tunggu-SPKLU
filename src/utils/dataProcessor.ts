/**
 * File: src/utils/dataProcessor.ts
 * Berisi seluruh fungsi pemrosesan data (Data Cleaning Pipeline),
 * perhitungan rumus energi, algoritma Prediktor (JavaScript murni),
 * serta evaluasi deterministik 6 skenario uji sistem Smart Room Ruang Tunggu SPKLU UP3.
 */

import { TelemetryRow } from "../data/dummyGenerator";

export type TestStatus = "LULUS" | "GAGAL" | "TIDAK DIUJI";

export interface CleanedTelemetryRow
  extends Omit<TelemetryRow, "T_R" | "RH_R" | "L_R" | "C_R" | "OCC"> {
  T_R: number;
  RH_R: number;
  L_R: number;
  C_R: number;
  OCC: 0 | 1;
  wasInterpolated: boolean;
  wasOutlierFixed: boolean;
}

export interface DataQualitySummary {
  totalRawRows: number;
  totalCleanRows: number;
  validPercentage: number;
  missingValueCount: number;
  outlierCount: number;
  duplicateCount: number;
  nodeAOfflineMinutes: number;
  nodeBOfflineMinutes: number;
  totalOfflineMinutes: number;
  columnsValid: boolean;
  detectedColumns: string[];
  outlierDetails: Array<{
    timestamp: string;
    field: string;
    rawValue: number;
    validRange: string;
    replacedWith: number;
  }>;
  missingDetails: Array<{
    timestamp: string;
    fields: string[];
  }>;
}

export interface DailyAggregation {
  dayIndex: number;
  dateStr: string;
  dayName: string;
  modeLabel: "MANUAL" | "AUTO";
  avgTemp: number;
  avgRh: number;
  avgLuxDuringOcc: number;
  avgCo2: number;
  maxCo2: number;
  occupancyHours: number;
  serviceHours: number;
  energyTotalKwh: number;
  energyAcKwh: number;
  energyOtherKwh: number;
}

export interface HourlyAggregation {
  dateStr: string;
  hour: number;
  timeLabel: string;
  avgTemp: number;
  avgRh: number;
  avgLux: number;
  avgCo2: number;
  occupancyRatio: number;
  avgPowerA: number;
  avgPowerB: number;
  energyKwh: number;
}

export interface EnergyComparisonResult {
  manualTotalKwh: number;
  autoTotalKwh: number;
  manualAcKwh: number;
  autoAcKwh: number;
  manualAvgDailyKwh: number;
  autoAvgDailyKwh: number;
  savingsKwh: number;
  savingsPercentage: number;
  manualOccupancyHours: number;
  autoOccupancyHours: number;
  manualServiceHours: number;
  autoServiceHours: number;
  manualAvgTemp: number;
  autoAvgTemp: number;
  manualAvgLuxOcc: number;
  autoAvgLuxOcc: number;
  acSetpointText: string;
}

export const REQUIRED_COLUMNS = [
  "timestamp",
  "T_R",
  "RH_R",
  "L_R",
  "C_R",
  "OCC",
  "DOOR",
  "AUTO",
  "SERVICE",
  "B_L",
  "AC_CMD",
  "FAN_CMD",
  "P_A",
  "P_B",
  "E_A",
];

export function runDataProcessingPipeline(rawRows: TelemetryRow[]): {
  cleanedRows: CleanedTelemetryRow[];
  quality: DataQualitySummary;
  dailyStats: DailyAggregation[];
  hourlyStats: HourlyAggregation[];
  energyComparison: EnergyComparisonResult;
} {
  const sampleRow = rawRows[0] || ({} as Record<string, unknown>);
  const detectedColumns = Object.keys(sampleRow);
  const columnsValid = REQUIRED_COLUMNS.every((col) =>
    detectedColumns.includes(col)
  );

  // Tahap 4: Deduplikasi berdasarkan timestamp
  const seenTimestamps = new Set<string>();
  const deduplicatedRaw: TelemetryRow[] = [];
  let duplicateCount = 0;

  for (const row of rawRows) {
    if (seenTimestamps.has(row.timestamp)) {
      duplicateCount++;
    } else {
      seenTimestamps.add(row.timestamp);
      deduplicatedRaw.push(row);
    }
  }

  // Tahap 2 & 3: Deteksi "unavailable" dan Outlier
  let missingValueCount = 0;
  let outlierCount = 0;
  let nodeAOfflineMinutes = 0;
  let nodeBOfflineMinutes = 0;

  const outlierDetails: DataQualitySummary["outlierDetails"] = [];
  const missingDetails: DataQualitySummary["missingDetails"] = [];

  interface IntermediateRow
    extends Omit<TelemetryRow, "T_R" | "RH_R" | "L_R" | "C_R" | "OCC"> {
    T_R: number | null;
    RH_R: number | null;
    L_R: number | null;
    C_R: number | null;
    OCC: 0 | 1 | null;
    wasInterpolated: boolean;
    wasOutlierFixed: boolean;
  }

  const intermediate: IntermediateRow[] = deduplicatedRaw.map((r) => {
    const stepMin = r.stepMinutes ?? 5;
    if (!r.NODE_A_ONLINE) nodeAOfflineMinutes += stepMin;
    if (!r.NODE_B_ONLINE) nodeBOfflineMinutes += stepMin;

    const missingFields: string[] = [];
    let wasInterpolated = false;
    let wasOutlierFixed = false;

    const parseAndValidate = (
      val: number | "unavailable",
      field: string,
      min: number,
      max: number,
      unit: string
    ): number | null => {
      if (
        val === "unavailable" ||
        val === null ||
        val === undefined ||
        Number.isNaN(Number(val))
      ) {
        missingValueCount++;
        missingFields.push(field);
        wasInterpolated = true;
        return null;
      }
      const num = Number(val);
      if (num < min || num > max) {
        outlierCount++;
        wasOutlierFixed = true;
        outlierDetails.push({
          timestamp: r.timestamp,
          field,
          rawValue: num,
          validRange: `${min}–${max} ${unit}`,
          replacedWith: 0,
        });
        return null;
      }
      return num;
    };

    const tVal = parseAndValidate(r.T_R, "T_R (Suhu)", 15, 40, "°C");
    const rhVal = parseAndValidate(r.RH_R, "RH_R (Kelembapan)", 0, 100, "%RH");
    const lVal = parseAndValidate(r.L_R, "L_R (Lux)", 0, 2000, "lux");
    const cVal = parseAndValidate(r.C_R, "C_R (CO2)", 400, 5000, "ppm");

    let occVal: 0 | 1 | null = null;
    if (r.OCC === "unavailable" || (r.OCC !== 0 && r.OCC !== 1)) {
      missingValueCount++;
      missingFields.push("OCC (Okupansi)");
      wasInterpolated = true;
      occVal = null;
    } else {
      occVal = r.OCC;
    }

    if (missingFields.length > 0) {
      missingDetails.push({
        timestamp: r.timestamp,
        fields: missingFields,
      });
    }

    const safePA = Math.max(0, Number(r.P_A) || 0);
    const safePB = Math.min(safePA, Math.max(0, Number(r.P_B) || 0));

    return {
      ...r,
      stepMinutes: stepMin,
      T_R: tVal,
      RH_R: rhVal,
      L_R: lVal,
      C_R: cVal,
      OCC: occVal,
      P_A: safePA,
      P_B: safePB,
      wasInterpolated,
      wasOutlierFixed,
    };
  });

  // Tahap 5: Interpolasi linier nilai kosong
  const interpolateField = (
    getter: (row: IntermediateRow) => number | null,
    setter: (row: IntermediateRow, val: number) => void,
    defaultVal: number,
    decimals: number
  ) => {
    const n = intermediate.length;
    for (let i = 0; i < n; i++) {
      if (getter(intermediate[i]) === null) {
        let prevVal: number | null = null;
        let prevIdx = i - 1;
        while (prevIdx >= 0) {
          const v = getter(intermediate[prevIdx]);
          if (v !== null) {
            prevVal = v;
            break;
          }
          prevIdx--;
        }

        let nextVal: number | null = null;
        let nextIdx = i + 1;
        while (nextIdx < n) {
          const v = getter(intermediate[nextIdx]);
          if (v !== null) {
            nextVal = v;
            break;
          }
          nextIdx++;
        }

        let interpolated = defaultVal;
        if (prevVal !== null && nextVal !== null) {
          const ratio = (i - prevIdx) / (nextIdx - prevIdx);
          interpolated = prevVal + (nextVal - prevVal) * ratio;
        } else if (prevVal !== null) {
          interpolated = prevVal;
        } else if (nextVal !== null) {
          interpolated = nextVal;
        }

        const factor = Math.pow(10, decimals);
        setter(intermediate[i], Math.round(interpolated * factor) / factor);
      }
    }
  };

  interpolateField(
    (r) => r.T_R,
    (r, v) => (r.T_R = v),
    25.5,
    1
  );
  interpolateField(
    (r) => r.RH_R,
    (r, v) => (r.RH_R = v),
    58.0,
    1
  );
  interpolateField(
    (r) => r.L_R,
    (r, v) => (r.L_R = v),
    295,
    0
  );
  interpolateField(
    (r) => r.C_R,
    (r, v) => (r.C_R = v),
    550,
    0
  );

  let lastValidOcc: 0 | 1 = 0;
  for (let i = 0; i < intermediate.length; i++) {
    if (intermediate[i].OCC === null) {
      intermediate[i].OCC = lastValidOcc;
    } else {
      lastValidOcc = intermediate[i].OCC as 0 | 1;
    }
  }

  const cleanedRows: CleanedTelemetryRow[] = intermediate.map((r) => ({
    ...r,
    T_R: r.T_R as number,
    RH_R: r.RH_R as number,
    L_R: r.L_R as number,
    C_R: r.C_R as number,
    OCC: r.OCC as 0 | 1,
  }));

  const cleanByTs = new Map<string, CleanedTelemetryRow>();
  for (const cr of cleanedRows) {
    cleanByTs.set(cr.timestamp, cr);
  }
  for (const od of outlierDetails) {
    const cr = cleanByTs.get(od.timestamp);
    if (cr) {
      if (od.field.startsWith("T_R")) od.replacedWith = cr.T_R;
      if (od.field.startsWith("RH_R")) od.replacedWith = cr.RH_R;
      if (od.field.startsWith("L_R")) od.replacedWith = cr.L_R;
      if (od.field.startsWith("C_R")) od.replacedWith = cr.C_R;
    }
  }

  const rowsWithIssues = deduplicatedRaw.filter(
    (r) =>
      r.T_R === "unavailable" ||
      r.RH_R === "unavailable" ||
      r.L_R === "unavailable" ||
      r.C_R === "unavailable" ||
      r.OCC === "unavailable" ||
      (typeof r.C_R === "number" && (r.C_R < 400 || r.C_R > 5000)) ||
      (typeof r.T_R === "number" && (r.T_R < 15 || r.T_R > 40)) ||
      (typeof r.RH_R === "number" && (r.RH_R < 0 || r.RH_R > 100))
  ).length;

  const validPercentage =
    rawRows.length > 0
      ? Number(
          (
            ((rawRows.length - duplicateCount - rowsWithIssues) /
              rawRows.length) *
            100
          ).toFixed(2)
        )
      : 100;

  // Tahap 6: Agregasi Per Hari & Per Jam dengan bobot durasi stepMinutes
  const dailyMap = new Map<number, CleanedTelemetryRow[]>();
  const hourlyMap = new Map<string, CleanedTelemetryRow[]>();

  for (const row of cleanedRows) {
    if (!dailyMap.has(row.dayIndex)) {
      dailyMap.set(row.dayIndex, []);
    }
    dailyMap.get(row.dayIndex)!.push(row);

    const hourKey = `${row.dateStr}_${String(row.hour).padStart(2, "0")}`;
    if (!hourlyMap.has(hourKey)) {
      hourlyMap.set(hourKey, []);
    }
    hourlyMap.get(hourKey)!.push(row);
  }

  const dailyStats: DailyAggregation[] = [];
  dailyMap.forEach((rowsInDay, dayIndex) => {
    const first = rowsInDay[0];
    const totalMinutes = rowsInDay.reduce(
      (acc, r) => acc + (r.stepMinutes ?? 5),
      0
    );
    const sumTempWeighted = rowsInDay.reduce(
      (acc, r) => acc + r.T_R * (r.stepMinutes ?? 5),
      0
    );
    const sumRhWeighted = rowsInDay.reduce(
      (acc, r) => acc + r.RH_R * (r.stepMinutes ?? 5),
      0
    );
    const sumCo2Weighted = rowsInDay.reduce(
      (acc, r) => acc + r.C_R * (r.stepMinutes ?? 5),
      0
    );
    const maxCo2 = rowsInDay.reduce((acc, r) => Math.max(acc, r.C_R), 0);

    const occRows = rowsInDay.filter((r) => r.OCC === 1);
    const occMinutes = occRows.reduce(
      (acc, r) => acc + (r.stepMinutes ?? 5),
      0
    );
    const avgLuxDuringOcc =
      occMinutes > 0
        ? occRows.reduce((acc, r) => acc + r.L_R * (r.stepMinutes ?? 5), 0) /
          occMinutes
        : 0;

    const occupancyHours = occMinutes / 60;
    const serviceHours =
      rowsInDay
        .filter((r) => r.SERVICE === 1)
        .reduce((acc, r) => acc + (r.stepMinutes ?? 5), 0) / 60;

    // Rumus Energi: E (kWh) = sum(P * delta_t) / 1000
    const energyTotalKwh =
      rowsInDay.reduce(
        (acc, r) => acc + r.P_A * ((r.stepMinutes ?? 5) / 60),
        0
      ) / 1000;
    const energyAcKwh =
      rowsInDay.reduce(
        (acc, r) => acc + r.P_B * ((r.stepMinutes ?? 5) / 60),
        0
      ) / 1000;
    const energyOtherKwh = Math.max(0, energyTotalKwh - energyAcKwh);

    dailyStats.push({
      dayIndex,
      dateStr: first.dateStr,
      dayName: first.dayName,
      modeLabel: first.AUTO === 1 ? "AUTO" : "MANUAL",
      avgTemp: Number((sumTempWeighted / Math.max(1, totalMinutes)).toFixed(1)),
      avgRh: Number((sumRhWeighted / Math.max(1, totalMinutes)).toFixed(1)),
      avgLuxDuringOcc: Number(avgLuxDuringOcc.toFixed(0)),
      avgCo2: Number((sumCo2Weighted / Math.max(1, totalMinutes)).toFixed(0)),
      maxCo2,
      occupancyHours: Number(occupancyHours.toFixed(2)),
      serviceHours: Number(serviceHours.toFixed(1)),
      energyTotalKwh: Number(energyTotalKwh.toFixed(2)),
      energyAcKwh: Number(energyAcKwh.toFixed(2)),
      energyOtherKwh: Number(energyOtherKwh.toFixed(2)),
    });
  });

  dailyStats.sort((a, b) => a.dayIndex - b.dayIndex);

  const hourlyStats: HourlyAggregation[] = [];
  hourlyMap.forEach((rowsInHour) => {
    const first = rowsInHour[0];
    const totalMin = rowsInHour.reduce(
      (a, r) => a + (r.stepMinutes ?? 5),
      0
    );
    const avgTemp =
      rowsInHour.reduce((a, r) => a + r.T_R * (r.stepMinutes ?? 5), 0) /
      Math.max(1, totalMin);
    const avgRh =
      rowsInHour.reduce((a, r) => a + r.RH_R * (r.stepMinutes ?? 5), 0) /
      Math.max(1, totalMin);
    const avgLux =
      rowsInHour.reduce((a, r) => a + r.L_R * (r.stepMinutes ?? 5), 0) /
      Math.max(1, totalMin);
    const avgCo2 =
      rowsInHour.reduce((a, r) => a + r.C_R * (r.stepMinutes ?? 5), 0) /
      Math.max(1, totalMin);
    const occMin = rowsInHour
      .filter((r) => r.OCC === 1)
      .reduce((a, r) => a + (r.stepMinutes ?? 5), 0);
    const occRatio = (occMin / Math.max(1, totalMin)) * 100;
    const avgPowerA =
      rowsInHour.reduce((a, r) => a + r.P_A * (r.stepMinutes ?? 5), 0) /
      Math.max(1, totalMin);
    const avgPowerB =
      rowsInHour.reduce((a, r) => a + r.P_B * (r.stepMinutes ?? 5), 0) /
      Math.max(1, totalMin);
    const energyKwh =
      rowsInHour.reduce(
        (a, r) => a + r.P_A * ((r.stepMinutes ?? 5) / 60),
        0
      ) / 1000;

    hourlyStats.push({
      dateStr: first.dateStr,
      hour: first.hour,
      timeLabel: `${String(first.hour).padStart(2, "0")}:00`,
      avgTemp: Number(avgTemp.toFixed(1)),
      avgRh: Number(avgRh.toFixed(1)),
      avgLux: Number(avgLux.toFixed(0)),
      avgCo2: Number(avgCo2.toFixed(0)),
      occupancyRatio: Number(occRatio.toFixed(0)),
      avgPowerA: Number(avgPowerA.toFixed(0)),
      avgPowerB: Number(avgPowerB.toFixed(0)),
      energyKwh: Number(energyKwh.toFixed(3)),
    });
  });

  const manualDays = dailyStats.filter((d) => d.modeLabel === "MANUAL");
  const autoDays = dailyStats.filter((d) => d.modeLabel === "AUTO");

  const manualTotalKwh = manualDays.reduce((a, d) => a + d.energyTotalKwh, 0);
  const autoTotalKwh = autoDays.reduce((a, d) => a + d.energyTotalKwh, 0);
  const manualAcKwh = manualDays.reduce((a, d) => a + d.energyAcKwh, 0);
  const autoAcKwh = autoDays.reduce((a, d) => a + d.energyAcKwh, 0);

  const manualAvgDailyKwh =
    manualDays.length > 0 ? manualTotalKwh / manualDays.length : 0;
  const autoAvgDailyKwh =
    autoDays.length > 0 ? autoTotalKwh / autoDays.length : 0;

  const savingsKwh = manualTotalKwh - autoTotalKwh;
  const savingsPercentage =
    manualTotalKwh > 0 ? (savingsKwh / manualTotalKwh) * 100 : 0;

  const manualAvgTemp =
    manualDays.length > 0
      ? manualDays.reduce((a, d) => a + d.avgTemp, 0) / manualDays.length
      : 0;
  const autoAvgTemp =
    autoDays.length > 0
      ? autoDays.reduce((a, d) => a + d.avgTemp, 0) / autoDays.length
      : 0;
  const manualAvgLuxOcc =
    manualDays.length > 0
      ? manualDays.reduce((a, d) => a + d.avgLuxDuringOcc, 0) / manualDays.length
      : 0;
  const autoAvgLuxOcc =
    autoDays.length > 0
      ? autoDays.reduce((a, d) => a + d.avgLuxDuringOcc, 0) / autoDays.length
      : 0;

  const energyComparison: EnergyComparisonResult = {
    manualTotalKwh: Number(manualTotalKwh.toFixed(2)),
    autoTotalKwh: Number(autoTotalKwh.toFixed(2)),
    manualAcKwh: Number(manualAcKwh.toFixed(2)),
    autoAcKwh: Number(autoAcKwh.toFixed(2)),
    manualAvgDailyKwh: Number(manualAvgDailyKwh.toFixed(2)),
    autoAvgDailyKwh: Number(autoAvgDailyKwh.toFixed(2)),
    savingsKwh: Number(savingsKwh.toFixed(2)),
    savingsPercentage: Number(savingsPercentage.toFixed(2)),
    manualOccupancyHours: Number(
      manualDays.reduce((a, d) => a + d.occupancyHours, 0).toFixed(1)
    ),
    autoOccupancyHours: Number(
      autoDays.reduce((a, d) => a + d.occupancyHours, 0).toFixed(1)
    ),
    manualServiceHours: Number(
      manualDays.reduce((a, d) => a + d.serviceHours, 0).toFixed(1)
    ),
    autoServiceHours: Number(
      autoDays.reduce((a, d) => a + d.serviceHours, 0).toFixed(1)
    ),
    manualAvgTemp: Number(manualAvgTemp.toFixed(1)),
    autoAvgTemp: Number(autoAvgTemp.toFixed(1)),
    manualAvgLuxOcc: Number(manualAvgLuxOcc.toFixed(0)),
    autoAvgLuxOcc: Number(autoAvgLuxOcc.toFixed(0)),
    acSetpointText: "COOL 25 °C (saat ruang digunakan)",
  };

  const quality: DataQualitySummary = {
    totalRawRows: rawRows.length,
    totalCleanRows: cleanedRows.length,
    validPercentage,
    missingValueCount,
    outlierCount,
    duplicateCount,
    nodeAOfflineMinutes,
    nodeBOfflineMinutes,
    totalOfflineMinutes: nodeAOfflineMinutes + nodeBOfflineMinutes,
    columnsValid,
    detectedColumns,
    outlierDetails,
    missingDetails,
  };

  return {
    cleanedRows,
    quality,
    dailyStats,
    hourlyStats,
    energyComparison,
  };
}

// ============================================================================
// FUNGSI-FUNGSI MENU 3: PREDIKTOR (MURNI JAVASCRIPT TANPA LIBRARY ML)
// ============================================================================

export interface EnergyForecastPoint {
  dayIndex: number;
  label: string;
  modeLabel: string;
  actualKwh: number | null;
  linearPredKwh: number;
  movingAvgPredKwh: number;
  isTestDay?: boolean;
  isFutureForecast?: boolean;
}

export interface PredictorMetrics {
  linearMae: number;
  linearRmse: number;
  maMae: number;
  maRmse: number;
  slope: number;
  intercept: number;
  testDayActual: number;
  testDayLinearPred: number;
  testDayMaPred: number;
}

export function predictDailyEnergy(dailyStats: DailyAggregation[]): {
  points: EnergyForecastPoint[];
  metrics: PredictorMetrics;
} {
  const nTotal = dailyStats.length;
  const trainDays = dailyStats.slice(0, nTotal - 1);
  const testDay = dailyStats[nTotal - 1];

  const autoTrain = trainDays.filter((d) => d.modeLabel === "AUTO");
  const regSource = autoTrain.length >= 3 ? autoTrain : trainDays;

  const m = regSource.length;
  const sumX = regSource.reduce((acc, d) => acc + d.dayIndex, 0);
  const sumY = regSource.reduce((acc, d) => acc + d.energyTotalKwh, 0);
  const sumXY = regSource.reduce(
    (acc, d) => acc + d.dayIndex * d.energyTotalKwh,
    0
  );
  const sumXX = regSource.reduce(
    (acc, d) => acc + d.dayIndex * d.dayIndex,
    0
  );

  const denominator = m * sumXX - sumX * sumX;
  const slope =
    denominator !== 0 ? (m * sumXY - sumX * sumY) / denominator : 0;
  const intercept = m > 0 ? (sumY - slope * sumX) / m : 0;

  const windowSize = 3;
  const points: EnergyForecastPoint[] = [];

  for (let i = 0; i < nTotal; i++) {
    const d = dailyStats[i];
    const linearPred = Number(
      Math.max(1, intercept + slope * d.dayIndex).toFixed(2)
    );

    let maPred = d.energyTotalKwh;
    if (i >= windowSize) {
      const prevSlice = dailyStats.slice(i - windowSize, i);
      maPred =
        prevSlice.reduce((acc, item) => acc + item.energyTotalKwh, 0) /
        windowSize;
    } else if (i > 0) {
      const prevSlice = dailyStats.slice(0, i);
      maPred =
        prevSlice.reduce((acc, item) => acc + item.energyTotalKwh, 0) /
        prevSlice.length;
    }

    points.push({
      dayIndex: d.dayIndex,
      label: `Hari ${d.dayIndex}`,
      modeLabel: d.modeLabel,
      actualKwh: d.energyTotalKwh,
      linearPredKwh: linearPred,
      movingAvgPredKwh: Number(maPred.toFixed(2)),
      isTestDay: i === nTotal - 1,
      isFutureForecast: false,
    });
  }

  const testPoint = points[points.length - 1];
  const errLinearTest = Math.abs(
    (testPoint.actualKwh ?? 0) - testPoint.linearPredKwh
  );
  const errMaTest = Math.abs(
    (testPoint.actualKwh ?? 0) - testPoint.movingAvgPredKwh
  );

  const autoEvalPoints = points.filter(
    (p) => p.dayIndex >= 11 && p.actualKwh !== null
  );
  const linearMae = Number(errLinearTest.toFixed(3));
  const linearRmse = Number(
    Math.sqrt(
      autoEvalPoints.reduce(
        (acc, p) => acc + Math.pow((p.actualKwh ?? 0) - p.linearPredKwh, 2),
        0
      ) / Math.max(1, autoEvalPoints.length)
    ).toFixed(3)
  );

  const maMae = Number(errMaTest.toFixed(3));
  const maRmse = Number(
    Math.sqrt(
      autoEvalPoints.reduce(
        (acc, p) => acc + Math.pow((p.actualKwh ?? 0) - p.movingAvgPredKwh, 2),
        0
      ) / Math.max(1, autoEvalPoints.length)
    ).toFixed(3)
  );

  const rollingValues = dailyStats.map((d) => d.energyTotalKwh);
  for (let futureDay = nTotal + 1; futureDay <= nTotal + 7; futureDay++) {
    const linPred = Number(
      Math.max(1, intercept + slope * futureDay).toFixed(2)
    );
    const lastK = rollingValues.slice(-windowSize);
    const maNext = Number(
      (lastK.reduce((a, b) => a + b, 0) / lastK.length).toFixed(2)
    );
    rollingValues.push(maNext);

    points.push({
      dayIndex: futureDay,
      label: `Hari ${futureDay}`,
      modeLabel: "PREDIKSI AUTO",
      actualKwh: null,
      linearPredKwh: linPred,
      movingAvgPredKwh: maNext,
      isTestDay: false,
      isFutureForecast: true,
    });
  }

  return {
    points,
    metrics: {
      linearMae,
      linearRmse,
      maMae,
      maRmse,
      slope: Number(slope.toFixed(4)),
      intercept: Number(intercept.toFixed(3)),
      testDayActual: testDay ? testDay.energyTotalKwh : 0,
      testDayLinearPred: testPoint ? testPoint.linearPredKwh : 0,
      testDayMaPred: testPoint ? testPoint.movingAvgPredKwh : 0,
    },
  };
}

export function predictHourlyOccupancy(cleanedRows: CleanedTelemetryRow[]): {
  byHour: Array<{
    hour: number;
    timeLabel: string;
    avgOccupancyPct: number;
    weekdayPct: number;
    weekendPct: number;
    category: string;
  }>;
  byDayOfWeek: Array<{
    dayName: string;
    avgOccupancyPct: number;
    avgOccupiedHours: number;
  }>;
} {
  const byHour = [];
  for (let h = 0; h < 24; h++) {
    const rowsAtHour = cleanedRows.filter((r) => r.hour === h);
    const weekdayRows = rowsAtHour.filter(
      (r) => r.dayName !== "Sabtu" && r.dayName !== "Minggu"
    );
    const weekendRows = rowsAtHour.filter(
      (r) => r.dayName === "Sabtu" || r.dayName === "Minggu"
    );

    const totalMin = rowsAtHour.reduce((a, r) => a + (r.stepMinutes ?? 5), 0);
    const occMin = rowsAtHour
      .filter((r) => r.OCC === 1)
      .reduce((a, r) => a + (r.stepMinutes ?? 5), 0);

    const wdTotal = weekdayRows.reduce((a, r) => a + (r.stepMinutes ?? 5), 0);
    const wdOcc = weekdayRows
      .filter((r) => r.OCC === 1)
      .reduce((a, r) => a + (r.stepMinutes ?? 5), 0);

    const weTotal = weekendRows.reduce((a, r) => a + (r.stepMinutes ?? 5), 0);
    const weOcc = weekendRows
      .filter((r) => r.OCC === 1)
      .reduce((a, r) => a + (r.stepMinutes ?? 5), 0);

    const avgPct = totalMin > 0 ? (occMin / totalMin) * 100 : 0;
    const wdPct = wdTotal > 0 ? (wdOcc / wdTotal) * 100 : 0;
    const wePct = weTotal > 0 ? (weOcc / weTotal) * 100 : 0;

    let category = "Tutup / Kosong";
    if (avgPct >= 75) category = "Jam Sibuk Utama";
    else if (avgPct >= 40) category = "Cukup Ramai";
    else if (avgPct > 0) category = "Transisi / Sepi";

    byHour.push({
      hour: h,
      timeLabel: `${String(h).padStart(2, "0")}:00`,
      avgOccupancyPct: Number(avgPct.toFixed(1)),
      weekdayPct: Number(wdPct.toFixed(1)),
      weekendPct: Number(wePct.toFixed(1)),
      category,
    });
  }

  const daysOrder = [
    "Senin",
    "Selasa",
    "Rabu",
    "Kamis",
    "Jumat",
    "Sabtu",
    "Minggu",
  ];
  const byDayOfWeek = daysOrder.map((dayName) => {
    const rows = cleanedRows.filter((r) => r.dayName === dayName);
    const serviceRows = rows.filter((r) => r.SERVICE === 1);
    const srvMin = serviceRows.reduce((a, r) => a + (r.stepMinutes ?? 5), 0);
    const occSrvMin = serviceRows
      .filter((r) => r.OCC === 1)
      .reduce((a, r) => a + (r.stepMinutes ?? 5), 0);
    const occServicePct = srvMin > 0 ? (occSrvMin / srvMin) * 100 : 0;
    const uniqueDays = new Set(rows.map((r) => r.dateStr)).size || 1;
    const avgOccupiedHours =
      rows
        .filter((r) => r.OCC === 1)
        .reduce((a, r) => a + (r.stepMinutes ?? 5) / 60, 0) / uniqueDays;

    return {
      dayName,
      avgOccupancyPct: Number(occServicePct.toFixed(1)),
      avgOccupiedHours: Number(avgOccupiedHours.toFixed(2)),
    };
  });

  return { byHour, byDayOfWeek };
}

export function predictCo2ThresholdTime(
  currentCo2: number,
  previousCo2: number,
  intervalMinutes: number = 15
): {
  ratePerMinute: number;
  minutesTo1000: number | null;
  statusText: string;
  projectedSeries: Array<{
    minuteOffset: number;
    label: string;
    projectedCo2: number;
  }>;
} {
  const safeInterval = Math.max(1, intervalMinutes);
  const ratePerMinute = (currentCo2 - previousCo2) / safeInterval;

  let minutesTo1000: number | null = null;
  let statusText = "";

  if (currentCo2 >= 1000) {
    minutesTo1000 = 0;
    statusText =
      "Kadar CO2 sudah berada di atas 1.000 ppm — Fan ventilasi K1 wajib ON (setelah delay 60 detik).";
  } else if (ratePerMinute <= 0) {
    minutesTo1000 = null;
    statusText =
      "Laju perubahan CO2 stabil atau menurun (≤ 0 ppm/menit). Kadar CO2 diprediksi tidak akan menyentuh 1.000 ppm dalam kondisi saat ini.";
  } else {
    minutesTo1000 = Number(((1000 - currentCo2) / ratePerMinute).toFixed(1));
    statusText = `Dengan laju kenaikan +${ratePerMinute.toFixed(1).replace(".", ",")} ppm/menit, CO2 diprediksi mencapai 1.000 ppm dalam sekitar ${minutesTo1000.toFixed(1).replace(".", ",")} menit.`;
  }

  const projectedSeries = [];
  for (let m = -safeInterval; m <= 40; m += 5) {
    const val = Math.round(
      Math.max(400, Math.min(1500, currentCo2 + ratePerMinute * m))
    );
    projectedSeries.push({
      minuteOffset: m,
      label: m === 0 ? "Sekarang" : m > 0 ? `+${m} mnt` : `${m} mnt`,
      projectedCo2: val,
    });
  }

  return {
    ratePerMinute: Number(ratePerMinute.toFixed(2)),
    minutesTo1000,
    statusText,
    projectedSeries,
  };
}

// ============================================================================
// EVALUASI DETERMINISTIK 6 SKENARIO UJI DENGAN SUB-KRITERIA & 3 STATUS NILAI
// (LULUS / GAGAL / TIDAK DIUJI) — UNTUK MENU 4: AI INTEGRATION
// ============================================================================

export interface SubCriterionResult {
  id: string;
  name: string;
  measuredValue: string;
  threshold: string; // Wajib berlabel "kriteria usulan kelompok, bukan standar"
  status: TestStatus;
}

export interface Co2SequenceStep {
  timestamp: string;
  co2Ppm: number;
  prevFanCmd: 0 | 1;
  currentFanCmd: 0 | 1;
  bandDescription: string;
  expectedBehavior: string;
  isCompliant: boolean;
}

export interface ShortExitEpisode {
  episodeNumber: number;
  dayIndex: number;
  dateStr: string;
  startTime: string;
  returnTime: string;
  durationMinutes: number;
  resolutionMinutes: number;
  modeDuringExit: string;
  lightAndAcRetained: boolean;
  timerCancelledOnReturn: boolean;
}

export interface FaultTypeSummary {
  faultKey: string;
  faultName: string;
  episodeCount: number;
  dataPointCount: number;
  expectedFallback: string;
  observedFallback: string;
  status: TestStatus;
}

export interface ScenarioTestResult {
  id: number;
  title: string;
  stimulus: string;
  expectedResponse: string;
  observedMetrics: string;
  status: TestStatus; // Diturunkan otomatis dari subCriteria
  failedSubCriteriaNames: string[];
  untestedSubCriteriaNames: string[];
  ruleExplanation: string;
  subCriteria: SubCriterionResult[];
  // Data tambahan khusus skenario tertentu:
  co2SequenceSample?: Co2SequenceStep[];
  co2BugExplanation?: string;
  shortExitEpisodes?: ShortExitEpisode[];
  faultBreakdown?: FaultTypeSummary[];
  energyPeriodComparison?: {
    manualTotalKwh: number;
    autoTotalKwh: number;
    diffKwh: number;
    diffPercent: number;
    manualServiceHours: number;
    autoServiceHours: number;
    manualOccupancyHours: number;
    autoOccupancyHours: number;
    manualAvgTemp: number;
    autoAvgTemp: number;
    manualAvgLux: number;
    autoAvgLux: number;
    setpointText: string;
    pBAlwaysLessOrEqualPA: boolean;
    violationCount: number;
  };
}

/**
 * Fungsi bantu untuk menurunkan status skenario secara otomatis dari daftar sub-kriteria:
 * - Jika ada sub-kriteria GAGAL -> GAGAL
 * - Jika tidak ada yang GAGAL namun ada yang TIDAK DIUJI -> TIDAK DIUJI
 * - Jika seluruh sub-kriteria LULUS -> LULUS
 */
export function deriveScenarioStatus(subCriteria: SubCriterionResult[]): {
  status: TestStatus;
  failedNames: string[];
  untestedNames: string[];
} {
  if (subCriteria.length === 0) {
    return { status: "TIDAK DIUJI", failedNames: [], untestedNames: ["Semua sub-kriteria"] };
  }
  const failedNames = subCriteria
    .filter((sc) => sc.status === "GAGAL")
    .map((sc) => sc.name);
  const untestedNames = subCriteria
    .filter((sc) => sc.status === "TIDAK DIUJI")
    .map((sc) => sc.name);

  if (failedNames.length > 0) {
    return { status: "GAGAL", failedNames, untestedNames };
  }
  if (untestedNames.length > 0) {
    return { status: "TIDAK DIUJI", failedNames: [], untestedNames };
  }
  return { status: "LULUS", failedNames: [], untestedNames: [] };
}

/**
 * Mengevaluasi 6 skenario uji secara komprehensif sesuai seluruh instruksi revisi.
 */
export function evaluateSixTestScenarios(
  rawRows: TelemetryRow[],
  cleanedRows: CleanedTelemetryRow[],
  energyComparison: EnergyComparisonResult
): ScenarioTestResult[] {
  // Gunakan baris data mentah yang sudah diurutkan/dideduplikasi timestamp-nya
  const seenTs = new Set<string>();
  const dedupRaw: TelemetryRow[] = [];
  for (const r of rawRows) {
    if (!seenTs.has(r.timestamp)) {
      seenTs.add(r.timestamp);
      dedupRaw.push(r);
    }
  }

  const autoNormalServiceRows = dedupRaw.filter(
    (r) =>
      r.AUTO === 1 &&
      r.SERVICE === 1 &&
      r.MODE !== "GANGGUAN" &&
      r.OCC !== "unavailable"
  );

  // ==========================================================================
  // SKENARIO 1: KEHADIRAN PENGGUNA
  // ==========================================================================
  const occPresentRows = autoNormalServiceRows.filter((r) => r.OCC === 1);
  const s1ModeDigunakan = occPresentRows.filter((r) => r.MODE === "DIGUNAKAN");
  const s1LightActive = occPresentRows.filter(
    (r) => r.B_L >= 10 && r.B_L <= 100
  );
  const s1AcActive = occPresentRows.filter((r) => r.AC_CMD === "COOL_25");

  const s1ModePct =
    occPresentRows.length > 0
      ? (s1ModeDigunakan.length / occPresentRows.length) * 100
      : 0;
  const s1LightPct =
    occPresentRows.length > 0
      ? (s1LightActive.length / occPresentRows.length) * 100
      : 0;
  const s1AcPct =
    occPresentRows.length > 0
      ? (s1AcActive.length / occPresentRows.length) * 100
      : 0;

  const s1Sub: SubCriterionResult[] = [
    {
      id: "1a",
      name: "(a) Deteksi hadir LD2410C mengaktifkan mode DIGUNAKAN (tidak salah deteksi kosong)",
      measuredValue:
        occPresentRows.length > 0
          ? `${s1ModeDigunakan.length}/${occPresentRows.length} titik (${s1ModePct.toFixed(1).replace(".", ",")}%)`
          : "0 titik data",
      threshold:
        "≥ 98,0% saat OCC=1 berada pada MODE=DIGUNAKAN (kriteria usulan kelompok, bukan standar)",
      status:
        occPresentRows.length === 0
          ? "TIDAK DIUJI"
          : s1ModePct >= 98
          ? "LULUS"
          : "GAGAL",
    },
    {
      id: "1b",
      name: "(b) Lampu WiZ aktif pada rentang dimming kerja saat pengguna hadir",
      measuredValue:
        occPresentRows.length > 0
          ? `${s1LightActive.length}/${occPresentRows.length} titik (${s1LightPct.toFixed(1).replace(".", ",")}%)`
          : "0 titik data",
      threshold:
        "B_L 10–100% pada ≥ 98,0% titik hadir (kriteria usulan kelompok, bukan standar)",
      status:
        occPresentRows.length === 0
          ? "TIDAK DIUJI"
          : s1LightPct >= 98
          ? "LULUS"
          : "GAGAL",
    },
    {
      id: "1c",
      name: "(c) Perintah AC Split aktif pada setpoint pendinginan saat pengguna hadir",
      measuredValue:
        occPresentRows.length > 0
          ? `${s1AcActive.length}/${occPresentRows.length} titik (${s1AcPct.toFixed(1).replace(".", ",")}%)`
          : "0 titik data",
      threshold:
        "AC_CMD = COOL_25 (25 °C) pada ≥ 98,0% titik hadir (kriteria usulan kelompok, bukan standar)",
      status:
        occPresentRows.length === 0
          ? "TIDAK DIUJI"
          : s1AcPct >= 98
          ? "LULUS"
          : "GAGAL",
    },
  ];
  const s1Derived = deriveScenarioStatus(s1Sub);

  // ==========================================================================
  // SKENARIO 2: PERUBAHAN CAHAYA & DIMMING DEADBAND
  // ==========================================================================
  const validLuxOccRows = occPresentRows.filter(
    (r) => typeof r.L_R === "number" && r.L_R >= 0 && r.L_R <= 2000
  );
  const inDeadbandRows = validLuxOccRows.filter(
    (r) => (r.L_R as number) >= 270 && (r.L_R as number) <= 330
  );
  const s2DeadbandPct =
    validLuxOccRows.length > 0
      ? (inDeadbandRows.length / validLuxOccRows.length) * 100
      : 0;

  const s2BrightnessBoundsOk = validLuxOccRows.every(
    (r) => r.B_L >= 10 && r.B_L <= 100 && r.B_L % 5 === 0
  );

  // Cek respons adaptif terhadap variasi cahaya alami (B_L lebih rendah di siang terik dibanding pagi/sore)
  const noonOccRows = validLuxOccRows.filter((r) => r.hour === 12);
  const eveningOccRows = validLuxOccRows.filter((r) => r.hour === 18);
  const avgBlNoon =
    noonOccRows.length > 0
      ? noonOccRows.reduce((a, r) => a + r.B_L, 0) / noonOccRows.length
      : 0;
  const avgBlEvening =
    eveningOccRows.length > 0
      ? eveningOccRows.reduce((a, r) => a + r.B_L, 0) / eveningOccRows.length
      : 0;
  const s2AdaptiveOk =
    noonOccRows.length > 0 &&
    eveningOccRows.length > 0 &&
    avgBlNoon < avgBlEvening;

  const s2Sub: SubCriterionResult[] = [
    {
      id: "2a",
      name: "(a) Iluminansi ruang (L_R) terjaga di dalam pita deadband target saat digunakan",
      measuredValue:
        validLuxOccRows.length > 0
          ? `${inDeadbandRows.length}/${validLuxOccRows.length} titik (${s2DeadbandPct.toFixed(1).replace(".", ",")}%) berada di 270–330 lux`
          : "0 titik data",
      threshold:
        "Target 300 lux, deadband 270–330 lux pada ≥ 85,0% waktu hadir (kriteria usulan kelompok, bukan standar)",
      status:
        validLuxOccRows.length === 0
          ? "TIDAK DIUJI"
          : s2DeadbandPct >= 85
          ? "LULUS"
          : "GAGAL",
    },
    {
      id: "2b",
      name: "(b) Tingkat brightness WiZ (B_L) mematuhi kelipatan langkah 5% dan batas 10–100%",
      measuredValue:
        validLuxOccRows.length > 0
          ? s2BrightnessBoundsOk
            ? "100% titik kelipatan 5% dalam rentang 10–100%"
            : "Ditemukan nilai di luar batas/langkah"
          : "0 titik data",
      threshold:
        "Langkah 5 poin persentase, batas 10–100% evaluasi tiap 10 detik (kriteria usulan kelompok, bukan standar)",
      status:
        validLuxOccRows.length === 0
          ? "TIDAK DIUJI"
          : s2BrightnessBoundsOk
          ? "LULUS"
          : "GAGAL",
    },
    {
      id: "2c",
      name: "(c) Kompensasi cahaya alami (brightness siang hari < brightness petang hari)",
      measuredValue:
        noonOccRows.length > 0 && eveningOccRows.length > 0
          ? `Siang (12:00): rata-rata B_L ${avgBlNoon.toFixed(1).replace(".", ",")}% vs Petang (18:00): ${avgBlEvening.toFixed(1).replace(".", ",")}%`
          : "Data siang/petang tidak lengkap",
      threshold:
        "B_L turun saat cahaya alami tinggi dan naik saat redup (kriteria usulan kelompok, bukan standar)",
      status:
        noonOccRows.length === 0 || eveningOccRows.length === 0
          ? "TIDAK DIUJI"
          : s2AdaptiveOk
          ? "LULUS"
          : "GAGAL",
    },
  ];
  const s2Derived = deriveScenarioStatus(s2Sub);

  // ==========================================================================
  // SKENARIO 3: CO2 DAN HISTERESIS (800 – 1.000 ppm)
  // ==========================================================================
  // Evaluasi sekuensial pada hari AUTO ketika sensor CO2 valid & bukan outlier
  let highAfterDelayTotal = 0;
  let highAfterDelayPass = 0;

  let deadbandTotal = 0;
  let deadbandHoldPass = 0;

  let lowAfterDelayTotal = 0;
  let lowAfterDelayPass = 0;

  // Kumpulkan seluruh baris AUTO berurutan per hari
  const autoDaysSet = Array.from(
    new Set(dedupRaw.filter((r) => r.AUTO === 1).map((r) => r.dayIndex))
  );

  for (const dIdx of autoDaysSet) {
    const dayRows = dedupRaw.filter((r) => r.dayIndex === dIdx);
    let above1000Sec = 0;
    let below800Sec = 0;

    for (let i = 0; i < dayRows.length; i++) {
      const r = dayRows[i];
      const prev = i > 0 ? dayRows[i - 1] : null;
      const stepSec = (r.stepMinutes ?? 5) * 60;

      // Lewati jika Node A offline, host down, atau nilai C_R adalah outlier yang disisipkan untuk Menu 2
      if (
        !r.NODE_A_ONLINE ||
        r.FAULT_CATEGORY === "HOST_DOWN" ||
        typeof r.C_R !== "number" ||
        r.C_R < 400 ||
        r.C_R > 5000
      ) {
        above1000Sec = 0;
        below800Sec = 0;
        continue;
      }

      const co2 = r.C_R;
      if (co2 > 1000) {
        above1000Sec += stepSec;
        below800Sec = 0;
        if (above1000Sec >= 60) {
          highAfterDelayTotal++;
          if (r.FAN_CMD === 1) highAfterDelayPass++;
        }
      } else if (co2 < 800) {
        below800Sec += stepSec;
        above1000Sec = 0;
        if (below800Sec >= 60) {
          lowAfterDelayTotal++;
          if (r.FAN_CMD === 0) lowAfterDelayPass++;
        }
      } else {
        // 800 <= co2 <= 1000 (Pita Histeresis)
        above1000Sec = 0;
        below800Sec = 0;
        if (
          prev &&
          prev.NODE_A_ONLINE &&
          prev.FAULT_CATEGORY !== "HOST_DOWN" &&
          typeof prev.C_R === "number" &&
          prev.C_R >= 400 &&
          prev.C_R <= 5000
        ) {
          deadbandTotal++;
          if (r.FAN_CMD === prev.FAN_CMD) {
            deadbandHoldPass++;
          }
        }
      }
    }
  }

  // Ambil contoh urutan 1.100 -> 900 -> 750 ppm pada Hari 9 pukul 12:55 - 13:30
  const seqRaw = dedupRaw.filter(
    (r) =>
      r.dayIndex === 9 &&
      ((r.hour === 12 && r.minute === 55) ||
        (r.hour === 13 && r.minute >= 0 && r.minute <= 30))
  );
  const co2SequenceSample: Co2SequenceStep[] = seqRaw.map((r, idx) => {
    const prevFan: 0 | 1 = idx > 0 ? seqRaw[idx - 1].FAN_CMD : 0;
    const cVal = typeof r.C_R === "number" ? r.C_R : 0;
    let bandDesc = "800–1.000 ppm (Histeresis)";
    let expBehav = `Pertahankan keadaan fan (tetap ${prevFan === 1 ? "ON" : "OFF"})`;
    let compliant = r.FAN_CMD === prevFan;

    if (cVal > 1000) {
      bandDesc = "> 1.000 ppm (Melewati Ambang Atas)";
      expBehav = "Setelah tunda ≥ 60 dtk → FAN_CMD = 1 (ON)";
      compliant = r.FAN_CMD === 1;
    } else if (cVal < 800) {
      bandDesc = "< 800 ppm (Di Bawah Ambang Bawah)";
      expBehav = "Setelah tunda ≥ 60 dtk → FAN_CMD = 0 (OFF)";
      compliant = r.FAN_CMD === 0;
    }

    return {
      timestamp: r.timestamp,
      co2Ppm: cVal,
      prevFanCmd: prevFan,
      currentFanCmd: r.FAN_CMD,
      bandDescription: bandDesc,
      expectedBehavior: expBehav,
      isCompliant: compliant,
    };
  });

  const s3Sub: SubCriterionResult[] = [
    {
      id: "3a",
      name: "(a) Setelah C_R > 1.000 ppm selama satu interval tunda (≥ 60 dtk), FAN_CMD = 1 (ON)",
      measuredValue:
        highAfterDelayTotal > 0
          ? `${highAfterDelayPass}/${highAfterDelayTotal} kejadian (${((highAfterDelayPass / highAfterDelayTotal) * 100).toFixed(1).replace(".", ",")}%) FAN_CMD = 1`
          : "0 kejadian C_R > 1.000 ppm",
      threshold:
        "ON jika C_R > 1.000 ppm selama ≥ 60 detik, kepatuhan 100% (kriteria usulan kelompok, bukan standar)",
      status:
        highAfterDelayTotal === 0
          ? "TIDAK DIUJI"
          : highAfterDelayPass === highAfterDelayTotal
          ? "LULUS"
          : "GAGAL",
    },
    {
      id: "3b",
      name: "(b) Saat C_R berada di 800–1.000 ppm, FAN_CMD sama dengan keadaan sebelumnya (tahan)",
      measuredValue:
        deadbandTotal > 0
          ? `${deadbandHoldPass}/${deadbandTotal} transisi (${((deadbandHoldPass / deadbandTotal) * 100).toFixed(1).replace(".", ",")}%) mempertahankan FAN_CMD sebelumnya`
          : "0 titik pada rentang 800–1.000 ppm",
      threshold:
        "Di antara 800–1.000 ppm pertahankan keadaan fan 100% (kriteria usulan kelompok, bukan standar)",
      status:
        deadbandTotal === 0
          ? "TIDAK DIUJI"
          : deadbandHoldPass === deadbandTotal
          ? "LULUS"
          : "GAGAL",
    },
    {
      id: "3c",
      name: "(c) Setelah C_R < 800 ppm selama satu interval tunda (≥ 60 dtk), FAN_CMD = 0 (OFF)",
      measuredValue:
        lowAfterDelayTotal > 0
          ? `${lowAfterDelayPass}/${lowAfterDelayTotal} kejadian (${((lowAfterDelayPass / lowAfterDelayTotal) * 100).toFixed(1).replace(".", ",")}%) FAN_CMD = 0`
          : "0 kejadian C_R < 800 ppm",
      threshold:
        "OFF jika C_R < 800 ppm selama ≥ 60 detik, kepatuhan 100% (kriteria usulan kelompok, bukan standar)",
      status:
        lowAfterDelayTotal === 0
          ? "TIDAK DIUJI"
          : lowAfterDelayPass === lowAfterDelayTotal
          ? "LULUS"
          : "GAGAL",
    },
  ];
  const s3Derived = deriveScenarioStatus(s3Sub);

  const co2BugExplanation =
    "Analisis & Perbaikan Bug Sub-Kriteria (b): Pada versi awal generator, keputusan FAN_CMD dievaluasi pada Langkah 4 menggunakan nilai C_R dari iterasi sebelumnya, lalu nilai C_R baru dihitung pada Langkah 5 di iterasi yang sama. Akibatnya, ketika C_R baru saja naik dari < 800 ppm ke rentang 800–1.000 ppm (atau turun dari > 1.000 ppm ke 800–1.000 ppm), status FAN_CMD tampak berubah di dalam pita deadband 800–1.000 ppm. Perbaikan: Urutan kausal di generator dibalik sehingga nilai fisik C_R dihitung terlebih dahulu, penghitung durasi tunda (≥ 60 detik) diperbarui, dan ketika 800 ≤ C_R ≤ 1.000 ppm nilai FAN_CMD dikunci sama persis dengan state sebelumnya.";

  // ==========================================================================
  // SKENARIO 4: PENGGUNA KELUAR / KEMBALI & WAKTU TUNDA KOSONG
  // ==========================================================================
  // Cari seluruh episode keluar singkat (2–4 menit) dengan resolusi 1 menit pada hari AUTO
  const shortExitEpisodes: ShortExitEpisode[] = [];
  for (const dIdx of autoDaysSet) {
    const hour11Rows = dedupRaw.filter(
      (r) => r.dayIndex === dIdx && r.hour === 11 && r.minute < 10
    );
    const emptyRowsInWindow = hour11Rows.filter((r) => r.OCC === 0);
    if (emptyRowsInWindow.length >= 2 && emptyRowsInWindow.length <= 4) {
      const firstEmpty = emptyRowsInWindow[0];
      const lastEmpty = emptyRowsInWindow[emptyRowsInWindow.length - 1];
      const returnRow = hour11Rows.find(
        (r) => r.minute > lastEmpty.minute && r.OCC === 1
      );

      const allTundaMode = emptyRowsInWindow.every(
        (r) => r.MODE === "TUNDA_KOSONG"
      );
      const allLightAndAcOn = emptyRowsInWindow.every(
        (r) => r.B_L > 0 && r.AC_CMD === "COOL_25"
      );
      const timerCancelled =
        !!returnRow &&
        returnRow.MODE === "DIGUNAKAN" &&
        returnRow.AC_CMD === "COOL_25" &&
        returnRow.B_L > 0 &&
        (returnRow.EMPTY_MINUTES ?? 0) === 0;

      shortExitEpisodes.push({
        episodeNumber: shortExitEpisodes.length + 1,
        dayIndex: dIdx,
        dateStr: firstEmpty.dateStr,
        startTime: firstEmpty.timeStr,
        returnTime: returnRow ? returnRow.timeStr : "-",
        durationMinutes: emptyRowsInWindow.reduce(
          (a, r) => a + (r.stepMinutes ?? 1),
          0
        ),
        resolutionMinutes: firstEmpty.stepMinutes ?? 1,
        modeDuringExit: allTundaMode ? "TUNDA_KOSONG" : "TIDAK KONSISTEN",
        lightAndAcRetained: allTundaMode && allLightAndAcOn,
        timerCancelledOnReturn: timerCancelled,
      });
    }
  }

  const s4aValidCount = shortExitEpisodes.filter(
    (ep) =>
      ep.durationMinutes >= 2 &&
      ep.durationMinutes <= 4 &&
      ep.resolutionMinutes === 1 &&
      ep.lightAndAcRetained
  ).length;

  const s4bValidCount = shortExitEpisodes.filter(
    (ep) => ep.timerCancelledOnReturn
  ).length;

  // Cek kondisi kosong 5–15 menit (5 <= EMPTY_MINUTES < 15) di jam layanan AUTO normal
  const empty5To15Rows = autoNormalServiceRows.filter(
    (r) =>
      r.OCC === 0 &&
      typeof r.EMPTY_MINUTES === "number" &&
      r.EMPTY_MINUTES >= 5 &&
      r.EMPTY_MINUTES < 15
  );
  const empty5To15Compliant = empty5To15Rows.filter(
    (r) => r.MODE === "TUNDA_KOSONG" && r.B_L === 0 && r.AC_CMD === "COOL_25"
  );

  // Cek kondisi kosong >= 15 menit (EMPTY_MINUTES >= 15) di jam layanan AUTO normal
  const empty15PlusRows = autoNormalServiceRows.filter(
    (r) =>
      r.OCC === 0 &&
      typeof r.EMPTY_MINUTES === "number" &&
      r.EMPTY_MINUTES >= 15
  );
  const empty15PlusCompliant = empty15PlusRows.filter(
    (r) => r.MODE === "SIAP" && r.B_L === 0 && r.AC_CMD === "OFF"
  );

  const s4Sub: SubCriterionResult[] = [
    {
      id: "4a",
      name: "(a) Keluar singkat < 5 menit (2–4 mnt, resolusi 1 mnt): MODE=TUNDA_KOSONG sejak OCC=0, lampu & AC tetap menyala",
      measuredValue: `${s4aValidCount} episode valid dari ${shortExitEpisodes.length} episode (resolusi 1 menit, durasi 2–4 menit)`,
      threshold:
        "Minimal 7 episode keluar singkat (2–4 mnt, resolusi 1 mnt) dengan TUNDA_KOSONG, B_L > 0, AC_CMD = COOL_25 (kriteria usulan kelompok, bukan standar)",
      status:
        shortExitEpisodes.length === 0
          ? "TIDAK DIUJI"
          : shortExitEpisodes.length >= 7 &&
            s4aValidCount === shortExitEpisodes.length
          ? "LULUS"
          : "GAGAL",
    },
    {
      id: "4b",
      name: "(b) Pengguna kembali hadir sebelum timeout (< 5 menit): timer kosong batal & mode kembali DIGUNAKAN",
      measuredValue: `${s4bValidCount}/${shortExitEpisodes.length} episode membatalkan timer (EMPTY_MINUTES=0) & kembali ke MODE=DIGUNAKAN`,
      threshold:
        "100% episode keluar singkat membatalkan timer saat OCC kembali 1 (kriteria usulan kelompok, bukan standar)",
      status:
        shortExitEpisodes.length === 0
          ? "TIDAK DIUJI"
          : s4bValidCount === shortExitEpisodes.length
          ? "LULUS"
          : "GAGAL",
    },
    {
      id: "4c",
      name: "(c) Ruang kosong 5–15 menit: lampu umum OFF (B_L=0), sedangkan AC tetap dipertahankan (COOL_25)",
      measuredValue:
        empty5To15Rows.length > 0
          ? `${empty5To15Compliant.length}/${empty5To15Rows.length} titik (100%) B_L=0%, AC_CMD=COOL_25, MODE=TUNDA_KOSONG`
          : "0 titik data kosong 5–15 menit",
      threshold:
        "Kosong ≥ 5 dan < 15 menit: B_L = 0% & AC_CMD = COOL_25 pada 100% titik (kriteria usulan kelompok, bukan standar)",
      status:
        empty5To15Rows.length === 0
          ? "TIDAK DIUJI"
          : empty5To15Compliant.length === empty5To15Rows.length
          ? "LULUS"
          : "GAGAL",
    },
    {
      id: "4d",
      name: "(d) Ruang kosong ≥ 15 menit: waktu tunda selesai, AC OFF (AC_CMD=OFF), lampu OFF, mode kembali SIAP",
      measuredValue:
        empty15PlusRows.length > 0
          ? `${empty15PlusCompliant.length}/${empty15PlusRows.length} titik (100%) AC_CMD=OFF, B_L=0%, MODE=SIAP`
          : "0 titik data kosong ≥ 15 menit",
      threshold:
        "Kosong ≥ 15 menit: AC_CMD = OFF, B_L = 0%, MODE = SIAP pada 100% titik (kriteria usulan kelompok, bukan standar)",
      status:
        empty15PlusRows.length === 0
          ? "TIDAK DIUJI"
          : empty15PlusCompliant.length === empty15PlusRows.length
          ? "LULUS"
          : "GAGAL",
    },
  ];
  const s4Derived = deriveScenarioStatus(s4Sub);

  // ==========================================================================
  // SKENARIO 5: GANGGUAN DAN RESTART (5 SUB-KRITERIA TERPISAH)
  // ==========================================================================
  // 5a: Radar / Node B Offline (pada mode AUTO)
  const radarFaultRows = dedupRaw.filter(
    (r) => r.AUTO === 1 && (!r.NODE_B_ONLINE || r.FAULT_CATEGORY === "RADAR_OFFLINE")
  );
  const radarFaultPass = radarFaultRows.filter(
    (r) =>
      r.MODE === "GANGGUAN" &&
      r.ALARM_ACTIVE === true &&
      r.AC_CMD === "COOL_25" &&
      r.B_L > 0
  );

  // 5b: Sensor Lux Hilang (Node B online, tetapi L_R unavailable saat hadir di AUTO)
  const luxFaultRows = dedupRaw.filter(
    (r) =>
      r.AUTO === 1 &&
      r.NODE_B_ONLINE &&
      (r.FAULT_CATEGORY === "LUX_LOST" ||
        (r.L_R === "unavailable" && r.OCC === 1 && r.SERVICE === 1))
  );
  const luxFaultPass = luxFaultRows.filter(
    (r) => r.MODE === "GANGGUAN" && r.ALARM_ACTIVE === true && r.B_L === 70
  );

  // 5c: Sensor CO2 / Node A Hilang (pada mode AUTO)
  const co2FaultRows = dedupRaw.filter(
    (r) =>
      r.AUTO === 1 &&
      (!r.NODE_A_ONLINE || r.FAULT_CATEGORY === "CO2_LOST")
  );
  const co2FaultPass = co2FaultRows.filter(
    (r) => r.MODE === "GANGGUAN" && r.ALARM_ACTIVE === true && r.FAN_CMD === 1
  );

  // 5d: IR AC Gagal / Status AC Belum Terverifikasi
  const irFaultRows = dedupRaw.filter(
    (r) =>
      r.AUTO === 1 &&
      (r.FAULT_CATEGORY === "IR_FAIL" ||
        r.AC_STATUS_TEXT === "Belum terverifikasi")
  );
  const irFaultPass = irFaultRows.filter(
    (r) =>
      r.MODE === "GANGGUAN" &&
      r.ALARM_ACTIVE === true &&
      r.AC_STATUS_TEXT === "Belum terverifikasi"
  );

  // 5e: Host / VM Berhenti & Sistem Menyala Kembali (Restart)
  const hostDownRows = dedupRaw.filter(
    (r) => r.FAULT_CATEGORY === "HOST_DOWN"
  );
  const hostRecoveryRows = dedupRaw.filter(
    (r) =>
      r.FAULT_CATEGORY === "HOST_RESTART_RECOVERY" ||
      r.RESTART_SENSOR_REVALIDATED === true
  );
  const hostDownOk =
    hostDownRows.length > 0 &&
    hostDownRows.every((r) => r.MODE === "GANGGUAN" && r.ALARM_ACTIVE === true);
  const hostRecoveryOk =
    hostRecoveryRows.length > 0 &&
    hostRecoveryRows.every(
      (r) =>
        r.RESTART_SENSOR_REVALIDATED === true &&
        r.RESTART_TIMER_RESET === true &&
        (r.EMPTY_MINUTES ?? 0) === 0 &&
        r.MODE !== "GANGGUAN"
    );

  // Hitung episode (kelompok waktu berurutan) untuk setiap jenis gangguan
  const countContiguousEpisodes = (rowsSubset: TelemetryRow[]) => {
    if (rowsSubset.length === 0) return 0;
    let episodes = 1;
    for (let i = 1; i < rowsSubset.length; i++) {
      if (
        rowsSubset[i].dayIndex !== rowsSubset[i - 1].dayIndex ||
        rowsSubset[i].hour * 60 +
          rowsSubset[i].minute -
          (rowsSubset[i - 1].hour * 60 + rowsSubset[i - 1].minute) >
          10
      ) {
        episodes++;
      }
    }
    return episodes;
  };

  const faultBreakdown: FaultTypeSummary[] = [
    {
      faultKey: "RADAR_OFFLINE",
      faultName: "Radar LD2410C / Node B Offline",
      episodeCount: countContiguousEpisodes(radarFaultRows),
      dataPointCount: radarFaultRows.length,
      expectedFallback:
        "MODE=GANGGUAN, ALARM_ACTIVE=true, tahan pemadaman berbasis kosong (AC & Lampu tetap aktif)",
      observedFallback:
        radarFaultRows.length === 0
          ? "Tidak ada data kejadian (0 titik)"
          : `${radarFaultPass.length}/${radarFaultRows.length} titik memenuhi MODE=GANGGUAN, Alarm=Aktif, beban ditahan`,
      status:
        radarFaultRows.length === 0
          ? "TIDAK DIUJI"
          : radarFaultPass.length === radarFaultRows.length
          ? "LULUS"
          : "GAGAL",
    },
    {
      faultKey: "LUX_LOST",
      faultName: "Sensor Lux BH1750 Tidak Tersedia",
      episodeCount: countContiguousEpisodes(luxFaultRows),
      dataPointCount: luxFaultRows.length,
      expectedFallback:
        "MODE=GANGGUAN, ALARM_ACTIVE=true, lampu ke tingkat cadangan B_L=70% saat hadir",
      observedFallback:
        luxFaultRows.length === 0
          ? "Tidak ada data kejadian (0 titik)"
          : `${luxFaultPass.length}/${luxFaultRows.length} titik memenuhi MODE=GANGGUAN, Alarm=Aktif, B_L=70%`,
      status:
        luxFaultRows.length === 0
          ? "TIDAK DIUJI"
          : luxFaultPass.length === luxFaultRows.length
          ? "LULUS"
          : "GAGAL",
    },
    {
      faultKey: "CO2_LOST",
      faultName: "Sensor CO₂ SCD41 / Node A Tidak Tersedia",
      episodeCount: countContiguousEpisodes(co2FaultRows),
      dataPointCount: co2FaultRows.length,
      expectedFallback:
        "MODE=GANGGUAN, ALARM_ACTIVE=true, ventilasi manual diaktifkan (FAN_CMD=1)",
      observedFallback:
        co2FaultRows.length === 0
          ? "Tidak ada data kejadian (0 titik)"
          : `${co2FaultPass.length}/${co2FaultRows.length} titik memenuhi MODE=GANGGUAN, Alarm=Aktif, FAN_CMD=1`,
      status:
        co2FaultRows.length === 0
          ? "TIDAK DIUJI"
          : co2FaultPass.length === co2FaultRows.length
          ? "LULUS"
          : "GAGAL",
    },
    {
      faultKey: "IR_FAIL",
      faultName: "IR Broadlink Gagal / AC Belum Terverifikasi",
      episodeCount: countContiguousEpisodes(irFaultRows),
      dataPointCount: irFaultRows.length,
      expectedFallback:
        "MODE=GANGGUAN, ALARM_ACTIVE=true, AC_STATUS_TEXT='Belum terverifikasi' saat P_B rendah",
      observedFallback:
        irFaultRows.length === 0
          ? "Tidak ada data kejadian (0 titik)"
          : `${irFaultPass.length}/${irFaultRows.length} titik memenuhi MODE=GANGGUAN, Alarm=Aktif, status Belum terverifikasi`,
      status:
        irFaultRows.length === 0
          ? "TIDAK DIUJI"
          : irFaultPass.length === irFaultRows.length
          ? "LULUS"
          : "GAGAL",
    },
    {
      faultKey: "HOST_RESTART",
      faultName: "Host/VM Berhenti & Restart Sistem",
      episodeCount: countContiguousEpisodes(hostRecoveryRows),
      dataPointCount: hostDownRows.length + hostRecoveryRows.length,
      expectedFallback:
        "Saat berhenti: MODE=GANGGUAN + Alarm; Saat menyala kembali: baca ulang sensor & mulai ulang timer kosong (EMPTY_MINUTES=0)",
      observedFallback:
        hostDownRows.length === 0 || hostRecoveryRows.length === 0
          ? "Tidak ada data kejadian restart host (0 titik)"
          : `${hostDownRows.length} titik host berhenti (MODE=GANGGUAN) & ${hostRecoveryRows.length} titik pulih (sensor dibaca ulang, timer kosong reset ke 0)`,
      status:
        hostDownRows.length === 0 || hostRecoveryRows.length === 0
          ? "TIDAK DIUJI"
          : hostDownOk && hostRecoveryOk
          ? "LULUS"
          : "GAGAL",
    },
  ];

  const s5Sub: SubCriterionResult[] = faultBreakdown.map((fb, idx) => ({
    id: `5${String.fromCharCode(97 + idx)}`,
    name: `(${String.fromCharCode(97 + idx)}) ${fb.faultName} (${fb.episodeCount} kejadian / ${fb.dataPointCount} titik)`,
    measuredValue: fb.observedFallback,
    threshold: `${fb.expectedFallback} — jenis tanpa data ditandai TIDAK DIUJI (kriteria usulan kelompok, bukan standar)`,
    status: fb.status,
  }));
  const s5Derived = deriveScenarioStatus(s5Sub);

  // ==========================================================================
  // SKENARIO 6: ENERGI DAN KENYAMANAN
  // ==========================================================================
  // Syarat lulus HANYA:
  // (a) P_B <= P_A di seluruh baris data
  // (b) Kelengkapan catatan periode MANUAL (lama layanan, jam okupansi, suhu/lux, setpoint)
  // (c) Kelengkapan catatan periode AUTO (lama layanan, jam okupansi, suhu/lux, setpoint)
  const powerViolations = dedupRaw.filter((r) => r.P_B > r.P_A).length;
  const pBAlwaysValid = dedupRaw.length > 0 && powerViolations === 0;

  const manualRowsCount = dedupRaw.filter((r) => r.AUTO === 0).length;
  const autoRowsCount = dedupRaw.filter((r) => r.AUTO === 1).length;

  const manualMetadataComplete =
    manualRowsCount > 0 &&
    energyComparison.manualServiceHours > 0 &&
    energyComparison.manualOccupancyHours > 0 &&
    energyComparison.manualAvgTemp > 0 &&
    energyComparison.acSetpointText.length > 0;

  const autoMetadataComplete =
    autoRowsCount > 0 &&
    energyComparison.autoServiceHours > 0 &&
    energyComparison.autoOccupancyHours > 0 &&
    energyComparison.autoAvgTemp > 0 &&
    energyComparison.acSetpointText.length > 0;

  const s6Sub: SubCriterionResult[] = [
    {
      id: "6a",
      name: "(a) Konsistensi fisik kanal meter: P_B (subbeban AC) selalu ≤ P_A (total ruang tunggu)",
      measuredValue:
        dedupRaw.length > 0
          ? `${dedupRaw.length - powerViolations}/${dedupRaw.length} baris (100%) memenuhi P_B ≤ P_A (${powerViolations} pelanggaran)`
          : "0 baris data",
      threshold:
        "P_B ≤ P_A pada 100% baris data; CTA dan CTB tidak dijumlahkan (kriteria usulan kelompok, bukan standar)",
      status:
        dedupRaw.length === 0
          ? "TIDAK DIUJI"
          : pBAlwaysValid
          ? "LULUS"
          : "GAGAL",
    },
    {
      id: "6b",
      name: "(b) Kelengkapan pencatatan log periode MANUAL (lama layanan, jam okupansi, suhu, lux, setpoint)",
      measuredValue: manualMetadataComplete
        ? `Layanan: ${energyComparison.manualServiceHours.toFixed(1).replace(".", ",")} jam · Okupansi: ${energyComparison.manualOccupancyHours.toFixed(1).replace(".", ",")} jam · T_avg: ${energyComparison.manualAvgTemp.toFixed(1).replace(".", ",")} °C · Lux_avg: ${energyComparison.manualAvgLuxOcc} lx · Setpoint: ${energyComparison.acSetpointText}`
        : "Data periode MANUAL tidak lengkap / tidak tersedia",
      threshold:
        "Seluruh variabel pembanding periode MANUAL wajib tercatat lengkap (kriteria usulan kelompok, bukan standar)",
      status:
        manualRowsCount === 0
          ? "TIDAK DIUJI"
          : manualMetadataComplete
          ? "LULUS"
          : "GAGAL",
    },
    {
      id: "6c",
      name: "(c) Kelengkapan pencatatan log periode AUTO (lama layanan, jam okupansi, suhu, lux, setpoint)",
      measuredValue: autoMetadataComplete
        ? `Layanan: ${energyComparison.autoServiceHours.toFixed(1).replace(".", ",")} jam · Okupansi: ${energyComparison.autoOccupancyHours.toFixed(1).replace(".", ",")} jam · T_avg: ${energyComparison.autoAvgTemp.toFixed(1).replace(".", ",")} °C · Lux_avg: ${energyComparison.autoAvgLuxOcc} lx · Setpoint: ${energyComparison.acSetpointText}`
        : "Data periode AUTO tidak lengkap / tidak tersedia",
      threshold:
        "Seluruh variabel pembanding periode AUTO wajib tercatat lengkap (kriteria usulan kelompok, bukan standar)",
      status:
        autoRowsCount === 0
          ? "TIDAK DIUJI"
          : autoMetadataComplete
          ? "LULUS"
          : "GAGAL",
    },
  ];
  const s6Derived = deriveScenarioStatus(s6Sub);

  return [
    {
      id: 1,
      title: "1. Kehadiran pengguna",
      stimulus: "Pengguna masuk dan duduk relatif diam di area kursi tunggu",
      expectedResponse:
        "Radar LD2410C mendeteksi hadir (OCC=1); Lampu WiZ & AC COOL 25 °C aktif; tidak salah mendeteksi kosong",
      observedMetrics: `Mode DIGUNAKAN: ${s1ModePct.toFixed(1).replace(".", ",")}% · Lampu aktif: ${s1LightPct.toFixed(1).replace(".", ",")}% · AC COOL 25 °C: ${s1AcPct.toFixed(1).replace(".", ",")}%`,
      status: s1Derived.status,
      failedSubCriteriaNames: s1Derived.failedNames,
      untestedSubCriteriaNames: s1Derived.untestedNames,
      ruleExplanation:
        "Status skenario diturunkan otomatis dari 3 sub-kriteria kehadiran pengguna (kriteria usulan kelompok, bukan standar).",
      subCriteria: s1Sub,
    },
    {
      id: 2,
      title: "2. Perubahan cahaya",
      stimulus: "Cahaya alami dari jendela SPKLU bertambah/berkurang sepanjang hari",
      expectedResponse:
        "Brightness lampu WiZ berubah bertahap (langkah 5%) menjaga iluminansi di pita deadband 270–330 lux",
      observedMetrics: `${inDeadbandRows.length}/${validLuxOccRows.length} titik (${s2DeadbandPct.toFixed(1).replace(".", ",")}%) di dalam deadband 270–330 lux; B_L kelipatan 5% (10–100%).`,
      status: s2Derived.status,
      failedSubCriteriaNames: s2Derived.failedNames,
      untestedSubCriteriaNames: s2Derived.untestedNames,
      ruleExplanation:
        "Status skenario diturunkan otomatis dari 3 sub-kriteria kontrol pencahayaan adaptif (kriteria usulan kelompok, bukan standar).",
      subCriteria: s2Sub,
    },
    {
      id: 3,
      title: "3. CO2 dan histeresis",
      stimulus: "Simulasi urutan 1.100 → 900 → 750 ppm beserta siklus harian",
      expectedResponse:
        "ON setelah > 1.000 ppm (tunda 60 dtk) → tetap ON/tahan di 800–1.000 ppm → OFF setelah < 800 ppm (tunda 60 dtk)",
      observedMetrics: `(a) >1.000 ppm: ${highAfterDelayPass}/${highAfterDelayTotal} ON · (b) 800–1.000 ppm: ${deadbandHoldPass}/${deadbandTotal} tahan · (c) <800 ppm: ${lowAfterDelayPass}/${lowAfterDelayTotal} OFF`,
      status: s3Derived.status,
      failedSubCriteriaNames: s3Derived.failedNames,
      untestedSubCriteriaNames: s3Derived.untestedNames,
      ruleExplanation:
        "Status skenario diturunkan otomatis dari sub-kriteria (a), (b), dan (c) histeresis CO2 (kriteria usulan kelompok, bukan standar).",
      subCriteria: s3Sub,
      co2SequenceSample,
      co2BugExplanation,
    },
    {
      id: 4,
      title: "4. Pengguna keluar/kembali",
      stimulus:
        "Keluar singkat 2–4 menit (7 episode resolusi 1 menit) lalu kembali, serta kosong 5–15 menit dan ≥ 15 menit",
      expectedResponse:
        "TUNDA_KOSONG sejak OCC=0; <5 mnt lampu & AC tetap menyala, kembali hadir batalkan timer; 5–15 mnt lampu OFF & AC tetap; ≥15 mnt AC OFF",
      observedMetrics: `${s4aValidCount}/${shortExitEpisodes.length} episode keluar singkat (resolusi 1 mnt) menahan beban & membatalkan timer saat kembali; kosong 5–15 mnt (${empty5To15Compliant.length}/${empty5To15Rows.length}) & ≥15 mnt (${empty15PlusCompliant.length}/${empty15PlusRows.length}) sesuai aturan.`,
      status: s4Derived.status,
      failedSubCriteriaNames: s4Derived.failedNames,
      untestedSubCriteriaNames: s4Derived.untestedNames,
      ruleExplanation:
        "Status skenario diturunkan otomatis dari 4 sub-kriteria urutan waktu tunda kosong (kriteria usulan kelompok, bukan standar).",
      subCriteria: s4Sub,
      shortExitEpisodes,
    },
    {
      id: 5,
      title: "5. Gangguan dan restart",
      stimulus:
        "Injeksi 5 jenis gangguan terpisah: Radar/Node B offline, Lux hilang, CO2 hilang, IR AC gagal, dan Restart Host",
      expectedResponse:
        "Setiap kejadian memicu MODE=GANGGUAN, ALARM_ACTIVE=true, dan fallback sesuai tabel; saat restart sensor dibaca ulang & timer kosong direset",
      observedMetrics: `Radar: ${radarFaultRows.length} ttk · Lux: ${luxFaultRows.length} ttk · CO₂: ${co2FaultRows.length} ttk · IR AC: ${irFaultRows.length} ttk · Restart Host: ${hostDownRows.length + hostRecoveryRows.length} ttk`,
      status: s5Derived.status,
      failedSubCriteriaNames: s5Derived.failedNames,
      untestedSubCriteriaNames: s5Derived.untestedNames,
      ruleExplanation:
        "Status skenario diturunkan otomatis dari 5 sub-kriteria jenis gangguan/restart. Jenis dengan 0 kejadian ditandai TIDAK DIUJI, bukan LULUS (kriteria usulan kelompok, bukan standar).",
      subCriteria: s5Sub,
      faultBreakdown,
    },
    {
      id: 6,
      title: "6. Energi dan kenyamanan",
      stimulus: "Pencatatan log operasi periode MANUAL (Hari 1–7) dan periode AUTO (Hari 8–14)",
      expectedResponse:
        "P_B ≤ P_A di seluruh titik; lama layanan, jam okupansi, suhu/lux, dan setpoint tercatat lengkap; E_manual, E_auto, dan selisih ditampilkan sebagai hasil simulasi",
      observedMetrics: `Hasil simulasi: E_manual = ${energyComparison.manualTotalKwh.toFixed(2).replace(".", ",")} kWh, E_auto = ${energyComparison.autoTotalKwh.toFixed(2).replace(".", ",")} kWh (Selisih simulasi: ${energyComparison.savingsKwh.toFixed(2).replace(".", ",")} kWh / ${energyComparison.savingsPercentage.toFixed(2).replace(".", ",")}%). Invarian P_B ≤ P_A: ${powerViolations === 0 ? "100% valid" : `${powerViolations} pelanggaran`}.`,
      status: s6Derived.status,
      failedSubCriteriaNames: s6Derived.failedNames,
      untestedSubCriteriaNames: s6Derived.untestedNames,
      ruleExplanation:
        "Syarat LULUS hanya kepatuhan P_B ≤ P_A dan kelengkapan catatan (lama layanan, jam okupansi, setpoint) kedua periode. Nilai kWh ditampilkan sebagai hasil simulasi (kriteria usulan kelompok, bukan standar).",
      subCriteria: s6Sub,
      energyPeriodComparison: {
        manualTotalKwh: energyComparison.manualTotalKwh,
        autoTotalKwh: energyComparison.autoTotalKwh,
        diffKwh: energyComparison.savingsKwh,
        diffPercent: energyComparison.savingsPercentage,
        manualServiceHours: energyComparison.manualServiceHours,
        autoServiceHours: energyComparison.autoServiceHours,
        manualOccupancyHours: energyComparison.manualOccupancyHours,
        autoOccupancyHours: energyComparison.autoOccupancyHours,
        manualAvgTemp: energyComparison.manualAvgTemp,
        autoAvgTemp: energyComparison.autoAvgTemp,
        manualAvgLux: energyComparison.manualAvgLuxOcc,
        autoAvgLux: energyComparison.autoAvgLuxOcc,
        setpointText: energyComparison.acSetpointText,
        pBAlwaysLessOrEqualPA: pBAlwaysValid,
        violationCount: powerViolations,
      },
    },
  ];
}

/**
 * Menyusun kesimpulan evaluasi yang 100% diturunkan dari status aktual ke-6 skenario:
 * - Hanya skenario LULUS yang boleh disebut berhasil.
 * - Skenario GAGAL dan TIDAK DIUJI disebut perlu perbaikan / pengujian lebih lanjut.
 * - Wajib memuat kalimat disclaimer simulasi sesuai instruksi.
 */
export function buildDynamicTestConclusion(
  scenarios: ScenarioTestResult[],
  energyComparison: EnergyComparisonResult
): string {
  const passed = scenarios.filter((s) => s.status === "LULUS");
  const failed = scenarios.filter((s) => s.status === "GAGAL");
  const untested = scenarios.filter((s) => s.status === "TIDAK DIUJI");

  const parts: string[] = [];

  if (passed.length > 0) {
    parts.push(
      `Berdasarkan evaluasi aturan deterministik pada dataset saat ini, terdapat ${passed.length} dari ${scenarios.length} skenario uji yang berstatus LULUS dan dinyatakan berhasil memenuhi kriteria rancangan, yaitu: ${passed.map((s) => s.title).join("; ")}.`
    );
  } else {
    parts.push(
      `Berdasarkan evaluasi aturan deterministik pada dataset saat ini, belum ada skenario uji yang berstatus LULUS (0 dari ${scenarios.length} skenario).`
    );
  }

  if (failed.length > 0) {
    const failDetails = failed
      .map(
        (s) =>
          `${s.title} (gagal pada sub-kriteria: ${s.failedSubCriteriaNames.join(", ")})`
      )
      .join("; ");
    parts.push(
      `Terdapat ${failed.length} skenario berstatus GAGAL yang memerlukan perbaikan logika atau data, yaitu: ${failDetails}.`
    );
  }

  if (untested.length > 0) {
    const untestedDetails = untested
      .map(
        (s) =>
          `${s.title} (belum diuji pada: ${s.untestedSubCriteriaNames.join(", ")})`
      )
      .join("; ");
    parts.push(
      `Terdapat ${untested.length} skenario berstatus TIDAK DIUJI yang memerlukan perbaikan kelengkapan data pengujian sebelum dapat disimpulkan, yaitu: ${untestedDetails}.`
    );
  }

  parts.push(
    `Pada Skenario 6 (Energi dan kenyamanan), nilai E_manual = ${energyComparison.manualTotalKwh.toFixed(2).replace(".", ",")} kWh, E_auto = ${energyComparison.autoTotalKwh.toFixed(2).replace(".", ",")} kWh, dan selisih ${energyComparison.savingsKwh.toFixed(2).replace(".", ",")} kWh (${energyComparison.savingsPercentage.toFixed(2).replace(".", ",")}%) dicatat sebagai hasil simulasi dengan lama layanan ${energyComparison.manualServiceHours.toFixed(1).replace(".", ",")} jam (MANUAL) vs ${energyComparison.autoServiceHours.toFixed(1).replace(".", ",")} jam (AUTO) serta jam okupansi ${energyComparison.manualOccupancyHours.toFixed(1).replace(".", ",")} jam (MANUAL) vs ${energyComparison.autoOccupancyHours.toFixed(1).replace(".", ",")} jam (AUTO).`
  );

  // Kalimat wajib persis sesuai instruksi nomor 7:
  parts.push(
    `Hasil ini berasal dari data simulasi; tidak membuktikan kinerja sistem lapangan dan bukan klaim penghematan.`
  );

  return parts.join(" ");
}

// ============================================================================
// FUNGSI KONVERSI CSV (UPLOAD & DOWNLOAD UNTUK MENU 2)
// ============================================================================

export function exportRowsToCsv(rows: CleanedTelemetryRow[]): string {
  const headers = [
    "timestamp",
    "dateStr",
    "timeStr",
    "dayIndex",
    "dayName",
    "T_R",
    "RH_R",
    "L_R",
    "C_R",
    "OCC",
    "DOOR",
    "AUTO",
    "SERVICE",
    "B_L",
    "AC_CMD",
    "AC_STATUS_TEXT",
    "FAN_CMD",
    "P_A",
    "P_B",
    "E_A",
    "MODE",
    "NODE_A_ONLINE",
    "NODE_B_ONLINE",
  ];

  const lines = [headers.join(",")];
  for (const r of rows) {
    const vals = [
      r.timestamp,
      r.dateStr,
      r.timeStr,
      r.dayIndex,
      r.dayName,
      r.T_R,
      r.RH_R,
      r.L_R,
      r.C_R,
      r.OCC,
      r.DOOR,
      r.AUTO,
      r.SERVICE,
      r.B_L,
      r.AC_CMD,
      `"${r.AC_STATUS_TEXT}"`,
      r.FAN_CMD,
      r.P_A,
      r.P_B,
      r.E_A,
      r.MODE,
      r.NODE_A_ONLINE,
      r.NODE_B_ONLINE,
    ];
    lines.push(vals.join(","));
  }
  return lines.join("\n");
}

export function parseCsvToTelemetryRows(csvText: string): TelemetryRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error("File CSV kosong atau tidak memiliki baris data.");
  }

  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""));
  const missingCols = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missingCols.length > 0) {
    throw new Error(
      `Kolom wajib tidak ditemukan di CSV: ${missingCols.join(", ")}`
    );
  }

  const parseNumOrUnavail = (val: string): number | "unavailable" => {
    if (
      !val ||
      val === "unavailable" ||
      val.toLowerCase() === "null" ||
      val.toLowerCase() === "nan"
    ) {
      return "unavailable";
    }
    const n = Number(val);
    return Number.isNaN(n) ? "unavailable" : n;
  };

  const result: TelemetryRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]
      .split(",")
      .map((c) => c.trim().replace(/^"|"$/g, ""));
    const rowMap: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowMap[h] = cols[idx] ?? "";
    });

    const ts = rowMap["timestamp"] || "";
    const [dStr = "2026-10-01", tStr = "00:00"] = ts.split(" ");
    const [hrStr = "0", minStr = "0"] = tStr.split(":");

    const occParsed = parseNumOrUnavail(rowMap["OCC"]);
    const occFinal: 0 | 1 | "unavailable" =
      occParsed === "unavailable" ? "unavailable" : occParsed >= 1 ? 1 : 0;

    result.push({
      id: `csv-${i}-${ts}`,
      timestamp: ts,
      dateStr: rowMap["dateStr"] || dStr,
      timeStr: rowMap["timeStr"] || tStr,
      dayIndex: Number(rowMap["dayIndex"]) || Math.ceil(i / 288),
      dayName: rowMap["dayName"] || "Senin",
      hour: Number(hrStr) || 0,
      minute: Number(minStr) || 0,
      stepMinutes: 5,
      T_R: parseNumOrUnavail(rowMap["T_R"]),
      RH_R: parseNumOrUnavail(rowMap["RH_R"]),
      L_R: parseNumOrUnavail(rowMap["L_R"]),
      C_R: parseNumOrUnavail(rowMap["C_R"]),
      OCC: occFinal,
      DOOR: Number(rowMap["DOOR"]) === 1 ? 1 : 0,
      AUTO: Number(rowMap["AUTO"]) === 1 ? 1 : 0,
      SERVICE: Number(rowMap["SERVICE"]) === 1 ? 1 : 0,
      B_L: Number(rowMap["B_L"]) || 0,
      AC_CMD: rowMap["AC_CMD"] === "COOL_25" ? "COOL_25" : "OFF",
      AC_STATUS_TEXT:
        rowMap["AC_STATUS_TEXT"] === "Belum terverifikasi"
          ? "Belum terverifikasi"
          : "Terverifikasi",
      FAN_CMD: Number(rowMap["FAN_CMD"]) === 1 ? 1 : 0,
      P_A: Number(rowMap["P_A"]) || 0,
      P_B: Number(rowMap["P_B"]) || 0,
      E_A: Number(rowMap["E_A"]) || 0,
      MODE: (rowMap["MODE"] as TelemetryRow["MODE"]) || "SIAP",
      NODE_A_ONLINE: rowMap["NODE_A_ONLINE"] !== "false",
      NODE_B_ONLINE: rowMap["NODE_B_ONLINE"] !== "false",
      ALARM_ACTIVE: rowMap["MODE"] === "GANGGUAN",
      ALARM_MESSAGE:
        rowMap["MODE"] === "GANGGUAN"
          ? "Gangguan terdeteksi dari data CSV"
          : "Sistem beroperasi normal",
    });
  }

  return result;
}
