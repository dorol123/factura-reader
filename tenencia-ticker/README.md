# Valiu

App de escritorio portable para Windows con dos secciones:

- **Tenencia por ticker**: elegís un ticker y muestra qué clientes lo tienen (nombre, comitente, nominales y valor en USD).
- **Tenencia por cliente**: con el mismo Excel, lista los clientes ordenados por AUM y muestra las posiciones de cada uno
  (ticker, nominales, valor en USD y % de su cartera).
- **Acreditaciones**: procesa el Excel de acreditaciones (el mismo motor del Procesador de Acreditaciones):
  filtra por rango de fecha/hora, separa Pesos y Dólares, resalta importes altos, copia la tabla como imagen
  para WhatsApp y guarda el Excel procesado.

- Es un único `.exe`, no se instala. Doble clic y abre.
- Usa el motor de Edge (WebView2) que ya trae Windows 10/11.
- Los datos se guardan **sólo en la PC de quien la usa**, en `%APPDATA%\Valiu\datos.json`.
  No hay servidores ni se envía nada por internet.

## Uso

1. Exportá el Excel desde **Planning Individuos 2 → Tablero general → Tenencia por ticker**.
2. Abrí `Valiu.exe` y cargá el Excel (botón *Cargar Excel* o arrastrándolo a la ventana).
3. Elegí un ticker de la lista (se puede buscar por ticker o nombre del instrumento).
4. Hacé clic en los encabezados de la tabla para ordenar.

**Asesor:** después de la primera carga, Valiu pide *Seleccione asesor* (con buscador; la lista sale de la columna
"Asesor" del Excel, más la opción *Todos*). Las dos secciones de tenencia muestran sólo los clientes de ese asesor.
La elección queda guardada en `%APPDATA%\Valiu\config.json` y se cambia desde arriba a la derecha. Si un Excel nuevo no
trae al asesor guardado, vuelve a preguntar.

Acreditaciones: cargá el Excel, elegí el rango (o un atajo: 10 a 13, 13 a 16, 16 del día hábil anterior a 10),
revisá la vista previa y usá *Copiar imagen* o *Descargar Excel procesado*. Estos archivos no se guardan en la app.

Al volver a abrir la app, los últimos datos cargados ya están. Cada Excel que cargás queda en un historial y la app
muestra siempre el último; con *Borrar datos* ves todas las cargas (archivo, fecha y hora) y podés borrar cualquiera.

La primera vez Windows puede mostrar *"Windows protegió su PC"* porque el `.exe` no está firmado:
*Más información → Ejecutar de todas formas*.

## Desarrollo

Hecha con [Neutralinojs](https://neutralino.js.org) + [SheetJS](https://sheetjs.com) para leer Excel.

```bash
npm i -g @neutralinojs/neu
neu update                              # descarga binarios y neutralino.js
neu run                                 # abre la app en modo desarrollo
neu build --release --embed-resources   # genera dist/Valiu/Valiu-win_x64.exe
```

También se puede abrir `resources/index.html` desde un servidor estático cualquiera;
en ese caso los datos se guardan en el `localStorage` del navegador.

### Estructura

- `resources/index.html`, `styles.css`: interfaz
- `resources/secciones.js`: navegación entre secciones
- `resources/app.js`: tenencia por ticker (lectura del Excel, agrupación y tabla)
- `resources/acreditaciones-motor.js`: motor de acreditaciones (copiado sin cambios del Procesador de Acreditaciones)
- `resources/acreditaciones.js`: pantalla de acreditaciones
- `resources/storage.js`: guardado local de los datos
- `resources/lib/xlsx.full.min.js`: SheetJS 0.20.3
- `resources/lib/exceljs.min.js`, `jszip.min.js`, `html2canvas.min.js`: usados por acreditaciones
- `resources/fonts/sora-700.woff2`: tipografía del logo (Sora, licencia OFL)
