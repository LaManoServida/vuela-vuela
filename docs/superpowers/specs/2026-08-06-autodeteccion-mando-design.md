# Autodetección del mando — Diseño

**Objetivo:** que enchufar la emisora de siempre y mover un stick sea todo lo que hay que
hacer para volar. El mando se reconoce por su `id`, su mapeo sale del fichero de
configuración, y cuando hay que calibrar se calibran **los cuatro ejes**, sin inventarse
ninguno y sin que dos acaben leyendo el mismo.

## El problema, con nombres y líneas

1. **El mapeo no se guarda en ningún sitio.** `vuela.config.js` trae `gamepadMap: null` y
   `src/config.js` no lee ni escribe nada del navegador, a propósito. Lo que se mapea en el
   menú vive en memoria: al recargar vuelve a `null`. De ahí que cada arranque empiece de
   cero.

2. **Los ejes que no se mueven se los inventa el código.** `ensureMap()`
   (`src/menu.js:562`) crea, si no había mapa, el de por defecto —roll→0, pitch→1, yaw→2,
   throttle→3— y encima escribe sólo el eje que se acaba de detectar. Los otros tres son
   adivinados, no medidos: por eso al detectar uno aparecen cuatro.

3. **Y por eso timón y gas se mueven juntos.** Si el eje detectado cae en el índice 2 o 3,
   choca con el que ese defecto ya había puesto en `yaw` o en `throttle`, y dos filas
   quedan leyendo el mismo eje físico. Hoy nada lo impide.

4. **Un mapeo a medias da medio gas.** `hasControl` sólo comprueba que exista *algún* mapa
   (`src/input.js:95`). Con un mapa al que le falte el gas, `readGamepad` devuelve 0 para
   el eje ausente y lo remapea a `(0+1)*0.5 = 0.5`: se despega con medio gas y sin stick.
   Hoy no ocurre porque el contrato exige los cuatro ejes; en cuanto se admiten mapeos
   parciales, sí.

**Lo que no tiene arreglo:** ni Chrome ni Firefox exponen un mando hasta que se toca una
vez —es una defensa antihuella—, así que «sin hacer nada» no existe del todo. Lo que sí se
garantiza es que ese toque sea el **único** gesto: nada de pulsar botones en pantalla.

## Decisiones tomadas

| Decisión | Elegida | Por qué |
|---|---|---|
| Dónde se guarda el mapeo | Bloque `gamepads` en `vuela.config.js` | El fichero sigue siendo la única fuente, se valida contra el contrato y se versiona. Cuesta un pegado por mando, una vez. |
| Mandos estándar de consola | Fuera | Se vuela con emisora RC, que el navegador da como no estándar. Un camino para todos. |
| Forma de calibrar | Botón que guía los cuatro + «Detectar» por eje | La secuencia resuelve el caso normal; los sueltos quedan para retocar uno sin rehacer los cuatro. |

---

## 1. La biblioteca de mandos vive en el fichero

`vuela.config.js` gana un bloque `gamepads`: diccionario de **id del mando → sus cuatro
ejes**.

```js
gamepads: {
	'RadioMaster TX16S Joystick (Vendor: 1209 Product: 4f54)': {
		roll:     { axis: 0, inv: false },
		pitch:    { axis: 1, inv: true  },
		yaw:      { axis: 3, inv: false },
		throttle: { axis: 2, inv: true  },
	},
},
```

Puede estar vacío (`gamepads: {}`) y admite tantas emisoras como haga falta.

A cambio, **`gamepadMap` desaparece del fichero y del contrato**. Pasa a ser lo que de
verdad es: el mapa *activo*, estado en memoria que sale de `gamepads[id]` o de una
calibración recién hecha. Tenerlo en los dos sitios obligaría a inventar una regla de quién
gana. `input.js` sigue leyendo `config.gamepadMap` sin enterarse del cambio.

La clave es el `id` tal y como lo reporta el navegador. Chrome y Firefox lo escriben
distinto para el mismo aparato: volar desde otro navegador cuesta una calibración más y
deja dos entradas. No se normaliza por vendor/product —sería adivinar formatos de cadena
para un caso que no se da.

## 2. Reconocer el mando al conectarlo

La lógica vive en `InputManager`: es quien ya sabe qué pad hay y quien lee el mapa. No en
el panel (que sólo pinta) ni en `main.js`. Además se prueba en Node, porque
`tests/input.test.mjs` ya finge `navigator.getGamepads`.

En cuanto el navegador expone un mando —el barrido de `attach()` o el evento
`gamepadconnected`— `InputManager` busca su `id` en `config.gamepads`:

- **está** → copia ese mapa a `config.gamepadMap`. Cero clics: en la pausa se enciende
  «Reanudar», en el menú ya se puede despegar.
- **no está** → no se mapea nada. `config.gamepadMap` queda a `null` y el panel ofrece
  calibrar.

El mapa se copia, no se referencia: calibrar de nuevo no debe editar la biblioteca cargada
del fichero.

**Orden de los oyentes:** `input.attach()` se registra en `init()` antes que el
`gamepadconnected` de `main.js`, y los oyentes de un mismo evento corren en orden de
registro. Así, cuando `main.js` llama a `refreshResume()`, el mapa ya está aplicado. Es la
misma dependencia de orden que ya documenta el oyente de `Esc` en `main.js:576`.

**Textos del panel:**

- sin mando visible → «Mueve un stick para detectar el mando.»
- reconocido → «Mando: *id* · *n* ejes · mapeo del fichero».
- desconocido → «Mando: *id* · *n* ejes · sin calibrar».

## 3. Calibración guiada

Botón **«Calibrar los cuatro ejes»**. Recorre `AXES` en orden con su instrucción:
alerones **a la derecha** → elevador **hacia arriba** → timón **a la derecha** → gas **a
tope**.

Reglas de cada paso:

- Al empezar se fotografían todos los ejes. Gana el que más se desvía de esa foto.
- Se acepta **en cuanto la desviación pasa de 0.5**, sin esperar un tiempo fijo. Si en
  **5 segundos** ninguna llega a **0.25**, el paso falla y la secuencia se corta ahí.
- `inv` sale del signo del valor en el momento de aceptar.
- **Los ejes ya asignados en esta calibración quedan excluidos** de los pasos siguientes.
  Es lo que hace imposible que timón y gas compartan eje.
- El paso siguiente no arranca por reloj, sino **cuando el eje recién asignado vuelve a
  ±0,15 de donde estaba en la foto de su paso**. Así el regreso del stick no puede contar
  como el movimiento del paso siguiente, y el ritmo lo marca la mano y no un temporizador
  que unas veces sobra y otras se queda corto. Mientras tanto el panel pide «suelta el
  stick». Si no vuelve en **2 s** se sigue igual: ese eje ya está excluido y no puede
  volver a ganar, así que esperar más no protege de nada y colgaría la secuencia. La foto
  del paso siguiente se toma justo al terminar esta espera.

  El gas no self-centra en una emisora, pero es el último paso: las tres transiciones que
  existen —alerones→elevador, elevador→timón, timón→gas— son de ejes que sí vuelven solos.
- **Nada se inventa.** Lo que no se calibra se queda sin asignar y se muestra como «—».

Los cuatro «Detectar» sueltos siguen, con las mismas dos reglas: no rellenan lo que no se
ha movido y no admiten un eje ya usado por otra fila. «Mapeo por defecto» se va —con una
emisora, roll→0/pitch→1/yaw→2/throttle→3 es una adivinanza, y es la que ha causado el
problema— y en su lugar queda «Borrar mapeo».

**La secuencia es una pieza pura de `src/input.js`**, no lógica del panel: recibe muestras
de ejes y el tiempo transcurrido, y devuelve qué eje ha ganado. El panel sólo la alimenta
desde su `requestAnimationFrame` y pinta lo que diga. Boceto (la forma exacta la fija el
plan):

```js
// null mientras busca · { axis, inv } al aceptar · { axis: null } si se agota el tiempo
picker.sample( axes, transcurrido )
```

El tiempo entra como argumento en segundos: en el navegador sale de `performance.now()`, en
el test es un número. Así la pieza no toca reloj ni navegador y se prueba entera.

**`hasControl` pasa a exigir los cuatro ejes**, no sólo que exista un mapa. Es lo que cierra
el fallo del medio gas descrito arriba, ahora que los mapeos parciales son posibles.

## 4. Del panel al fichero

Al terminar la calibración, el panel muestra el bloque ya escrito —en un cuadro
seleccionable— y un botón **«Copiar mapeo»** que lo pone en el portapapeles:

```js
'RadioMaster TX16S Joystick (Vendor: 1209 Product: 4f54)': {
	roll:     { axis: 0, inv: false },
	pitch:    { axis: 1, inv: true  },
	yaw:      { axis: 3, inv: false },
	throttle: { axis: 2, inv: true  },
},
```

Se pega dentro de `gamepads`, se recarga, y ése es el último gesto que se hace con ese
mando. Mientras no se pegue, el mapeo funciona en memoria: se vuela en el acto, lo que no
sobrevive es el reinicio. El cuadro seleccionable es la vía de respaldo si el portapapeles
no está disponible; el id se escribe entre comillas simples con las suyas escapadas.

## 5. Contrato y errores

En `src/config.js`:

- `gamepads: record( block( { roll: padAxis, pitch: padAxis, yaw: padAxis, throttle: padAxis } ) )`.
  `record()` y `padAxis` ya existen. La clave tiene que estar en el fichero aunque valga
  `{}`, como todo lo demás.
- Se borra `gamepadMap` del `SCHEMA` y la línea `gamepadMap: null` de `vuela.config.js`. Un
  fichero que la conserve arranca igual, avisando por consola de que nadie la lee.

Qué pasa cuando algo no cuadra:

- Entrada a la que le falta un eje, o con `axis: 99` → **no arranca**, nombrando la ruta
  (`falta gamepads.RadioMaster… .throttle`). Es la regla de la casa y aquí paga: un mapeo a
  medias es medio gas al despegar.
- Mando conectado que no está en `gamepads` → **no es un error**: es «sin calibrar».
- `gamepads: {}` → válido.

## 6. Pruebas

En `npm test`:

**`tests/input.test.mjs`**

- Un mando cuyo `id` está en `gamepads` queda mapeado solo, tanto por el barrido de
  `attach()` como por el evento `gamepadconnected`, y sus ejes llegan con inversión y banda
  muerta.
- Un mando desconocido no inventa mapa y no da control.
- Un mapa al que le falta el gas no da control (el fallo del 0.5).
- La pieza de calibración, a muestras: acepta al pasar el umbral, respeta la exclusión de
  ejes ya asignados, deduce `inv` del signo y falla al agotar el tiempo sin movimiento.
- La espera entre pasos: con el stick aún fuera no se pasa al siguiente; se pasa en cuanto
  vuelve; y se pasa igualmente si no vuelve en 2 s.

**`tests/config.test.mjs`**

- `gamepads` ausente, una entrada con tres ejes y un `axis` fuera de rango se cazan.
- `gamepads: {}` es válido.

**Documentación:** `docs/configuracion.md` gana el bloque `gamepads` y el flujo nuevo;
`README.md` deja de mandar «*Mando* → *Detectar* en cada eje».

## 7. Ficheros

| Fichero | Qué |
|---|---|
| `src/input.js` | Reconocer el mando por `id`, aplicar su mapa, `hasControl` con los cuatro ejes, pieza de calibración. |
| `src/gamepadPanel.js` | **Nuevo.** Sale de `menu.js` con `buildGamepadPanel`; el panel crece ~80 líneas y `menu.js` ya va por 783. Va en su propio commit, antes del cambio de comportamiento. |
| `src/menu.js` | Pierde `buildGamepadPanel` y `ensureMap`. |
| `src/config.js` | `gamepads` entra en el contrato, `gamepadMap` sale. |
| `vuela.config.js` | Bloque `gamepads`; fuera `gamepadMap: null`. |
| `tests/input.test.mjs`, `tests/config.test.mjs` | Lo de arriba. |
| `docs/configuracion.md`, `README.md` | El flujo nuevo. |

## Fuera de alcance

- Mandos con `mapping: 'standard'` (consola): se vuela con emisora y adivinar por tipo de
  mando reintroduce justo lo que se está quitando.
- Normalizar el `id` por vendor/product para compartir mapeo entre navegadores.
- Que el juego escriba `vuela.config.js` (ni por servidor de Vite ni de ninguna otra
  forma): el fichero no se reescribe nunca.
- Guardar nada en el navegador.
- Mapear botones (armar, modos de vuelo): hoy no se usa ninguno.

## Verificación que corresponde al dueño

Lo que sólo se ve volando:

1. Con la TX16S en `gamepads`: arrancar, mover un stick, y que aparezca **reconocida y con
   los cuatro ejes puestos** sin tocar nada más —ni un clic— y que se pueda despegar.
2. Borrar el mapeo y calibrar los cuatro: que cada paso pille el eje correcto, que ninguna
   fila repita eje y que las barras se muevan una a una.
3. Desenchufar en vuelo (pausa) y volver a enchufar: que se reconozca solo otra vez.
