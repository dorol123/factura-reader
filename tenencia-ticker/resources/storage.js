// Guarda los datos cargados sólo en esta PC.
// En la app de escritorio: %APPDATA%\Valiu\datos.json
// En un navegador (para desarrollo): localStorage.

const Storage = (() => {
  const esApp = typeof window.NL_OS !== 'undefined';
  const CLAVE = 'tenencia-ticker-datos';
  let carpeta = null;

  async function rutaArchivo() {
    if (!carpeta) {
      const data = await Neutralino.os.getPath('data');
      carpeta = `${data}/Valiu`;
      try {
        await Neutralino.filesystem.createDirectory(carpeta);
      } catch (err) {
        // ya existe
      }
    }
    return `${carpeta}/datos.json`;
  }

  async function leerArchivo(ruta) {
    try {
      return JSON.parse(await Neutralino.filesystem.readFile(ruta));
    } catch (err) {
      return null;
    }
  }

  async function leer() {
    if (!esApp) {
      try {
        const texto = localStorage.getItem(CLAVE);
        return texto ? JSON.parse(texto) : null;
      } catch (err) {
        return null;
      }
    }
    const datos = await leerArchivo(await rutaArchivo());
    if (datos) return datos;
    // Datos guardados por la versión anterior (TenenciaTicker): se migran a Valiu
    const anterior = await leerArchivo(`${await Neutralino.os.getPath('data')}/TenenciaTicker/datos.json`);
    if (anterior) await guardar(anterior);
    return anterior;
  }

  async function guardar(datos) {
    const texto = JSON.stringify(datos);
    if (esApp) await Neutralino.filesystem.writeFile(await rutaArchivo(), texto);
    else localStorage.setItem(CLAVE, texto);
  }

  // Configuración del usuario (por ejemplo, el asesor elegido): %APPDATA%\Valiu\config.json
  const CLAVE_CONFIG = 'valiu-config';

  async function leerConfig() {
    if (!esApp) {
      try {
        return JSON.parse(localStorage.getItem(CLAVE_CONFIG)) || {};
      } catch (err) {
        return {};
      }
    }
    await rutaArchivo();
    return (await leerArchivo(`${carpeta}/config.json`)) || {};
  }

  async function guardarConfig(config) {
    const texto = JSON.stringify(config);
    if (esApp) {
      await rutaArchivo();
      await Neutralino.filesystem.writeFile(`${carpeta}/config.json`, texto);
    } else {
      try { localStorage.setItem(CLAVE_CONFIG, texto); } catch (err) { /* sin almacenamiento */ }
    }
  }

  return { esApp, leer, guardar, leerConfig, guardarConfig };
})();
