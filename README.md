# chrome-clean

Librería JavaScript para extensiones de Chrome Manifest V3. Limpia cookies, historial, caché y almacenamiento, y cierra pestañas o ventanas. Las operaciones se pueden ejecutar por separado o en una secuencia. El paquete funciona como módulo ES y no tiene dependencias de ejecución.

## Uso básico

```js
import { clearCache, clearHistory, closeTabs, run } from "chrome-clean";

await clearCache("https://app.example.com");
await clearHistory(30);
await closeTabs(/checkout|login/i);

const results = await run([
  ["closeTabs", "example.com"],
  ["clearCache", "open"],
  ["clearHistory", 15]
]);
```

En una extensión sin empaquetador, copia `src/` a un directorio de tu extensión e importa `index.js` mediante una ruta relativa. Usa el módulo desde una página de extensión o un service worker. Para pruebas de integración puedes crear una instancia con `createChromeClean(chromeApi)`.

## Selectores

| Selector | Significado |
| --- | --- |
| `"*"` | Todo el perfil regular accesible. Las páginas internas y de extensión se protegen al cerrar. |
| `"example.com"` | El dominio base y sus subdominios. |
| `"portal"`, `"*.example.com"` | Palabra clave o comodín sobre el hostname. |
| `"https://app.example.com:8443"` | Origen exacto para caché, almacenamiento, historial y pestañas. En cookies se usa el hostname. |
| `"active"`, `"open"` | Sitio de la pestaña activa o sitios de todas las pestañas web abiertas. En el cierre, `"active"` selecciona la pestaña o la ventana activa. |
| `"!example.com"` | Exclusión. En una lista se aplica después de unir las inclusiones. |
| `/checkout/i` | Expresión regular sobre la URL completa en historial y cierre. Sobre el hostname en los demás casos. |
| `30` | Últimos 30 minutos en los datos. En el cierre es un ID de pestaña o ventana. |
| `["a.example.com", "!b.example.com"]` | Lista de selectores. También se aceptan listas de IDs para el cierre. |

Los selectores omitidos o inválidos se rechazan antes de modificar el navegador. Una exclusión amplia sin coincidencias detectables devuelve un resultado sin cambios. Para limpiar todo, pasa `"*"` de forma explícita.

## Resultados

| Función | Resultado |
| --- | --- |
| `closeTabs`, `closeWindows` | Número de cierres. |
| `clearCookies`, `clearHistory` | Número de elementos eliminados o `null` si Chrome no ofrece un conteo. El historial selectivo cuenta URL. |
| `clearCache`, `clearStorage` | `true` si se ejecutó la limpieza, `false` si no hubo orígenes que limpiar. |
| `clean` | Objeto con `tabs`, `cookies`, `history`, `cache` y `storage`. Un selector temporal deja `tabs` en `0`. |
| `run` | Array ordenado de `{ op, result }`. Conserva una entrada por cada paso, incluso si se repite la operación. |

`ChromeCleanError` tiene un código y, cuando corresponda, incluye la operación, el índice del paso y los resultados completados. La instancia procesa una ejecución a la vez. `run` prepara los permisos y los orígenes de cada paso antes de ejecutar el primero.

## Permisos y cobertura

- Los orígenes exactos de caché y almacenamiento y las limpiezas globales o temporales de datos usan `browsingData`. [Datos de navegación](https://developer.chrome.com/docs/extensions/reference/api/browsingData)
- El historial selectivo usa `history`. Cada URL seleccionada se elimina con todas sus visitas. [Historial](https://developer.chrome.com/docs/extensions/reference/api/history#method-deleteUrl)
- Las cookies selectivas necesitan `cookies` y permisos de host. La librería enumera las cookies del almacén regular y consulta particiones identificables desde pestañas cuando Chrome expone esa API. Si un nombre y una URL coinciden con varias cookies, solo ejecuta el borrado cuando todas están dentro del alcance seleccionado. [Cookies](https://developer.chrome.com/docs/extensions/reference/api/cookies)
- El cierre requiere acceso a las URL de pestañas para proteger las internas. Chrome permite ese acceso mediante `tabs`, permisos de host o el contexto autorizado de `activeTab`. [Permisos de pestañas](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions)
- Los selectores que necesitan descubrir orígenes requieren al menos una fuente autorizada entre pestañas, cookies e historial. En caché y almacenamiento, las exclusiones por origen exacto pueden aplicarse al perfil. Una exclusión por palabra clave, dominio o patrón se aplica al conjunto de orígenes detectados. Una cookie puede aportar candidatos HTTP y HTTPS para un host, pero no identifica puertos adicionales. [Filtrado por origen](https://developer.chrome.com/docs/extensions/reference/api/browsingData#specific-origins)

`clearStorage` abarca `localStorage`, IndexedDB, CacheStorage, archivos del sitio y service workers. La caché HTTP tiene su propia función. La implementación trabaja en el perfil regular de Chrome.

## Desarrollo y ejemplo

Con Node.js 22 o posterior, ejecuta `npm ci` y `npm test`. Las pruebas usan APIs simuladas y se pueden ejecutar sin Chrome.

Para generar el ejemplo, ejecuta `npm run example`. En el gestor de extensiones de Chrome, activa el modo de desarrollador y carga `dist/extension` como extensión descomprimida. El botón limpia únicamente la caché HTTP del origen que escribas.

La [especificación](SPEC.md) explica el contrato de resolución y ejecución. El proyecto está preparado para alojarse como repositorio independiente. La licencia de distribución está pendiente de elección.
