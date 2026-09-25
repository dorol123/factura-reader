# Tenencia por Ticker

App de escritorio portable para Windows: elegís un ticker y muestra qué clientes lo tienen
(nombre, comitente y nominales).

- Es un único `.exe`, no se instala. Doble clic y abre.
- Usa el motor de Edge (WebView2) que ya trae Windows 10/11.
- Los datos se guardan **sólo en la PC de quien la usa**, en `%APPDATA%\TenenciaTicker\datos.json`.
  No hay servidores ni se envía nada por internet.

## Uso

1. Exportá el Excel desde **Planning Individuos 2 → Tablero general → Tenencia por ticker**.
2. Abrí `TenenciaTicker.exe` y cargá el Excel (botón *Cargar Excel* o arrastrándolo a la ventana).
3. Elegí un ticker de la lista (se puede buscar por ticker o nombre del instrumento).
4. Hacé clic en los encabezados de la tabla para ordenar.

Al volver a abrir la app, los últimos datos cargados ya están. Cargar un Excel nuevo reemplaza al anterior.

La primera vez Windows puede mostrar *"Windows protegió su PC"* porque el `.exe` no está firmado:
*Más información → Ejecutar de todas formas*.

## Desarrollo

Hecha con [Neutralinojs](https://neutralino.js.org) + [SheetJS](https://sheetjs.com) para leer Excel.

```bash
npm i -g @neutralinojs/neu
neu update                              # descarga binarios y neutralino.js
neu run                                 # abre la app en modo desarrollo
neu build --release --embed-resources   # genera dist/TenenciaTicker/TenenciaTicker-win_x64.exe
```

También se puede abrir `resources/index.html` desde un servidor estático cualquiera;
en ese caso los datos se guardan en el `localStorage` del navegador.

### Estructura

- `resources/index.html`, `styles.css`: interfaz
- `resources/app.js`: lectura del Excel, agrupación por ticker y tabla
- `resources/storage.js`: guardado local de los datos
- `resources/lib/xlsx.full.min.js`: SheetJS 0.20.3
