// ── Estado ──

let datos = null;          // { archivo, fechaCarga, filas: [...] }
let tickerActual = null;
let orden = { campo: 'nominales', desc: true };

const $ = (id) => document.getElementById(id);

const fmtNum = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const fmtUsd = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFecha = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

// Columnas del export que usa la app (se busca por nombre, sin importar mayúsculas/acentos)
const COLUMNAS = {
  cuenta: 'cuenta',
  comitente: 'comitente',
  ticker: 'ticker',
  instrumento: 'instrumento',
  tipo: 'tipo',
  nominales: 'nominales',
  tenencia: 'tenencia'
};

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

// ── Lectura del Excel ──

function leerExcel(buffer, nombreArchivo) {
  const libro = XLSX.read(buffer, { type: 'array' });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null, raw: true });

  // Busca la fila de encabezados entre las primeras filas
  const iHeader = filas.slice(0, 15).findIndex(f =>
    f.some(c => normalizar(c) === 'ticker') && f.some(c => normalizar(c) === 'nominales'));
  if (iHeader === -1) {
    throw new Error('No encontré las columnas "Ticker" y "Nominales". ¿Es el export de Tenencia por Ticker?');
  }

  const headers = filas[iHeader].map(h => String(h ?? '').trim());
  const indice = {};
  for (const [campo, nombre] of Object.entries(COLUMNAS)) {
    indice[campo] = headers.findIndex(h => normalizar(h) === nombre);
  }
  for (const campo of ['cuenta', 'comitente', 'ticker', 'nominales']) {
    if (indice[campo] === -1) throw new Error(`Falta la columna "${COLUMNAS[campo]}" en el Excel.`);
  }

  const registros = [];
  for (const fila of filas.slice(iHeader + 1)) {
    const ticker = fila[indice.ticker];
    if (ticker == null || String(ticker).trim() === '') continue;

    // Se guardan todas las columnas originales para poder usarlas más adelante
    const original = {};
    headers.forEach((h, i) => { if (h) original[h] = fila[i]; });

    registros.push({
      cuenta: String(fila[indice.cuenta] ?? '').trim(),
      comitente: String(fila[indice.comitente] ?? '').trim(),
      ticker: String(ticker).trim(),
      instrumento: indice.instrumento >= 0 ? String(fila[indice.instrumento] ?? '').trim() : '',
      tipo: indice.tipo >= 0 ? String(fila[indice.tipo] ?? '').trim() : '',
      nominales: Number(fila[indice.nominales]) || 0,
      tenencia: indice.tenencia >= 0 ? Number(fila[indice.tenencia]) || 0 : 0,
      original
    });
  }

  if (registros.length === 0) throw new Error('El Excel no tiene filas con ticker.');

  return { archivo: nombreArchivo, fechaCarga: new Date().toISOString(), filas: registros };
}

async function cargarArchivo(file) {
  $('error').textContent = '';
  try {
    const buffer = await file.arrayBuffer();
    const nuevos = leerExcel(buffer, file.name);
    await Storage.guardar(nuevos);
    datos = nuevos;
    tickerActual = null;
    render();
  } catch (err) {
    console.error(err);
    const msg = 'No se pudo cargar el archivo: ' + err.message;
    if (datos) alert(msg);
    else $('error').textContent = msg;
  }
}

// ── Agrupación ──

function resumenTickers() {
  const mapa = new Map();
  for (const r of datos.filas) {
    let t = mapa.get(r.ticker);
    if (!t) {
      t = { ticker: r.ticker, instrumento: r.instrumento, tipo: r.tipo, comitentes: new Set() };
      mapa.set(r.ticker, t);
    }
    t.comitentes.add(r.comitente);
  }
  return [...mapa.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// Un cliente puede tener el mismo ticker en más de una fila: se suman sus nominales
function clientesDeTicker(ticker) {
  const mapa = new Map();
  for (const r of datos.filas) {
    if (r.ticker !== ticker) continue;
    // Datos guardados con versiones anteriores no tienen el campo tenencia
    const tenencia = r.tenencia ?? (Number(r.original?.Tenencia) || 0);
    const c = mapa.get(r.comitente);
    if (c) {
      c.nominales += r.nominales;
      c.tenencia += tenencia;
    } else {
      mapa.set(r.comitente, { cuenta: r.cuenta, comitente: r.comitente, nominales: r.nominales, tenencia });
    }
  }
  return [...mapa.values()];
}

// ── Render ──

function render() {
  const hayDatos = !!datos;
  $('vista-vacia').hidden = hayDatos;
  $('vista-datos').hidden = !hayDatos;
  $('estado').textContent = hayDatos
    ? `${datos.archivo} · cargado ${fmtFecha.format(new Date(datos.fechaCarga))} · ${datos.filas.length} filas`
    : 'Sin datos cargados';
  if (!hayDatos) return;
  renderTickers();
  renderDetalle();
}

function renderTickers() {
  const filtro = normalizar($('buscar-ticker').value);
  const lista = $('lista-tickers');
  lista.innerHTML = '';
  for (const t of resumenTickers()) {
    if (filtro && !normalizar(t.ticker).includes(filtro) && !normalizar(t.instrumento).includes(filtro)) continue;
    const li = document.createElement('li');
    li.className = t.ticker === tickerActual ? 'activo' : '';
    li.innerHTML = `
      <div class="t-fila"><strong></strong><span class="t-cant"></span></div>
      <div class="t-instr"></div>`;
    li.querySelector('strong').textContent = t.ticker;
    li.querySelector('.t-cant').textContent = t.comitentes.size;
    li.querySelector('.t-instr').textContent = t.instrumento;
    li.title = `${t.ticker} — ${t.instrumento} (${t.comitentes.size} clientes)`;
    li.addEventListener('click', () => {
      tickerActual = t.ticker;
      renderTickers();
      renderDetalle();
    });
    lista.appendChild(li);
  }
  if (!lista.children.length) {
    lista.innerHTML = '<li class="sin-resultados">Sin resultados</li>';
  }
}

function renderDetalle() {
  const clientes = tickerActual ? clientesDeTicker(tickerActual) : [];
  $('detalle-vacio').hidden = clientes.length > 0;
  $('detalle').hidden = clientes.length === 0;
  if (!clientes.length) return;

  const info = datos.filas.find(r => r.ticker === tickerActual);
  $('det-ticker').textContent = tickerActual;
  $('det-instrumento').textContent = [info.instrumento, info.tipo].filter(Boolean).join(' · ');
  $('det-clientes').textContent = clientes.length;
  $('det-total').textContent = fmtNum.format(clientes.reduce((s, c) => s + c.nominales, 0));
  $('det-valor').textContent = 'USD ' + fmtUsd.format(clientes.reduce((s, c) => s + c.tenencia, 0));

  const { campo, desc } = orden;
  clientes.sort((a, b) => {
    const cmp = (campo === 'nominales' || campo === 'tenencia')
      ? a[campo] - b[campo]
      : String(a[campo]).localeCompare(String(b[campo]), 'es', { numeric: true });
    return desc ? -cmp : cmp;
  });

  const body = $('tabla-body');
  body.innerHTML = '';
  for (const c of clientes) {
    const tr = document.createElement('tr');
    for (const [valor, clase] of [[c.cuenta, ''], [c.comitente, ''], [fmtNum.format(c.nominales), 'num'], [fmtUsd.format(c.tenencia), 'num']]) {
      const td = document.createElement('td');
      td.textContent = valor;
      if (clase) td.className = clase;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  document.querySelectorAll('th[data-orden]').forEach(th => {
    th.classList.toggle('orden-asc', th.dataset.orden === campo && !desc);
    th.classList.toggle('orden-desc', th.dataset.orden === campo && desc);
  });
}

// ── Eventos ──

function initEventos() {
  const input = $('input-excel');
  $('btn-cargar').addEventListener('click', () => input.click());
  $('drop').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files[0]) cargarArchivo(input.files[0]);
    input.value = '';
  });

  // Arrastrar y soltar en cualquier parte de la ventana
  document.addEventListener('dragover', e => {
    e.preventDefault();
    $('drop').classList.add('encima');
  });
  document.addEventListener('dragleave', e => {
    if (!e.relatedTarget) $('drop').classList.remove('encima');
  });
  document.addEventListener('drop', e => {
    e.preventDefault();
    $('drop').classList.remove('encima');
    const file = e.dataTransfer.files[0];
    if (file) cargarArchivo(file);
  });

  $('buscar-ticker').addEventListener('input', renderTickers);

  document.querySelectorAll('th[data-orden]').forEach(th => {
    th.addEventListener('click', () => {
      const campo = th.dataset.orden;
      orden = { campo, desc: orden.campo === campo ? !orden.desc : (campo === 'nominales' || campo === 'tenencia') };
      renderDetalle();
    });
  });
}

// ── Inicio ──

async function iniciar() {
  if (Storage.esApp) {
    Neutralino.init();
    Neutralino.events.on('windowClose', () => Neutralino.app.exit());
  }
  initEventos();
  datos = await Storage.leer();
  render();
}

iniciar();
