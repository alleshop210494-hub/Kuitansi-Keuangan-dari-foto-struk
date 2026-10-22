import { GoogleGenerativeAI } from '@google/generative-ai';

export class AIService {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY wajib dikonfigurasi di Environment Variables.");
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Menggunakan model gemini-3.8-flash yang valid dan sesuai dengan akun Anda
    this.model = genAI.getGenerativeModel({
      model: "gemini-3.8-flash",
      generationConfig: {
        responseMimeType: "application/json"
      }
    });
  }

  async parseReceipt(imageBuffer, mimeType) {
    const prompt = `
Anda adalah mesin OCR dan ekstraktor data keuangan presisi tinggi.
Tugas Anda adalah membaca gambar struk/kuitansi ini dan mengekstrak datanya menjadi format JSON valid.

Format JSON Wajib:
{
  "merchant": {
    "name": "string (Nama Toko / Perusahaan)",
    "address": "string atau null"
  },
  "transaction": {
    "date": "YYYY-MM-DD atau null jika tidak terbaca",
    "time": "HH:mm atau null"
  },
  "payment": {
    "method": "CASH | CARD | QRIS | UNKNOWN",
    "total_amount": number (Total Akhir Pembayaran dalam angka murni),
    "tax_amount": number (Pajak jika ada, default 0),
    "service_charge": number (Layanan jika ada, default 0)
  },
  "items": [
    {
      "name": "string (Nama barang)",
      "qty": number (Jumlah kuantitas, default 1),
      "unit_price": number (Harga satuan),
      "total_price": number (Harga total barang)
    }
  ]
}

Aturan Ketat:
1. Jangan berasumsi! Jika angka atau teks tidak jelas, gunakan null atau 0.
2. Hapus simbol mata uang seperti Rp, $, koma pemisah ribuan. Angka harus bertipe Number.
3. Berikan output murni dalam format JSON sesuai struktur di atas.
`;

    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const imagePart = {
          inlineData: {
            data: imageBuffer.toString("base64"),
            mimeType: mimeType
          }
        };

        const result = await this.model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();
        return JSON.parse(responseText);
      } catch (error) {
        attempt++;
        const errorMessage = error.message || '';
        
        // Jika mendapati error 503 / high demand, tunggu beberapa detik lalu coba lagi otomatis
        if ((errorMessage.includes('503') || errorMessage.includes('high demand')) && attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
          continue;
        }
        
        if (attempt >= maxRetries) {
          throw new Error(`Gemini AI Processing Failure setelah ${maxRetries} percobaan (Server sedang sibuk): ${errorMessage}`);
        }
        throw new Error(`Gemini AI Processing Failure: ${errorMessage}`);
      }
    }
  }
}