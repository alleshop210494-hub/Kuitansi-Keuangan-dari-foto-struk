import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { AIService } from './services/aiService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Penyimpanan sementara riwayat struk di memori server
const receiptHistory = [];

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

// API Endpoint untuk scanning struk
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

    // Simpan hasil ekstraksi ke riwayat
    receiptHistory.push({
      id: Date.now(),
      scanned_at: new Date().toISOString(),
      data: parsedData
    });

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      total_scanned: receiptHistory.length,
      data: parsedData
    });
  } catch (error) {
    next(error);
  }
});

// API Endpoint untuk Ekspor Laporan Excel
app.post('/api/export-excel', async (req, res, next) => {
  try {
    if (receiptHistory.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Belum ada data struk yang berhasil dipindai untuk diekspor.'
      });
    }

    const workbook = new ExcelJS.Workbook();
    
    // Sheet 1: Rekap Transaksi Utama
    const sheetSummary = workbook.addWorksheet('Rekap Transaksi');
    sheetSummary.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Tanggal Scan', key: 'scanned_at', width: 20 },
      { header: 'Nama Toko / Merchant', key: 'merchant_name', width: 25 },
      { header: 'Tanggal Transaksi', key: 'date', width: 18 },
      { header: 'Waktu', key: 'time', width: 10 },
      { header: 'Metode Pembayaran', key: 'method', width: 20 },
      { header: 'Pajak (Tax)', key: 'tax', width: 15 },
      { header: 'Biaya Layanan', key: 'service', width: 15 },
      { header: 'Total Pembayaran', key: 'total', width: 20 }
    ];

    // Styling Header
    sheetSummary.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    sheetSummary.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '1E293B' }
    };

    // Sheet 2: Rincian Barang / Item Detail
    const sheetItems = workbook.addWorksheet('Rincian Item');
    sheetItems.columns = [
      { header: 'No Transaksi', key: 'trans_id', width: 15 },
      { header: 'Nama Toko', key: 'merchant_name', width: 25 },
      { header: 'Nama Barang / Item', key: 'item_name', width: 30 },
      { header: 'Kuantitas (Qty)', key: 'qty', width: 15 },
      { header: 'Harga Satuan', key: 'unit_price', width: 18 },
      { header: 'Total Harga', key: 'total_price', width: 18 }
    ];

    sheetItems.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    sheetItems.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '0F766E' }
    };

    // Populasi Data ke Excel
    receiptHistory.forEach((item, index) => {
      const d = item.data;
      
      // Tambah baris rekap
      const summaryRow = sheetSummary.addRow({
        no: index + 1,
        scanned_at: new Date(item.scanned_at).toLocaleString('id-ID'),
        merchant_name: d.merchant?.name || 'Tidak Terbaca',
        date: d.transaction?.date || '-',
        time: d.transaction?.time || '-',
        method: d.payment?.method || 'UNKNOWN',
        tax: d.payment?.tax_amount || 0,
        service: d.payment?.service_charge || 0,
        total: d.payment?.total_amount || 0
      });

      // Format Angka Mata Uang
      summaryRow.getCell('tax').numFmt = '#,##0';
      summaryRow.getCell('service').numFmt = '#,##0';
      summaryRow.getCell('total').numFmt = '#,##0';

      // Tambah Rincian Items
      if (Array.isArray(d.items)) {
        d.items.forEach(it => {
          const itemRow = sheetItems.addRow({
            trans_id: index + 1,
            merchant_name: d.merchant?.name || 'Tidak Terbaca',
            item_name: it.name || '-',
            qty: it.qty || 1,
            unit_price: it.unit_price || 0,
            total_price: it.total_price || 0
          });

          itemRow.getCell('unit_price').numFmt = '#,##0';
          itemRow.getCell('total_price').numFmt = '#,##0';
        });
      }
    });

    // Mengirim file Excel langsung ke browser sebagai unduhan
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=Laporan_Struk_Keuangan_${Date.now()}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[READY] Server berjalan di port ${PORT}`);
});