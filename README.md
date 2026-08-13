# vuela-vuela

Simulador de dron FPV sobre el escenario 3D fotorrealista de Google (Photorealistic 3D
Tiles), en el navegador. Proyecto personal.

El objetivo de diseño es uno solo: **que no haya nunca un tirón**. Todo lo demás está
subordinado a eso — se descarga la zona entera antes de despegar y durante el vuelo no
queda trabajo pendiente.

El modelo de vuelo es el de un dron de verdad: Betaflight, cuatro motores, cuatro hélices y
un sólido rígido. Una tune que funcione aquí funciona en un quad real, y al revés.

## Probarlo

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

**Hace falta un mando** —cualquier emisora por USB o mando de consola— y no hace falta API
key para empezar: el botón *«Volar en la ciudad de prueba»* genera una ciudad procedural
donde ajustar el mando y comprobar los fps antes de gastar cuota.

## Lo que cuesta

Google factura los Photorealistic 3D Tiles **por sesión**, no por tile: cada vez que pulsas
*«Cargar zona y volar»* gastas una de las **1.000 gratuitas al mes**, y durante las 3 horas
siguientes todo lo que descargues es gratis. A partir de ahí son 6 $ por cada 1.000.

Son ~33 arranques al día sin pagar nada. Recargar la página (F5) también cuenta, así que
usa la pausa (`Esc`) en lugar de recargar.

Necesitas una cuenta de facturación activa **aunque no vayas a pagar**: sin ella la API
devuelve 403. Si quieres blindarte, pon un presupuesto de 0 € con alerta en *Billing →
Budgets & alerts* y un límite de cuota diario en la clave.

Fuentes: [facturación de Map Tiles API](https://developers.google.com/maps/documentation/tile/usage-and-billing),
[precios de Google Maps Platform](https://mapsplatform.google.com/pricing/).

## La API key

1. En [console.cloud.google.com](https://console.cloud.google.com): crea un proyecto y
   activa la facturación.
2. *APIs & Services* → habilita **Map Tiles API**.
3. *Credentials* → crea una *API key* y restríngela: *Websites* con
   `http://127.0.0.1:5173/*`, y en *API restrictions* deja sólo *Map Tiles API*.
4. Crea `.env.local` con `VITE_GOOGLE_API_KEY=AIza...`

También puedes pegarla en el menú, pero sólo dura esa sesión. Es lo único que no vive en
`vuela.config.js`, precisamente para que ese fichero se pueda versionar.

## Controles

Se vuela con mando, y sólo con mando. La primera vez: *Mando* → *Calibrar los cuatro ejes*,
mueve cada stick en la dirección que te pida y suéltalo cuando te lo diga. Al terminar te da
un trozo de texto: pégalo dentro de `gamepads` en `vuela.config.js` y **ese mando queda
reconocido para siempre**. A partir de ahí, arrancar es enchufarlo y mover un stick.

Ese meneo inicial no te lo puedo ahorrar: ningún navegador enseña un mando hasta que lo
tocas una vez. Lo que sí se ahorra es todo lo demás —no hay que pulsar nada.

Calibrar borra lo que hubiera antes, así que si abandonas a medias —o le das a *Borrar
mapeo* sin querer— el mando se queda sin ejes. *Volver al mapeo del fichero* lo deja como
estaba: no hace falta recargar la página, que desde la pausa cuesta la zona entera.

Sin los cuatro ejes mapeados no se despega, pero la zona **sí** se carga: si terminas la
descarga sin mando, esperas en la pantalla de pausa con el panel a mano. Desconectarlo en
vuelo pausa la partida.

Del teclado sólo queda `Esc`, que pausa y vuelve a reanudar (la pausa no recarga: la zona
sigue en memoria).
Tras un choque se reaparece solo, al segundo y medio: se ajusta con `respawnDelay` en
`vuela.config.js`.

Si es tu primera vez, empieza en **modo Angle** (autonivelado) y pásate a **Acro** cuando te
encuentres cómodo.

## Configuración

Todos los números ajustables están en **`vuela.config.js`**: la zona, la calidad, el aparato
entero y la tune de Betaflight. Se lee al arrancar y no se reescribe nunca — para cambiar
algo de forma permanente, edítalo con el juego cerrado y recarga. Lo que toques desde el menú
se aplica al instante pero vive sólo en memoria. No hay nada guardado en el navegador.

Como se edita a mano, se valida contra un contrato al arrancar: si algo no cuadra, falla
nombrando la ruta exacta en lugar de dejarte un dron que aparece cayendo.

Detalle de qué merece la pena tocar, y por qué: [docs/configuracion.md](docs/configuracion.md).

## Si algo falla

| Síntoma | Causa habitual |
|---|---|
| «Google rechazó la petición (400/401/403)» | Clave inválida, *Map Tiles API* sin habilitar, proyecto sin facturación, o restricciones que no incluyen `http://127.0.0.1:5173` |
| La carga no termina, o la pestaña se queda sin memoria | Radio demasiado grande o calidad demasiado alta. El radio pesa al cuadrado |
| Va fluido pero a pocos fps | Baja *Escala de render*: es lo más barato |
| El dron oscila o vibra | Demasiada `P` o `D` para la masa que has puesto. Baja `D` primero |
| Cae en vertical y el gas no responde | Anillo de vórtices: sal hacia adelante, no metas más gas. Se puede apagar con `flight.prop.vortexRing: false` |
| Los ajustes de vuelo no cambian nada | Los de hardware (masa, hélice, motor) sólo se aplican al cargar la zona; los del controlador son inmediatos |
| Quiero vaciar la caché de tiles | Consola: `navigator.serviceWorker.controller.postMessage('vv:clear-cache')` |

## Cómo funciona por dentro

- [El modelo de vuelo](docs/modelo-de-vuelo.md) — la cadena completa de stick a sólido
  rígido, y qué sale gratis por modelarla entera.
- [Cómo se consigue que no se entrecorte](docs/rendimiento.md) — las diez decisiones que
  sostienen el objetivo de diseño.
- [Configuración](docs/configuracion.md) — el contrato del fichero y los ajustes que importan.
- [Tests](docs/tests.md) — qué cubre `npm test`, y los fallos reales que ha cazado.

## Nota legal

Los tiles son de Google y sus proveedores. La atribución que exigen los términos de Map
Tiles API se muestra siempre en la esquina inferior izquierda; no la quites. La caché respeta
el `Cache-Control` que devuelve Google. Esto es un proyecto personal y no está pensado para
distribuirse.

El modelo de vuelo está escrito desde sus fuentes públicas: el firmware de
[Betaflight](https://github.com/betaflight/betaflight) (GPL-3) para el controlador, y
aerodinámica de rotores y electrotecnia de libro para el resto. No hay código de terceros
copiado aquí.
