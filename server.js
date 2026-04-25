require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── PostgreSQL ──
const { Pool } = require('pg');
let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

async function initDB() {
  try {
    await getPool().query(`
      CREATE TABLE IF NOT EXISTS facturas (
        id           SERIAL PRIMARY KEY,
        numero       INTEGER NOT NULL,
        factura_code TEXT,
        nombre_custom TEXT,
        productos    JSONB,
        total        NUMERIC,
        created_at   TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('DB lista');
  } catch (err) {
    console.error('Error iniciando DB:', err.message);
  }
}

// ── Extracción de texto ──

async function extractTextFromPdf(buffer) {
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return data.text;
}

async function extractTextFromImage(buffer) {
  try {
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker('spa');
    const { data: { text } } = await worker.recognize(buffer);
    await worker.terminate();
    return text;
  } catch (err) {
    throw new Error('OCR no disponible en este entorno. Por favor usá la opción de subir PDF.');
  }
}

function limpiarTexto(text) {
  const { skip_keywords } = require('./rules.json');
  function normalizar(t) {
    return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
  const lineas = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 2);
  const filtradas = lineas.filter(linea => {
    const norm = normalizar(linea);
    if (skip_keywords.some(kw => norm.includes(normalizar(kw)))) return false;
    if (/^[-=_*#|]+$/.test(linea)) return false;
    return true;
  });
  return filtradas.join('\n');
}

async function parseWithAI(text) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: `Sos un extractor de datos de facturas comerciales. Dado el texto crudo de una factura, extraé los productos con sus cantidades y precios.

Devolvé ÚNICAMENTE un objeto JSON válido, sin texto adicional antes ni después:
{
  "factura": "número o código de la factura, o 'Sin identificar'",
  "productos": [
    {
      "nombre": "nombre del producto o insumo",
      "cantidad": número o null,
      "precio_unitario": número o null,
      "precio_total": número
    }
  ],
  "total": número total general de la factura
}

Reglas importantes:
- Los precios y cantidades deben ser números JavaScript (no strings)
- Ignorá encabezados de tabla, datos del cliente, dirección, CUIT, RUC, observaciones, subtotales de IVA y cualquier dato que no sea una línea de producto
- Solo incluí líneas que representen productos o insumos reales
- Si una línea tiene cantidad y precio unitario, calculá o usá el precio total de esa línea
- Manejá cualquier formato de número: 1.234,56 o 1,234.56 o 1234.56`,
        cache_control: { type: 'ephemeral' }
      }
    ],
    messages: [{ role: 'user', content: `Texto de la factura:\n\n${text}` }]
  });
  const raw = response.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('La IA no devolvió un JSON válido');
  return JSON.parse(jsonMatch[0]);
}

// ── Endpoints de factura ──

// Parsear PDF/imagen con IA
app.post('/api/scan', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No se recibió archivo' });

    let text;
    if (file.mimetype === 'application/pdf') {
      text = await extractTextFromPdf(file.buffer);
    } else {
      text = await extractTextFromImage(file.buffer);
    }

    if (!text || text.trim().length === 0)
      return res.status(400).json({ error: 'No se pudo extraer texto del documento' });

    const textLimpio = limpiarTexto(text);
    const result = await parseWithAI(textLimpio);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Traer todas las facturas
app.get('/api/facturas', async (req, res) => {
  try {
    const result = await getPool().query('SELECT * FROM facturas ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Guardar una factura
app.post('/api/facturas', async (req, res) => {
  try {
    const { numero, factura_code, nombre_custom, productos, total } = req.body;
    const result = await getPool().query(
      `INSERT INTO facturas (numero, factura_code, nombre_custom, productos, total)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [numero, factura_code, nombre_custom || null, JSON.stringify(productos), total]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Renombrar una factura
app.put('/api/facturas/:id', async (req, res) => {
  try {
    const { nombre_custom } = req.body;
    await getPool().query(
      'UPDATE facturas SET nombre_custom = $1 WHERE id = $2',
      [nombre_custom || null, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Eliminar una factura
app.delete('/api/facturas/:id', async (req, res) => {
  try {
    await getPool().query('DELETE FROM facturas WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Limpiar todas las facturas
app.delete('/api/facturas', async (req, res) => {
  try {
    await getPool().query('DELETE FROM facturas');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Texto crudo (debug)
app.post('/api/raw', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No se recibió archivo' });
    let text;
    if (file.mimetype === 'application/pdf') {
      text = await extractTextFromPdf(file.buffer);
    } else {
      text = await extractTextFromImage(file.buffer);
    }
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  initDB().then(() => {
    app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
  });
}

module.exports = app;
