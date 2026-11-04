/**
 * File: src/config/appConfig.tsx
 * Menyimpan konstanta konfigurasi global aplikasi serta pemetaan ikon
 * Material Design Icons (@mdi/js & @mdi/react) ala Home Assistant.
 *
 * Catatan untuk pemula:
 * - DEMO_BADGE = true mengaktifkan chip "Mode Demo" di pojok header.
 * - DATA_SOURCE_MODE mengatur apakah aplikasi membaca dari generator data dummy
 *   ('dummy') atau dari kerangka koneksi Home Assistant ('homeassistant').
 */

import React from "react";
import {
  mdiLightbulbOn,
  mdiLightbulbOutline,
  mdiAirConditioner,
  mdiFan,
  mdiThermometer,
  mdiWaterPercent,
  mdiMoleculeCo2,
  mdiBrightness5,
  mdiAccountCheck,
  mdiAccountOffOutline,
  mdiDoorOpen,
  mdiDoorClosed,
  mdiFlash,
  mdiLightningBolt,
  mdiChip,
  mdiWifi,
  mdiWifiOff,
  mdiBellRing,
  mdiBellOutline,
  mdiCash,
  mdiRobotOutline,
  mdiViewDashboardOutline,
  mdiDatabaseCheckOutline,
  mdiChartBellCurveCumulative,
  mdiCogOutline,
  mdiTuneVariant,
  mdiCheckCircleOutline,
  mdiAlertCircleOutline,
  mdiCloseCircleOutline,
  mdiClockOutline,
  mdiSend,
  mdiUpload,
  mdiDownload,
  mdiRefresh,
  mdiFileDocumentOutline,
} from "@mdi/js";

// 1. Konstanta kontrol chip "Mode Demo" di Header
export const DEMO_BADGE: boolean = true;

// 2. Konstanta mode sumber data ('dummy' | 'homeassistant')
export type DataSourceMode = "dummy" | "homeassistant";
export const DEFAULT_DATA_SOURCE_MODE: DataSourceMode = "dummy";

// 3. Tarif listrik dasar PLN (Rp / kWh) default = Rp 1.445 (bisa diubah di Pengaturan)
export const DEFAULT_TARIFF_PER_KWH: number = 1445;

// 4. Jam layanan ruang tunggu SPKLU default (08:00 - 20:00)
export const DEFAULT_SERVICE_START_HOUR: number = 8;
export const DEFAULT_SERVICE_END_HOUR: number = 20;
export const DEFAULT_SERVICE_HOURS = {
  startHour: DEFAULT_SERVICE_START_HOUR,
  endHour: DEFAULT_SERVICE_END_HOUR,
};

// 5. Kumpulan Path Ikon Material Design Icons (MDI) ala Home Assistant
export const HA_ICONS = {
  lampuOn: mdiLightbulbOn,
  lampuOff: mdiLightbulbOutline,
  ac: mdiAirConditioner,
  fan: mdiFan,
  suhu: mdiThermometer,
  kelembapan: mdiWaterPercent,
  co2: mdiMoleculeCo2,
  lux: mdiBrightness5,
  okupansiHadir: mdiAccountCheck,
  okupansiKosong: mdiAccountOffOutline,
  occupancy: mdiAccountCheck,
  pintuBuka: mdiDoorOpen,
  pintuTutup: mdiDoorClosed,
  daya: mdiFlash,
  energi: mdiLightningBolt,
  energy: mdiLightningBolt,
  nodeEsp32: mdiChip,
  wifiOn: mdiWifi,
  wifi: mdiWifi,
  wifiOff: mdiWifiOff,
  alarmActive: mdiBellRing,
  alarmNormal: mdiBellOutline,
  tagihan: mdiCash,
  ai: mdiRobotOutline,
  menuDashboard: mdiViewDashboardOutline,
  dashboard: mdiViewDashboardOutline,
  menuProcessing: mdiDatabaseCheckOutline,
  database: mdiDatabaseCheckOutline,
  menuPredictor: mdiChartBellCurveCumulative,
  chartLine: mdiChartBellCurveCumulative,
  settings: mdiCogOutline,
  simulasi: mdiTuneVariant,
  play: mdiTuneVariant,
  check: mdiCheckCircleOutline,
  checkCircle: mdiCheckCircleOutline,
  alert: mdiAlertCircleOutline,
  info: mdiAlertCircleOutline,
  close: mdiCloseCircleOutline,
  closeCircle: mdiCloseCircleOutline,
  clock: mdiClockOutline,
  send: mdiSend,
  upload: mdiUpload,
  download: mdiDownload,
  refresh: mdiRefresh,
  pdf: mdiFileDocumentOutline,
};

interface HaIconProps {
  path: string;
  sizePx?: number;
  size?: number;
  className?: string;
  spin?: boolean;
}

/**
 * Komponen pembungkus ikon MDI (@mdi/js) dengan ukuran piksel (default 24px)
 * dan class Tailwind CSS. Merender elemen <svg viewBox="0 0 24 24"> secara langsung
 * agar kompatibel penuh dengan React 19 & Vite ESM tanpa masalah interop CJS.
 */
export const HaIcon: React.FC<HaIconProps> = ({
  path,
  sizePx,
  size,
  className = "",
  spin = false,
}) => {
  const finalSize = sizePx ?? size ?? 24;
  return (
    <svg
      viewBox="0 0 24 24"
      width={finalSize}
      height={finalSize}
      fill="currentColor"
      aria-hidden="true"
      className={`inline-block shrink-0 ${className} ${
        spin ? "animate-spin" : ""
      }`}
    >
      <path d={path} />
    </svg>
  );
};
