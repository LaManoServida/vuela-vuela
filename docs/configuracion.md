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
  (cuánto patina contra la fachada), `maxSpin` (cuánto puede voltear un golpe descentrado)
  y `respawnDelay` (segundos de volteo antes de reaparecer solo; 0 reaparece al instante).
- **Ver la rejilla** — ayuda de depuración: pinta en rojo translúcido las celdas de colisión
  que rodean al dron, para ver si la rejilla se pega a las fachadas y contra qué se está
  chocando de verdad. Se enciende y se apaga en la pausa. Hasta dónde llega lo decide
  `gridRadius` en `vuela.config.js` (50 m); subirlo cuesta con el cubo del radio, así que a
  partir de 80 m se nota. `gridRefresh` (1 s) limita cada cuánto se rehace la ventana: no
  abarata la reconstrucción, la espacia. Bajarlo la recentra antes en el dron a costa de
  gastar más a menudo; 0 la rehace cada vez que el dron cambia de celda. Apagada no dibuja
  nada ni ocupa memoria.
- **Modo de exploración** — la zona cargada sigue al dron en vez de quedarse clavada en el
  punto de despegue, así que el mundo deja de acabarse a 22 km y puedes alejarte sin
  límite. A cambio el detalle aparece según llega y **no hay colisiones**: la rejilla que
  las hace posibles se construye de una vez sobre una zona finita, y aquí no la hay —ni al
  cargar ni al reanudar desde la pausa—, así que el dron atraviesa edificios y terreno. Por
  eso, mientras está encendido, el menú apaga solas **Colisiones**, **Ver la rejilla** y
  sus tres deslizadores —resolución, alcance y refresco de la vista de rejilla—, y también
  la respuesta al choque entera —a qué velocidad se rompe, cuánto rebota, cuánto patina,
  cuánto voltea y el retardo de reaparición—, con una nota que explica el porqué en vez de
  dejarte moverlos sin que hagan nada. La **batería** queda fuera: no depende de la
  rejilla. Encenderlo o apagarlo recarga la zona —cuesta lo mismo, una sesión— y sus tres
  números se aplican en el sitio:
  - *Refresco de la carga* (1 s) — cada cuánto se recorre el árbol de tiles. Bajarlo no es
    gratis: el recorrido es una llamada indivisible, así que un intervalo corto convierte
    un recorrido caro en un tirón por turno más seguido; el número de milisegundos del OSD
    dice si conviene subirlo. Un turno se salta entero si el dron no se ha movido 25 m.
  - *Trabajo por frame* (3 ms) — techo de tiempo subiendo texturas a la GPU en cada frame.
    Súbelo si el detalle no llega a tiempo, bájalo si el contador de tirones deja de ser
    cero.
  - *Memoria para tiles* (1,5 GB) — presupuesto de la caché. Corto, descarta cosas que
    sigues viendo y las vuelve a pedir en bucle; largo, crece hasta matar la pestaña. El
    OSD enseña cuánta se está usando de verdad. Y hay un tercer efecto que no se ve venir:
    en el modo normal el árbol de tiles se congela y three deja de recorrerlo, pero aquí no
    se congela, así que cada frame se recomponen las matrices de todos los tiles vivos
    —objetos que no se mueven— y ese coste sube en línea recta con la memoria. Es el mando
    de los tres que más se nota en los fps.

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

## Mando

`gamepads` guarda un mapeo por cada mando, con la clave que reporta el navegador:

    gamepads: {
    	'RadioMaster TX16S Joystick (Vendor: 1209 Product: 4f54)': {
    		roll:     { axis: 0, inv: false },
    		pitch:    { axis: 1, inv: true  },
    		yaw:      { axis: 3, inv: false },
    		throttle: { axis: 2, inv: true  },
    	},
    },

Un mando que esté aquí queda mapeado en cuanto el navegador lo ve, sin tocar nada. Uno que
no esté se calibra en el panel de mando, que te da ese mismo trozo listo para pegar aquí.
Puede estar vacío (`gamepads: {}`): un mando sin calibrar no es un error.

La clave es exactamente lo que reporta el navegador, y Chrome y Firefox la escriben
distinta para el mismo aparato. Volar desde otro navegador cuesta una calibración más y
deja dos entradas.

Una entrada a la que le falte un eje, o con un `axis` fuera de rango, **impide arrancar**
nombrando la ruta. Es a propósito: un mapeo a medias deja el gas en 0.5 —medio gas al
despegar, sin stick.

### Topes de los sticks

El navegador no entrega el eje contra el recorrido que los sticks hacen, sino contra el que
la emisora **declara** en su descriptor HID. No son lo mismo: un RealFlight R7 declara −1..1
y entrega −0.9686..0.9608 reposando en −0.0196. Volando con el valor crudo se pierde un 4 %
de recorrido por cada extremo —el gas nunca llega al 100 %— y el centro queda descolocado.

El botón **Medir topes** del panel los mide barriendo los sticks, y añade tres números por
eje:

    roll: { axis: 0, inv: false, zero: -0.0196, min: -0.9686, max: 0.9608 },

Los dos lados se escalan por separado, porque el reposo no cae en el centro geométrico del
recorrido. Van los tres juntos o ninguno, y tienen que cumplir `min < zero < max`: unos
topes a medias o cruzados no dejan el eje corto, lo dejan **hipersensible**, así que el
arranque falla nombrando la ruta.

Son opcionales. Un mapeo sin ellos vuela con el valor crudo, como se hacía antes de
medirlos.

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
