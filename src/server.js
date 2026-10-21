import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { AIService } from './services/aiService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Konfigurasi Multer untuk memproses file di memori
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // Maksimal 10 MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('File yang diunggah harus berupa format gambar (JPG/PNG/WebP).'));
    }
  }
});

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// API Endpoint untuk scanning struk menggunakan Gemini
app.post('/api/scan', upload.single('receipt_image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Berkas gambar struk wajib dilampirkan.'
      });
    }

    const aiService = new AIService(process.env.GEMINI_API_KEY);
    const parsedData = await aiService.parseReceipt(req.file.buffer, req.file.mimetype);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      data: parsedData
    });
  } catch (error) {
    next(error);
  }
});

// Centralized Error Handler
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]:', err.stack);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Terjadi kesalahan sistem internal.'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[READY] Server berjalan di port ${PORT}`);
});