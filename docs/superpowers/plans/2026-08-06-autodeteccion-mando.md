# Autodetección del mando — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que enchufar la emisora de siempre y mover un stick sea todo lo que hay que hacer para volar: el mando se reconoce por su `id`, su mapeo sale de `vuela.config.js`, y cuando hay que calibrar se calibran los cuatro ejes sin inventarse ninguno y sin que dos compartan índice.

**Architecture:** `vuela.config.js` gana un bloque `gamepads` —diccionario `id del mando → sus cuatro ejes`— y pierde `gamepadMap`, que pasa a ser estado en memoria: el mapa *activo*. `InputManager` es quien reconoce el mando: cada vez que adopta un pad compara su `id` con el del mapa activo y, si ha cambiado, pone el mapeo que el fichero tenga para él (o ninguno). La calibración deja de ser lógica de interfaz y se convierte en tres piezas puras de `src/input.js` —`AxisPicker`, `hasReturned`, `Calibration`— que reciben muestras de ejes y segundos, y por eso se prueban enteras en Node. El panel sale de `menu.js` a `src/gamepadPanel.js` y se limita a alimentarlas y pintar.

**Tech Stack:** JavaScript ESM puro, Vite 8, three.js. Sin dependencias nuevas. Tests caseros en Node (`node tests/*.mjs`, sin framework) con el ayudante `check( nombre, condición, info )` que ya usan los cuatro ficheros existentes.

**Spec:** `docs/superpowers/specs/2026-08-06-autodeteccion-mando-design.md`

## Global Constraints

- **Estilo del repositorio:** tabuladores para indentar, espacios dentro de los paréntesis (`fn( a, b )`), línea en blanco tras la apertura de un bloque de función/clase y antes del cierre, comentarios en castellano que expliquen el *porqué*, no el qué.
- **`vuela.config.js` es la única fuente de configuración.** No se guarda nada en el navegador y el juego no reescribe el fichero nunca: el mapeo llega ahí pegado a mano.
- **Si al empezar una tarea que toca `vuela.config.js` hay cambios sin commitear en ese fichero:** `git stash push -- vuela.config.js`, hacer la tarea, y devolverlos después. Los ajustes a mano del dueño van en su propio commit.
- **Umbrales de la calibración, exactos:** acepta con desviación **≥ 0.5**; con **≥ 0.25** si se agota el tiempo; el paso caduca a los **5 s**; el stick se da por vuelto dentro de **±0.15**; la espera del regreso caduca a los **2 s**.
- **Un mapeo incompleto no vuela.** `hasControl` exige los cuatro ejes: con el gas sin mapear, `readGamepad` devuelve 0 y lo remapea a 0.5 —medio gas al despegar, sin stick.
- **Nada se inventa.** Ningún camino puede rellenar ejes que el piloto no haya movido, y dos filas no pueden apuntar al mismo índice.
- **Cada tarea acaba con `npm test` en verde y un commit.**

---

### Task 1: El panel de mando, en su propio fichero

Mover `buildGamepadPanel` de `menu.js` a `src/gamepadPanel.js`, **sin tocar una línea de su lógica**. `menu.js` va por 783 líneas y el panel va a crecer unas 80 más. Al acabar, el juego se comporta exactamente igual.

**Files:**
- Create: `src/gamepadPanel.js`
- Modify: `src/menu.js:519-714` (se borra el bloque), `src/main.js:11` (sólo el import; las dos llamadas, `main.js:376` y `main.js:526`, no cambian)
- Modify: `tests/config.test.mjs:238-249`

**Interfaces:**
- Consumes: nada.
- Produces: `buildGamepadPanel( container, config, input, { onChange } )` pasa a exportarse desde `src/gamepadPanel.js` con la misma firma y el mismo `{ dispose() }` de vuelta. `menu.js` sigue exportando `h`.

- [ ] **Step 1: Crear `src/gamepadPanel.js` con el panel movido tal cual**

Corta el bloque entero de `src/menu.js` que va desde el comentario separador anterior a `export function buildGamepadPanel` hasta el cierre de esa función (líneas 519-714, incluida la línea `// ---…---` que lo precede) y pégalo en el fichero nuevo, con esta cabecera:

```js
import { AXES } from './input.js';
import { h } from './menu.js';

/*
 * El panel de mando: estado del mando, las cuatro barras de ejes y la
 * calibración. Vive aparte de `menu.js` porque se monta en dos sitios —el menú
 * principal y la pantalla de pausa— y porque `menu.js` ya es largo de sobra.
 */
```

El cuerpo de `buildGamepadPanel` no se toca en esta tarea: se mueve literalmente, `ensureMap()` incluida.

- [ ] **Step 2: Quitarlo de `menu.js`**

En `src/menu.js`, borra el bloque movido. Comprueba que sigue estando `export { h };` al final del fichero y que `import { AXES } from './input.js';` (línea 2) ya no lo usa nadie ahí: si no queda ningún uso de `AXES` en `menu.js`, borra también ese import.

- [ ] **Step 3: Apuntar `main.js` al fichero nuevo**

En `src/main.js:11`, separa el import:

```js
import { buildMenu, buildPauseSettings } from './menu.js';
import { buildGamepadPanel } from './gamepadPanel.js';
```

Las dos llamadas (`main.js:376` y `main.js:526`) no cambian.

- [ ] **Step 4: Que el guardián del ratón mire también el fichero nuevo**

`tests/config.test.mjs` concatena los fuentes para comprobar que no vuelve el vuelo por ratón y teclado. El panel se ha ido de `menu.js`, así que el fichero nuevo tiene que entrar en esa suma. En `tests/config.test.mjs`, junto a las otras lecturas:

```js
const panelSource = await read( 'gamepadPanel.js' );
```

y en la concatenación:

```js
const todo = inputSource + mainSource + menuSource + panelSource + configSource + fileSource;
```

- [ ] **Step 5: Verificar**

Run: `npm test`
Expected: TODO OK en los cuatro ficheros. En particular siguen en verde `ningún min/max/step literal en menu.js` y `todos los rangos de ui se usan en el menú` —el panel no usaba ningún `ui.*`, así que moverlo no descubre rangos huérfanos.

Comprueba además que no queda ningún `buildGamepadPanel` en `menu.js`:

Run: `grep -n "buildGamepadPanel\|ensureMap" src/menu.js`
Expected: sin resultados.

- [ ] **Step 6: Commit**

```bash
git add src/gamepadPanel.js src/menu.js src/main.js tests/config.test.mjs
git commit -m "refactor: el panel de mando vive en su propio fichero"
```

---

### Task 2: El fichero guarda un mapeo por mando

`vuela.config.js` gana `gamepads` y pierde `gamepadMap`. Al acabar, el arranque falla nombrando la ruta ante una entrada de mando mal escrita, y el juego sigue funcionando exactamente como antes (el mapeo aún se hace a mano en el panel; reconocerlo llega en la Task 3).

**Files:**
- Modify: `src/config.js:124-129` (contrato), `vuela.config.js:74-80`
- Modify: `tests/config.test.mjs:143` (zona de `catches`)
- Modify: `docs/configuracion.md`

**Interfaces:**
- Consumes: nada.
- Produces: `config.gamepads` — objeto `{ [id: string]: { roll, pitch, yaw, throttle } }`, cada eje `{ axis: number, inv: boolean }`. Puede estar vacío. `config.gamepadMap` deja de venir del fichero: a partir de aquí es estado en memoria y arranca como `undefined`.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/config.test.mjs`, después de `catches( 'borrar deadzone', … )`, añade:

```js
// El mapeo por mando es lo que evita tener que calibrar en cada arranque, y un
// mapeo a medias es peor que ninguno: sin el eje del gas, `readGamepad` lo
// remapea a 0.5 y se despega con medio gas.
catches( 'borrar el bloque gamepads', c => { delete c.gamepads; }, 'gamepads' );
catches( 'un mando con sólo tres ejes', c => {
	c.gamepads = { 'Mando de prueba': {
		roll: { axis: 0, inv: false },
		pitch: { axis: 1, inv: true },
		yaw: { axis: 2, inv: false },
	} };
}, 'gamepads.Mando de prueba.throttle' );
catches( 'un eje fuera del rango del mando', c => {
	c.gamepads = { 'Mando de prueba': {
		roll: { axis: 99, inv: false },
		pitch: { axis: 1, inv: true },
		yaw: { axis: 2, inv: false },
		throttle: { axis: 3, inv: true },
	} };
}, 'gamepads.Mando de prueba.roll.axis' );
catches( 'inv escrito como cadena', c => {
	c.gamepads = { 'Mando de prueba': {
		roll: { axis: 0, inv: 'no' },
		pitch: { axis: 1, inv: true },
		yaw: { axis: 2, inv: false },
		throttle: { axis: 3, inv: true },
	} };
}, 'gamepads.Mando de prueba.roll.inv' );
```

Y justo después, la comprobación de que el diccionario vacío es legítimo —un mando sin calibrar no es un error, es un mando sin calibrar:

```js
const vacio = structuredClone( baseConfig );
vacio.gamepads = {};
check( 'un fichero sin mandos guardados es válido', validate( vacio ).errors.length === 0 );
```

- [ ] **Step 2: Ver que fallan**

Run: `node tests/config.test.mjs`
Expected: FAIL en los cuatro `catches` (aún no hay contrato que cace nada) y en `un fichero sin mandos guardados es válido` no —ése pasa por casualidad—. Además falla `no hay claves que no lea nadie`, porque `gamepads` todavía no está en el `SCHEMA`.

- [ ] **Step 3: Meter `gamepads` en el contrato y sacar `gamepadMap`**

En `src/config.js`, sustituye el bloque `gamepadMap` (líneas 124-129) por:

```js
	// Un mapeo por mando, guardado bajo el `id` que reporta el navegador. Es lo
	// que permite enchufar y volar sin calibrar nada; el mapa que se está usando
	// no vive aquí, porque depende de qué mando haya enchufado ahora mismo.
	gamepads: record( block( {
		roll: padAxis,
		pitch: padAxis,
		yaw: padAxis,
		throttle: padAxis,
	} ) ),
```

`record()`, `block()` y `padAxis` ya existen en el fichero. `orNull` puede quedarse sin usar; si no lo usa nadie más, bórralo.

- [ ] **Step 4: Cambiar el fichero de configuración**

En `vuela.config.js`, sustituye el comentario y la clave `gamepadMap: null` (líneas 74-80) por:

```js
	// Un mapeo por mando, con la clave que reporta el navegador (aparece en el
	// panel de mando, y es distinta en Chrome y en Firefox). El que esté aquí se
	// aplica solo al enchufarlo: mover un stick es todo el trámite. Los que no
	// estén se calibran en el panel, que te da este mismo trozo listo para pegar.
	gamepads: {},
```

- [ ] **Step 5: Verificar**

Run: `npm test`
Expected: TODO OK. Los cuatro `catches` nuevos nombran su ruta, `el fichero actual cumple el contrato` y `no hay claves que no lea nadie` siguen en verde (`gamepadMap` ya no está ni en el fichero ni en el contrato).

- [ ] **Step 6: Documentar el bloque**

En `docs/configuracion.md`, entre la sección `## Vuelo` y `## Aparato`, añade:

```markdown
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
```

- [ ] **Step 7: Commit**

```bash
git add src/config.js vuela.config.js tests/config.test.mjs docs/configuracion.md
git commit -m "feat: el fichero guarda un mapeo por cada mando"
```

---

### Task 3: El mando se reconoce por su id

`InputManager` deja de ser ciego al `id`: cada vez que adopta un pad, si ha cambiado de aparato pone el mapeo que el fichero tenga para él. Y `hasControl` pasa a exigir los cuatro ejes. Al acabar, con la emisora en `gamepads` se puede despegar sin tocar el panel.

**Files:**
- Modify: `src/input.js:20-114` (constructor, `attach`, `_onGamepad`, `hasControl`, `getGamepad`)
- Modify: `tests/input.test.mjs:19-70`

**Interfaces:**
- Consumes: `config.gamepads` (Task 2).
- Produces:
  - `isCompleteMap( map ) → boolean` — exportada de `src/input.js`; true si el mapa trae los cuatro ejes de `AXES` con un `axis` numérico.
  - `input.mappedId` — `string | null`, el `id` del mando al que pertenece `config.gamepadMap`.
  - `input.getGamepad()` sigue devolviendo el pad o `null`, pero ahora **adopta**: deja `config.gamepadMap` coherente con el mando que devuelve.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/input.test.mjs`, cambia el ayudante `fakePad` para que los mandos tengan nombre —ahora es lo que los identifica— y añade el import de `isCompleteMap`:

```js
import { InputManager, isCompleteMap } from '../src/input.js';
```

```js
const fakePad = ( axes, id = 'Mando de prueba' ) => ( { index: 0, id, connected: true, axes } );
```

Reescribe el bloque `== con mando y mapeo llegan los ejes ==` para que el mapeo llegue por donde llega ahora, que es el fichero:

```js
console.log( '\n== con mando conocido llegan los ejes, sin tocar nada ==' );
{
	setPads( [ fakePad( [ 0.6, 0.5, 0.02, - 1 ] ) ] );
	const input = new InputManager( { deadzone: 0.04, gamepads: { 'Mando de prueba': MAPA } } );
	const c = input.update();

	check( 'hay control', input.hasControl === true );
	check( 'el mapeo del fichero se aplica solo', input.config.gamepadMap?.roll.axis === 0 );
	check( 'roll pasa por la banda muerta',
		Math.abs( c.roll - ( 0.6 - 0.04 ) / 0.96 ) < 1e-9, `${ c.roll.toFixed( 4 ) }` );
	check( 'pitch llega invertido',
		Math.abs( c.pitch + ( 0.5 - 0.04 ) / 0.96 ) < 1e-9, `${ c.pitch.toFixed( 4 ) }` );
	check( 'la banda muerta se come el ruido', c.yaw === 0, `yaw=${ c.yaw }` );
	// El gas físico va de -1 (abajo) a +1 (arriba) y el mapeo lo invierte;
	// `readGamepad` lo remapea a 0..1.
	check( 'el gas se remapea a 0..1', c.throttle === 1, `${ c.throttle }` );
}
```

Y añade, después del bloque `== un mando sin mapear tampoco vuela ==`, estos cuatro:

```js
console.log( '\n== el mapeo guardado es una copia, no la biblioteca ==' );
{
	setPads( [ fakePad( [ 0, 0, 0, - 1 ] ) ] );
	const gamepads = { 'Mando de prueba': structuredClone( MAPA ) };
	const input = new InputManager( { deadzone: 0.04, gamepads } );
	input.update();

	input.config.gamepadMap.roll.axis = 7;
	check( 'recalibrar no edita lo que vino del fichero', gamepads[ 'Mando de prueba' ].roll.axis === 0 );
}

console.log( '\n== un mando desconocido no inventa mapeo ==' );
{
	setPads( [ fakePad( [ 0.9, 0, 0, - 1 ], 'Emisora rarísima' ) ] );
	const input = new InputManager( { deadzone: 0.04, gamepads: { 'Mando de prueba': MAPA } } );
	const c = input.update();

	check( 'no hay control', input.hasControl === false );
	check( 'no se ha inventado un mapa', ! input.config.gamepadMap );
	check( 'los ejes no llegan', c.roll === 0, `roll=${ c.roll }` );
}

console.log( '\n== cambiar de mando cambia de mapeo ==' );
{
	// El mapa activo pertenece al mando que hay en la mano: los ejes de una
	// emisora en otra no son los mismos ejes.
	setPads( [ fakePad( [ 0, 0, 0, - 1 ] ) ] );
	const input = new InputManager( { deadzone: 0.04, gamepads: { 'Mando de prueba': MAPA } } );
	input.update();
	check( 'el conocido queda mapeado', isCompleteMap( input.config.gamepadMap ) );

	setPads( [ fakePad( [ 0, 0, 0, - 1 ], 'Emisora rarísima' ) ] );
	input.update();
	check( 'al enchufar otro, el mapeo anterior deja de valer', ! input.config.gamepadMap );

	// Y desenchufar y volver a enchufar el MISMO no puede tirar una calibración
	// recién hecha y todavía sin pegar en el fichero.
	input.config.gamepadMap = structuredClone( MAPA );
	setPads( [ fakePad( [ 0, 0, 0, - 1 ], 'Emisora rarísima' ) ] );
	input.update();
	check( 'reenchufar el mismo mando respeta lo calibrado', isCompleteMap( input.config.gamepadMap ) );
}

console.log( '\n== un mapeo a medias no vuela ==' );
{
	// Sin el eje del gas, `readGamepad` devuelve 0 y lo remapea a (0+1)*0.5:
	// medio gas al despegar, sin stick. Es el fallo que `hasControl` tapaba.
	const aMedias = structuredClone( MAPA );
	delete aMedias.throttle;

	check( 'isCompleteMap lo rechaza', isCompleteMap( aMedias ) === false );
	check( 'isCompleteMap acepta los cuatro', isCompleteMap( MAPA ) === true );

	setPads( [ fakePad( [ 0, 0, 0, - 1 ] ) ] );
	const input = new InputManager( { deadzone: 0.04, gamepads: { 'Mando de prueba': aMedias } } );
	input.update();
	check( 'no hay control con el gas sin mapear', input.hasControl === false );
}
```

- [ ] **Step 2: Ver que fallan**

Run: `node tests/input.test.mjs`
Expected: FAIL. El primero es `SyntaxError`/`isCompleteMap is not a function` al importar algo que no existe.

- [ ] **Step 3: Implementar**

En `src/input.js`, debajo de la constante `AXES`, añade:

```js
/**
 * Un mapeo sirve para volar sólo si trae los cuatro ejes. Uno a medias es peor
 * que ninguno: `readGamepad` devuelve 0 para el eje que falta, y el gas —que se
 * remapea de −1..1 a 0..1— sale como 0.5. Medio gas al despegar, sin stick.
 */
export function isCompleteMap( map ) {

	return !! map && AXES.every( ( { id } ) => typeof map[ id ]?.axis === 'number' );

}
```

En el constructor, junto a `this.gamepadIndex = null;`:

```js
		// De qué mando es el mapa que hay activo. Se compara por `id` y no por
		// índice porque el índice lo reparte el navegador y cambia solo.
		this.mappedId = null;
```

Sustituye `_onGamepad` por:

```js
		this._onGamepad = () => {

			// Adoptar —y con ello aplicar el mapeo guardado— es cosa de
			// `getGamepad()`. Aquí sólo se le hace mirar ya, sin esperar al
			// siguiente frame: en el menú y en la pausa no hay bucle de vuelo.
			this.getGamepad();

		};
```

En `attach()`, sustituye el barrido final por:

```js
		// Un mando que ya estuviera visible al arrancar se adopta aquí mismo. Si
		// el navegador aún no lo enseña —no lo hace hasta que lo tocas: es una
		// defensa antihuella, no un fallo— lo hará `gamepadconnected`.
		this.getGamepad();
```

Sustituye `hasControl` y `getGamepad` por:

```js
	/**
	 * Hay con qué volar: mando conectado y los cuatro ejes mapeados. Los cuatro,
	 * no «algún mapeo»: ver `isCompleteMap`.
	 */
	get hasControl() {

		return this.getGamepad() !== null && isCompleteMap( this.config.gamepadMap );

	}

	getGamepad() {

		const pads = navigator.getGamepads?.() || [];
		const known = this.gamepadIndex !== null ? pads[ this.gamepadIndex ] : null;

		if ( known ) return this._adopt( known );

		for ( const pad of pads ) if ( pad && pad.connected ) return this._adopt( pad );

		return null;

	}

	/**
	 * Toma este mando como el que se está usando y, si ha cambiado de aparato,
	 * pone el mapeo que le toca.
	 *
	 * El mapa activo pertenece siempre al mando que hay en la mano: si el fichero
	 * conoce su `id` se aplica su mapeo —enchufar y mover un stick es todo el
	 * trámite—, y si no lo conoce, el mapa anterior deja de valer, porque los
	 * ejes de otra emisora en ésta no son los mismos ejes.
	 *
	 * Por `id` y no por índice: desenchufar y volver a enchufar el mismo mando no
	 * puede tirar una calibración recién hecha y todavía sin pegar en el fichero.
	 */
	_adopt( pad ) {

		this.gamepadIndex = pad.index;

		if ( pad.id !== this.mappedId ) {

			this.mappedId = pad.id;
			const saved = this.config.gamepads?.[ pad.id ];
			// Copia: recalibrar no puede editar la biblioteca del fichero.
			this.config.gamepadMap = saved ? structuredClone( saved ) : null;

		}

		return pad;

	}
```

- [ ] **Step 4: Verificar**

Run: `npm test`
Expected: TODO OK en los cuatro ficheros.

Y comprobar una dependencia de orden que no rompe ningún test pero sí la pantalla de pausa:

Run: `grep -n "input.attach()\|'gamepadconnected'" src/main.js`
Expected: `input.attach()` aparece **antes** que el `addEventListener( 'gamepadconnected', … )` de `main.js`. Los oyentes de un mismo evento corren en orden de registro, así que el mapeo ya está aplicado cuando `main.js` llama a `refreshResume()`. Invertirlo dejaría «Reanudar» apagado hasta el siguiente evento.

- [ ] **Step 5: Commit**

```bash
git add src/input.js tests/input.test.mjs
git commit -m "feat: el mando se reconoce por su id y trae su mapeo puesto"
```

---

### Task 4: La calibración, como pieza probada

Las tres piezas puras que el panel necesitará: encontrar qué eje se mueve, saber si el stick ha vuelto, y encadenar los cuatro pasos. Ninguna toca el navegador ni el reloj, así que se prueban enteras en Node. Al acabar no cambia nada de lo que se ve: el panel aún usa su detección vieja.

**Files:**
- Modify: `src/input.js` (al final del fichero)
- Modify: `tests/input.test.mjs` (antes del recuento final)

**Interfaces:**
- Consumes: `AXES` (ya exportada).
- Produces, todo desde `src/input.js`:
  - `new AxisPicker( base, { exclude = [], accept = 0.5, floor = 0.25, timeout = 5 } )` con `sample( axes, elapsed ) → null | { axis: number, inv: boolean } | { axis: null }`. `base` es una foto de `pad.axes`; `elapsed`, segundos desde que empezó el paso.
  - `hasReturned( axes, base, axis, tolerance = 0.15 ) → boolean`.
  - `new Calibration( opts )` con `begin( axes, t )`, `sample( axes, t ) → 'buscando' | 'suelta' | 'hecho' | 'fallo'`, y las propiedades `step` (el elemento de `AXES` que toca, o `null`), `map` (lo calibrado hasta ahora), `used` (índices ya asignados), `done`, `failed` (id del eje que no se detectó). `t` en segundos.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/input.test.mjs`, antes de la línea del recuento (`console.log( fails === 0 ? … )`), añade:

```js
console.log( '\n== encontrar qué eje se mueve ==' );
{
	const picker = new AxisPicker( [ 0, 0, 0, - 1 ] );

	check( 'con los sticks quietos no decide nada', picker.sample( [ 0, 0, 0, - 1 ], 0.1 ) === null );
	check( 'un temblorcillo tampoco', picker.sample( [ 0, 0.1, 0, - 1 ], 0.2 ) === null );

	const got = picker.sample( [ 0, 0, 0.8, - 1 ], 0.3 );
	check( 'acepta en cuanto pasa el umbral', got?.axis === 2, JSON.stringify( got ) );
	check( 'y no lo da por invertido', got?.inv === false );
}
{
	const picker = new AxisPicker( [ 0, 0, 0, - 1 ] );
	const got = picker.sample( [ 0, - 0.9, 0, - 1 ], 0.3 );
	check( 'el signo del valor decide la inversión', got?.axis === 1 && got?.inv === true );
}
{
	// Es lo que impide que timón y gas acaben leyendo el mismo stick.
	const picker = new AxisPicker( [ 0, 0, 0, - 1 ], { exclude: [ 2 ] } );
	check( 'un eje con dueño no puede volver a ganar', picker.sample( [ 0, 0, 0.9, - 1 ], 0.3 ) === null );

	const got = picker.sample( [ 0.6, 0, 0.9, - 1 ], 0.4 );
	check( 'gana el mejor de los que quedan libres', got?.axis === 0, JSON.stringify( got ) );
}
{
	const picker = new AxisPicker( [ 0, 0, 0, - 1 ] );
	picker.sample( [ 0, 0, 0.3, - 1 ], 1 );
	const got = picker.sample( [ 0, 0, 0.3, - 1 ], 5 );
	check( 'al agotarse el tiempo vale un movimiento pequeño', got?.axis === 2, JSON.stringify( got ) );
}
{
	const picker = new AxisPicker( [ 0, 0, 0, - 1 ] );
	const got = picker.sample( [ 0, 0, 0.05, - 1 ], 5 );
	check( 'sin movimiento de verdad, el paso falla', got?.axis === null, JSON.stringify( got ) );
}

console.log( '\n== saber si el stick ha vuelto ==' );
{
	check( 'fuera no ha vuelto', hasReturned( [ 0, 0, 0.9, 0 ], [ 0, 0, 0, 0 ], 2 ) === false );
	check( 'dentro de la tolerancia sí', hasReturned( [ 0, 0, 0.1, 0 ], [ 0, 0, 0, 0 ], 2 ) === true );
	// Se compara contra la foto del principio del paso, no contra el cero: en una
	// emisora el gas se queda donde lo dejas.
	check( 'vuelve a donde estaba, no al centro', hasReturned( [ 0, 0, 0, - 1 ], [ 0, 0, 0, - 1 ], 3 ) === true );
}

console.log( '\n== la calibración guiada, los cuatro ejes ==' );
{
	const cal = new Calibration();
	const quieto = [ 0, 0, 0, - 1 ];
	cal.begin( quieto, 0 );

	check( 'empieza por los alerones', cal.step.id === 'roll' );

	check( 'mientras no se mueve, busca', cal.sample( quieto, 0.1 ) === 'buscando' );
	check( 'con el stick a la derecha, pide soltarlo', cal.sample( [ 0.9, 0, 0, - 1 ], 0.2 ) === 'suelta' );
	check( 'y no pasa al siguiente hasta que vuelve', cal.sample( [ 0.9, 0, 0, - 1 ], 0.5 ) === 'suelta' );
	check( 'el eje sigue siendo el de los alerones', cal.step.id === 'roll' );

	check( 'en cuanto vuelve, al siguiente', cal.sample( quieto, 0.8 ) === 'buscando' );
	check( 'toca el elevador', cal.step.id === 'pitch' );

	cal.sample( [ 0, - 0.9, 0, - 1 ], 1 );
	cal.sample( quieto, 1.2 );
	check( 'toca el timón', cal.step.id === 'yaw' );

	cal.sample( [ 0, 0, 0.9, - 1 ], 1.4 );
	cal.sample( quieto, 1.6 );
	check( 'toca el gas', cal.step.id === 'throttle' );

	check( 'el gas a tope la termina', cal.sample( [ 0, 0, 0, 1 ], 1.8 ) === 'hecho' );
	check( 'no queda paso pendiente', cal.step === null );
	check( 'los cuatro ejes, y distintos',
		isCompleteMap( cal.map ) && new Set( Object.values( cal.map ).map( m => m.axis ) ).size === 4,
		JSON.stringify( cal.map ) );
	check( 'el elevador quedó invertido', cal.map.pitch.inv === true );
	check( 'el gas no', cal.map.throttle.inv === false );
}
{
	// Una palanca de tres posiciones asignada por error no puede colgar la
	// secuencia: el eje ya está excluido y no puede volver a ganar.
	const cal = new Calibration();
	cal.begin( [ 0, 0, 0, - 1 ], 0 );
	cal.sample( [ 0.9, 0, 0, - 1 ], 0.2 );
	check( 'si el stick no vuelve, sigue pidiéndolo', cal.sample( [ 0.9, 0, 0, - 1 ], 1.9 ) === 'suelta' );
	check( 'pero a los 2 s se sigue igual', cal.sample( [ 0.9, 0, 0, - 1 ], 2.3 ) === 'buscando' );
	check( 'y el eje gastado no puede repetirse', cal.used.includes( 0 ) && cal.step.id === 'pitch' );
}
{
	const cal = new Calibration();
	cal.begin( [ 0, 0, 0, - 1 ], 0 );
	check( 'sin mover nada en 5 s, falla', cal.sample( [ 0, 0, 0, - 1 ], 5 ) === 'fallo' );
	check( 'y dice en qué eje se quedó', cal.failed === 'roll' );
	check( 'sin inventarse los otros tres', Object.keys( cal.map ).length === 0 );
}
```

Y amplía el import de la cabecera del fichero:

```js
import { InputManager, isCompleteMap, AxisPicker, hasReturned, Calibration } from '../src/input.js';
```

- [ ] **Step 2: Ver que fallan**

Run: `node tests/input.test.mjs`
Expected: FAIL — `AxisPicker is not a constructor`.

- [ ] **Step 3: Implementar**

Al final de `src/input.js`, después de la clase `InputManager`:

```js
// ---------------------------------------------------------------------------
//  Calibración
// ---------------------------------------------------------------------------

/**
 * Busca qué eje físico se está moviendo, comparándolo con una foto de todos los
 * ejes tomada al empezar el paso.
 *
 * No sabe de navegador ni de reloj: recibe las muestras y los segundos
 * transcurridos. Por eso se prueba entera en Node, que es lo que hace que «no se
 * inventa nada» y «dos ejes no colisionan» sean reglas verificadas y no
 * intenciones.
 */
export class AxisPicker {

	constructor( base, { exclude = [], accept = 0.5, floor = 0.25, timeout = 5 } = {} ) {

		this.base = Array.from( base );
		this.exclude = new Set( exclude );
		this.accept = accept;
		this.floor = floor;
		this.timeout = timeout;

		this.best = 0;
		this.bestAxis = - 1;
		this.bestValue = 0;

	}

	/**
	 * `null` mientras busca · `{ axis, inv }` cuando acepta · `{ axis: null }` si
	 * se agota el tiempo sin un movimiento que valga.
	 */
	sample( axes, elapsed ) {

		for ( let i = 0; i < axes.length; i ++ ) {

			// Un eje que ya tiene dueño no puede volver a ganar.
			if ( this.exclude.has( i ) ) continue;

			const delta = Math.abs( axes[ i ] - ( this.base[ i ] ?? 0 ) );

			if ( delta > this.best ) {

				this.best = delta;
				this.bestAxis = i;
				this.bestValue = axes[ i ];

			}

		}

		if ( this.best >= this.accept ) return this._picked();
		if ( elapsed >= this.timeout ) return this.best >= this.floor ? this._picked() : { axis: null };

		return null;

	}

	_picked() {

		return { axis: this.bestAxis, inv: this.bestValue < 0 };

	}

}

/**
 * ¿Ha vuelto ese eje a donde estaba en la foto? Contra la foto y no contra el
 * centro: en una emisora el gas se queda donde lo dejas.
 */
export function hasReturned( axes, base, axis, tolerance = 0.15 ) {

	return Math.abs( ( axes[ axis ] ?? 0 ) - ( base[ axis ] ?? 0 ) ) <= tolerance;

}

/**
 * La calibración guiada: los cuatro ejes en el orden de `AXES`, uno detrás de
 * otro, y ninguno inventado.
 *
 * Entre paso y paso no se espera un tiempo fijo: se espera a que el stick vuelva
 * a donde estaba. Así su regreso no puede contar como el movimiento del paso
 * siguiente, y el ritmo lo marca la mano y no un temporizador que unas veces
 * sobra y otras se queda corto. Con un tope de dos segundos por si no vuelve —una
 * palanca de tres posiciones, por ejemplo—: ese eje ya está excluido y no puede
 * volver a ganar, así que esperar más no protege de nada y colgaría la secuencia.
 */
export class Calibration {

	constructor( opts = {} ) {

		this.opts = opts;
		this.releaseTimeout = opts.releaseTimeout ?? 2;

		this.map = {};
		this.used = [];
		this.index = 0;
		this.done = false;
		this.failed = null;
		this.picker = null;
		this.release = null;
		this.t0 = 0;

	}

	/** El eje que toca mover ahora, o `null` si ya no queda ninguno. */
	get step() {

		return this.done ? null : AXES[ this.index ];

	}

	/** Arranca el primer paso con la foto de los ejes de este instante. */
	begin( axes, t ) {

		this.map = {};
		this.used = [];
		this.index = 0;
		this.done = false;
		this.failed = null;
		this.release = null;
		this._pick( axes, t );

	}

	/** `'buscando'` · `'suelta'` · `'hecho'` · `'fallo'`. */
	sample( axes, t ) {

		if ( this.done ) return this.failed ? 'fallo' : 'hecho';

		if ( this.release ) {

			const vuelto = hasReturned( axes, this.release.base, this.release.axis );
			if ( ! vuelto && t - this.release.t0 < this.releaseTimeout ) return 'suelta';

			this.release = null;
			this.index ++;
			this._pick( axes, t );
			return 'buscando';

		}

		const got = this.picker.sample( axes, t - this.t0 );
		if ( ! got ) return 'buscando';

		const step = this.step;

		if ( got.axis === null ) {

			this.failed = step.id;
			this.done = true;
			return 'fallo';

		}

		this.map[ step.id ] = { axis: got.axis, inv: got.inv };
		this.used.push( got.axis );

		if ( this.index + 1 >= AXES.length ) {

			this.done = true;
			return 'hecho';

		}

		// El paso no avanza hasta que el stick vuelve: mientras se espera, `step`
		// sigue siendo el eje recién calibrado, que es lo que el panel enseña.
		// La referencia del regreso es la foto del principio del paso —con el
		// stick en reposo—, no la de ahora, que lo pilla en el tope.
		this.release = { axis: got.axis, base: this.picker.base, t0: t };
		return 'suelta';

	}

	_pick( axes, t ) {

		this.picker = new AxisPicker( axes, { ...this.opts, exclude: this.used } );
		this.t0 = t;

	}

}
```

- [ ] **Step 4: Verificar**

Run: `npm test`
Expected: TODO OK.

- [ ] **Step 5: Commit**

```bash
git add src/input.js tests/input.test.mjs
git commit -m "feat: la calibración de los cuatro ejes, como pieza probada"
```

---

### Task 5: El mapeo, listo para pegar en el fichero

Una función pura que escribe el mapeo tal y como va dentro de `gamepads`. Es la única vía por la que un mapeo llega al fichero, porque el juego no lo reescribe nunca.

**Files:**
- Modify: `src/input.js` (junto a `isCompleteMap`)
- Modify: `tests/input.test.mjs`

**Interfaces:**
- Consumes: `AXES`.
- Produces: `mapSnippet( id, map ) → string` — una entrada de `gamepads` con su clave, indentada con tabuladores y terminada en coma.

- [ ] **Step 1: Escribir el test que falla**

En `tests/input.test.mjs`, después del bloque de la calibración guiada:

```js
console.log( '\n== el trozo que se pega en el fichero ==' );
{
	// Lo que vale de este trozo es que se pueda pegar dentro de `gamepads` y
	// vuelva a leerse como el mismo mapeo. Se comprueba evaluándolo, que es
	// justo lo que hará el fichero de configuración al importarse.
	const id = "Emisora d'Andoni (Vendor: 1209)";
	const texto = mapSnippet( id, MAPA );
	const leido = new Function( `return ({${ texto }})` )();

	check( 'vuelve a leerse como el mismo mapeo',
		JSON.stringify( leido ) === JSON.stringify( { [ id ]: MAPA } ), texto );
	check( 'la comilla del nombre no rompe el fichero', Object.keys( leido )[ 0 ] === id );
	check( 'lleva los cuatro ejes en orden',
		texto.indexOf( 'roll' ) < texto.indexOf( 'pitch' )
		&& texto.indexOf( 'pitch' ) < texto.indexOf( 'yaw' )
		&& texto.indexOf( 'yaw' ) < texto.indexOf( 'throttle' ) );
}
```

Añade `mapSnippet` al import de la cabecera.

- [ ] **Step 2: Ver que falla**

Run: `node tests/input.test.mjs`
Expected: FAIL — `mapSnippet is not a function`.

- [ ] **Step 3: Implementar**

En `src/input.js`, justo debajo de `isCompleteMap`:

```js
/**
 * El mapeo escrito tal y como va dentro de `gamepads`, en `vuela.config.js`.
 *
 * Es la única vía por la que un mapeo llega al fichero: el juego no lo reescribe
 * nunca, así que el panel enseña esto y se pega a mano. Una vez por mando.
 */
export function mapSnippet( id, map ) {

	const clave = `'${ id.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" ) }'`;
	const ejes = AXES.map( ( { id: eje } ) =>
		`\t\t${ eje }: { axis: ${ map[ eje ].axis }, inv: ${ !! map[ eje ].inv } },` );

	return `\t${ clave }: {\n${ ejes.join( '\n' ) }\n\t},`;

}
```

- [ ] **Step 4: Verificar**

Run: `npm test`
Expected: TODO OK.

- [ ] **Step 5: Commit**

```bash
git add src/input.js tests/input.test.mjs
git commit -m "feat: el panel podrá dar el mapeo listo para pegar"
```

---

### Task 6: El panel calibra los cuatro ejes

El panel deja de inventarse mapeos. Al acabar: sin mando pide un stick, con mando conocido lo dice y no hay nada que hacer, y con mando desconocido un botón guía los cuatro ejes y da el trozo para pegar.

**Files:**
- Modify: `src/gamepadPanel.js` (el cuerpo entero de `buildGamepadPanel`)
- Modify: `src/styles.css` (al final, junto a `.tag`)

**Interfaces:**
- Consumes: `AXES`, `AxisPicker`, `Calibration`, `isCompleteMap`, `mapSnippet` de `src/input.js`; `input.getGamepad()` (Task 3).
- Produces: la misma firma de siempre, `buildGamepadPanel( container, config, input, { onChange } ) → { dispose() }`. `main.js` no cambia.

- [ ] **Step 1: Reescribir el panel**

Sustituye el contenido entero de `src/gamepadPanel.js` por:

```js
import { AXES, AxisPicker, Calibration, isCompleteMap, mapSnippet } from './input.js';
import { h } from './menu.js';

/*
 * El panel de mando: qué mando hay, cómo se mueven sus cuatro ejes y qué hacer
 * si no está calibrado.
 *
 * Lo que aquí NO hay es lógica de calibración: encontrar el eje que se mueve y
 * encadenar los cuatro pasos son piezas de `input.js`, probadas en Node. Este
 * fichero las alimenta con las muestras del mando y pinta lo que digan.
 */

/** Hacia dónde hay que mover cada stick para que se le vea. */
const DIRS = {
	roll: 'a la DERECHA',
	pitch: 'hacia ARRIBA (morro arriba)',
	yaw: 'a la DERECHA',
	throttle: 'a TOPE',
};

export function buildGamepadPanel( container, config, input, { onChange } = {} ) {

	const rows = [];
	const status = h( 'p', { class: 'note' } );
	const hint = h( 'p', { class: 'note' } );
	const list = h( 'div', { class: 'axes' } );

	// Una detección suelta ({ axis, picker, t0 }) o la guiada de los cuatro.
	let single = null;
	let guided = null;

	for ( const axis of AXES ) {

		const bar = h( 'div', { class: 'axis-bar' }, [ h( 'i' ) ] );
		const tag = h( 'span', { class: 'tag', text: '—' } );

		const detect = h( 'button', { text: 'Detectar', onclick: () => startSingle( axis ) } );

		const invert = h( 'label', { class: 'check' }, [
			h( 'input', {
				type: 'checkbox',
				onchange: e => {

					// Sin eje asignado no hay nada que invertir: antes esto creaba
					// un mapeo entero por defecto.
					const m = config.gamepadMap?.[ axis.id ];
					if ( ! m ) { e.target.checked = false; return; }

					m.inv = e.target.checked;
					changed();

				},
			} ),
			'inv',
		] );

		rows.push( { axis, bar: bar.firstChild, tag, invert: invert.firstChild } );
		list.appendChild( h( 'div', { class: 'axis-row' }, [
			h( 'span', { text: axis.label } ),
			bar,
			tag,
			h( 'span', { class: 'row' }, [ invert, detect ] ),
		] ) );

	}

	const snippet = h( 'textarea', { class: 'snippet', rows: '7', spellcheck: 'false', readonly: true } );
	const snippetBox = h( 'div', { hidden: true }, [
		h( 'p', {
			class: 'note',
			html: 'Pega esto dentro de <code>gamepads</code>, en <code>vuela.config.js</code>, '
				+ 'y este mando quedará reconocido en todos los arranques.',
		} ),
		snippet,
		h( 'button', {
			text: 'Copiar mapeo',
			onclick: () => {

				snippet.select();
				navigator.clipboard?.writeText( snippet.value ).catch( () => {} );

			},
		} ),
	] );

	function changed() {

		refreshSnippet();
		onChange?.();

	}

	function refreshSnippet() {

		const pad = input.getGamepad();
		const listo = !! pad && isCompleteMap( config.gamepadMap );

		snippetBox.hidden = ! listo;
		if ( listo ) snippet.value = mapSnippet( pad.id, config.gamepadMap );

	}

	function startSingle( axis ) {

		const pad = input.getGamepad();
		if ( ! pad ) return;

		guided = null;

		// Los ejes de las otras filas quedan fuera: dos mandos no pueden leer el
		// mismo eje físico.
		const exclude = AXES
			.filter( a => a.id !== axis.id )
			.map( a => config.gamepadMap?.[ a.id ]?.axis )
			.filter( a => a !== undefined );

		single = { axis, picker: new AxisPicker( pad.axes, { exclude } ), t0: performance.now() / 1000 };
		hint.textContent = `${ axis.label }: mueve ${ DIRS[ axis.id ] }…`;

	}

	function startGuided() {

		const pad = input.getGamepad();
		if ( ! pad ) return;

		single = null;
		guided = new Calibration();
		guided.begin( pad.axes, performance.now() / 1000 );

		// Se calibra desde cero: nada heredado que luego no sepas de dónde salió.
		config.gamepadMap = null;
		changed();

	}

	function tick( now ) {

		raf = requestAnimationFrame( tick );

		const t = now / 1000;
		const pad = input.getGamepad();

		if ( ! pad ) {

			status.textContent = 'Mueve un stick para detectar el mando.';
			hint.textContent = 'El navegador no enseña el mando hasta que lo tocas; no es cosa del juego.';
			single = guided = null;
			snippetBox.hidden = true;

			for ( const row of rows ) {

				row.tag.textContent = '—';
				row.bar.style.left = '50%';

			}

			return;

		}

		const conocido = config.gamepads?.[ pad.id ] !== undefined;
		const estado = conocido ? 'mapeo del fichero'
			: isCompleteMap( config.gamepadMap ) ? 'calibrado en esta sesión'
				: 'sin calibrar';

		status.textContent = `Mando: ${ pad.id } · ${ pad.axes.length } ejes · ${ estado }`;

		for ( const row of rows ) {

			const m = config.gamepadMap?.[ row.axis.id ];
			const raw = m && pad.axes[ m.axis ] !== undefined ? pad.axes[ m.axis ] * ( m.inv ? - 1 : 1 ) : 0;

			row.bar.style.left = `${ ( raw * 0.5 + 0.5 ) * 100 }%`;
			row.tag.textContent = m ? `eje ${ m.axis } · ${ raw.toFixed( 2 ) }` : '—';
			row.invert.checked = !! m?.inv;

		}

		if ( single ) {

			const got = single.picker.sample( pad.axes, t - single.t0 );

			if ( got && got.axis === null ) {

				hint.textContent = `No se detectó movimiento en ${ single.axis.label.toLowerCase() }.`;
				single = null;

			} else if ( got ) {

				config.gamepadMap = { ...config.gamepadMap, [ single.axis.id ]: { axis: got.axis, inv: got.inv } };
				hint.textContent = `${ single.axis.label }: eje ${ got.axis } ✓`;
				single = null;
				changed();

			}

		}

		if ( guided ) {

			const antes = Object.keys( guided.map ).length;
			const paso = guided.sample( pad.axes, t );

			if ( Object.keys( guided.map ).length !== antes ) {

				config.gamepadMap = { ...guided.map };
				changed();

			}

			if ( paso === 'buscando' ) hint.textContent = `${ guided.step.label }: mueve ${ DIRS[ guided.step.id ] }…`;
			else if ( paso === 'suelta' ) hint.textContent = 'Suelta el stick…';
			else if ( paso === 'hecho' ) { hint.textContent = 'Los cuatro ejes calibrados.'; guided = null; }
			else {

				const fallado = AXES.find( a => a.id === guided.failed );
				hint.textContent = `No se detectó movimiento en ${ fallado.label.toLowerCase() }. Vuelve a empezar.`;
				guided = null;

			}

		}

	}

	let raf = requestAnimationFrame( tick );

	container.replaceChildren( h( 'fieldset', {}, [
		h( 'legend', { text: 'Mando' } ),
		status,
		list,
		hint,
		h( 'div', { class: 'row', style: 'margin-top:10px' }, [
			h( 'button', { class: 'primary', text: 'Calibrar los cuatro ejes', onclick: startGuided } ),
			h( 'button', {
				text: 'Borrar mapeo',
				onclick: () => {

					single = guided = null;
					config.gamepadMap = null;
					hint.textContent = '';
					changed();

				},
			} ),
		] ),
		snippetBox,
		h( 'p', {
			class: 'note',
			html: 'Se vuela con mando y los cuatro ejes tienen que estar mapeados. Un mando '
				+ 'guardado en <code>gamepads</code> no hay que calibrarlo nunca más. Del teclado '
				+ 'sólo queda <kbd>Esc</kbd>, que pausa y reanuda; tras un choque se reaparece solo.',
		} ),
	] ) );

	refreshSnippet();

	return {
		dispose() {

			cancelAnimationFrame( raf );

		},
	};

}
```

- [ ] **Step 2: El cuadro del trozo, con estilo**

En `src/styles.css`, después de la línea de `.tag`:

```css
.snippet {
	width: 100%;
	margin: 8px 0;
	background: rgba(0, 0, 0, 0.35);
	border: 1px solid var(--line);
	border-radius: 9px;
	color: var(--fg);
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 11.5px;
	line-height: 1.45;
	padding: 8px 10px;
	resize: vertical;
}
```

- [ ] **Step 3: Verificar lo que se puede verificar sin volar**

Run: `npm test`
Expected: TODO OK. En especial `sin rastro de …` sigue en verde con el fichero nuevo dentro de la suma (Task 1).

Run: `grep -n "ensureMap\|Mapeo por defecto" src/gamepadPanel.js src/menu.js`
Expected: sin resultados. No queda ningún camino que rellene ejes que nadie ha movido.

Run: `npm run build`
Expected: termina sin errores (es lo que caza un import mal escrito sin abrir el navegador).

- [ ] **Step 4: Commit**

```bash
git add src/gamepadPanel.js src/styles.css
git commit -m "feat: el panel calibra los cuatro ejes y no inventa ninguno"
```

---

### Task 7: La documentación dice lo que hace el juego

`README.md` sigue mandando «*Detectar* en cada eje» y ofreciendo un «Mapeo por defecto» que ya no existe, y `docs/tests.md` describe una cobertura de entrada que se ha quedado corta.

**Files:**
- Modify: `README.md:52-60`
- Modify: `docs/tests.md:45-49`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Reescribir la sección de controles del README**

Sustituye los dos párrafos que van bajo `## Controles` (desde «Se vuela con mando, y sólo con mando…» hasta «…pausa la partida.») por:

```markdown
Se vuela con mando, y sólo con mando. La primera vez: *Mando* → *Calibrar los cuatro ejes*,
mueve cada stick en la dirección que te pida y suéltalo cuando te lo diga. Al terminar te da
un trozo de texto: pégalo dentro de `gamepads` en `vuela.config.js` y **ese mando queda
reconocido para siempre**. A partir de ahí, arrancar es enchufarlo y mover un stick.

Ese meneo inicial no te lo puedo ahorrar: ningún navegador enseña un mando hasta que lo
tocas una vez. Lo que sí se ahorra es todo lo demás —no hay que pulsar nada.

Sin los cuatro ejes mapeados no se despega, pero la zona **sí** se carga: si terminas la
descarga sin mando, esperas en la pantalla de pausa con el panel a mano. Desconectarlo en
vuelo pausa la partida.
```

- [ ] **Step 2: Poner al día `docs/tests.md`**

Sustituye el párrafo de `tests/input.test.mjs` (líneas 45-49) por:

```markdown
`tests/input.test.mjs` cubre la regla de entrada entera: sin mando —o con mando desconocido—
los ejes llegan a cero y `hasControl` es falso; un mando cuyo `id` está en `gamepads` queda
mapeado solo, con los ejes pasando por su inversión y su banda muerta y el gas remapeado de
−1..1 a 0..1; cambiar de mando cambia de mapeo, y volver a enchufar el mismo respeta lo
calibrado. Un mapeo al que le falte un eje no da control: es el fallo del medio gas, que
`hasControl` tapaba mirando sólo si había mapa. Cubre además la calibración entera sin
navegador —umbral de aceptación, exclusión de los ejes ya asignados, el signo que decide la
inversión, la espera a que el stick vuelva y su tope de dos segundos, y el fallo por no
mover nada— y que el trozo que se pega en `vuela.config.js` vuelve a leerse como el mismo
mapeo. Comprueba también que las teclas pulsadas fuera del vuelo no se disparan en el primer
frame, y que no ha vuelto la API del ratón.
```

- [ ] **Step 3: Verificar**

Run: `npm test`
Expected: TODO OK (la documentación no la comprueba nadie automáticamente, pero el commit no debe salir con los tests rojos).

Lee `README.md` y comprueba que no queda ninguna mención a *Mapeo por defecto*:

Run: `grep -rn "Mapeo por defecto" README.md docs/ src/`
Expected: sin resultados fuera de `docs/superpowers/`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/tests.md
git commit -m "docs: el mando se calibra una vez y se guarda en el fichero"
```

---

## Verificación del dueño

Lo que no se ve con `npm test` y hay que mirar volando, **antes de hacer push**:

1. **Reconocimiento.** Con la emisora pegada en `gamepads`: arrancar, mover un stick, y que el panel diga «mapeo del fichero» con los cuatro ejes puestos y las cuatro barras moviéndose por separado. Despegar sin haber pulsado nada.
2. **Calibración.** *Borrar mapeo* → *Calibrar los cuatro ejes*: que cada paso pille el eje correcto, que pida soltar el stick entre paso y paso, que ninguna fila repita eje y que el gas quede en 0 abajo y 1 arriba en el HUD.
3. **El trozo.** Que *Copiar mapeo* dé un texto que, pegado en `vuela.config.js`, arranque sin quejas y deje el mando reconocido.
4. **Desenchufar y volver a enchufar** en vuelo: pausa al desenchufar, y al volver a enchufar y mover un stick, «Reanudar» se enciende solo.
