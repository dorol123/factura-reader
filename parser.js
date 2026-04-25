const fs = require('fs');
const path = require('path');

// Unidades de medida a ignorar del nombre del producto
const UNIDADES = [
  'metro cubico', 'metro cubica', 'pie cuadrado', 'pie cuadrada',
  'metro lineal', 'metros lineales',
  'kilogramo', 'kilogramos', 'kilogram',
  'unidad', 'unidades',
  'bolsa', 'bolsas',
  'litro', 'litros',
  'gramo', 'gramos',
  'metro', 'metros',
  'caja', 'cajas',
  'rollo', 'rollos',
  'paquete', 'paquetes',
  'juego', 'juegos',
  'global', 'conjunto',
  'hora', 'horas',
  'und', 'kg', 'lt', 'lts', 'gr', 'grs',
  'm3', 'p2', 'ml', 'mt', 'bls', 'cj',
  'rll', 'pqt', 'jgo', 'pr', 'hr', 'hrs', 'glb'
];

function loadRules() {
  const raw = fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8');
  return JSON.parse(raw);
}

function normalizeText(text) {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Detecta el formato del número y lo parsea:
// - Inglés/Peruano: 1,899.98 o 949.99
// - Argentino: 1.899,98 o 949,99
function parseUniversalNum(raw) {
  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');

  if (hasComma && hasDot) {
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    if (lastDot > lastComma) {
      // Inglés: 1,234.56 → quitar comas → 1234.56
      return parseFloat(raw.replace(/,/g, ''));
    } else {
      // Argentino: 1.234,56 → quitar puntos, reemplazar coma
      return parseFloat(raw.replace(/\./g, '').replace(',', '.'));
    }
  } else if (hasComma) {
    const afterComma = raw.slice(raw.lastIndexOf(',') + 1);
    if (afterComma.length <= 2) {
      return parseFloat(raw.replace(',', '.')); // decimal: 1234,56
    } else {
      return parseFloat(raw.replace(/,/g, '')); // miles: 1,234
    }
  } else {
    return parseFloat(raw); // 1234.56 o 1234
  }
}

// Encuentra precios en una línea (con 1-3 decimales, formato inglés o argentino)
function findPrices(line, minPrice) {
  const re = /\$?\s*(\d{1,3}(?:,\d{3})+\.\d{1,3}|\d+\.\d{1,3}|\d{1,3}(?:\.\d{3})+,\d{1,3}|\d+,\d{1,3})/g;
  const results = [];
  let m;
  while ((m = re.exec(line)) !== null) {
    const val = parseUniversalNum(m[1]);
    if (!isNaN(val) && val >= minPrice) {
      results.push({ raw: m[1], val, start: m.index, end: m.index + m[0].length });
    }
  }
  return results;
}

// Extrae cantidad del inicio (puede ser entero o decimal: 2, 34, 0.30, 0.20)
function extractQty(text) {
  const m = text.match(/^(\d+(?:[.,]\d+)?)\s+/);
  if (!m) return { qty: null, rest: text };
  const val = parseUniversalNum(m[1]);
  if (isNaN(val) || val <= 0) return { qty: null, rest: text };
  return { qty: val, rest: text.slice(m[0].length) };
}

// Quita la unidad de medida del inicio del texto (compara normalizando acentos y mayúsculas)
function quitarUnidad(text) {
  const words = text.trim().split(/\s+/);
  const textNorm = words.map(w => normalizeText(w));

  for (const u of UNIDADES) {
    const uWords = u.split(' ');
    if (textNorm.length >= uWords.length) {
      const primeras = textNorm.slice(0, uWords.length).join(' ');
      if (primeras === u) {
        return words.slice(uWords.length).join(' ').trim();
      }
    }
  }
  return text;
}

function isSkippable(line, rules) {
  const norm = normalizeText(line);
  return rules.skip_keywords.some(kw => norm.includes(normalizeText(kw)));
}

function isTotal(line, rules) {
  const norm = normalizeText(line);
  return rules.total_keywords.some(kw => norm.includes(normalizeText(kw)));
}

function extractFacturaNumber(lines) {
  for (const line of lines) {
    const norm = normalizeText(line);
    const match = norm.match(/(?:factura|remito|comprobante)\s*n?[°º.]?\s*(\w+[-\/]\w+|\d+)/i);
    if (match) return 'Factura N° ' + match[1].toUpperCase();
  }
  return 'Sin identificar';
}

function parseProductLine(line, rules) {
  const prices = findPrices(line, rules.min_price);
  if (prices.length === 0) return null;

  const lastPrice = prices[prices.length - 1];

  let precio_total = lastPrice.val;
  let precio_unitario = prices.length >= 2 ? prices[prices.length - 2].val : null;

  // Texto antes del primer precio detectado
  let textAntes = line.slice(0, prices[0].start).trim();

  // Extraer cantidad del inicio
  const { qty, rest } = extractQty(textAntes);
  let cantidad = qty;
  textAntes = rest || textAntes;

  // Quitar unidad de medida (ej: "UNIDAD", "KILOGRAMO", "METRO CUBICO")
  textAntes = quitarUnidad(textAntes);

  const nombre = textAntes.trim().replace(/\s+/g, ' ');
  if (nombre.length < rules.min_name_length) return null;

  return { nombre, cantidad, precio_unitario, precio_total };
}

function parse(text) {
  const rules = loadRules();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  const factura = extractFacturaNumber(lines);
  const productos = [];
  let total = null;

  for (const line of lines) {
    if (isSkippable(line, rules)) continue;

    if (isTotal(line, rules)) {
      const prices = findPrices(line, rules.min_price);
      if (prices.length > 0) {
        const maxPrice = Math.max(...prices.map(p => p.val));
        if (total === null || maxPrice > total) total = maxPrice;
      }
      continue;
    }

    const producto = parseProductLine(line, rules);
    if (producto) productos.push(producto);
  }

  if (total === null) {
    total = productos.reduce((acc, p) => acc + (p.precio_total || 0), 0);
  }

  return { factura, productos, total };
}

module.exports = { parse };
