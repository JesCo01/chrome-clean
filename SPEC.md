# Propuesta de chrome-clean para limpiar el navegador

`chrome-clean` será una librería JavaScript independiente para extensiones de Chrome. Cada función recibe un solo argumento obligatorio. El desarrollador puede pasar un dominio, una palabra clave, el contexto de las pestañas, un número o una lista. La librería resuelve el alcance y elige la API de Chrome correspondiente.

## API pública

| Función | Operación |
| --- | --- |
| `clearCookies(selector)` | Quita cookies del alcance indicado. |
| `clearHistory(selector)` | Borra el historial del alcance indicado. |
| `clearCache(selector)` | Limpia la caché HTTP del navegador. |
| `clearStorage(selector)` | Limpia datos persistentes del sitio, como `localStorage`, IndexedDB y `CacheStorage`, y elimina sus service workers dentro del alcance admitido. |
| `closeTabs(selector)` | Cierra las pestañas web que coinciden y conserva las protegidas. |
| `closeWindows(selector)` | Cierra las ventanas que coinciden siempre que se puedan cerrar todas sus pestañas. |
| `clean(selector)` | Combina cierre de pestañas, cookies, historial, caché y almacenamiento. Con un número ejecuta únicamente limpiezas por tiempo. |
| `run(pasos)` | Ejecuta una secuencia de pares `[operacion, selector]` en orden. |

## Cómo se interpreta el argumento

| Argumento | Interpretación |
| --- | --- |
| `"*"` | Selecciona explícitamente todo el perfil accesible. En el cierre, aplica las protecciones de pestañas y ventanas. |
| Omitido, `undefined` o `null` | Lanza un error de entrada antes de llamar a Chrome. |
| `"ejemplo.com"` | Coincide con ese dominio y sus subdominios. `"https://app.ejemplo.com:8443"` permite indicar un origen concreto cuando la operación admite ese nivel de precisión. |
| `"portal"` | Busca esa palabra en nombres de host disponibles. El texto en títulos, rutas o parámetros queda fuera de esta comparación. |
| `"*.ejemplo.com"` o `"*portal*"` | Aplica el comodín al nombre de host. `"*.ejemplo.com"` selecciona los subdominios y el selector `"ejemplo.com"` incluye también el dominio base. |
| `"!google.com"` | Protege los elementos que coinciden con ese selector. La operación usa el complemento dentro del alcance que admite Chrome. |
| `"active"` | Usa el sitio de la pestaña web activa en la ventana enfocada. `closeTabs("active")` apunta a esa pestaña y `closeWindows("active")` apunta a su ventana. |
| `"open"` | Obtiene los sitios de las pestañas web abiertas y usa esa lista como alcance. |
| `30` | Un entero positivo significa últimos 30 minutos en las funciones de datos y `clean`. En `closeTabs` o `closeWindows`, el número es el ID. |
| `["a.com", "b.com"]` o `[12, 15]` | Une los sitios indicados o los IDs en una operación de cierre. |
| `["google.com", "!mail.google.com"]` | Parte de las inclusiones y resta todas las exclusiones. Si todos los elementos empiezan con `!`, parte del alcance disponible para esa operación. |
| `/checkout\|login/i` | Compara la URL completa en historial y pestañas. `closeWindows` aplica la misma comparación a las pestañas de cada ventana. En cookies, caché y almacenamiento compara el nombre de host. |
| `[["closeTabs", "portal"], ["clearCookies", 30]]` | Ejecuta una secuencia mediante `run`. Cada paso requiere un selector. Los nombres abreviados `tabs`, `windows`, `cookies`, `history`, `cache` y `storage` equivalen a sus funciones públicas. |

Una lista vacía, un número menor o igual a cero o un número que no sea un entero seguro lanza un error de entrada. La validación también se aplica a los elementos de listas y secuencias. Si un selector válido no encuentra coincidencias, la operación termina sin cambios. Una exclusión sin resolver conserva su alcance y jamás se sustituye por `"*"`. Cuando la pestaña activa es interna o su URL no está disponible, `"active"` queda sin un sitio resuelto.

Para apuntar solo al host raíz, usa un origen exacto donde esté admitido o una expresión regular anclada al campo que evalúa la operación. Por ejemplo, `/^ejemplo\.com$/i` coincide con el nombre de host y `/^https?:\/\/ejemplo\.com(?::\d+)?(?:[/?#]|$)/i` coincide con las URL de ese host.

## Ejemplos de uso

```js
import {
  clean, clearCookies, clearHistory, clearCache, clearStorage,
  closeTabs, closeWindows, run
} from "chrome-clean";

await clean("*");                                  // Preparación global del perfil
await clearCache("*");                             // Solo caché, en todo el perfil
await clearStorage("portal");                    // Orígenes detectados por nombre
await clean("active");                             // Preparación para el sitio activo
await clearCookies("!google.com");                 // Exclusión por dominio
await closeTabs("youtube");                       // Pestañas por palabra clave
await closeTabs(["google.com", "!mail.google.com"]); // Incluye Google y conserva Gmail
await closeTabs(/checkout|login/i);                 // Busca en la URL completa
await clearHistory(60);                            // Últimos 60 minutos
await clean(15);                                    // Limpieza por tiempo
await closeTabs([482, 485]);                        // Pestañas por ID
await closeWindows(12);                             // Ventana por ID
```

```js
const resultados = await run([
  ["closeTabs", "portal"],
  ["clearCookies", ["!google.com", "!ejemplo.com"]],
  ["clearCookies", 15],
  ["clearCache", /portal|cuenta/i]
]);

// Ejemplo de resultado en el mismo orden
// [
//   { op: "closeTabs", result: 3 },
//   { op: "clearCookies", result: 18 },
//   { op: "clearCookies", result: null },
//   { op: "clearCache", result: true }
// ]
```

## Alcance real en Chrome

### Descubrir objetivos sin listas manuales

`resolveArg` traduce los argumentos a objetivos concretos. Para palabras clave y comodines, la librería busca nombres de host y orígenes en las pestañas, las cookies y el historial que puede consultar. Los dominios se comparan por etiquetas completas. `ejemplo.com` incluye `app.ejemplo.com` y deja fuera `otroejemplo.com`. Para caché y almacenamiento se conservan el esquema y el puerto de cada origen conocido. El dominio de una cookie permite detectar el host, mientras que las URL de pestañas e historial permiten identificar orígenes completos.

El descubrimiento se limita a lo que la extensión puede observar. Un CDN con un nombre distinto al de la marca queda fuera de una búsqueda por palabra clave, salvo que el selector también lo identifique. Chrome permite filtrar caché y almacenamiento por orígenes concretos. El universo detectado puede dejar fuera sitios que solo tienen datos guardados y no aparecen en las fuentes consultadas. [Filtrado por origen en Chrome](https://developer.chrome.com/docs/extensions/reference/api/browsingData#specific-origins)

`clearCache("https://app.ejemplo.com")` y `clearStorage("https://app.ejemplo.com")` usan el origen dado con el permiso `browsingData`. Una palabra clave, comodín u otro selector que deba descubrir orígenes exige al menos una fuente autorizada. Puede ser acceso a las URL de pestañas, permiso `cookies` con acceso a los sitios correspondientes o permiso `history`. Si falta toda fuente utilizable, se lanza un error de permisos antes de borrar. Una fuente autorizada que respondió correctamente sin coincidencias sí permite devolver `false` en caché y almacenamiento. [Permiso de datos de navegación](https://developer.chrome.com/docs/extensions/reference/api/browsingData#permissions) · [Acceso a URL de pestañas](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions) · [Permisos de cookies](https://developer.chrome.com/docs/extensions/reference/api/cookies#permissions) · [Permiso de historial](https://developer.chrome.com/docs/extensions/reference/api/history#permissions)

### Exclusiones y cookies compartidas

Para pestañas e historial, la librería filtra los elementos visibles antes de actuar. Para cookies enumeradas, respeta dominio, ruta, almacén y, cuando se pueda consultar, partición. Una exclusión por dominio protege también sus cookies compartidas cuando aplican a los sitios excluidos. Si un nombre y una URL coinciden con varias cookies, se informa la ambigüedad cuando alguna queda fuera del alcance seleccionado. `chrome.cookies` solo puede consultar los sitios autorizados y, por defecto, trabaja con cookies sin particionar. [Cookies y particiones en Chrome](https://developer.chrome.com/docs/extensions/reference/api/cookies#partitioning)

Para caché y almacenamiento, una exclusión de orígenes exactos puede aplicarse al perfil mediante `excludeOrigins`. Una exclusión amplia como `"!google.com"` se aplica al inventario detectado y envía a Chrome únicamente los orígenes incluidos. Esto evita que el borrado global alcance un origen protegido que no se pudo descubrir. En esta operación, `true` indica que Chrome aceptó la limpieza del alcance aplicable. [Opciones de borrado por origen](https://developer.chrome.com/docs/extensions/reference/api/browsingData#type-RemovalOptions)

### Limpieza por tiempo

Un entero positivo se convierte a un límite `since` en milisegundos para las limpiezas nativas compatibles. Si el cálculo produciría un límite fuera del intervalo válido, se lanza un error de entrada. `clearHistory(60)` puede usar `history.deleteRange` con el intervalo calculado. El borrado por URL se usa para historial por sitio y elimina todas las visitas de esa URL. La primera versión mantiene separadas ambas operaciones. Para caché y almacenamiento rige la semántica temporal que Chrome aplica a cada tipo. [Opciones temporales de Chrome](https://developer.chrome.com/docs/extensions/reference/api/browsingData#type-RemovalOptions) · [Borrado de historial por intervalo y URL](https://developer.chrome.com/docs/extensions/reference/api/history#method-deleteRange)

### Cierre de pestañas y ventanas

Se conservan las páginas internas del navegador, las de extensión y las pestañas nuevas. Para cerrar por dominio, la librería vuelve a comprobar la URL antes de actuar. Si una ventana contiene una pestaña protegida, `closeWindows` conserva la ventana completa. Con un selector de dominio también conserva las ventanas mixtas con pestañas de otros sitios. Si `closeTabs` cerraría la última ventana, se crea primero una pestaña en blanco. Si `closeWindows` cerraría todas las ventanas, se crea primero una ventana nueva con una pestaña en blanco. [Cierre de pestañas](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-remove) · [Cierre de ventanas](https://developer.chrome.com/docs/extensions/reference/api/windows#method-remove)

## Resultados y errores

| Función | Retorno | Significado |
| --- | --- | --- |
| `closeTabs`, `closeWindows` | `Promise<number>` | Cantidad de cierres. `0` indica que no se cerró ningún elemento. |
| `clearCookies`, `clearHistory` | `Promise<number \| null>` | Cantidad de cookies o URL eliminadas. `0` indica que no se eliminó ningún elemento. `null` indica que Chrome completó la operación sin conteo, por ejemplo por tiempo o con `"*"`. |
| `clearCache`, `clearStorage` | `Promise<boolean>` | `true` indica que Chrome completó la limpieza del alcance aplicable. `false` indica que una búsqueda autorizada no encontró orígenes para limpiar. |
| `clean` | `Promise<CleanResult>` | Objeto con `tabs`, `cookies`, `history`, `cache` y `storage`. Cada campo usa el tipo de su operación. Con un selector temporal, `tabs` vale `0`. |
| `run` | `Promise<RunResult[]>` | Una entrada `{ op, result }` por paso en el mismo orden, incluso cuando se repite una operación. `op` usa el nombre público aunque la secuencia haya usado un alias. |

Los errores de entrada, permisos o ejecución rechazan la promesa. `run` valida sus pasos antes de empezar. Si falla durante la ejecución, el error identifica el índice y conserva el array ordenado de resultados completados. Los resultados omiten valores de cookies y URL sensibles.

En una secuencia, `run` conserva el contexto y los orígenes detectados antes de cerrar pestañas. Así, un paso posterior puede limpiar el mismo conjunto de sitios después del cierre. Los IDs y las URL de las pestañas se vuelven a comprobar en el momento de cerrar.

## Implementación y pruebas

1. **Resolver argumentos.** Implementar `resolveArg` con pruebas unitarias y datos simulados antes de conectar Chrome. Cubrir `"*"`, argumento omitido, `null`, `0`, negativos, dominios y subdominios, contextos y listas mixtas. Probar expresiones regulares contra una ruta de URL y contra un nombre de host.
2. **Conectar Chrome.** Implementar las acciones independientes y comprobarlas en un perfil descartable. Probar un origen explícito con solo `browsingData`, una palabra clave sin fuente autorizada y una búsqueda autorizada sin resultados. Cubrir cookies compartidas, operaciones nativas sin conteo y ventanas mixtas.
3. **Componer y distribuir.** Agregar `clean` y `run`. Probar operaciones repetidas, fallos parciales y una limpieza posterior al cierre que utiliza los orígenes capturados antes del primer paso. Distribuir como módulo ES con declaraciones TypeScript y ejemplos para extensiones de Chrome.
