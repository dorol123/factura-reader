// Sección Acreditaciones: interfaz del procesador (el cálculo está en acreditaciones-motor.js,
// igual que en el acreditador original). Todo corre en esta PC.

(() => {
  const $ = (id) => document.getElementById(id);

  const form = $('acr-form');
  const inputArchivo = $('acr-archivo');
  const drop = $('acr-drop');
  const dropTexto = $('acr-drop-texto');
  const btnDescargar = $('acr-descargar');
  const mensaje = $('acr-mensaje');
  const fechaDesde = $('acr-fecha-desde');
  const fechaHasta = $('acr-fecha-hasta');
  const horaDesde = $('acr-hora-desde');
  const horaHasta = $('acr-hora-hasta');
  const tabs = $('acr-tabs');
  const tablaWrap = $('acr-tabla-wrap');
  const selectAsesor = $('acr-asesor');
  const zonaImagen = $('acr-zona-imagen');
  const notaImagen = $('acr-nota-imagen');

  const UMBRAL_DIVIDIR_IMAGEN = 60;
  const ETIQUETA_HOJA = { Pesos: 'Pesos', Dolares: 'Dólares' };

  let archivoActual = null;
  let vistaPrevia = null;
  let hojaActiva = null;
  let ultimoXlsx = null;
  let ultimoNombre = null;
  let procesando = false;
  let timerReprocesar = null;

  // ── Fechas ──

  function fechaLocalISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function sumarDias(fechaISO, dias) {
    const [anio, mes, dia] = fechaISO.split('-').map(Number);
    const fecha = new Date(anio, mes - 1, dia);
    fecha.setDate(fecha.getDate() + dias);
    return fechaLocalISO(fecha);
  }

  function esLunes(fechaISO) {
    const [anio, mes, dia] = fechaISO.split('-').map(Number);
    return new Date(anio, mes - 1, dia).getDay() === 1;
  }

  function formatFechaDDMMYYYY(fechaISO) {
    const [anio, mes, dia] = fechaISO.split('-');
    return `${dia}/${mes}/${anio}`;
  }

  const hoy = fechaLocalISO(new Date());
  fechaDesde.value = hoy;
  fechaHasta.value = hoy;
  horaDesde.value = '00:00';
  horaHasta.value = '23:59';

  // ── Mensajes ──

  function mostrarMensaje(texto, tipo) {
    mensaje.textContent = texto;
    mensaje.className = 'acr-mensaje' + (tipo ? ' ' + tipo : '');
  }

  // ── Archivo ──

  function setArchivo(archivo) {
    if (!archivo) return;
    archivoActual = archivo;
    dropTexto.textContent = archivo.name;
    drop.classList.add('con-archivo');
    btnDescargar.disabled = false;
    mostrarMensaje('', null);
    procesar({ descargar: false });
  }

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('encima');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('encima'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('encima');
    setArchivo(e.dataTransfer.files[0]);
  });
  inputArchivo.addEventListener('change', () => {
    setArchivo(inputArchivo.files[0]);
    inputArchivo.value = '';
  });

  // ── Guardar archivos ──
  // En la app de escritorio se usa el diálogo "Guardar como" de Windows;
  // en un navegador, la descarga común.

  async function guardarArchivo(blob, nombre) {
    if (Storage.esApp) {
      const ruta = await Neutralino.os.showSaveDialog('Guardar archivo', {
        defaultPath: nombre,
        filters: [{ name: nombre.endsWith('.png') ? 'Imagen PNG' : 'Excel', extensions: [nombre.split('.').pop()] }]
      });
      if (!ruta) return false;
      await Neutralino.filesystem.writeBinaryFile(ruta, await blob.arrayBuffer());
      return true;
    }
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  // ── Tabla ──

  function formatImporte(importe) {
    return '$ ' + Math.round(importe).toLocaleString('es-AR');
  }

  function normalizarNombre(valor) {
    return String(valor || '').trim().replace(/\s+/g, ' ').toUpperCase();
  }

  function construirTabla(encabezados, filas, colImporte, colAsesor) {
    const colFecha = encabezados.indexOf('Fecha Acreditación');
    const colCuenta = encabezados.indexOf('Cuenta');
    const tabla = document.createElement('table');
    tabla.className = 'tabla-acreditaciones';

    const trHead = document.createElement('tr');
    encabezados.forEach((encabezado, i) => {
      const th = document.createElement('th');
      th.textContent = encabezado;
      if (i === colFecha) th.classList.add('columna-fecha');
      if (i === colCuenta) th.classList.add('columna-cuenta');
      if (i === colImporte) th.classList.add('columna-importe');
      trHead.appendChild(th);
      if (i === colFecha) {
        const thHora = document.createElement('th');
        thHora.textContent = 'Hora';
        thHora.classList.add('columna-hora');
        trHead.appendChild(thHora);
      }
    });
    const thead = document.createElement('thead');
    thead.appendChild(trHead);
    tabla.appendChild(thead);

    const tbody = document.createElement('tbody');
    if (filas.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = encabezados.length + 1;
      td.className = 'tabla-vacia';
      td.textContent = 'No hay operaciones en este rango.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    for (const fila of filas) {
      const tr = document.createElement('tr');
      // Si la cuenta es del propio asesor, no se repite el nombre
      const ocultarCuenta = colCuenta !== -1
        && normalizarNombre(fila.valores[colCuenta]) === normalizarNombre(fila.valores[colAsesor]);
      fila.valores.forEach((valor, i) => {
        const td = document.createElement('td');
        if (i === colImporte) {
          td.textContent = formatImporte(fila.importe);
          td.classList.add('columna-importe');
        } else if (i === colCuenta && ocultarCuenta) {
          td.textContent = '';
        } else {
          td.textContent = valor == null ? '' : String(valor);
        }
        if (i === colFecha) td.classList.add('columna-fecha');
        if (i === colCuenta) td.classList.add('columna-cuenta');
        if (fila.destacado && (i === colImporte || i === colAsesor)) td.classList.add('destacado');
        tr.appendChild(td);
        if (i === colFecha) {
          const tdHora = document.createElement('td');
          tdHora.textContent = fila.hora || '';
          tdHora.classList.add('columna-hora');
          tr.appendChild(tdHora);
        }
      });
      tbody.appendChild(tr);
    }
    tabla.appendChild(tbody);
    return tabla;
  }

  function filasVisibles() {
    const filas = vistaPrevia.hojas[hojaActiva];
    const asesor = selectAsesor.value;
    return asesor ? filas.filter(f => f.valores[vistaPrevia.colAsesor] === asesor) : filas;
  }

  function actualizarTabla() {
    if (!vistaPrevia) return;
    const filas = filasVisibles();
    const tabla = construirTabla(vistaPrevia.encabezados, filas, vistaPrevia.colImporte, vistaPrevia.colAsesor);
    tabla.id = 'acr-tabla-activa';
    tablaWrap.innerHTML = '';
    tablaWrap.appendChild(tabla);
    actualizarBotonesImagen(filas);
  }

  function renderVistaPrevia() {
    const nombres = Object.keys(vistaPrevia.hojas);
    if (!nombres.includes(hojaActiva)) hojaActiva = nombres[0];

    tabs.innerHTML = '';
    for (const nombre of nombres) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'acr-tab' + (nombre === hojaActiva ? ' activa' : '');
      boton.setAttribute('role', 'tab');
      boton.innerHTML = '<span></span><small></small>';
      boton.querySelector('span').textContent = ETIQUETA_HOJA[nombre] || nombre;
      boton.querySelector('small').textContent = vistaPrevia.hojas[nombre].length;
      boton.addEventListener('click', () => {
        hojaActiva = nombre;
        renderVistaPrevia();
      });
      tabs.appendChild(boton);
    }

    const asesorPrevio = selectAsesor.value;
    const asesores = [...new Set(vistaPrevia.hojas[hojaActiva].map(f => f.valores[vistaPrevia.colAsesor]))]
      .sort((a, b) => String(a).localeCompare(String(b), 'es'));
    selectAsesor.innerHTML = '<option value="">Todos los asesores</option>';
    for (const asesor of asesores) {
      const opcion = document.createElement('option');
      opcion.value = asesor;
      opcion.textContent = asesor;
      selectAsesor.appendChild(opcion);
    }
    if (asesores.includes(asesorPrevio)) selectAsesor.value = asesorPrevio;

    $('acr-vacio').hidden = true;
    $('acr-preview').hidden = false;
    actualizarTabla();
  }

  selectAsesor.addEventListener('change', actualizarTabla);

  $('acr-seleccionar').addEventListener('click', () => {
    const tabla = $('acr-tabla-activa');
    if (!tabla) return;
    const seleccion = window.getSelection();
    seleccion.removeAllRanges();
    const rango = document.createRange();
    rango.selectNodeContents(tabla);
    seleccion.addRange(rango);
  });

  // ── Copiar como imagen (para WhatsApp) ──

  function tituloImagen() {
    const moneda = ETIQUETA_HOJA[hojaActiva] || hojaActiva;
    if (fechaDesde.value === fechaHasta.value) {
      return `${moneda} desde ${horaDesde.value} hasta ${horaHasta.value} — ${formatFechaDDMMYYYY(fechaDesde.value)}`;
    }
    return `${moneda} desde ${horaDesde.value} (${formatFechaDDMMYYYY(fechaDesde.value)}) `
      + `hasta ${horaHasta.value} (${formatFechaDDMMYYYY(fechaHasta.value)})`;
  }

  async function generarImagen(tabla, titulo) {
    const envoltorio = document.createElement('div');
    envoltorio.className = 'acr-captura';
    const encabezado = document.createElement('div');
    encabezado.className = 'acr-captura-titulo';
    encabezado.textContent = titulo;
    envoltorio.appendChild(encabezado);
    const clon = tabla.cloneNode(true);
    clon.querySelectorAll('.columna-hora').forEach(c => c.remove());
    envoltorio.appendChild(clon);
    document.body.appendChild(envoltorio);
    try {
      const canvas = await html2canvas(envoltorio, { backgroundColor: '#ffffff', scale: 2 });
      return await new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen.'))), 'image/png');
      });
    } finally {
      envoltorio.remove();
    }
  }

  async function copiarImagen(boton, tabla, nombreArchivo, etiquetaExito, titulo) {
    const textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Generando imagen…';
    try {
      const blob = await generarImagen(tabla, titulo);
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        mostrarMensaje(`${etiquetaExito} Pegala en WhatsApp con Ctrl+V.`, 'exito');
      } catch (err) {
        if (await guardarArchivo(blob, nombreArchivo)) {
          mostrarMensaje('No se pudo copiar la imagen al portapapeles; se guardó como archivo.', 'exito');
        }
      }
    } catch (err) {
      mostrarMensaje('No se pudo generar la imagen: ' + err.message, 'error');
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }

  function crearBotonImagen(etiqueta, tabla, nombreArchivo, etiquetaExito, titulo) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn-secundario';
    boton.textContent = etiqueta;
    boton.addEventListener('click', () => copiarImagen(boton, tabla, nombreArchivo, etiquetaExito, titulo));
    return boton;
  }

  // Con muchas órdenes, WhatsApp comprime una imagen muy alta y el texto queda ilegible:
  // pasado el umbral se arman dos imágenes más cortas.
  function actualizarBotonesImagen(filas) {
    const { encabezados, colImporte, colAsesor } = vistaPrevia;
    const titulo = tituloImagen();
    zonaImagen.innerHTML = '';
    if (filas.length > UMBRAL_DIVIDIR_IMAGEN) {
      const mitad = Math.ceil(filas.length / 2);
      const t1 = construirTabla(encabezados, filas.slice(0, mitad), colImporte, colAsesor);
      const t2 = construirTabla(encabezados, filas.slice(mitad), colImporte, colAsesor);
      zonaImagen.appendChild(crearBotonImagen('Copiar imagen 1', t1, 'acreditaciones-1.png', 'Imagen 1 copiada.', titulo));
      zonaImagen.appendChild(crearBotonImagen('Copiar imagen 2', t2, 'acreditaciones-2.png', 'Imagen 2 copiada.', titulo));
      notaImagen.textContent = `Son ${filas.length} órdenes: se arman 2 imágenes porque en una sola la calidad bajaría mucho.`;
      notaImagen.hidden = false;
    } else {
      const tabla = construirTabla(encabezados, filas, colImporte, colAsesor);
      zonaImagen.appendChild(crearBotonImagen('Copiar imagen', tabla, 'acreditaciones.png', 'Imagen copiada.', titulo));
      notaImagen.hidden = true;
    }
  }

  // ── Procesar ──

  async function procesar({ descargar }) {
    if (!archivoActual || procesando) return;
    procesando = true;
    const textoOriginal = btnDescargar.textContent;
    btnDescargar.disabled = true;
    btnDescargar.textContent = descargar ? 'Guardando…' : 'Procesando…';
    mostrarMensaje('', null);
    try {
      const resultado = await procesarAcreditaciones(await archivoActual.arrayBuffer(), {
        fechaDesde: fechaDesde.value,
        fechaHasta: fechaHasta.value,
        horaDesde: horaDesde.value,
        horaHasta: horaHasta.value
      });
      ultimoXlsx = resultado.xlsxBuffer;
      ultimoNombre = resultado.nombreArchivo;
      vistaPrevia = resultado.vistaPrevia;
      renderVistaPrevia();

      if (descargar) {
        const blob = new Blob([ultimoXlsx], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        if (await guardarArchivo(blob, ultimoNombre)) mostrarMensaje('Listo, se guardó el Excel procesado.', 'exito');
      }
    } catch (err) {
      console.error(err);
      mostrarMensaje(err.message, 'error');
    } finally {
      procesando = false;
      btnDescargar.disabled = false;
      btnDescargar.textContent = textoOriginal;
    }
  }

  function reprocesarConDemora() {
    clearTimeout(timerReprocesar);
    timerReprocesar = setTimeout(() => procesar({ descargar: false }), 300);
  }

  [fechaDesde, fechaHasta, horaDesde, horaHasta].forEach(c => c.addEventListener('change', reprocesarConDemora));

  document.querySelectorAll('.acr-atajo').forEach(boton => {
    boton.addEventListener('click', () => {
      const tipo = boton.dataset.atajo;
      const base = fechaHasta.value || fechaLocalISO(new Date());
      if (tipo === '10-13' || tipo === '13-16') {
        fechaDesde.value = base;
        fechaHasta.value = base;
        horaDesde.value = tipo === '10-13' ? '10:00' : '13:00';
        horaHasta.value = tipo === '10-13' ? '13:00' : '16:00';
      } else if (tipo === '16-10') {
        // Desde las 16 del día hábil anterior (viernes si hoy es lunes) hasta las 10 de hoy
        fechaDesde.value = sumarDias(base, esLunes(base) ? -3 : -1);
        fechaHasta.value = base;
        horaDesde.value = '16:00';
        horaHasta.value = '10:00';
      }
      procesar({ descargar: false });
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    procesar({ descargar: true });
  });
})();
