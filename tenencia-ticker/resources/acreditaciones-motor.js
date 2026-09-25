/*
 * Motor de procesamiento del Excel de Acreditaciones.
 * Corre 100% en el navegador (usa los ExcelJS y JSZip vendorizados en
 * vendor/): el archivo nunca se sube a ningún servidor.
 */

// ---------- Reparación del XML (filas/celdas sin atributo r="...") ----------
// Algunos exportadores (como el que genera este reporte) escriben las filas y
// celdas del XML sin los atributos r="..." (referencia de fila/columna).
// Eso es válido según el estándar OOXML (la posición se infiere por orden),
// pero el parser de exceljs no lo soporta y falla con "Invalid row number in
// model". Esta función reconstruye esos atributos antes de pasarle el
// archivo a exceljs. Solo contempla filas "normales" (<row>...</row>), que
// es el único caso que genera este reporte.

function indiceAColumna(indice) {
  let letra = '';
  let n = indice;
  while (n > 0) {
    const resto = (n - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    n = Math.floor((n - 1) / 26);
  }
  return letra;
}

function columnaAIndice(letra) {
  let n = 0;
  for (const ch of letra) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function repararCeldasDeFila(contenido, rowIndex) {
  let colIndex = 0;
  return contenido.replace(/<c(?=[\s/>])([^>]*?)(\/?)>/g, (match, atributos, autocierre) => {
    if (/\br="/.test(atributos)) {
      const m = atributos.match(/r="([A-Z]+)\d+"/);
      if (m) colIndex = columnaAIndice(m[1]);
      return match;
    }
    colIndex += 1;
    const letra = indiceAColumna(colIndex);
    return `<c r="${letra}${rowIndex}"${atributos}${autocierre}>`;
  });
}

function repararSheetXml(xml) {
  let rowIndex = 0;
  return xml.replace(/<row([^>]*)>([\s\S]*?)<\/row>/g, (match, atributos, contenido) => {
    rowIndex += 1;
    let nuevosAtributos = atributos;
    const m = atributos.match(/\br="(\d+)"/);
    if (m) {
      rowIndex = parseInt(m[1], 10);
    } else {
      nuevosAtributos = ` r="${rowIndex}"${atributos}`;
    }
    const contenidoReparado = repararCeldasDeFila(contenido, rowIndex);
    return `<row${nuevosAtributos}>${contenidoReparado}</row>`;
  });
}

async function repararBuffer(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const rutasHojas = Object.keys(zip.files).filter((ruta) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(ruta)
  );

  for (const ruta of rutasHojas) {
    const xml = await zip.file(ruta).async('string');
    if (/<row>|<row\s+(?!r=")/.test(xml)) {
      zip.file(ruta, repararSheetXml(xml));
    }
  }

  return zip.generateAsync({ type: 'arraybuffer' });
}

// ---------- Procesamiento (filtrado, orden, formato) ----------

const COLUMNAS_A_QUITAR = [
  'Fecha Carga',
  'Hora Carga',
  'Recibo',
  'Usuario Alta',
  'Equipo',
  'UnidadDeNegocio',
];

const MONEDAS_DOLAR = ['Dólar MEP', 'Dólar Cable'];

const UMBRAL_PESOS_ELIMINAR = 999999; // se eliminan filas con importe <= a esto
const UMBRAL_DOLARES_ELIMINAR = 999;

const UMBRAL_PESOS_DESTACAR = 5000000; // rojo+negrita si importe >= a esto
const UMBRAL_DOLARES_DESTACAR = 5000;

const FORMATO_MONEDA = '"$" #,##0';
const ROJO_NEGRITA = { color: { argb: 'FFFF0000' }, bold: true };

function normalizar(valor) {
  return typeof valor === 'string' ? valor.trim() : valor;
}

function fechaISOLocalDeHoy() {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

function obtenerRangoFiltro({ fechaDesde, fechaHasta, horaDesde, horaHasta } = {}) {
  const hoyISO = fechaISOLocalDeHoy();
  const fDesde = fechaDesde || hoyISO;
  const fHasta = fechaHasta || hoyISO;
  const hDesde = horaDesde || '00:00';
  const hHasta = horaHasta || '23:59';

  const [yDesde, moDesde, dDesde] = fDesde.split('-').map(Number);
  const [yHasta, moHasta, dHasta] = fHasta.split('-').map(Number);
  const [hhDesde, mmDesde] = hDesde.split(':').map(Number);
  const [hhHasta, mmHasta] = hHasta.split(':').map(Number);

  const inicio = new Date(yDesde, moDesde - 1, dDesde, hhDesde || 0, mmDesde || 0, 0);
  const fin = new Date(yHasta, moHasta - 1, dHasta, hhHasta || 0, mmHasta || 0, 59);
  return { inicio, fin };
}

function parseFechaHoraCarga(fechaCarga, horaCarga) {
  let dia;
  let mes;
  let anio;
  if (fechaCarga instanceof Date) {
    dia = fechaCarga.getDate();
    mes = fechaCarga.getMonth() + 1;
    anio = fechaCarga.getFullYear();
  } else if (typeof fechaCarga === 'string') {
    const partes = fechaCarga.trim().split('/');
    if (partes.length !== 3) return null;
    [dia, mes, anio] = partes.map(Number);
  } else {
    return null;
  }
  if (!Number.isFinite(dia) || !Number.isFinite(mes) || !Number.isFinite(anio)) return null;

  let horas = 0;
  let minutos = 0;
  let segundos = 0;
  if (horaCarga instanceof Date) {
    horas = horaCarga.getHours();
    minutos = horaCarga.getMinutes();
    segundos = horaCarga.getSeconds();
  } else if (typeof horaCarga === 'string') {
    const [h, m, s] = horaCarga.trim().split(':').map(Number);
    horas = h || 0;
    minutos = m || 0;
    segundos = s || 0;
  }
  return new Date(anio, mes - 1, dia, horas, minutos, segundos);
}

/**
 * Ordena por asesor: los asesores van alfabéticamente, y dentro de cada
 * asesor sus filas de mayor a menor importe.
 */
function ordenarPorAsesor(filas) {
  return [...filas].sort((a, b) => {
    const comparacionAsesor = String(a.asesor).localeCompare(String(b.asesor), 'es');
    if (comparacionAsesor !== 0) return comparacionAsesor;
    return b.importe - a.importe;
  });
}

function construirHoja(workbook, nombre, filas, encabezados, colImporte, colAsesor, colCuenta, umbralDestacar) {
  const hoja = workbook.addWorksheet(nombre);
  hoja.addRow(encabezados);
  hoja.getRow(1).font = { bold: true };
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: encabezados.length } };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];

  for (const fila of filas) {
    const filaExcel = hoja.addRow(fila.valores);
    const celdaImporte = filaExcel.getCell(colImporte + 1);
    celdaImporte.numFmt = FORMATO_MONEDA;
    if (fila.importe >= umbralDestacar) {
      celdaImporte.font = ROJO_NEGRITA;
      filaExcel.getCell(colAsesor + 1).font = ROJO_NEGRITA;
    }
  }

  encabezados.forEach((encabezado, i) => {
    hoja.getColumn(i + 1).width = Math.max(14, String(encabezado).length + 4);
  });
  hoja.getColumn(colImporte + 1).width = 16;
  if (colCuenta !== -1) {
    hoja.getColumn(colCuenta + 1).width = 45;
  }

  return hoja;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatFechaHoraParaArchivo(fecha) {
  const dia = fecha.getDate();
  const mes = fecha.getMonth() + 1;
  const anio2 = String(fecha.getFullYear()).slice(-2);
  const hora = pad2(fecha.getHours());
  const minutos = pad2(fecha.getMinutes());
  return `${dia}-${mes}-${anio2}--${hora}-${minutos}`;
}

/** Ej: "Acreditaciones-24-8-26--10-30----24-8-26--13-00.xlsx" */
function construirNombreArchivo(filtros = {}) {
  const { inicio, fin } = obtenerRangoFiltro(filtros);
  return `Acreditaciones-${formatFechaHoraParaArchivo(inicio)}----${formatFechaHoraParaArchivo(fin)}.xlsx`;
}

function serializarValor(valor) {
  if (valor instanceof Date) {
    return valor.toLocaleDateString('es-AR');
  }
  if (valor && typeof valor === 'object' && 'text' in valor) {
    return valor.text; // celdas con formato tipo { text, hyperlink }
  }
  return valor;
}

function formatHora(valor) {
  if (valor instanceof Date) {
    return `${pad2(valor.getHours())}:${pad2(valor.getMinutes())}`;
  }
  if (typeof valor === 'string') {
    const [h, m] = valor.trim().split(':');
    if (h !== undefined && m !== undefined) return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  }
  return '';
}

function serializarFilas(filas, umbralDestacar) {
  return filas.map((fila) => ({
    valores: fila.valores.map(serializarValor),
    importe: fila.importe,
    destacado: fila.importe >= umbralDestacar,
    hora: formatHora(fila.horaCarga),
  }));
}

async function procesarDatos(arrayBuffer, filtros = {}) {
  const { inicio, fin } = obtenerRangoFiltro(filtros);
  const bufferReparado = await repararBuffer(arrayBuffer);
  const workbookOrigen = new ExcelJS.Workbook();
  await workbookOrigen.xlsx.load(bufferReparado);
  const hojaOrigen = workbookOrigen.worksheets[0];
  if (!hojaOrigen) {
    throw new Error('El archivo no tiene ninguna hoja.');
  }

  const encabezadosOrigen = [];
  hojaOrigen.getRow(1).eachCell({ includeEmpty: false }, (celda, colNumero) => {
    encabezadosOrigen[colNumero] = String(celda.value ?? '').trim();
  });

  const columnasAConservar = [];
  encabezadosOrigen.forEach((nombre, colNumero) => {
    if (nombre && !COLUMNAS_A_QUITAR.includes(nombre)) {
      columnasAConservar.push({ colNumero, nombre });
    }
  });

  const idxMoneda = encabezadosOrigen.indexOf('Moneda');
  const idxImporte = encabezadosOrigen.indexOf('Importe');
  const idxAsesor = encabezadosOrigen.indexOf('Asesor');
  const idxFechaCarga = encabezadosOrigen.indexOf('Fecha Carga');
  const idxHoraCarga = encabezadosOrigen.indexOf('Hora Carga');
  if (idxMoneda === -1 || idxImporte === -1 || idxAsesor === -1) {
    throw new Error('El archivo debe tener las columnas "Moneda", "Importe" y "Asesor".');
  }

  const encabezadosSalida = columnasAConservar.map((c) => c.nombre);
  const colImporteSalida = columnasAConservar.findIndex((c) => c.colNumero === idxImporte);
  const colAsesorSalida = columnasAConservar.findIndex((c) => c.colNumero === idxAsesor);
  const colCuentaSalida = columnasAConservar.findIndex((c) => c.nombre === 'Cuenta');

  const filasPesos = [];
  const filasDolares = [];

  hojaOrigen.eachRow({ includeEmpty: false }, (fila, numeroFila) => {
    if (numeroFila === 1) return;

    if (idxFechaCarga !== -1) {
      const fechaHoraFila = parseFechaHoraCarga(
        fila.getCell(idxFechaCarga).value,
        idxHoraCarga !== -1 ? fila.getCell(idxHoraCarga).value : null
      );
      if (fechaHoraFila && (fechaHoraFila < inicio || fechaHoraFila > fin)) return;
    }

    const moneda = normalizar(fila.getCell(idxMoneda).value);
    const importeCrudo = fila.getCell(idxImporte).value;
    const importe = typeof importeCrudo === 'number' ? importeCrudo : parseFloat(importeCrudo);
    if (!Number.isFinite(importe)) return;

    const asesor = normalizar(fila.getCell(idxAsesor).value);
    const valores = columnasAConservar.map((c) => fila.getCell(c.colNumero).value);
    const horaCarga = idxHoraCarga !== -1 ? fila.getCell(idxHoraCarga).value : null;
    const filaProcesada = { valores, importe, asesor, horaCarga };

    if (moneda === 'Pesos' && importe > UMBRAL_PESOS_ELIMINAR) {
      filasPesos.push(filaProcesada);
    } else if (MONEDAS_DOLAR.includes(moneda) && importe > UMBRAL_DOLARES_ELIMINAR) {
      filasDolares.push(filaProcesada);
    }
  });

  const pesosOrdenados = ordenarPorAsesor(filasPesos);
  const dolaresOrdenados = ordenarPorAsesor(filasDolares);

  return {
    encabezadosSalida,
    colImporteSalida,
    colAsesorSalida,
    colCuentaSalida,
    pesosOrdenados,
    dolaresOrdenados,
  };
}

/**
 * Procesa el archivo (100% en el navegador) y devuelve tanto el .xlsx final
 * (como ArrayBuffer, listo para descargar) como los mismos datos en JSON,
 * para mostrar la vista previa sin tener que volver a leer el archivo.
 */
async function procesarAcreditaciones(arrayBuffer, filtros = {}) {
  const datos = await procesarDatos(arrayBuffer, filtros);
  const {
    encabezadosSalida,
    colImporteSalida,
    colAsesorSalida,
    colCuentaSalida,
    pesosOrdenados,
    dolaresOrdenados,
  } = datos;

  const workbookSalida = new ExcelJS.Workbook();
  construirHoja(workbookSalida, 'Pesos', pesosOrdenados, encabezadosSalida, colImporteSalida, colAsesorSalida, colCuentaSalida, UMBRAL_PESOS_DESTACAR);
  construirHoja(workbookSalida, 'Dolares', dolaresOrdenados, encabezadosSalida, colImporteSalida, colAsesorSalida, colCuentaSalida, UMBRAL_DOLARES_DESTACAR);
  const xlsxBuffer = await workbookSalida.xlsx.writeBuffer();

  return {
    xlsxBuffer,
    nombreArchivo: construirNombreArchivo(filtros),
    vistaPrevia: {
      encabezados: encabezadosSalida,
      colImporte: colImporteSalida,
      colAsesor: colAsesorSalida,
      hojas: {
        Pesos: serializarFilas(pesosOrdenados, UMBRAL_PESOS_DESTACAR),
        Dolares: serializarFilas(dolaresOrdenados, UMBRAL_DOLARES_DESTACAR),
      },
    },
  };
}
