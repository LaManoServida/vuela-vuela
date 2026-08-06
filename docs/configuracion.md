# El fichero de configuración

Todos los números ajustables del simulador están en **`vuela.config.js`**, en la raíz: la
zona, la calidad, el aparato entero (masa, motor, hélice, batería), la tune de Betaflight y
los recorridos de los deslizadores del menú.

Se lee al arrancar y **no se reescribe nunca**. Para cambiar algo de forma permanente,
edítalo con el juego cerrado y recarga. Lo que toques desde el menú o desde la consola se
aplica al instante pero vive sólo en memoria: al recargar vuelve a mandar el fichero.

No hay nada guardado en el navegador.

## El contrato

Como se edita a mano, el fichero se lee contra un contrato: qué claves tienen que estar, de
qué tipo, con qué forma y entre qué límites el código sabe calcular. Si algo no cuadra —una
clave que falta, un `mass` escrito `masa`, un número entre comillas, una inercia con dos
componentes en vez de tres, un `voxelSize: 0`— el arranque **falla nombrando la ruta
exacta**, en lugar de dejarte un dron que aparece cayendo, un alabeo que se va a NaN o unos
sticks que no responden. Una clave de más —la otra mitad de una errata— no impide arrancar,
pero se avisa por consola: nadie la está leyendo.

Los recorridos del bloque `ui` son otra cosa distinta: son lo que ofrece el menú, no lo que
es válido. `ui.radius` llega a 3.000 m porque es lo cómodo de mover con el ratón, no porque
3.500 sea imposible. Un valor fuera de su recorrido se recorta y se avisa por consola, pero
no impide arrancar.

## Escenario

- **Radio a máximo detalle** — cuánto mapa se carga entero antes de despegar. Es el
  parámetro que decide el tiempo de carga y la memoria. 1.100 m es un buen punto de partida.
- **Calidad** — error geométrico objetivo dentro del radio. *Menor = más detalle y más
  descarga.* 12 es alto; 20 es el valor que Google recomienda para navegación normal.
- **Escala de render** — si tu GPU no llega a 60 fps estables, bájala antes que la calidad.
- **Colisiones** — construye la rejilla de vóxeles (unos segundos más de carga). Lo que
  pasa al chocar no tiene deslizador y se toca en `vuela.config.js`: `crashSpeed` (a qué
  velocidad de impacto se rompe el dron), `restitution` (cuánto rebota), `friction`
  (cuánto patina contra la fachada) y `maxSpin` (cuánto puede voltear un golpe descentrado).

El coste de carga crece con el **cuadrado** del radio y con el **cuadrado** del inverso de
la calidad. Duplicar el radio es 4× de trabajo. El menú te da una estimación en vivo. Todos
estos valores, y sus recorridos, salen de `vuela.config.js`.

## Vuelo

Los ajustes de vuelo son **los de Betaflight, con sus mismos nombres, unidades y escalas
internas**. Una tune que funcione aquí funciona en un dron real, y al revés: puedes copiar
los números de tu configurador tal cual.

- **RC rate / super rate / expo** — la curva del stick. Con los valores por defecto (0.95 y
  0.70) el stick a fondo pide 633 °/s. El menú te dice el máximo resultante en vivo.
- **P / I / D / F** — `P` es la fuerza con que corrige, `I` lo que aguanta contra el viento,
  `D` el amortiguamiento, `F` lo que se adelanta al stick. El `D` de yaw está deshabilitado
  a propósito: el mezclador de un cuadricóptero sólo suma P+I+F en ese eje.
- **Airmode** — mantiene autoridad de actitud con el gas a cero. Sin él no puedes enderezar
  en caída.
- **Anti-gravity / TPA / I-term relax** — los tres correctores estándar de Betaflight.

## Aparato

Todo son magnitudes físicas reales, así que cambiarlas cambia el vuelo por la vía correcta:
subir la masa no baja un número de "agilidad", sino que empeora la relación empuje/peso
*y* aumenta la inercia, y las dos cosas se notan por separado.

| Ajuste | Qué mueve de verdad |
|---|---|
| Masa | empuje/peso, gas de sustentación, inercia |
| KV del motor | régimen alcanzable y par por amperio (son la misma constante) |
| Límite de corriente | lo rápido que sube de vueltas: es lo que aplana el acelerón |
| Diámetro y paso de hélice | empuje, par resistente y régimen de sustentación |
| Celdas de batería | margen de gas; el régimen de sustentación **no** cambia |
| Longitud de brazo | par de alabeo y cabeceo a igualdad de empuje |

Con los valores por defecto sale un 5" freestyle: 601 g, 711 g de empuje por motor,
**4,7:1** de empuje/peso, sustentación al **30 %** de gas a 9.360 RPM y unos 139 km/h de
punta. Son las cifras de un quad real de esa clase.
