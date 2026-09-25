// Guarda los datos cargados sólo en esta PC.
// En la app de escritorio: %APPDATA%\TenenciaTicker\datos.json
// En un navegador (para desarrollo): localStorage.

const Storage = (() => {
  const esApp = typeof window.NL_OS !== 'undefined';
  const CLAVE = 'tenencia-ticker-datos';
  let carpeta = null;

  async function rutaArchivo() {
    if (!carpeta) {
      const data = await Neutralino.os.getPath('data');
      carpeta = `${data}/TenenciaTicker`;
      try {
        await Neutralino.filesystem.createDirectory(carpeta);
      } catch (err) {
        // ya existe
      }
    }
    return `${carpeta}/datos.json`;
  }

  async function leer() {
    try {
      const texto = esApp
        ? await Neutralino.filesystem.readFile(await rutaArchivo())
        : localStorage.getItem(CLAVE);
      return texto ? JSON.parse(texto) : null;
    } catch (err) {
      return null;
    }
  }

  async function guardar(datos) {
    const texto = JSON.stringify(datos);
    if (esApp) await Neutralino.filesystem.writeFile(await rutaArchivo(), texto);
    else localStorage.setItem(CLAVE, texto);
  }

  return { esApp, leer, guardar };
})();
