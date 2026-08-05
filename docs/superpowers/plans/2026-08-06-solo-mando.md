# Sólo mando — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dron se pilote únicamente con mando, quitando de todo el proyecto el camino de vuelo por ratón y teclado.

**Architecture:** `src/input.js` pasa de dos caminos (mando *o* stick virtual de ratón) a uno solo: si hay mando conectado y `gamepadMap` no es `null`, se leen sus ejes; si no, los mandos se quedan a cero y `source` vale `'none'`. Con eso, el pointer lock —que sólo existía para alimentar el stick del ratón— desaparece del proyecto entero. El vuelo se bloquea sin mando, pero **la carga no**: al terminar de cargar sin control se entra en pausa, y el panel de mapeo se monta también en la pantalla de pausa para poder mapear sin tirar los minutos de descarga.

**Tech Stack:** JavaScript ESM puro, Vite 8, three.js. Sin dependencias nuevas. Tests caseros en Node (`node tests/*.mjs`, sin framework), con el ayudante `check( nombre, condición, info )` que ya usan los tres ficheros existentes.

## Global Constraints

- **Las teclas que sobreviven son `Esc` (pausa) y `R` (reaparecer).** No son mandos de vuelo, son órdenes de juego: `_keys`, `_pending`, `_edges` y `consumeKey()` siguen en `input.js`.
- **`deadzone` se queda** en la configuración y en el contrato: la usa el mando. Los que se van son `inputMode` y `mouseSens`.
- **`gamepadMap: null` sigue significando «el mando se ignora»**, que es una decisión deliberada del fichero de configuración. No se autoaplica ningún mapeo por defecto sin que alguien pulse el botón.
- **Cargar nunca se bloquea.** Sin mando se carga igual y se espera en pausa. Perder una descarga de varios minutos por no tener el cable puesto no es aceptable.
- **Estilo del repositorio:** tabuladores para indentar, espacios dentro de los paréntesis (`fn( a, b )`), comentarios en castellano que expliquen el *porqué*, no el qué.

---

### Task 1: Un solo camino de entrada

Quita el vuelo por ratón y teclado de `input.js` y desengancha de `main.js` todo lo que lo sostenía (pointer lock y `resetStick`). Al acabar, el juego sigue arrancando y volando **con mando**; sin mando el dron no responde (el bloqueo llega en la Task 2).

**Files:**
- Modify: `src/input.js`
- Modify: `src/main.js:328-330`, `:344`, `:355`, `:377`, `:499`, `:525-553`
- Create: `tests/input.test.mjs`
- Modify: `package.json:10`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `input.hasControl` (getter, `boolean`) — hay mando conectado **y** `config.gamepadMap` no es `null`. `input.attach()` ya no recibe argumentos. Dejan de existir: `input.requestCapture()`, `input.releaseCapture()`, `input.captured`, `input.resetStick()`, `input.readMouseKeyboard()`.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/input.test.mjs`:

```js
/*
 * La entrada tiene un solo camino: el mando. Aquí se comprueban las dos mitades
 * de esa regla —sin mando no hay mandos, con mando y mapeo los ejes llegan con
 * su inversión y su banda muerta— sin abrir un navegador.
 */
import { InputManager } from '../src/input.js';

let fails = 0;
const check = ( name, cond, info = '' ) => {
	if ( cond ) console.log( `  ok  ${ name } ${ info }` );
	else { console.log( `FAIL  ${ name } ${ info }` ); fails ++; }
};

// `navigator` existe en Node pero sin `getGamepads`, y está definido como
// getter: asignarlo directamente lanza TypeError en un módulo ESM (que es
// estricto). Con `defineProperty` sí se deja sustituir.
const setPads = pads => Object.defineProperty( globalThis, 'navigator', {
	value: { getGamepads: () => pads },
	configurable: true,
} );

const fakePad = axes => ( { index: 0, connected: true, axes } );

const MAPA = {
	roll: { axis: 0, inv: false },
	pitch: { axis: 1, inv: true },
	yaw: { axis: 2, inv: false },
	throttle: { axis: 3, inv: true },
};

console.log( '\n== sin mando no hay mandos ==' );
{
	setPads( [] );
	const input = new InputManager( { deadzone: 0.04, gamepadMap: null } );
	const c = input.update();

	check( 'no hay control', input.hasControl === false );
	check( 'la fuente es ninguna', input.source === 'none', input.source );
	check( 'ejes a cero', c.roll === 0 && c.pitch === 0 && c.yaw === 0 );
	check( 'gas cortado', c.throttle === 0 );
}

console.log( '\n== un mando sin mapear tampoco vuela ==' );
{
	setPads( [ fakePad( [ 0.6, 0.5, 0.5, - 1 ] ) ] );
	const input = new InputManager( { deadzone: 0.04, gamepadMap: null } );
	const c = input.update();

	check( 'no hay control', input.hasControl === false );
	check( 'los ejes no llegan', c.roll === 0, `roll=${ c.roll }` );
	check( 'el gas no llega', c.throttle === 0, `throttle=${ c.throttle }` );
}

console.log( '\n== con mando y mapeo llegan los ejes ==' );
{
	setPads( [ fakePad( [ 0.6, 0.5, 0.02, - 1 ] ) ] );
	const input = new InputManager( { deadzone: 0.04, gamepadMap: MAPA } );
	const c = input.update();

	check( 'hay control', input.hasControl === true );
	check( 'la fuente es el mando', input.source === 'gamepad', input.source );
	check( 'roll pasa por la banda muerta',
		Math.abs( c.roll - ( 0.6 - 0.04 ) / 0.96 ) < 1e-9, `${ c.roll.toFixed( 4 ) }` );
	check( 'pitch llega invertido',
		Math.abs( c.pitch + ( 0.5 - 0.04 ) / 0.96 ) < 1e-9, `${ c.pitch.toFixed( 4 ) }` );
	check( 'la banda muerta se come el ruido', c.yaw === 0, `yaw=${ c.yaw }` );
	// El gas físico va de -1 (abajo) a +1 (arriba) y el mapeo lo invierte;
	// `readGamepad` lo remapea a 0..1.
	check( 'el gas se remapea a 0..1', c.throttle === 1, `${ c.throttle }` );
}

console.log( '\n== no queda API de ratón ==' );
{
	const input = new InputManager( { deadzone: 0.04, gamepadMap: null } );
	check( 'sin requestCapture', input.requestCapture === undefined );
	check( 'sin releaseCapture', input.releaseCapture === undefined );
	check( 'sin readMouseKeyboard', input.readMouseKeyboard === undefined );
	check( 'sin resetStick', input.resetStick === undefined );
}

console.log( fails === 0 ? '\nTODO OK\n' : `\n${ fails } FALLOS\n` );
process.exit( fails === 0 ? 0 : 1 );
```

- [ ] **Step 2: Ejecutarlo y ver que falla**

Run: `node tests/input.test.mjs`
Expected: FALLA. `input.hasControl` es `undefined` (no existe todavía), `input.source` vale `'mouse'` en vez de `'none'`, y los cuatro checks de «no queda API de ratón» fallan porque los métodos siguen ahí.

- [ ] **Step 3: Reescribir `src/input.js`**

Cabecera del fichero — sustituir el comentario de clase (`src/input.js:10-15`) por:

```js
/**
 * Entrada del piloto: mando, y sólo mando.
 *
 * Hubo un camino de ratón y teclado con un stick virtual que no se autocentraba;
 * se quitó a propósito. Un 5" en acro se pilota con dos sticks analógicos, y
 * mantener el repuesto obligaba a duplicarlo todo —modo de entrada, sensibilidad
 * del ratón, captura del puntero— para una forma de volar que no es la de verdad.
 *
 * Las teclas que quedan (`Esc`, `R`) son órdenes de juego, no mandos de vuelo.
 */
```

En el constructor, borrar `this.captured = false;` y `this._mouseStick = { x: 0, y: 0 };`. Borrar el manejador `_onMouseMove` entero y el `_onPointerLockChange` entero.

En `attach()`, quitar el parámetro y las dos líneas del ratón:

```js
	attach() {

		// Ya no se guarda el elemento: sólo lo usaba el pointer lock.
		window.addEventListener( 'keydown', this._onKeyDown );
		window.addEventListener( 'keyup', this._onKeyUp );
		window.addEventListener( 'gamepadconnected', this._onGamepad );

		const pads = navigator.getGamepads?.() || [];
		for ( const pad of pads ) if ( pad ) this.gamepadIndex = pad.index;

	}

	detach() {

		window.removeEventListener( 'keydown', this._onKeyDown );
		window.removeEventListener( 'keyup', this._onKeyUp );
		window.removeEventListener( 'gamepadconnected', this._onGamepad );

	}

	/** Hay con qué volar: mando conectado y ejes mapeados. */
	get hasControl() {

		return this.getGamepad() !== null && !! this.config.gamepadMap;

	}
```

Borrar `requestCapture()`, `releaseCapture()` y `resetStick()` completos.

Sustituir el cuerpo de `update()` (`src/input.js:159-183`) por:

```js
	update() {

		this._edges.clear();
		for ( const code of this._pending ) this._edges.add( code );
		this._pending.clear();

		const pad = this.getGamepad();

		if ( pad && this.config.gamepadMap ) {

			this.source = 'gamepad';
			this.readGamepad( pad, this.config.gamepadMap );

		} else {

			// Sin mando no se inventa nada: ejes al centro y gas cortado. Quien
			// decide qué hacer con eso es `main.js`, que pausa el vuelo.
			this.source = 'none';
			this.controls.roll = 0;
			this.controls.pitch = 0;
			this.controls.yaw = 0;
			this.controls.throttle = 0;

		}

		return this.controls;

	}
```

Borrar `readMouseKeyboard()` completo. `readGamepad()`, `deadzone()`, `getGamepad()`, `pollRaw()`, `rawCount` y `consumeKey()` se quedan como están.

- [ ] **Step 4: Ejecutar el test y verlo pasar**

Run: `node tests/input.test.mjs`
Expected: `TODO OK`.

- [ ] **Step 5: Desenganchar `main.js`**

En `startFlying()` borrar estas dos líneas (`src/main.js:328-330`):

```js
	input.resetStick( drone.hoverThrottle );

	if ( input.source !== 'gamepad' ) input.requestCapture();
```

En `pauseFlight()` (`:344`) y en `backToMenu()` (`:355`) borrar `input.releaseCapture();`.

En `frame()`, dentro del bloque de `KeyR` (`:374-380`), borrar `input.resetStick( drone.hoverThrottle );`. El bloque queda:

```js
	if ( input.consumeKey( 'KeyR' ) ) {

		drone.respawn();
		hud.skipFrames( 4 );

	}
```

En `init()` (`:499`) cambiar `input.attach( document.body );` por `input.attach();`.

Borrar los dos bloques de pointer lock de `init()` (`src/main.js:525-553`): el comentario «Salir del pointer lock…» con su `let hadPointerLock` y su `document.addEventListener( 'pointerlockchange', … )`, y el comentario «Volver a capturar el ratón…» con su `document.addEventListener( 'click', … )`.

- [ ] **Step 6: Meter el test en la batería**

En `package.json:10`, la línea `"test"` pasa a:

```json
    "test": "node tests/config.test.mjs && node tests/flight.test.mjs && node tests/input.test.mjs && node tests/world.test.mjs"
```

- [ ] **Step 7: Batería completa**

Run: `npm test`
Expected: cuatro `TODO OK`.

- [ ] **Step 8: Commit**

```bash
git add src/input.js src/main.js tests/input.test.mjs package.json
git commit -m "refactor: el dron se pilota sólo con mando"
```

---

### Task 2: Sin mando no se despega, pero la zona no se pierde

El vuelo queda condicionado a `input.hasControl`. Sin control se entra en pausa —con la zona cargada— y desde ahí se puede mapear el mando, porque el panel de mapeo se monta también en la pantalla de pausa. Desconectar el mando en vuelo pausa, igual que perder el foco de la pestaña.

**Files:**
- Modify: `index.html:84-95`
- Modify: `src/main.js` (mapa `dom`, `startFlying`, `pauseFlight`, `backToMenu`, `init`)
- Modify: `src/menu.js:521-711` (`buildGamepadPanel`)

**Interfaces:**
- Consumes: `input.hasControl` de la Task 1.
- Produces: `buildGamepadPanel( container, config, input, { onChange } = {} )` — cuarto parámetro nuevo; `onChange()` se llama sin argumentos cada vez que cambia `config.gamepadMap`. Sigue devolviendo `{ dispose() }`.

- [ ] **Step 1: Sitio en el DOM para el panel y el aviso**

En `index.html`, el bloque `#pause` (`:84-95`) pasa a:

```html
	<div id="pause" hidden>
		<div class="panel">
			<h2>Pausa</h2>
			<p id="pause-note" class="note">La zona ya está cargada en memoria: reanudar es instantáneo.</p>
			<div class="row actions">
				<button id="btn-resume" class="primary">Reanudar</button>
				<button id="btn-respawn">Reaparecer</button>
				<button id="btn-menu">Cambiar de zona</button>
			</div>
			<div id="pause-gamepad"></div>
			<div id="pause-settings"></div>
		</div>
	</div>
```

En el mapa `dom` de `src/main.js`, añadir junto a `pauseSettings`:

```js
	pauseNote: document.getElementById( 'pause-note' ),
	pauseGamepad: document.getElementById( 'pause-gamepad' ),
```

- [ ] **Step 2: `buildGamepadPanel` avisa de los cambios de mapeo**

En `src/menu.js:521`, la firma pasa a:

```js
export function buildGamepadPanel( container, config, input, { onChange } = {} ) {
```

Hay cuatro sitios que tocan `config.gamepadMap`; cada uno llama a `onChange?.()` justo después:

1. El `onchange` de la casilla `inv` (`:541-546`):

```js
				onchange: e => {

					ensureMap();
					config.gamepadMap[ axis.id ].inv = e.target.checked;
					onChange?.();

				},
```

2. El final de la detección con éxito (`:655-660`):

```js
						ensureMap();
						config.gamepadMap[ detecting.axis.id ] = {
							axis: detecting.bestAxis,
							inv: detecting.bestValue < 0,
						};
						detecting.tag.textContent = `eje ${ detecting.bestAxis } ✓`;
						onChange?.();
```

3. El botón «Mapeo por defecto» (`:687-695`):

```js
			h( 'button', {
				text: 'Mapeo por defecto',
				onclick: () => {

					config.gamepadMap = null;
					ensureMap();
					onChange?.();

				},
			} ),
```

4. El botón «Usar sólo ratón y teclado» (`:696-704`) **se borra entero**: ya no hay a qué caer.

- [ ] **Step 3: Los textos del panel dejan de prometer ratón**

El mensaje sin mando (`src/menu.js:614-616`) pasa a:

```js
		status.textContent = pad
			? `Mando: ${ pad.id } · ${ pad.axes.length } ejes`
			: 'Sin mando detectado. Conéctalo y mueve un stick: sin mando no se puede volar.';
```

Y la nota del final del panel (`src/menu.js:706-709`) pasa a:

```js
		h( 'p', {
			class: 'note',
			html: 'Se vuela con mando: los cuatro ejes tienen que estar mapeados. Del teclado sólo quedan <kbd>R</kbd> para reaparecer y <kbd>Esc</kbd> para pausar.',
		} ),
```

- [ ] **Step 4: La pantalla de pausa, en un solo sitio**

En `src/main.js`, junto a las demás variables de estado (`let rafId = 0;` y compañía), añadir:

```js
let pauseGamepad = null;   // panel de mapeo montado en la pausa
```

Sustituir `startFlying()` y `pauseFlight()` (`src/main.js:322-349`) por:

```js
function startFlying() {

	// Sin mando no se despega. La zona ya cargada NO se tira: se espera en
	// pausa, que es donde se puede mapear el mando sin perder la descarga.
	if ( ! input.hasControl ) {

		phase = 'paused';
		cancelAnimationFrame( rafId );
		hud.hide();
		openPause();
		return;

	}

	phase = 'flying';
	closePause();
	hud.show();
	hud.skipFrames( 12 );

	lastTime = performance.now();
	cancelAnimationFrame( rafId );
	rafId = requestAnimationFrame( frame );

}

function pauseFlight() {

	if ( phase !== 'flying' ) return;

	phase = 'paused';
	cancelAnimationFrame( rafId );
	hud.hide();
	openPause();

}

/**
 * Monta la pantalla de pausa. El panel de mando va aquí y no sólo en el menú
 * principal a propósito: llegar al menú desde el vuelo es «Cambiar de zona», que
 * descarga el mundo, y quedarse sin mando no puede costar una descarga entera.
 */
function openPause() {

	dom.pause.hidden = false;
	buildPauseSettings( dom.pauseSettings, config, onLiveSettingChange );

	pauseGamepad?.dispose();
	pauseGamepad = buildGamepadPanel( dom.pauseGamepad, config, input, { onChange: refreshResume } );

	refreshResume();

}

function closePause() {

	dom.pause.hidden = true;
	pauseGamepad?.dispose();
	pauseGamepad = null;

}

/** Reanudar sólo está disponible si hay con qué pilotar. */
function refreshResume() {

	const ready = input.hasControl;

	dom.btnResume.disabled = ! ready;
	dom.btnRespawn.disabled = ! ready;
	dom.pauseNote.textContent = ready
		? 'La zona ya está cargada en memoria: reanudar es instantáneo.'
		: 'Sin mando no se vuela. Conéctalo y mapea los cuatro ejes aquí abajo; la zona sigue cargada.';

}
```

En `backToMenu()` (`:351-362`), sustituir `dom.pause.hidden = true;` por `closePause();`.

- [ ] **Step 5: Conectar y desconectar el mando**

En `init()`, junto al listener de `visibilitychange`, añadir:

```js
	window.addEventListener( 'gamepadconnected', () => {

		if ( phase === 'paused' ) refreshResume();

	} );

	// Quedarse sin mando en vuelo es quedarse sin control: se pausa, igual que
	// al perder el foco de la pestaña.
	window.addEventListener( 'gamepaddisconnected', () => {

		if ( phase === 'flying' ) pauseFlight();
		else if ( phase === 'paused' ) refreshResume();

	} );
```

- [ ] **Step 6: Comprobar que la batería sigue verde**

Run: `npm test`
Expected: cuatro `TODO OK`. (Ninguna prueba cubre el DOM; esto sólo verifica que no se ha roto nada de lo que sí se prueba.)

- [ ] **Step 7: Comprobación manual en el navegador**

Run: `npm run dev`, abrir la página y **con el mando desconectado** pulsar «Volar en la ciudad de prueba».
Expected: la zona carga hasta el final y aparece la pantalla de pausa con «Sin mando no se vuela…», «Reanudar» y «Reaparecer» deshabilitados y el panel de mando visible. Al conectar un mando y pulsar «Mapeo por defecto», los dos botones se habilitan y «Reanudar» entra en vuelo. Desconectar el mando en vuelo devuelve a la pausa.

- [ ] **Step 8: Commit**

```bash
git add index.html src/main.js src/menu.js
git commit -m "feat: sin mando mapeado no se despega, pero la zona no se pierde"
```

---

### Task 3: Fuera `inputMode` y `mouseSens`

Los dos valores se quedaron sin nadie que los lea. En este repositorio un número de configuración que no gobierna nada es peso muerto, y hay tests que lo persiguen; este los quita de la única fuente y del contrato, y añade el guardián que impide que el camino del ratón vuelva por descuido.

**Files:**
- Modify: `vuela.config.js:67-81`
- Modify: `src/config.js:121-124`
- Modify: `tests/config.test.mjs:214-218` (comentario) y final del fichero (guardián nuevo)

**Interfaces:**
- Consumes: `input.hasControl` de la Task 1 (el guardián comprueba que ya no hay rastro del ratón en `src/`).
- Produces: `config.inputMode` y `config.mouseSens` dejan de existir.

- [ ] **Step 1: Escribir el guardián que falla**

En `tests/config.test.mjs`, justo antes del `console.log` final de resultados, añadir:

`menuSource` y `mainSource` ya están leídos más arriba en el fichero (líneas 200 y ~227): reutilizarlos, no volver a declararlos.

```js
console.log( '\n== el vuelo por ratón y teclado no vuelve ==' );

// Es el tipo de código que reaparece solo: alguien echa de menos poder probar
// sin mando y vuelve a colar un stick virtual. El camino se quitó a propósito
// —se pilota con mando— y esto lo deja por escrito donde falla. Se miran las
// dos capas: el código que pilotaría y los valores que lo configuraban.
const inputSource = await read( 'input.js' );
const configSource = await read( 'config.js' );
const fileSource = await ( await import( 'node:fs/promises' ) ).readFile(
	new URL( '../vuela.config.js', import.meta.url ), 'utf8' );

const todo = inputSource + mainSource + menuSource + configSource + fileSource;

for ( const rastro of [ 'mouseSens', 'inputMode', 'readMouseKeyboard', 'requestPointerLock', 'pointerlockchange' ] ) {

	check( `sin rastro de ${ rastro }`, ! todo.includes( rastro ) );

}
```

- [ ] **Step 2: Ejecutarlo y ver que falla**

Run: `node tests/config.test.mjs`
Expected: FALLA en `sin rastro de mouseSens` y `sin rastro de inputMode`. Los dos siguen declarados en `vuela.config.js` y en el contrato de `src/config.js`, que es justo lo que quitan los Steps 3 y 4.

- [ ] **Step 3: Quitarlos del fichero de configuración**

En `vuela.config.js`, el bloque «Entrada» (`:67-81`) pasa a:

```js
	// =====================================================================
	//  Entrada
	// =====================================================================

	deadzone: 0.04,

	// Se vuela con mando y nada más. Sin mapeo el mando se IGNORA: aunque esté
	// conectado, no se despega hasta que pulses «Mapeo por defecto» —o detectes
	// los cuatro ejes— en el panel de mando. Para dejarlo fijado desde aquí y no
	// tener que tocar nada al arrancar:
	//   { roll: { axis: 0, inv: false }, pitch: { axis: 1, inv: true },
	//     yaw:  { axis: 2, inv: false }, throttle: { axis: 3, inv: true } }
	gamepadMap: null,
```

- [ ] **Step 4: Quitarlos del contrato**

En `src/config.js`, el bloque `// --- Entrada ---` (`:121-124`) pierde dos líneas y queda:

```js
	// --- Entrada ---
	deadzone: num( 0, 0.9 ),           // `input.js` divide por `1 - deadzone`
```

Comprobar que el ayudante `text()` sigue usándose en otro sitio (`flight.bf.mode`, `flight.bf.rateType`): si quedara sin uso habría que borrarlo, pero no es el caso.

- [ ] **Step 5: Actualizar el comentario de cobertura de `ui`**

En `tests/config.test.mjs:214-218`, la lista de valores sin control de menú menciona `mouseSens`, que ya no existe. El comentario pasa a:

```js
// El guardián no admite excepciones: `ui` es el recorrido de los deslizadores y
// nada más. Los valores sin control —`voxelSize`, `crashSpeed`, `deadzone`,
// `restitution`, `friction`, `maxSpin`— no tienen entrada aquí; lo que los
// valida es el contrato de `src/config.js`, que es otra cosa y se comprueba
// arriba.
```

- [ ] **Step 6: Batería completa**

Run: `npm test`
Expected: cuatro `TODO OK`, con la sección «el vuelo por ratón y teclado no vuelve» en verde.

- [ ] **Step 7: Commit**

```bash
git add vuela.config.js src/config.js tests/config.test.mjs
git commit -m "refactor: fuera inputMode y mouseSens, que ya no los lee nadie"
```

---

### Task 4: Documentación

El README documenta los controles en su §3 y los tests uno a uno en su §7. Los dos se han quedado desfasados.

**Files:**
- Modify: `README.md:95-114` (§3 Controles)
- Modify: `README.md` §7 (párrafo de los tests)

**Interfaces:**
- Consumes: el comportamiento de las Tasks 1-3.
- Produces: nada de código.

- [ ] **Step 1: Reescribir §3**

`README.md:95-114` pasa a:

```markdown
## 3. Controles

Se vuela **con mando**, y sólo con mando. Cualquier emisora por USB o mando de consola
aparece como joystick. En el menú, *Mando* → *Detectar* en cada eje, mueve el stick en la
dirección que te pida y queda mapeado con su inversión; *Mapeo por defecto* sirve para la
disposición habitual (ejes 0-3) sin detectar nada.

Sin mando mapeado no se despega. La zona **sí** se carga: si terminas la descarga sin mando,
te quedas en la pantalla de pausa con el panel de mapeo a mano, sin perder los minutos de
descarga. Desconectar el mando en vuelo pausa la partida.

Del teclado sólo quedan dos teclas, que son órdenes de juego y no mandos de vuelo:

| | |
|---|---|
| `R` | reaparecer |
| `Esc` | pausa (no recarga: la zona sigue en memoria) |

Si es tu primera vez, empieza en **modo Angle** (autonivelado) y pásate a **Acro** cuando
te encuentres cómodo.
```

- [ ] **Step 2: Añadir el test nuevo a §7**

En el párrafo que enumera los ficheros de prueba, después de la frase que describe
`tests/flight.test.mjs` y antes de la que describe `tests/world.test.mjs`, insertar:

```markdown
`tests/input.test.mjs` cubre la regla de entrada entera: sin mando —o con mando sin
mapear— los ejes llegan a cero y `hasControl` es falso, y con mapeo los ejes pasan por su
inversión y su banda muerta, con el gas remapeado de −1..1 a 0..1. Comprueba además que no
ha vuelto la API del ratón.
```

- [ ] **Step 3: Comprobar que el README no menciona ya el vuelo con ratón**

Run: `grep -n "ratón\|teclado" README.md`
Expected: sólo quedan menciones que **no** son de pilotar — el recorrido de los deslizadores («es lo cómodo de ofrecer con el ratón», §2) y la tabla de teclas de arriba. Cualquier otra hay que corregirla.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: se vuela sólo con mando"
```
