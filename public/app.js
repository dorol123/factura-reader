let stream = null;
let fotoBlob = null;
let archivoBlob = null;
let facturas = [];
let cropper = null;
let cropCallback = null;
let facturaCounter = 0;

document.addEventListener('DOMContentLoaded', async () => {
  // Login
  if (!sessionStorage.getItem('loggedIn')) {
    document.getElementById('login-overlay').style.display = 'flex';
  } else {
    document.getElementById('login-overlay').style.display = 'none';
  }

  await cargarFacturasDB();
  renderTabla();
  activarTab('archivo');
  document.getElementById('hora-carga').textContent = '25/04/2026 16:45';
  generarCoffeeBar();
});

// ── Login ──

function loginCheck() {
  const val = document.getElementById('login-input').value;
  if (val === '123') {
    sessionStorage.setItem('loggedIn', 'true');
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('login-error').textContent = '';
  } else {
    document.getElementById('login-error').textContent = 'Contraseña incorrecta';
    document.getElementById('login-input').value = '';
    document.getElementById('login-input').focus();
  }
}

// ── Base de datos ──

async function cargarFacturasDB() {
  try {
    const res = await fetch('/api/facturas');
    const rows = await res.json();
    facturas = rows.map(row => ({
      _id:           row.id,
      _numero:       row.numero,
      _nombre_custom: row.nombre_custom,
      factura:       row.factura_code,
      productos:     row.productos || [],
      total:         parseFloat(row.total) || 0
    }));
    facturaCounter = facturas.length > 0 ? Math.max(...facturas.map(f => f._numero)) : 0;
  } catch (e) {
    console.error('Error cargando facturas:', e);
    facturas = [];
  }
}

async function guardarFacturaDB({ numero, factura_code, nombre_custom, productos, total }) {
  const res = await fetch('/api/facturas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero, factura_code, nombre_custom, productos, total })
  });
  return await res.json();
}

// ── Coffee bar ──

function generarCoffeeBar() {
  const iconos = ['☕', '🫘', '☕', '🫘', '☕', '🫘', '☕', '🫘', '☕', '🫘', '☕', '🫘', '☕', '🫘', '☕', '🫘', '☕', '🫘', '☕', '🫘'];
  const base = iconos.map(i => `<span style="padding:0 14px;opacity:0.75">${i}</span>`).join('');
  const el = document.getElementById('coffee-icons');
  el.innerHTML = base + base;
}

// ── Toast duplicado ──

function mostrarToastDuplicado() {
  const toast = document.getElementById('toast-duplicado');
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 4500);
}

// ── Tabs ──

function showTab(tab) { activarTab(tab); }

function activarTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  document.getElementById('tab-' + tab).style.display = 'block';
  document.querySelectorAll('.tab').forEach(t => {
    if (t.getAttribute('onclick') === `showTab('${tab}')`) t.classList.add('active');
  });
  if (tab === 'camara' && esMobil()) iniciarCamara();
}

function esMobil() { return window.innerWidth <= 640; }

// ── Cámara ──

async function iniciarCamara() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    if (esMobil()) {
      document.getElementById('camara-overlay').style.display = 'flex';
      document.getElementById('video-fullscreen').srcObject = stream;
    } else {
      document.getElementById('video').srcObject = stream;
      document.getElementById('btn-foto').disabled = false;
      document.getElementById('btn-camara').textContent = 'Activa ✓';
      document.getElementById('btn-camara').disabled = true;
    }
  } catch (e) {
    alert('No se pudo acceder a la cámara: ' + e.message);
  }
}

function capturarFullscreen() {
  const video = document.getElementById('video-fullscreen');
  const canvas = document.getElementById('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  cerrarCamaraFullscreen();
  canvas.toBlob(blob => {
    abrirRecorte(blob, (croppedBlob) => {
      fotoBlob = croppedBlob;
      document.getElementById('preview-foto').src = URL.createObjectURL(croppedBlob);
      document.getElementById('preview-foto').style.display = 'block';
      document.getElementById('nombre-wrap-foto').style.display = 'flex';
      document.getElementById('btn-analizar-foto').style.display = 'block';
    });
  }, 'image/jpeg', 0.9);
}

function cerrarCamaraFullscreen() {
  document.getElementById('camara-overlay').style.display = 'none';
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  document.getElementById('btn-camara').textContent = 'Activar';
  document.getElementById('btn-camara').disabled = false;
}

function tomarFoto() {
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob(blob => {
    abrirRecorte(blob, (croppedBlob) => {
      fotoBlob = croppedBlob;
      document.getElementById('preview-foto').src = URL.createObjectURL(croppedBlob);
      document.getElementById('preview-foto').style.display = 'block';
      document.getElementById('nombre-wrap-foto').style.display = 'flex';
      document.getElementById('btn-analizar-foto').style.display = 'block';
    });
  }, 'image/jpeg', 0.9);
}

function archivoSeleccionado(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.type === 'application/pdf') {
    archivoBlob = file;
    document.getElementById('nombre-archivo').textContent = '📄 ' + file.name;
    document.getElementById('btn-preview-archivo').style.display = 'inline-flex';
    document.getElementById('nombre-wrap-archivo').style.display = 'flex';
    document.getElementById('btn-analizar-archivo').style.display = 'block';
    return;
  }
  abrirRecorte(file, (croppedBlob) => {
    archivoBlob = croppedBlob;
    document.getElementById('nombre-archivo').textContent = '🖼️ ' + file.name + ' (recortada)';
    document.getElementById('btn-preview-archivo').style.display = 'inline-flex';
    document.getElementById('nombre-wrap-archivo').style.display = 'flex';
    document.getElementById('btn-analizar-archivo').style.display = 'block';
  });
}

function previsualizarArchivo() {
  if (!archivoBlob) return;
  const url = URL.createObjectURL(archivoBlob);
  window.open(url, '_blank');
}

// ── Recortador ──

function abrirRecorte(blob, callback) {
  cropCallback = callback;
  const img = document.getElementById('crop-image');
  if (cropper) { cropper.destroy(); cropper = null; }
  img.src = URL.createObjectURL(blob);
  document.getElementById('crop-overlay').style.display = 'flex';
  img.onload = () => {
    cropper = new Cropper(img, { viewMode: 1, autoCropArea: 0.85, responsive: true, movable: true, zoomable: true, rotatable: false });
  };
}

function confirmarRecorte() {
  if (!cropper) return;
  cropper.getCroppedCanvas({ maxWidth: 2048, maxHeight: 2048 }).toBlob(blob => {
    const cb = cropCallback;
    cancelarRecorte();
    cb(blob);
  }, 'image/jpeg', 0.92);
}

function cancelarRecorte() {
  document.getElementById('crop-overlay').style.display = 'none';
  if (cropper) { cropper.destroy(); cropper = null; }
  cropCallback = null;
}

// ── Análisis ──

async function analizarFoto() {
  if (!fotoBlob) return;
  const nombreCustom = document.getElementById('input-nombre-foto').value.trim();
  await enviar(fotoBlob, 'foto.jpg', nombreCustom);
}

async function analizarArchivo() {
  if (!archivoBlob) return;
  const nombreCustom = document.getElementById('input-nombre-archivo').value.trim();
  await enviar(archivoBlob, archivoBlob.name || 'imagen.jpg', nombreCustom);
}

async function enviar(blob, nombre, nombreCustom = '') {
  mostrarLoader(true);
  try {
    // 1. Parsear con IA
    const form = new FormData();
    form.append('file', blob, nombre);
    const res = await fetch('/api/scan', { method: 'POST', body: form });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch {
      alert('Error del servidor. Intentá con un PDF en lugar de foto.');
      return;
    }
    if (data.error) { alert('Error: ' + data.error); return; }

    // Detección de duplicado
    if (data.factura && data.factura !== 'Sin identificar') {
      if (facturas.some(f => f.factura === data.factura)) mostrarToastDuplicado();
    }

    // 2. Guardar en DB
    facturaCounter++;
    const saved = await guardarFacturaDB({
      numero:        facturaCounter,
      factura_code:  data.factura,
      nombre_custom: nombreCustom || null,
      productos:     data.productos,
      total:         data.total
    });

    facturas.push({
      _id:            saved.id,
      _numero:        saved.numero,
      _nombre_custom: (saved && saved.nombre_custom != null) ? saved.nombre_custom : (nombreCustom || null),
      factura:        saved.factura_code,
      productos:      saved.productos || data.productos,
      total:          parseFloat(saved.total) || data.total
    });

    renderTabla();

    // Limpiar controles
    document.getElementById('nombre-archivo').textContent = '';
    document.getElementById('btn-preview-archivo').style.display = 'none';
    document.getElementById('btn-analizar-archivo').style.display = 'none';
    document.getElementById('nombre-wrap-archivo').style.display = 'none';
    document.getElementById('input-nombre-archivo').value = '';
    document.getElementById('input-archivo').value = '';
    document.getElementById('nombre-wrap-foto').style.display = 'none';
    document.getElementById('input-nombre-foto').value = '';
    archivoBlob = null;
    fotoBlob = null;
    document.getElementById('preview-foto').style.display = 'none';
    document.getElementById('btn-analizar-foto').style.display = 'none';
  } catch (e) {
    alert('Error de conexión: ' + e.message);
  } finally {
    mostrarLoader(false);
  }
}

// ── Tabla ──

function renderTabla() {
  const wrap = document.getElementById('lista-productos-wrap');
  wrap.innerHTML = '';

  if (facturas.length === 0) {
    wrap.innerHTML = `<div class="empty-msg"><span>📋</span><p>Cargá una factura para ver los productos acá</p></div>`;
    document.getElementById('total-general').textContent = '$0,00';
    document.getElementById('cant-facturas').textContent = '0';
    document.getElementById('cant-productos').textContent = '0';
    return;
  }

  const tabla = document.createElement('table');
  tabla.className = 'tabla-productos';
  tabla.innerHTML = `<thead><tr><th>Producto</th><th>Cantidad</th><th>P. Unitario</th><th>P. Total</th></tr></thead>`;

  const tbody = document.createElement('tbody');
  let totalGeneral = 0;
  let totalProductos = 0;

  facturas.forEach((factura) => {
    const displayName = factura._nombre_custom || `Factura ${factura._numero}`;
    const seccion = document.createElement('tr');
    seccion.className = 'seccion-factura';
    seccion.innerHTML = `<td colspan="4">${displayName}</td>`;
    tbody.appendChild(seccion);

    (factura.productos || []).forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.nombre}</td>
        <td class="td-cantidad">${p.cantidad ?? '-'}</td>
        <td>${formatPrecio(p.precio_unitario)}</td>
        <td>${formatPrecio(p.precio_total ?? p.precio_unitario)}</td>
      `;
      tbody.appendChild(tr);
      totalProductos++;
    });

    totalGeneral += factura.total ?? sumarProductos(factura.productos) ?? 0;
  });

  tabla.appendChild(tbody);
  wrap.appendChild(tabla);

  document.getElementById('total-general').textContent = formatPrecio(totalGeneral);
  document.getElementById('cant-facturas').textContent = facturas.length;
  document.getElementById('cant-productos').textContent = totalProductos;
}

function sumarProductos(productos) {
  if (!productos) return 0;
  return productos.reduce((acc, p) => acc + (p.precio_total ?? p.precio_unitario ?? 0), 0);
}

function formatPrecio(valor) {
  if (valor === null || valor === undefined) return '-';
  return '$' + Number(valor).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mostrarLoader(show) {
  document.getElementById('loader').style.display = show ? 'block' : 'none';
}

async function limpiar() {
  if (!confirm('¿Limpiar todas las facturas guardadas?')) return;
  try {
    await fetch('/api/facturas', { method: 'DELETE' });
    facturas = [];
    facturaCounter = 0;
    renderTabla();
    document.getElementById('preview-foto').style.display = 'none';
    document.getElementById('btn-analizar-foto').style.display = 'none';
    document.getElementById('nombre-wrap-foto').style.display = 'none';
    document.getElementById('input-nombre-foto').value = '';
    document.getElementById('nombre-archivo').textContent = '';
    document.getElementById('btn-analizar-archivo').style.display = 'none';
    document.getElementById('nombre-wrap-archivo').style.display = 'none';
    document.getElementById('input-nombre-archivo').value = '';
    document.getElementById('input-archivo').value = '';
  } catch (e) {
    alert('Error al limpiar: ' + e.message);
  }
}

// ── Mis Facturas ──

function abrirMisFacturas() {
  renderMisFacturas();
  document.getElementById('modal-facturas').style.display = 'flex';
}

function cerrarMisFacturas() {
  document.getElementById('modal-facturas').style.display = 'none';
}

function renderMisFacturas() {
  const lista = document.getElementById('lista-mis-facturas');
  if (facturas.length === 0) {
    lista.innerHTML = '<p class="mis-facturas-empty">No hay facturas guardadas aún</p>';
    return;
  }
  lista.innerHTML = facturas.map((f, i) => {
    const nombre = f._nombre_custom || `Factura ${f._numero}`;
    const sub = f._nombre_custom ? `<span class="mf-sub">#${f.factura}</span>` : '';
    return `
      <div class="mis-facturas-item" id="mf-item-${i}">
        <div class="mf-info">
          <span class="mf-nombre" id="mf-nombre-${i}">${nombre}</span>
          ${sub}
        </div>
        <div class="mf-acciones">
          <button onclick="verFactura(${i})" class="btn-mf-ver" title="Ver productos">👁️</button>
          <button onclick="editarNombreFactura(${i})" class="btn-mf-edit" title="Renombrar">✏️</button>
          <button onclick="eliminarFactura(${i})" class="btn-mf-delete" title="Eliminar">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function editarNombreFactura(i) {
  const actual = facturas[i]._nombre_custom || `Factura ${facturas[i]._numero}`;
  const nombreEl = document.getElementById(`mf-nombre-${i}`);
  nombreEl.outerHTML = `
    <div class="mf-edit-row" id="mf-nombre-${i}">
      <input type="text" id="mf-input-${i}" class="mf-edit-input" value="${actual}" maxlength="40">
      <button onclick="guardarNombreFactura(${i})" class="btn-mf-save">✓</button>
      <button onclick="renderMisFacturas()" class="btn-mf-cancel">✕</button>
    </div>
  `;
  const inp = document.getElementById(`mf-input-${i}`);
  inp.focus();
  inp.select();
}

async function guardarNombreFactura(i) {
  const val = document.getElementById(`mf-input-${i}`).value.trim();
  try {
    await fetch(`/api/facturas/${facturas[i]._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre_custom: val || null })
    });
    facturas[i]._nombre_custom = val || null;
    renderMisFacturas();
    renderTabla();
  } catch (e) {
    alert('Error al renombrar: ' + e.message);
  }
}

function verFactura(i) {
  const f = facturas[i];
  const nombre = f._nombre_custom || `Factura ${f._numero}`;
  document.getElementById('ver-factura-titulo').textContent = nombre;
  const contenido = document.getElementById('ver-factura-contenido');
  if (!f.productos || f.productos.length === 0) {
    contenido.innerHTML = '<p class="ver-empty">Sin productos registrados</p>';
  } else {
    contenido.innerHTML = `
      <table class="ver-tabla">
        <thead><tr><th>Producto</th><th>Cant.</th><th>Total</th></tr></thead>
        <tbody>
          ${f.productos.map(p => `
            <tr>
              <td>${p.nombre}</td>
              <td class="td-cantidad">${p.cantidad ?? '-'}</td>
              <td>${formatPrecio(p.precio_total ?? p.precio_unitario)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="ver-total">Total: ${formatPrecio(f.total)}</div>
    `;
  }
  document.getElementById('modal-ver-factura').style.display = 'flex';
}

function cerrarVerFactura() {
  document.getElementById('modal-ver-factura').style.display = 'none';
}

async function eliminarFactura(i) {
  try {
    await fetch(`/api/facturas/${facturas[i]._id}`, { method: 'DELETE' });
    facturas.splice(i, 1);
    renderMisFacturas();
    renderTabla();
  } catch (e) {
    alert('Error al eliminar: ' + e.message);
  }
}
