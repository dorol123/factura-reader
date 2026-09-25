// Navegación entre secciones de Valiu (barra superior)

(() => {
  const CLAVE = 'valiu-seccion';

  function mostrar(seccion) {
    document.body.dataset.seccion = seccion;
    document.querySelectorAll('.seccion').forEach(el => {
      el.hidden = el.id !== `seccion-${seccion}`;
    });
    document.querySelectorAll('.seccion-tab').forEach(tab => {
      tab.classList.toggle('activa', tab.dataset.seccion === seccion);
      tab.setAttribute('aria-current', tab.dataset.seccion === seccion ? 'page' : 'false');
    });
    // El Excel de tenencia sirve para las dos secciones de tenencia
    document.getElementById('acciones-tenencia').hidden = !['tenencia', 'clientes'].includes(seccion);
    try { localStorage.setItem(CLAVE, seccion); } catch (err) { /* sin almacenamiento */ }
  }

  document.querySelectorAll('.seccion-tab').forEach(tab => {
    tab.addEventListener('click', () => mostrar(tab.dataset.seccion));
  });

  let inicial = 'tenencia';
  try { inicial = localStorage.getItem(CLAVE) || inicial; } catch (err) { /* sin almacenamiento */ }
  mostrar(document.getElementById(`seccion-${inicial}`) ? inicial : 'tenencia');

  // Enlaces externos (Power BI, etc.): en la app de escritorio se abren en el navegador de Windows
  document.addEventListener('click', e => {
    const enlace = e.target.closest('a[data-externo]');
    if (!enlace || typeof window.NL_OS === 'undefined') return;
    e.preventDefault();
    Neutralino.os.open(enlace.href);
  });
})();
