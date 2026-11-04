import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import {
  GoogleGenAI,
  ThinkingLevel,
  FunctionDeclaration,
  Type,
} from "@google/genai";

dotenv.config();

/**
 * Daftar 7 FunctionDeclaration resmi untuk fitur Function Calling Gemini API
 * sesuai spesifikasi Smart Room Ruang Tunggu SPKLU UP3.
 */
const SMART_ROOM_TOOLS: FunctionDeclaration[] = [
  {
    name: "set_lampu",
    description:
      "Mengatur tingkat kecerahan (brightness) lampu WiZ di ruang tunggu SPKLU dalam satuan persen (rentang diizinkan: 10 sampai 100).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        persen: {
          type: Type.NUMBER,
          description: "Persentase brightness lampu WiZ (10-100).",
        },
      },
      required: ["persen"],
    },
  },
  {
    name: "set_ac",
    description:
      "Mengatur perintah AC Split melalui IR Broadlink RM4 mini (mode OFF atau COOL, setpoint suhu diizinkan 22 sampai 28 derajat Celcius).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        mode: {
          type: Type.STRING,
          description: "Mode operasi AC: 'COOL' atau 'OFF'.",
        },
        setpoint: {
          type: Type.NUMBER,
          description: "Suhu setpoint AC dalam derajat Celcius (22-28).",
        },
      },
      required: ["mode", "setpoint"],
    },
  },
  {
    name: "set_fan",
    description:
      "Mengatur kipas ventilasi tambahan melalui relay Shelly Pro EM-50 dan kontaktor K1 ('ON' atau 'OFF').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        status: {
          type: Type.STRING,
          description: "Status kipas ventilasi: 'ON' atau 'OFF'.",
        },
      },
      required: ["status"],
    },
  },
  {
    name: "set_mode",
    description:
      "Mengubah mode koordinasi sistem Smart Room antara 'AUTO' (otomatis Home Assistant) dan 'MANUAL' (kendali petugas).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        mode: {
          type: Type.STRING,
          description: "Mode sistem: 'AUTO' atau 'MANUAL'.",
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "jalankan_prediksi",
    description:
      "Membuka halaman Prediktor dan menjalankan metode prediksi pemakaian energi bulanan dengan jumlah langkah bulan tertentu.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        metode: {
          type: Type.STRING,
          description:
            "Nama metode: 'Regresi linear', 'Rata-rata', 'Bulan terakhir', 'Musim tahun lalu', 'Heuristik musiman', 'RBF network', 'Kalman filter', 'Particle filter', 'Theta method', atau 'ARIMA(1,1,1)'.",
        },
        step: {
          type: Type.NUMBER,
          description: "Jumlah bulan ke depan yang diprediksi (1 sampai 12).",
        },
      },
      required: ["metode", "step"],
    },
  },
  {
    name: "buka_halaman",
    description:
      "Berpindah ke halaman menu tertentu di aplikasi ('DASHBOARD', 'PROCESSING', 'PREDICTOR', atau 'AI').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        nama: {
          type: Type.STRING,
          description:
            "Nama halaman tujuan: 'DASHBOARD', 'PROCESSING', 'PREDICTOR', atau 'AI'.",
        },
      },
      required: ["nama"],
    },
  },
  {
    name: "jelaskan_alarm",
    description:
      "Menjelaskan kondisi alarm gangguan yang sedang aktif beserta prosedur fallback rancangan.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "2mb" }));

  // Endpoint aman untuk memanggil Gemini API (mendukung teks & Function Calling)
  app.post("/api/gemini", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        return res.status(503).json({
          error: "API Key Gemini belum dikonfigurasi pada environment.",
          code: "NO_API_KEY",
        });
      }

      const { prompt, systemInstruction, enableTools } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Parameter prompt wajib diisi." });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          systemInstruction:
            systemInstruction ||
            "Kamu adalah asisten analitik sistem Smart Room Ruang Tunggu SPKLU di UP3 berbasis Home Assistant (Kelompok 9). Jawab dalam bahasa Indonesia dengan format angka Indonesia (koma desimal). Jawab HANYA berdasarkan data simulasi yang diberikan, jangan mengarang angka di luar data, dan gunakan fungsi resmi bila pengguna meminta aksi kontrol atau navigasi.",
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
          ...(enableTools
            ? { tools: [{ functionDeclarations: SMART_ROOM_TOOLS }] }
            : {}),
        },
      });

      const functionCalls = response.functionCalls || [];
      return res.json({
        text: response.text || "",
        functionCalls: functionCalls.map((fc) => ({
          name: fc.name || "",
          args: fc.args || {},
        })),
      });
    } catch (error: any) {
      console.error("Gemini API Error:", error?.message || error);
      return res.status(500).json({
        error: error?.message || "Gagal menghubungi layanan Gemini API.",
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server Smart Room SPKLU berjalan di http://localhost:${PORT}`);
  });
}

startServer();
