// Sección Tenencia por ticker. Va dentro de su propio ámbito para no chocar con
// los nombres de acreditaciones-motor.js (por ejemplo, normalizar).
(() => {

// ── Estado ──

let cargas = [];           // historial: [{ id, archivo, fechaCarga, filas: [...] }]
let datos = null;          // la carga que se muestra: siempre la última
let tickerActual = null;
let orden = { campo: 'nominales', desc: true };
let clienteActual = null;
let ordenCliente = { campo: 'tenencia', desc: true };
let config = {};           // { asesor: nombre del asesor o TODOS }

const TODOS = '__todos__';

const $ = (id) => document.getElementById(id);

const fmtNum = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const fmtEntero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
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
  tenencia: 'tenencia',
  asesor: 'asesor'
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
      asesor: indice.asesor >= 0 ? String(fila[indice.asesor] ?? '').trim() : '',
      original
    });
  }

  if (registros.length === 0) throw new Error('El Excel no tiene filas con ticker.');

  return { archivo: nombreArchivo, fechaCarga: new Date().toISOString(), filas: registros };
}

// ── Asesor ──
// Los Excel pueden traer clientes de uno o varios asesores; se muestran sólo los del asesor elegido.

function asesorDe(r) {
  return r.asesor ?? String(r.original?.Asesor ?? '').trim();
}

function asesoresDisponibles() {
  if (!datos) return [];
  const conteo = new Map();
  for (const r of datos.filas) {
    const a = asesorDe(r);
    if (!a) continue;
    if (!conteo.has(a)) conteo.set(a, new Set());
    conteo.get(a).add(r.comitente);
  }
  return [...conteo.entries()]
    .map(([nombre, comitentes]) => ({ nombre, clientes: comitentes.size }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function filasVisibles() {
  if (!datos) return [];
  if (!config.asesor || config.asesor === TODOS) return datos.filas;
  return datos.filas.filter(r => asesorDe(r) === config.asesor);
}

// Hay que preguntar si nunca se eligió o si el asesor guardado no está en la carga actual
function hayQuePedirAsesor() {
  if (!datos) return false;
  if (config.asesor === TODOS) return false;
  return !config.asesor || !asesoresDisponibles().some(a => a.nombre === config.asesor);
}

async function elegirAsesor(asesor) {
  config.asesor = asesor;
  await Storage.guardarConfig(config);
  tickerActual = null;
  clienteActual = null;
  $('dialogo-asesor').close();
  cerrarMenuAsesor();
  render();
}

// Lista de asesores con buscador: "Todos" va fijo arriba y después los asesores que coinciden
function botonesAsesores(contenedor, filtro = '') {
  contenedor.innerHTML = '';
  const buscado = normalizar(filtro);
  const total = new Set(datos.filas.map(r => r.comitente)).size;
  const coinciden = asesoresDisponibles().filter(a => !buscado || normalizar(a.nombre).includes(buscado));
  const opciones = [{ nombre: TODOS, clientes: total }, ...coinciden];
  for (const a of opciones) {
    const li = document.createElement('li');
    if (a.nombre === TODOS) li.className = 'opcion-todos';
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'opcion-asesor' + (a.nombre === config.asesor ? ' elegido' : '');
    boton.innerHTML = '<span></span><small></small>';
    boton.querySelector('span').textContent = a.nombre === TODOS ? 'Todos' : a.nombre;
    boton.querySelector('small').textContent = a.clientes === 1 ? '1 cliente' : `${fmtEntero.format(a.clientes)} clientes`;
    boton.addEventListener('click', () => elegirAsesor(a.nombre));
    li.appendChild(boton);
    contenedor.appendChild(li);
  }
  if (!coinciden.length) {
    const li = document.createElement('li');
    li.className = 'sin-asesores';
    li.textContent = 'Ningún asesor coincide con la búsqueda';
    contenedor.appendChild(li);
  }
}

// Enter en el buscador elige el primer asesor que coincide (o "Todos" si el buscador está vacío)
function elegirPrimero(contenedor, filtro) {
  const botones = contenedor.querySelectorAll('.opcion-asesor');
  const boton = filtro.trim() ? botones[1] : botones[0];
  if (boton) boton.click();
}

function pedirAsesor() {
  $('buscar-asesor-dialogo').value = '';
  botonesAsesores($('lista-asesores'));
  if (!$('dialogo-asesor').open) $('dialogo-asesor').showModal();
  $('buscar-asesor-dialogo').focus();
}

function renderAsesor() {
  const menu = $('asesor-menu');
  menu.hidden = !datos || !config.asesor;
  if (menu.hidden) return;
  $('asesor-nombre').textContent = config.asesor === TODOS ? 'Todos' : config.asesor;
  $('btn-asesor').title = `Asesor: ${$('asesor-nombre').textContent}`;
}

function abrirMenuAsesor() {
  $('buscar-asesor-menu').value = '';
  botonesAsesores($('asesor-lista-menu'));
  $('asesor-opciones').hidden = false;
  $('btn-asesor').setAttribute('aria-expanded', 'true');
  $('buscar-asesor-menu').focus();
  const elegido = $('asesor-lista-menu').querySelector('.elegido');
  if (elegido) elegido.scrollIntoView({ block: 'nearest' });
}

function cerrarMenuAsesor() {
  $('asesor-opciones').hidden = true;
  $('btn-asesor').setAttribute('aria-expanded', 'false');
}

// ── Historial de cargas ──
// Se guardan todas las cargas; para mostrar datos se usa sólo la más reciente.

function ultimaCarga() {
  return cargas.reduce((ultima, c) => (!ultima || c.fechaCarga > ultima.fechaCarga ? c : ultima), null);
}

// Versiones anteriores guardaban una sola carga sin historial
function leerHistorial(guardado) {
  if (!guardado) return [];
  if (Array.isArray(guardado.cargas)) return guardado.cargas;
  if (Array.isArray(guardado.filas)) return [{ id: guardado.fechaCarga, ...guardado }];
  return [];
}

async function guardarHistorial() {
  await Storage.guardar({ version: 2, cargas });
}

function usarUltimaCarga() {
  const anterior = datos;
  datos = ultimaCarga();
  if (datos !== anterior) {
    tickerActual = null;
    clienteActual = null;
  }
}

async function borrarCarga(id) {
  cargas = cargas.filter(c => c.id !== id);
  await guardarHistorial();
  usarUltimaCarga();
  render();
  renderCargas();
  if (hayQuePedirAsesor()) {
    $('dialogo-cargas').close();
    pedirAsesor();
  }
}

async function cargarArchivo(file) {
  $('error').textContent = '';
  try {
    const buffer = await file.arrayBuffer();
    const nueva = leerExcel(buffer, file.name);
    nueva.id = nueva.fechaCarga;
    cargas.push(nueva);
    await guardarHistorial();
    usarUltimaCarga();
    render();
    renderCargas();
    if (hayQuePedirAsesor()) pedirAsesor();
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
  for (const r of filasVisibles()) {
    let t = mapa.get(r.ticker);
    if (!t) {
      t = { ticker: r.ticker, instrumento: r.instrumento, tipo: r.tipo, comitentes: new Set(), aum: 0 };
      mapa.set(r.ticker, t);
    }
    t.comitentes.add(r.comitente);
    t.aum += tenenciaDe(r);
  }
  const lista = [...mapa.values()];
  const criterio = $('orden-tickers').value;
  return lista.sort((a, b) => {
    if (criterio === 'aum') return b.aum - a.aum || a.ticker.localeCompare(b.ticker);
    if (criterio === 'clientes') return b.comitentes.size - a.comitentes.size || b.aum - a.aum;
    return a.ticker.localeCompare(b.ticker);
  });
}

// Datos guardados con versiones anteriores no tienen el campo tenencia
function tenenciaDe(r) {
  return r.tenencia ?? (Number(r.original?.Tenencia) || 0);
}

// Un cliente puede tener el mismo ticker en más de una fila: se suman sus nominales
function clientesDeTicker(ticker) {
  const mapa = new Map();
  for (const r of filasVisibles()) {
    if (r.ticker !== ticker) continue;
    const tenencia = tenenciaDe(r);
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

// Clientes con su AUM (suma de la tenencia de todas sus posiciones, incluidos los saldos)
function resumenClientes() {
  const mapa = new Map();
  for (const r of filasVisibles()) {
    let c = mapa.get(r.comitente);
    if (!c) {
      c = { comitente: r.comitente, cuenta: r.cuenta, aum: 0, tickers: new Set(), perfil: r.original?.['Perfil de Inversor'] || '' };
      mapa.set(r.comitente, c);
    }
    c.aum += tenenciaDe(r);
    c.tickers.add(r.ticker);
  }
  return [...mapa.values()].sort((a, b) => b.aum - a.aum || a.cuenta.localeCompare(b.cuenta, 'es'));
}

// Posiciones de un cliente, sumando las filas repetidas del mismo ticker
function posicionesDeCliente(comitente) {
  const mapa = new Map();
  for (const r of filasVisibles()) {
    if (r.comitente !== comitente) continue;
    const p = mapa.get(r.ticker);
    if (p) {
      p.nominales += r.nominales;
      p.tenencia += tenenciaDe(r);
    } else {
      mapa.set(r.ticker, { ticker: r.ticker, instrumento: r.instrumento, nominales: r.nominales, tenencia: tenenciaDe(r) });
    }
  }
  return [...mapa.values()];
}

// ── Render ──

function render() {
  const hayDatos = !!datos;
  $('vista-vacia').hidden = hayDatos;
  $('vista-datos').hidden = !hayDatos;
  $('cli-vacia').hidden = hayDatos;
  $('cli-datos').hidden = !hayDatos;
  const estado = hayDatos
    ? `${datos.archivo} · cargado ${fmtFecha.format(new Date(datos.fechaCarga))} · ${datos.filas.length} ${datos.filas.length === 1 ? 'fila' : 'filas'}`
    : 'Sin datos cargados';
  for (const id of ['estado', 'cli-estado']) {
    $(id).textContent = estado;
    $(id).title = estado;
  }
  renderAsesor();
  if (!hayDatos) return;
  renderTickers();
  renderDetalle();
  renderClientes();
  renderDetalleCliente();
}

function renderClientes() {
  const filtro = normalizar($('buscar-cliente').value);
  const lista = $('lista-clientes');
  lista.innerHTML = '';
  resumenClientes().forEach((c, i) => {
    if (filtro && !normalizar(c.cuenta).includes(filtro) && !normalizar(c.comitente).includes(filtro)) return;
    const li = document.createElement('li');
    li.className = c.comitente === clienteActual ? 'activo' : '';
    li.innerHTML = `
      <div class="t-fila"><strong><span class="c-pos"></span><span class="c-nombre"></span></strong><span class="t-aum"></span></div>
      <div class="t-fila"><span class="t-instr"></span><span class="t-cant"></span></div>`;
    li.querySelector('.c-pos').textContent = `${i + 1}.`;
    li.querySelector('.c-nombre').textContent = c.cuenta;
    li.querySelector('.t-aum').textContent = 'USD ' + fmtEntero.format(c.aum);
    li.querySelector('.t-instr').textContent = `Comitente ${c.comitente}`;
    li.querySelector('.t-cant').textContent = c.tickers.size === 1 ? '1 ticker' : `${c.tickers.size} tickers`;
    li.title = `${c.cuenta} — comitente ${c.comitente} (USD ${fmtUsd.format(c.aum)})`;
    li.addEventListener('click', () => {
      clienteActual = c.comitente;
      renderClientes();
      renderDetalleCliente();
    });
    lista.appendChild(li);
  });
  if (!lista.children.length) {
    lista.innerHTML = '<li class="sin-resultados">Sin resultados</li>';
  }
}

function renderDetalleCliente() {
  const posiciones = clienteActual ? posicionesDeCliente(clienteActual) : [];
  $('cli-detalle-vacio').hidden = posiciones.length > 0;
  $('cli-detalle').hidden = posiciones.length === 0;
  if (!posiciones.length) return;

  const cliente = resumenClientes().find(c => c.comitente === clienteActual);
  $('cli-nombre').textContent = cliente.cuenta;
  const sub = $('cli-sub');
  sub.innerHTML = '';
  sub.append('Comitente ', cliente.comitente, botonCopiar(cliente.comitente));
  if (cliente.perfil) sub.append(` · Perfil ${cliente.perfil}`);
  $('cli-tickers').textContent = posiciones.length;
  $('cli-aum').textContent = 'USD ' + fmtUsd.format(cliente.aum);

  const { campo, desc } = ordenCliente;
  posiciones.sort((a, b) => {
    const cmp = (campo === 'nominales' || campo === 'tenencia')
      ? a[campo] - b[campo]
      : String(a[campo]).localeCompare(String(b[campo]), 'es', { numeric: true });
    return desc ? -cmp : cmp;
  });

  const fmtPct = new Intl.NumberFormat('es-AR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const body = $('cli-tabla-body');
  body.innerHTML = '';
  for (const p of posiciones) {
    const tr = document.createElement('tr');
    const pct = cliente.aum ? p.tenencia / cliente.aum : 0;
    tr.appendChild(celdaEnlace(p.ticker, `Ver todos los clientes con ${p.ticker}`, () => irATicker(p.ticker), 'c-ticker'));
    for (const [valor, clase] of [
      [p.instrumento, ''], [fmtNum.format(p.nominales), 'num'],
      [fmtUsd.format(p.tenencia), 'num'], [fmtPct.format(pct), 'num c-pct']
    ]) {
      const td = document.createElement('td');
      td.textContent = valor;
      if (clase) td.className = clase;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  document.querySelectorAll('th[data-orden-cli]').forEach(th => {
    th.classList.toggle('orden-asc', th.dataset.ordenCli === campo && !desc);
    th.classList.toggle('orden-desc', th.dataset.ordenCli === campo && desc);
  });
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
      <div class="t-fila"><strong></strong><span class="t-aum"></span></div>
      <div class="t-fila"><span class="t-instr"></span><span class="t-cant"></span></div>`;
    li.querySelector('strong').textContent = t.ticker;
    li.querySelector('.t-aum').textContent = 'USD ' + fmtEntero.format(t.aum);
    li.querySelector('.t-cant').textContent = t.comitentes.size === 1 ? '1 cliente' : `${t.comitentes.size} clientes`;
    li.querySelector('.t-instr').textContent = t.instrumento;
    li.title = `${t.ticker} — ${t.instrumento} (${t.comitentes.size} clientes, USD ${fmtUsd.format(t.aum)})`;
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

  const info = filasVisibles().find(r => r.ticker === tickerActual);
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
    tr.appendChild(celdaEnlace(c.cuenta, `Ver la tenencia de ${c.cuenta}`, () => irACliente(c.comitente)));
    const tdComitente = document.createElement('td');
    tdComitente.append(c.comitente, botonCopiar(c.comitente));
    tr.appendChild(tdComitente);
    for (const [valor, clase] of [[fmtNum.format(c.nominales), 'num'], [fmtUsd.format(c.tenencia), 'num']]) {
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

// ── Copiar comitente ──

const ICONO_COPIAR = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3.5 10.5h-.5A1.5 1.5 0 0 1 1.5 9V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5"/></svg>';
const ICONO_OK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch (err) {
    // En la app de escritorio, si el navegador no deja, se usa el portapapeles de Windows
    if (Storage.esApp) await Neutralino.clipboard.writeText(texto);
    else throw err;
  }
}

function botonCopiar(texto) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'btn-copiar';
  boton.title = `Copiar ${texto}`;
  boton.setAttribute('aria-label', `Copiar comitente ${texto}`);
  boton.innerHTML = ICONO_COPIAR;
  boton.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await copiarTexto(texto);
      boton.innerHTML = ICONO_OK;
      boton.classList.add('copiado');
      boton.title = 'Copiado';
    } catch (err) {
      boton.title = 'No se pudo copiar';
    }
    clearTimeout(boton._timer);
    boton._timer = setTimeout(() => {
      boton.innerHTML = ICONO_COPIAR;
      boton.classList.remove('copiado');
      boton.title = `Copiar ${texto}`;
    }, 1500);
  });
  return boton;
}

// ── Navegación entre ticker y cliente ──

function celdaEnlace(texto, titulo, alHacerClic, clase) {
  const td = document.createElement('td');
  if (clase) td.className = clase;
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'enlace-celda';
  boton.textContent = texto;
  boton.title = titulo;
  boton.addEventListener('click', alHacerClic);
  td.appendChild(boton);
  return td;
}

function mostrarSeleccionado(listaId) {
  const activo = document.querySelector(`#${listaId} li.activo`);
  if (activo) activo.scrollIntoView({ block: 'center' });
}

function irATicker(ticker) {
  tickerActual = ticker;
  $('buscar-ticker').value = '';
  renderTickers();
  renderDetalle();
  window.mostrarSeccion('tenencia');
  mostrarSeleccionado('lista-tickers');
}

function irACliente(comitente) {
  clienteActual = comitente;
  $('buscar-cliente').value = '';
  renderClientes();
  renderDetalleCliente();
  window.mostrarSeccion('clientes');
  mostrarSeleccionado('lista-clientes');
}

// ── Ventana "Borrar datos" ──

function renderCargas() {
  const lista = $('lista-cargas');
  if (!lista) return;
  lista.innerHTML = '';
  const activa = ultimaCarga();
  const ordenadas = [...cargas].sort((a, b) => (a.fechaCarga < b.fechaCarga ? 1 : -1));
  $('cargas-vacio').hidden = ordenadas.length > 0;
  for (const c of ordenadas) {
    const li = document.createElement('li');
    li.className = 'carga' + (c === activa ? ' en-uso' : '');
    li.innerHTML = `
      <div class="carga-info">
        <div class="carga-archivo"><span></span></div>
        <div class="carga-detalle"></div>
      </div>
      <div class="carga-acciones">
        <button type="button" class="btn-borrar">Borrar</button>
      </div>`;
    li.querySelector('.carga-archivo span').textContent = c.archivo;
    if (c === activa) {
      const chip = document.createElement('em');
      chip.className = 'chip-uso';
      chip.textContent = 'En uso';
      li.querySelector('.carga-archivo').appendChild(chip);
    }
    li.querySelector('.carga-detalle').textContent =
      `Cargado el ${fmtFecha.format(new Date(c.fechaCarga))} · ${fmtEntero.format(c.filas.length)} ${c.filas.length === 1 ? 'fila' : 'filas'}`;

    // Confirmación dentro de la misma fila
    const acciones = li.querySelector('.carga-acciones');
    li.querySelector('.btn-borrar').addEventListener('click', () => {
      acciones.innerHTML = '<span class="carga-seguro">¿Borrar?</span>'
        + '<button type="button" class="btn-borrar confirmar">Sí, borrar</button>'
        + '<button type="button" class="btn-cancelar">No</button>';
      acciones.querySelector('.confirmar').addEventListener('click', () => borrarCarga(c.id));
      acciones.querySelector('.btn-cancelar').addEventListener('click', renderCargas);
    });
    lista.appendChild(li);
  }
}

function abrirCargas() {
  renderCargas();
  $('dialogo-cargas').showModal();
}

// ── Eventos ──

function initEventos() {
  const input = $('input-excel');
  $('btn-cargar').addEventListener('click', () => input.click());
  $('btn-borrar-datos').addEventListener('click', abrirCargas);
  $('cerrar-cargas').addEventListener('click', () => $('dialogo-cargas').close());
  // El asesor es obligatorio la primera vez: la ventana no se cierra con Escape
  $('dialogo-asesor').addEventListener('cancel', e => e.preventDefault());
  for (const [input, lista] of [['buscar-asesor-dialogo', 'lista-asesores'], ['buscar-asesor-menu', 'asesor-lista-menu']]) {
    $(input).addEventListener('input', () => botonesAsesores($(lista), $(input).value));
    $(input).addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        elegirPrimero($(lista), $(input).value);
      }
    });
  }
  $('btn-asesor').addEventListener('click', e => {
    e.stopPropagation();
    if ($('asesor-opciones').hidden) abrirMenuAsesor();
    else cerrarMenuAsesor();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#asesor-menu')) cerrarMenuAsesor();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cerrarMenuAsesor();
  });

  $('dialogo-cargas').addEventListener('click', e => {
    if (e.target === $('dialogo-cargas')) $('dialogo-cargas').close();
  });
  $('drop').addEventListener('click', () => input.click());
  $('cli-drop').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files[0]) cargarArchivo(input.files[0]);
    input.value = '';
  });

  // Arrastrar y soltar en cualquier parte de la ventana (sólo con esta sección abierta)
  const enTenencia = () => ['tenencia', 'clientes'].includes(document.body.dataset.seccion);
  const zonas = () => [$('drop'), $('cli-drop')];
  document.addEventListener('dragover', e => {
    e.preventDefault();
    if (enTenencia()) zonas().forEach(z => z.classList.add('encima'));
  });
  document.addEventListener('dragleave', e => {
    if (!e.relatedTarget) zonas().forEach(z => z.classList.remove('encima'));
  });
  document.addEventListener('drop', e => {
    e.preventDefault();
    zonas().forEach(z => z.classList.remove('encima'));
    const file = e.dataTransfer.files[0];
    if (file && enTenencia()) cargarArchivo(file);
  });

  $('buscar-ticker').addEventListener('input', renderTickers);
  $('buscar-cliente').addEventListener('input', renderClientes);

  document.querySelectorAll('th[data-orden-cli]').forEach(th => {
    th.addEventListener('click', () => {
      const campo = th.dataset.ordenCli;
      const numerico = campo === 'nominales' || campo === 'tenencia';
      ordenCliente = { campo, desc: ordenCliente.campo === campo ? !ordenCliente.desc : numerico };
      renderDetalleCliente();
    });
  });
  $('orden-tickers').addEventListener('change', renderTickers);

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
  cargas = leerHistorial(await Storage.leer());
  config = await Storage.leerConfig();
  usarUltimaCarga();
  render();
  if (hayQuePedirAsesor()) pedirAsesor();
}

iniciar();

})();
