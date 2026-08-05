# vuela-vuela

Simulador de dron FPV sobre el escenario 3D fotorrealista de Google (Photorealistic 3D Tiles),
en el navegador. Uso personal.

El objetivo de diseño es uno solo: **que no haya nunca un tirón**. Todo lo demás está
subordinado a eso.

---

## 1. Lo que cuesta (los números reales)

Los Photorealistic 3D Tiles se facturan **por petición de "root tileset"**, que equivale a
una sesión: una petición abre una ventana de 3 horas durante la cual todos los tiles que
descargues son gratis.

| Concepto | Valor |
|---|---|
| Peticiones root gratis | **1.000 al mes** por cuenta de facturación |
| A partir de ahí | 6 $ por cada 1.000 |
| Tiles dentro de la sesión | no se facturan aparte |
| Límite duro | 10.000 root/día |

**Cada vez que pulsas "Cargar zona y volar" gastas 1 de esas 1.000.** Son ~33 arranques al
día sin pagar nada. Recargar la página (F5) también cuenta como uno, así que conviene usar
la pausa (`Esc`) en lugar de recargar.

Necesitas una cuenta de facturación activa aunque no vayas a pagar: sin ella la API
devuelve 403. Si quieres blindarte, en Google Cloud → *Billing* → *Budgets & alerts* puedes
poner un presupuesto de 0 € con alerta, y en la API key un límite de cuota diario.

Fuentes: [facturación de Map Tiles API](https://developers.google.com/maps/documentation/tile/usage-and-billing),
[precios de Google Maps Platform](https://mapsplatform.google.com/pricing/).

---

## 2. Poner en marcha

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

Puedes probarlo **ahora mismo sin API key**: el botón *"Volar en la ciudad de prueba"*
genera una ciudad procedural. Sirve para ajustar el mando, los rates y comprobar los fps
antes de gastar cuota.

### Conseguir la API key

1. [console.cloud.google.com](https://console.cloud.google.com) → crea un proyecto.
2. Activa la facturación en ese proyecto (*Billing*).
3. *APIs & Services* → *Enable APIs* → habilita **Map Tiles API**.
4. *Credentials* → *Create credentials* → *API key*.
5. Restringe la clave: *Application restrictions* → *Websites* → añade `http://127.0.0.1:5173/*`.
   En *API restrictions*, deja solo *Map Tiles API*.
6. Crea `.env.local` con la clave:

```
VITE_GOOGLE_API_KEY=AIza...
```

También puedes pegarla en el menú del juego, pero **sólo dura esa sesión**: no
se guarda en ningún sitio. La clave es lo único que no vive en
`vuela.config.js`, precisamente para que ese fichero se pueda versionar.

### El fichero de configuración

Todos los números ajustables del simulador están en **`vuela.config.js`**, en la
raíz: la zona, la calidad, el aparato entero (masa, motor, hélice, batería), la
tune de Betaflight y los recorridos de los deslizadores del menú.

Se lee al arrancar y **no se reescribe nunca**. Para cambiar algo de forma
permanente, edítalo con el juego cerrado y recarga. Lo que toques desde el menú
o desde la consola se aplica al instante pero vive sólo en memoria: al recargar
vuelve a mandar el fichero.

No hay nada guardado en el navegador.

Como se edita a mano, el fichero se lee contra un contrato: qué claves tienen que
estar, de qué tipo, con qué forma y entre qué límites el código sabe calcular. Si
algo no cuadra —una clave que falta, un `mass` escrito `masa`, un número entre
comillas, una inercia con dos componentes en vez de tres, un `voxelSize: 0`— el
arranque **falla nombrando la ruta exacta**, en lugar de dejarte un dron que
aparece cayendo, un alabeo que se va a NaN o unos sticks que no responden. Una
clave de más —la otra mitad de una errata— no impide arrancar, pero se avisa por
consola: nadie la está leyendo.

Los recorridos del bloque `ui` son otra cosa distinta: son lo que ofrece el menú,
no lo que es válido. `ui.radius` llega a 3.000 m porque es lo cómodo de mover con
el ratón, no porque 3.500 sea imposible. Un valor fuera de su recorrido se recorta
y se avisa por consola, pero no impide arrancar.

---

## 3. Controles

**Mando / emisora.** Cualquier emisora por USB o mando de consola aparece como joystick.
En el menú, *Mando* → *Detectar* en cada eje, mueve el stick en la dirección que te pida y
queda mapeado con su inversión.

**Ratón y teclado** (sin mando):

| | |
|---|---|
| Ratón | sticks de roll y pitch. **No se autocentra**, como unos gimbals reales — es lo que hace acro pilotable sin emisora |
| `W` / `S` | subir y bajar gas (se queda donde lo dejes) |
| `Shift` | gas al máximo mientras lo mantengas |
| `Espacio` | corta gas |
| `A` / `D` | yaw |
| `R` | reaparecer |
| `Esc` | pausa (no recarga: la zona sigue en memoria) |

Si es tu primera vez, empieza en **modo Angle** (autonivelado) y pásate a **Acro** cuando
te encuentres cómodo.

---

## 4. Ajustes que importan

### Escenario

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

### Vuelo

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

### Aparato

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

---

## 5. El modelo de vuelo

No hay ningún par de alabeo aplicado a mano. La cadena es la de un dron de verdad, y la
actitud **emerge** de que cuatro empujes distintos actúan en la punta de cuatro brazos:

```
sticks ─► Betaflight ─► mezclador ─► 4 × (variador → motor → hélice) ─► sólido rígido
          rates/expo     por motor      Ohm + BEMT      empuje         F=ma, τ=Iα
          PID (P·error + I·∫ + D·Δgiro + F·Δstick)      en el brazo
```

Cada bloque, en `src/flight/`:

- **`betaflight.js`** — rates (curvas *Betaflight* y *ACTUAL*), PID sobre la medida con
  I-term relax, anti-gravity, TPA, D-min y feedforward; mezclador lineal con airmode;
  suavizado del enlace de radio; limitador de RPM. Escalas internas del firmware
  (`PTERM_SCALE`, `ITERM_SCALE`, …) para que los números sean los de verdad.
- **`prop.js`** — elemento de pala + teoría de cantidad de movimiento. Saca el ángulo de
  ataque del flujo que atraviesa el disco, de ahí `Cl`/`Cd` y de ahí empuje y par
  resistente. Incluye velocidad inducida exacta en ascenso, la curva empírica de Johnson
  para el anillo de vórtices, alivio por traslación, deformación de pala y efecto suelo.
- **`motor.js`** — motor brushless de continua: fuerza contraelectromotriz, ley de Ohm
  sobre motor + variador + batería, límite de corriente, frenado activo, `τ = Kt·(I − I₀)`
  con `Kt = 60/(2π·KV)`.
- **`battery.js`** — curva de descarga de litio y caída bajo consumo por resistencia interna.
- **`rigidbody.js`** — 6 grados de libertad con tensor de inercia diagonal, `α = I⁻¹(τ − ω×Iω)`.
- **`quad.js`** — lo ensambla: cuatro rotores en sus brazos, reacción de guiñada, precesión
  giroscópica de los rotores, arrastre del chasis eje a eje, colisión por impulsos.

Todo corre a **1 kHz** con el rotor subdividido a 2 kHz (la dinámica del rotor es rígida:
inercias de microgramos·m² contra pares de centinewton·metro), desacoplado del render y sin
asignar memoria. Coste medido en el navegador: **0,09 ms por frame a 60 fps**.

Cosas que salen gratis por estar modelado el camino completo, y que un modelo de rates no
puede dar:

- El gas tiene peso, porque los rotores tardan ~120 ms en subir de vueltas.
- Dar gas de golpe mete un tirón de guiñada, porque durante el acelerón el par del motor
  supera al de la hélice y esa diferencia sale del chasis.
- Caer en vertical hunde el dron en su propia estela y el gas deja de servir: hay que salir
  hacia adelante. El OSD avisa, porque el reflejo correcto es el contrario del instintivo.
- Con la batería baja hay menos punch, porque la tensión cae bajo carga.
- Alabear amortigua solo: el rotor que baja ve más flujo axial y pierde empuje.
- Al posarse el dron flota el último palmo por efecto suelo.

## 6. Cómo se consigue que no se entrecorte

Un visor normal de tiles 3D descarga, parsea y sube a GPU **mientras te mueves**. Eso
funciona para una cámara orbital lenta y es injugable a 100 km/h entre edificios. Aquí el
enfoque es el contrario: se paga todo el coste antes de despegar.

1. **Carga por región, no por cámara.** `LoadRegionPlugin` hace que el error geométrico
   dependa de una esfera centrada en tu punto de vuelo, no de dónde mira la cámara. El
   resultado: los tiles de la zona se cargan y se marcan visibles mires donde mires.
2. **Congelar el traversal.** Como el conjunto visible ya no depende de la cámara, en
   cuanto termina la precarga se deja de llamar a `tiles.update()`. Cero descargas, cero
   descartes, cero reevaluación de LOD durante el vuelo. El culling por frustum pasa a
   hacerlo three por objeto (`autoDisableRendererCulling = false`), y las matrices del
   subárbol dejan de recalcularse.
3. **Texturas subidas a mano.** Por defecto una textura llega a la GPU la primera vez que
   se dibuja: con miles de tiles eso es un goteo de micro-tirones durante todo el vuelo.
   Se fuerzan todas con `initTexture` durante la carga, troceado.
4. **Shaders compilados antes.** `compileAsync` sobre el tileset entero, más un barrido
   real de 360° renderizando de verdad antes de devolver el control.
5. **Materiales planos.** Los tiles fotogramétricos ya llevan la luz horneada en la
   textura, así que se cambian a `MeshBasicMaterial`: una sola variante de shader y menos
   trabajo por píxel.
6. **Colisiones O(1).** Nada de raycasts contra la malla. Durante la carga se voxeliza la
   geometría en una rejilla de bits (~2 m, decenas de MB) y colisionar es una consulta de
   coste constante — ~40 ns, medido en los tests. Se voxeliza lo que el tileset **dibuja**,
   no lo que tiene cargado: la caché no descarta nada, así que los tiles ancestros siguen en
   memoria, y son el globo entero resuelto con un par de cientos de triángulos.
7. **Física de paso fijo a 1 kHz**, desacoplada del render y sin asignar memoria en el
   bucle (no hay presión de GC). A 40 m/s el dron avanza 4 cm por subpaso, muy por debajo
   de un vóxel: la detección es continua sin hacer nada especial. El modelo completo
   —Betaflight, cuatro motores, cuatro hélices y el sólido rígido— cuesta 0,09 ms por
   frame a 60 fps, medido en el navegador.
8. **Depth invertido** (`EXT_clip_control`) en vez de depth logarítmico: precisión de
   0,15 m a 40 km sin el coste por vértice. Cae al logarítmico si la GPU no lo soporta.
9. **Caché en disco.** Un service worker guarda los tiles respetando su `Cache-Control`,
   con clave independiente de `key` y `session`. No ahorra dinero (lo facturable es la
   sesión), pero recargar la misma zona pasa de minutos a segundos.

El OSD lleva un **gráfico de frametime y un contador de tirones** (frames > 24 ms) en la
esquina superior derecha. Si marca 0 tras un vuelo largo, la precarga hizo su trabajo. Si
aparece un pico, algo se quedó fuera.

---

## 7. Tests

```bash
npm test
```

`tests/config.test.mjs` es la primera en correr, antes de tocar el modelo de vuelo: valida
el fichero en sí. Recorre `vuela.config.js` entero buscando cualquier número que no sea
finito — un NaN se propaga en silencio hasta que el dron aparece cayendo o girando a mil
rpm sin que nada avise — comprueba que estén los bloques que el modelo da por hechos
(`frame`, `motor`, `esc`, `prop`, `battery`, `bf`), y que la curva del variador tenga sus 65
puntos, monótona y entre 0 y 1. Del bloque `ui` comprueba las dos direcciones: que cada
rango sea coherente (`min < max`, `step > 0`) y que el valor de partida caiga dentro del
suyo, y también que ningún `min`, `max` o `step` se haya colado como literal en `menu.js`
—un número de configuración escondido en código es justo lo que este refactor vino a
eliminar— ni quede un rango declarado en `ui` que nadie use en el menú. Por último
comprueba el cargador: que `cloneFlight()` devuelva una copia independiente en cada
llamada, que tocar una copia no contamine `config.flight` (el objeto que de verdad vuela),
y que la `apiKey` no aparezca en el fichero, porque es la única credencial y por eso vive
fuera, en `.env.local`.

Además comprueba el contrato **por el otro lado**: coge copias del fichero, las sabotea
como lo haría alguien editándolo a mano (borrar `radius`, escribir `mass` como `masa`,
poner un número entre comillas, dejar la inercia en dos componentes, quitar el bloque
`flight.motor`, poner `voxelSize: 0`, borrar `deadzone`, apuntar un `ui.*.path` a una clave
que ya no existe) y exige que la validación devuelva un error **que nombre esa ruta**. Esto
es lo que evita que el fichero se rompa en silencio: el flujo documentado es «edítalo y
recarga», no «edítalo y `npm test`», así que el arranque tiene que quejarse solo.

`tests/flight.test.mjs` no comprueba sólo que el modelo no explote: comprueba que sigue
representando un dron. Empuje por motor, empuje/peso, gas de sustentación, régimen y consumo
tienen que caer en el rango de un 5" real, y la figura de mérito de la hélice en el de una
hélice real (0,4–0,8). Si una de esas cifras se sale, el modelo ha dejado de ser físico
aunque siga volando bien.

Además cubre: las curvas de rates contra sus valores exactos, el sentido de los tres ejes
(y hacia dónde se mueve el dron, no sólo cómo gira), que la actitud emerge de empujes
distintos en cada brazo, modo angle y horizon, airmode, los regímenes de la hélice
(ascenso, anillo de vórtices, autorrotación, traslación), la batería, el acoplamiento del
hardware con el vuelo, y estabilidad numérica tras un minuto de pilotaje aleatorio con paso
de render variable. `tests/world.test.mjs` cubre la voxelización de geometría real, la caída
libre, el choque contra fachada y posarse sin temblar. Cubre también las dos formas que tiene
la rejilla de irse de las manos: que un tile cargado pero **no dibujado** —un ancestro de
miles de kilómetros— no dicte la altura de la rejilla, y que el tope de 64 MB se respete pase
lo que pase con la extensión, porque pasarse no da una rejilla grande, da un `RangeError` y
una pestaña muerta. Todo en Node, sin navegador.

Fallos reales que salieron de estos tests:

- La formulación de "estación representativa" del elemento de pala sobrestimaba el empuje un
  55 %: evaluar una sección a 0,8R y multiplicar por el área geométrica ignora que la parte
  interior de la pala va mucho más despacio. Hay que usar el área equivalente
  `c·N·R·(1−h³)/(3·0,64)`, que sale de igualar la integral.
- La curva de Johnson por sí sola **nunca** produce pérdida de empuje al descender: el flujo
  medio da más empuje, no menos. Lo que hunde a un rotor que cae en su estela es la
  recirculación, y eso hay que modelarlo aparte.
- Un impulso puntual sobre un sólido de 3 g·m² de inercia daba 108 rad/s de volteo al chocar
  contra una pared (más de mil vueltas por minuto).
- El empuje de sustentación se calculaba en unidades de motor, pero el stick pasa por el
  remapeo del ralentí: el dron aparecía cayendo.
- Sacar el dron del vóxel a pasos fijos lo dejaba flotando hasta medio vóxel por encima del
  tejado, y desde ahí volvía a caer: el temblor clásico de un dron posado. Ahora la
  distancia a la superficie se busca por bisección.
- Con `reversedDepthBuffer`, three **invierte la lista opaca completa**, así que un
  `renderOrder: -1000` acaba dibujándose el último. La cúpula del cielo tapaba el mundo
  entero. Ahora se resuelve por profundidad y no depende del orden.
- Un `pointerlockchange` espurio justo al entrar en vuelo pausaba la partida. Ahora solo
  cuenta si el lock llegó a concederse.

---

## 8. Consola

Con el vuelo en marcha tienes `window.vv` para afinar en caliente:

```js
// Controlador: se lee en cada paso, así que el cambio es inmediato.
// Nada de esto persiste: al recargar vuelve a mandar vuela.config.js.
vv.config.flight.bf.pid[0].p = 80      // más P en roll
vv.config.flight.bf.superRate = 0.85   // rates más agresivos
vv.config.flight.bf.mode = 'angle'     // autonivelado

// Hardware: hay que rehacer lo que se derivó de los parámetros.
// `vv.config.flight` y `vv.drone.params` son el mismo objeto durante el vuelo.
vv.config.flight.frame.mass = 0.45
vv.drone.refresh()
vv.drone.hoverThrottle                 // recalculado

// Telemetría cruda de un rotor.
vv.drone.props[0].rpm
vv.drone.props[0].thrust               // N
vv.drone.props[0].vrs                  // 0..1, anillo de vórtices
vv.drone.motors[0].current             // A
vv.drone.bf.motor                      // los 4 mandos del mezclador, 0..1

vv.drone.position.y += 200             // teletransporte
vv.world.grid.voxelSize                // resolución de la rejilla de colisión
```

---

## 9. Si algo falla

| Síntoma | Causa habitual |
|---|---|
| "Google rechazó la petición (400/401/403)" | La clave no es válida, falta habilitar *Map Tiles API*, el proyecto no tiene facturación activa, o las restricciones no incluyen `http://127.0.0.1:5173` |
| La carga no termina nunca | Radio demasiado grande o calidad demasiado alta. Baja uno de los dos |
| La pestaña se queda sin memoria | Lo mismo. El radio pesa al cuadrado |
| Va fluido pero a pocos fps | Baja *Escala de render*; es lo más barato |
| Aparecen tirones | Mira si coinciden con algo concreto (girar la cámara hacia una zona nueva indicaría que la precarga no cubrió el área) |
| Quiero vaciar la caché de tiles | Consola: `navigator.serviceWorker.controller.postMessage('vv:clear-cache')` |
| El dron oscila o vibra | Demasiada `P` o `D` para la masa que has puesto. Baja `D` primero |
| No aguanta la actitud contra el viento | Poca `I` |
| Cae en vertical y el gas no responde | Anillo de vórtices: sal hacia adelante, no metas más gas |
| Los ajustes de vuelo no cambian nada | Los de hardware (masa, hélice, motor) sólo se aplican al cargar la zona; los de controlador son inmediatos |

---

## 10. Nota legal

Los tiles son de Google y sus proveedores. La atribución que exigen los términos de Map
Tiles API se muestra siempre en la esquina inferior izquierda; no la quites. La caché
respeta el `Cache-Control` que devuelve Google y no guarda nada más tiempo del que ese
encabezado autoriza. Esto es un proyecto personal y no está pensado para distribuirse.

El modelo de vuelo está escrito desde sus fuentes públicas: el firmware de
[Betaflight](https://github.com/betaflight/betaflight) (GPL-3) para el controlador, y
aerodinámica de rotores y electrotecnia de libro para el resto —teoría de cantidad de
movimiento, elemento de pala, la curva empírica de Johnson para el anillo de vórtices
(*Helicopter Theory*, §3-4), el modelo de Cheeseman-Bennett para el efecto suelo y la
relación `Kt = 60/(2π·KV)`. Los parámetros son magnitudes físicas de componentes que
existen. No hay código de terceros copiado aquí.
