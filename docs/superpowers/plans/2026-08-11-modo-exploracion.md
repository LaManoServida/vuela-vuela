# Modo de exploración — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un modo en el que las esferas de carga siguen al dron —así el mundo deja de acabarse a 22 km del despegue— pagando todo el trabajo nuevo a plazos con un techo por frame, de modo que se rompa la nitidez y nunca la fluidez.

**Architecture:** Un módulo nuevo, `src/stream.js`, con tres piezas independientes y probables por separado: un **reloj de refresco** que decide si toca recorrer el árbol (por tiempo *y* por distancia recorrida), un **recentrado** que lleva las esferas del `LoadRegionPlugin` a donde está el dron, y una **cola de texturas con presupuesto** que las sube a la GPU a plazos. Una cuarta función, `createStream()`, las junta y las engancha al tileset. `main.js` la llama una vez por frame; `world.js` y `preload.js` sólo cambian en dos decisiones (qué desaloja la caché y si se congela el traversal).

**Tech Stack:** JavaScript ESM puro, Vite 8, three.js, `3d-tiles-renderer`. Sin dependencias nuevas. Tests caseros en Node (`node tests/*.mjs`, sin framework) con el ayudante `check( nombre, condición, info )`.

**Spec:** `docs/superpowers/specs/2026-08-11-modo-exploracion-design.md`

## Global Constraints

- **Estilo del repositorio:** tabuladores para indentar, espacios dentro de los paréntesis (`fn( a, b )`), línea en blanco tras la apertura de un bloque de función y antes del cierre, comentarios en castellano que expliquen el *porqué*, no el qué.
- **`vuela.config.js` se toca en las tareas 1 y 7, y a propósito.** Si al empezar cualquiera de las dos hay cambios sin commitear en ese fichero: `git stash push -- vuela.config.js`, hacer la tarea, y devolverlos después. Nunca sepultar sus ajustes a mano en un commit de otra cosa.
- **El modo actual no se toca.** Con `stream.enabled` en `false` el comportamiento tiene que ser idéntico al de hoy, hasta el último número: precarga entera, traversal congelado, caché que no suelta nada, rejilla de colisiones. Cualquier cambio que se note con el modo apagado es un fallo.
- **Nada de tocar `tests/flight.test.mjs`, `tests/input.test.mjs` ni `tests/world.test.mjs`.** Este trabajo no roza el modelo de vuelo, la entrada ni la voxelización. Si alguno se pone rojo, el fallo está en el cambio, no en el umbral.
- **`ui` y el menú van juntos, siempre.** `tests/config.test.mjs` falla si hay un rango en `ui` que ningún control del menú usa, y también si aparece un `min`/`max`/`step` literal en `menu.js`. Por eso los rangos nuevos entran en la tarea 7, con sus deslizadores, y no antes.
- **Cada tarea acaba con `npm test` en verde y un commit.** Y con push, sin esperar a que lo pidan.

## Estructura de ficheros

| Fichero | Responsabilidad | Tarea |
|---|---|---|
| `vuela.config.js` | El bloque `stream` (cuatro valores) y sus rangos de menú | 1, 7 |
| `src/config.js` | El contrato del bloque `stream` | 1 |
| `src/stream.js` *(nuevo)* | Reloj de refresco, recentrado, cola de texturas y el ensamblaje | 2, 3, 4 |
| `src/world.js` | Qué desaloja la caché según el modo | 5 |
| `src/preload.js` | Congelar el traversal sólo en el modo de precarga | 5 |
| `src/main.js` | Crear el stream, llamarlo en el frame, soltarlo al descargar el mundo | 6 |
| `src/menu.js` | El interruptor y los tres deslizadores | 7 |
| `src/hud.js`, `index.html` | Coste del recorrido y memoria viva en el OSD | 8 |
| `tests/stream.test.mjs` *(nuevo)* | Las cuatro piezas de `stream.js` | 2, 3, 4 |
| `tests/config.test.mjs` | Sabotajes del bloque nuevo | 1, 7 |
| `docs/*.md` | Qué es el modo, qué se ajusta y qué se prueba | 9 |

---

### Task 1: El bloque `stream` en la configuración, con su contrato

Sólo la configuración y su contrato. Al acabar esta tarea el juego se comporta exactamente igual: hay cuatro valores nuevos que no lee nadie, pero que ya fallan el arranque si alguien los rompe editando el fichero a mano.

Va primero y sola porque es el único cambio que toca `vuela.config.js` con el fichero del dueño del repositorio en juego, y porque todo lo demás lee de aquí.

**Files:**
- Modify: `vuela.config.js` (bloque nuevo tras `spawnHeight`)
- Modify: `src/config.js:112` (el `SCHEMA`, tras `spawnHeight`)
- Test: `tests/config.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: `config.stream` — `{ enabled: boolean, interval: number, budgetMs: number, memoryMb: number }`. `interval` en segundos, `budgetMs` en milisegundos, `memoryMb` en mebibytes.

- [ ] **Step 1: Poner a salvo los ajustes a mano del fichero**

```bash
git status --porcelain vuela.config.js
# Si aparece algo, y SÓLO si aparece algo:
git stash push -- vuela.config.js
```

Anótalo: al final de la tarea hay que devolverlos con `git stash pop`.

- [ ] **Step 2: Escribir el test que todavía no pasa**

En `tests/config.test.mjs`, justo antes de la línea `console.log( '\n== curva del variador ==' );`, añade el bloque de comprobación del fichero actual:

```js
console.log( '\n== modo de exploración ==' );

check( 'el modo de exploración viene apagado de fábrica', baseConfig.stream.enabled === false );
// El techo por frame tiene que dejarle sitio al render: si se come medio frame
// de 60 fps, el presupuesto deja de proteger la fluidez y pasa a romperla.
check( 'el techo de trabajo por frame deja sitio al render',
	baseConfig.stream.budgetMs > 0 && baseConfig.stream.budgetMs < 8,
	`${ baseConfig.stream.budgetMs } ms` );
```

Y en la sección de sabotajes, después de `catches( 'radius como cadena', ... )`, añade:

```js
catches( 'borrar el bloque stream entero', c => { delete c.stream; }, 'stream' );
catches( 'stream.enabled escrito como cadena', c => { c.stream.enabled = 'true'; }, 'stream.enabled' );
// Un intervalo de 0 devuelve el recorrido del árbol a cada frame, que es justo
// lo que este modo evita.
catches( 'stream.interval a 0', c => { c.stream.interval = 0; }, 'stream.interval' );
catches( 'stream.budgetMs más largo que un frame entero', c => { c.stream.budgetMs = 20; }, 'stream.budgetMs' );
catches( 'memoryMb escrito memoriaMb', c => {
	c.stream.memoriaMb = c.stream.memoryMb;
	delete c.stream.memoryMb;
}, 'stream.memoryMb' );
```

- [ ] **Step 3: Verlo fallar**

Run: `npm test`
Expected: FAIL en `tests/config.test.mjs`. Los `check` nuevos petan al leer `baseConfig.stream.enabled` de un `undefined`, o fallan directamente. Si en vez de eso pasa algo, el bloque ya existía y hay que parar y mirar por qué.

- [ ] **Step 4: Añadir el bloque a `vuela.config.js`**

Justo después de `spawnHeight: 45,` y antes del bloque `Imagen`:

```js
	// =====================================================================
	//  Modo de exploración
	// =====================================================================
	//  El modo normal precarga la zona entera y congela el recorrido del árbol
	//  de tiles: cero tirones garantizados, a cambio de que el mundo se acabe a
	//  22 km del despegue. En exploración las esferas de carga siguen al dron y
	//  el mundo no tiene borde, a cambio de que el detalle aparezca según llega.
	//
	//  Aquí no hay colisiones: la rejilla de vóxeles se construye de una vez
	//  sobre una zona finita, y en este modo no la hay. El dron atraviesa
	//  edificios y terreno.

	stream: {
		enabled: false,
		interval: 1.0,             // s entre recorridos del árbol de tiles
		budgetMs: 3,               // techo de trabajo por frame subiendo texturas
		memoryMb: 1500,            // presupuesto de la caché de tiles
	},
```

- [ ] **Step 5: Añadir el contrato a `src/config.js`**

En `SCHEMA`, justo después de `spawnHeight: num( 0 ),`:

```js
		// --- Modo de exploración ---
		//
		// Los límites son la frontera de lo que el código sabe hacer, no gusto:
		// por debajo de 0.05 s el recorrido del árbol vuelve a ser trabajo de
		// cada frame; por encima de 8 ms el presupuesto se come medio frame de
		// 60 fps y pasa a romper la fluidez en vez de protegerla; y con menos de
		// 128 MB la caché no sostiene ni la zona de despegue, así que descartaría
		// tiles que se están viendo para volver a pedirlos en bucle.
		stream: block( {
			enabled: bool(),
			interval: num( 0.05, 60 ),
			budgetMs: num( 0.1, 8 ),
			memoryMb: num( 128, 16384 ),
		} ),
```

- [ ] **Step 6: Verlo pasar**

Run: `npm test`
Expected: PASS, la suite entera verde. Comprueba en la salida que aparecen las líneas nuevas: `ok  el modo de exploración viene apagado de fábrica` y los cinco `catches` con su `→ «...»`.

- [ ] **Step 7: Devolver los ajustes a mano, si los guardaste**

```bash
git stash pop        # sólo si el Step 1 guardó algo
```

Si hay conflicto, resuélvelo dejando **sus** valores y el bloque `stream` nuevo.

- [ ] **Step 8: Commit**

```bash
git add vuela.config.js src/config.js tests/config.test.mjs
git commit -m "feat: la configuración conoce el modo de exploración

Cuatro valores nuevos que todavía no lee nadie: si se enciende, cada cuánto se
recorre el árbol de tiles, cuánto trabajo por frame se admite y cuánta memoria
se le deja a la caché. Con el contrato puesto, porque el flujo es «edítalo y
recarga»: romper cualquiera de los cuatro a mano tiene que fallar el arranque
nombrando la clave, no salir como un NaN dos multiplicaciones después.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 2: El reloj de refresco y el recentrado de las esferas

Las dos piezas que responden a *cuándo* y *dónde*. Son funciones puras sobre objetos sencillos, así que se prueban enteras en Node sin navegador ni WebGL. Nadie las usa todavía.

Van juntas porque comparten el fichero nuevo y el test nuevo, y separadas de la cola de texturas porque son otra pregunta: éstas deciden qué se pide, aquélla cuánto se paga por frame.

**Files:**
- Create: `src/stream.js`
- Create: `tests/stream.test.mjs`

**Interfaces:**
- Consumes: nada. Sólo `three` (`Matrix4`, `Vector3`).
- Produces:
  - `MIN_MOVE` — constante, metros que hay que recorrer para que un turno cuente (25).
  - `createRefreshClock( { intervalS, minMoveM } )` → objeto con las propiedades **mutables** `intervalS` y `minMoveM` y el método `due( nowMs, position )` → `boolean`. `position` es cualquier objeto con `x`, `y`, `z`.
  - `recenterRegions( regions, group, position )` → `Vector3` con la posición en el marco del tileset. `regions` es una lista de objetos con `.sphere.center`; `group` es cualquier objeto con `.matrixWorld`.

- [ ] **Step 1: Escribir el test que todavía no pasa**

Crea `tests/stream.test.mjs`:

```js
/*
 * Prueba las piezas del modo de exploración, en el que la zona cargada sigue al
 * dron en vez de estar clavada en el punto de despegue.
 *
 * Lo que se comprueba aquí es lo que decide el coste: cuándo toca recorrer el
 * árbol de tiles —que es una llamada indivisible y cara— y dónde se ponen las
 * esferas de carga. El navegador no está, pero ninguna de las dos lo necesita:
 * una es aritmética de tiempo y distancia, la otra de matrices.
 */
import { Matrix4, Vector3, Sphere } from 'three';
import { createRefreshClock, recenterRegions, MIN_MOVE } from '../src/stream.js';

let fails = 0;
const check = ( name, cond, info = '' ) => {
	if ( cond ) console.log( `  ok  ${ name } ${ info }` );
	else { console.log( `FAIL  ${ name } ${ info }` ); fails ++; }
};

console.log( '\n== el reloj de refresco ==' );

const reloj = createRefreshClock( { intervalS: 1, minMoveM: 25 } );
const en = ( x, y = 0, z = 0 ) => ( { x, y, z } );

check( 'el primer turno sale siempre', reloj.due( 0, en( 0 ) ) === true );
check( 'el siguiente frame no, ni ha pasado tiempo ni se ha movido nadie',
	reloj.due( 16, en( 0 ) ) === false );
check( 'moverse mucho sin cumplir el intervalo tampoco vale',
	reloj.due( 500, en( 400 ) ) === false );
check( 'cumplido el intervalo y movido, toca',
	reloj.due( 1500, en( 400 ) ) === true );

// Quedarse quieto en el aire no puede costar nada: por muchos segundos que
// pasen, sin movimiento no hay nada nuevo que pedir.
check( 'quieto en el aire no gasta un solo turno',
	reloj.due( 9000, en( 400 ) ) === false );

// Y en cuanto arranca, el turno sale al instante en vez de esperar otro ciclo:
// el reloj no se apunta los turnos que se salta.
check( 'al volver a moverse responde en el acto',
	reloj.due( 9001, en( 430 ) ) === true );

// La distancia es en tres dimensiones, no en el plano: subir en vertical mueve
// la esfera igual que avanzar.
const vertical = createRefreshClock( { intervalS: 1, minMoveM: 25 } );
vertical.due( 0, en( 0, 0, 0 ) );
check( 'subir cuenta como moverse', vertical.due( 2000, en( 0, 100, 0 ) ) === true );

// Los ajustes se leen en cada consulta, no al construir: así los deslizadores
// de la pausa hacen efecto sin recargar la zona.
const vivo = createRefreshClock( { intervalS: 10, minMoveM: 25 } );
vivo.due( 0, en( 0 ) );
check( 'con el intervalo largo no toca', vivo.due( 2000, en( 400 ) ) === false );
vivo.intervalS = 1;
check( 'y bajándolo en caliente, toca', vivo.due( 2001, en( 400 ) ) === true );

check( 'la distancia mínima es un número razonable de metros',
	MIN_MOVE > 0 && MIN_MOVE < 200, `${ MIN_MOVE } m` );

console.log( '\n== el recentrado de las esferas ==' );

// Las regiones viven en el marco del tileset, no en el de la escena: el plugin
// de reorientación pone la zona en el origen, y esa transformación hay que
// deshacerla para saber a qué punto del planeta mira el dron.
const group = { matrixWorld: new Matrix4().makeTranslation( 1000, 2000, 3000 ) };
const regions = [
	new Sphere( new Vector3(), 1100 ),
	new Sphere( new Vector3(), 22000 ),
].map( sphere => ( { sphere } ) );

const local = recenterRegions( regions, group, new Vector3( 10, 20, 30 ) );

check( 'la esfera va al punto del dron deshaciendo la transformación del tileset',
	regions[ 0 ].sphere.center.equals( new Vector3( - 990, - 1980, - 2970 ) ),
	regions[ 0 ].sphere.center.toArray().join( ', ' ) );
check( 'todas las esferas van al mismo centro',
	regions[ 1 ].sphere.center.equals( regions[ 0 ].sphere.center ) );
check( 'y ninguna cambia de radio',
	regions[ 0 ].sphere.radius === 1100 && regions[ 1 ].sphere.radius === 22000 );
check( 'devuelve esa misma posición en el marco del tileset',
	local.equals( new Vector3( - 990, - 1980, - 2970 ) ) );

console.log( fails === 0 ? '\nTODO OK\n' : `\n${ fails } FALLOS\n` );
process.exit( fails === 0 ? 0 : 1 );
```

- [ ] **Step 2: Verlo fallar**

Run: `node tests/stream.test.mjs`
Expected: FAIL — `Cannot find module '.../src/stream.js'`.

- [ ] **Step 3: Escribir las dos piezas**

Crea `src/stream.js`:

```js
import { Matrix4, Vector3 } from 'three';

/*
 * Modo de exploración: la zona cargada sigue al dron.
 *
 * El modo normal precarga una zona finita y congela el recorrido del árbol de
 * tiles. Es lo que garantiza que no haya un solo tirón —no queda trabajo
 * pendiente que pueda caer en mitad de un frame— y también lo que hace que el
 * mundo se acabe a 22 km del despegue.
 *
 * Aquí se cambia esa garantía por un presupuesto. Las esferas de carga siguen
 * al dron, así que hay trabajo nuevo continuamente, y ese trabajo se paga a
 * plazos con un techo por frame que no se rebasa. Si el dron avanza más rápido
 * de lo que la red y la GPU alimentan, lo que se rompe es la nitidez —por
 * delante se ve basto y va afinando— y nunca la fluidez.
 *
 * Hay dos relojes distintos y confundirlos tira abajo el diseño entero:
 *
 *  - Recorrer el árbol es UNA llamada indivisible y cara. Va cada `interval`
 *    segundos. A 40 m/s eso son 40 metros entre pasada y pasada, nada frente a
 *    un radio de detalle de cientos.
 *  - Subir texturas a la GPU va CADA frame, en porciones diminutas. Es lo que
 *    reparte el coste: agruparlo una vez por segundo daría un tirón por segundo.
 */

// Cuánto hay que moverse para que un turno de recorrido valga la pena. Frente a
// un radio de detalle de cientos de metros, veinticinco no cambian qué tiles
// hacen falta. Es una constante y no un deslizador a propósito: nadie va a
// querer tocarla y el menú ya va servido.
export const MIN_MOVE = 25;

/**
 * Decide si toca recorrer el árbol de tiles.
 *
 * Dos condiciones y tienen que darse las dos: que haya pasado el intervalo y
 * que el dron se haya movido lo suficiente. Quedarse quieto en el aire no
 * cuesta nada, que es medio motivo de que la distancia esté aquí.
 *
 * El otro medio: cuando el intervalo se cumple pero el dron no se ha movido, no
 * se apunta nada. Así el turno que se salta no cuenta como gastado y, en cuanto
 * el dron arranca, la carga responde en el acto en vez de esperar otro ciclo.
 *
 * `intervalS` y `minMoveM` se leen en cada consulta y son públicos a propósito:
 * los deslizadores de la pausa los cambian en caliente, sin recargar la zona.
 */
export function createRefreshClock( { intervalS, minMoveM = MIN_MOVE } ) {

	let lastMs = - Infinity;
	let lastX = Infinity;
	let lastY = Infinity;
	let lastZ = Infinity;

	return {

		intervalS,
		minMoveM,

		due( nowMs, position ) {

			if ( nowMs - lastMs < this.intervalS * 1000 ) return false;

			const dx = position.x - lastX;
			const dy = position.y - lastY;
			const dz = position.z - lastZ;
			if ( dx * dx + dy * dy + dz * dz < this.minMoveM * this.minMoveM ) return false;

			lastMs = nowMs;
			lastX = position.x;
			lastY = position.y;
			lastZ = position.z;
			return true;

		},

	};

}

const _inverse = new Matrix4();
const _local = new Vector3();

/**
 * Lleva las esferas de carga a donde está el dron.
 *
 * Las regiones del `LoadRegionPlugin` viven en el marco del tileset —ECEF, con
 * el planeta entero alrededor del centro de la Tierra—, no en el de la escena:
 * el plugin de reorientación es el que pone la zona elegida en el origen con +Y
 * arriba. Así que hay que deshacer esa transformación para saber a qué punto
 * del planeta corresponde la posición del dron.
 *
 * Mutar el centro basta: el plugin relee las esferas en cada recorrido.
 */
export function recenterRegions( regions, group, position ) {

	_inverse.copy( group.matrixWorld ).invert();
	_local.copy( position ).applyMatrix4( _inverse );

	for ( const region of regions ) region.sphere.center.copy( _local );

	return _local;

}
```

- [ ] **Step 4: Verlo pasar**

Run: `node tests/stream.test.mjs`
Expected: PASS, `TODO OK`.

- [ ] **Step 5: Engancharlo a la suite**

Comprueba cómo lanza `npm test` los ficheros de `tests/`:

```bash
grep -n '"test"' package.json
```

Si el script enumera los ficheros uno a uno, añade `tests/stream.test.mjs` a la lista, después de `tests/schedule.test.mjs`. Si usa un comodín (`node tests/*.test.mjs` o similar), no hay nada que tocar.

Run: `npm test`
Expected: PASS, y en la salida tienen que verse los bloques `== el reloj de refresco ==` y `== el recentrado de las esferas ==`.

- [ ] **Step 6: Commit**

```bash
git add src/stream.js tests/stream.test.mjs package.json
git commit -m "feat: cuándo y dónde se recarga la zona en exploración

Dos piezas que todavía no usa nadie. El reloj de refresco decide si toca
recorrer el árbol de tiles: por tiempo y por distancia recorrida, las dos
condiciones. Que la distancia esté ahí es lo que hace que quedarse quieto en el
aire no cueste nada, y que los turnos saltados no se apunten es lo que hace que
al arrancar de nuevo la carga responda en el acto.

El recentrado lleva las esferas de carga a donde está el dron, deshaciendo la
transformación con la que el tileset pone la zona en el origen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 3: El goteo de texturas con presupuesto

La pieza que responde a *cuánto por frame*. Es la que traduce «se rompe la nitidez, nunca la fluidez» a código: un techo en milisegundos que no se rebasa aunque queden mil texturas pendientes.

**Files:**
- Modify: `src/stream.js` (al final)
- Test: `tests/stream.test.mjs`

**Interfaces:**
- Consumes: nada de las tareas anteriores.
- Produces: `createTextureQueue( { renderer, budgetMs, now } )` → objeto con la propiedad **mutable** `budgetMs`, el getter `pending` (número de texturas por subir), `enqueue( scene )` y `drain()` → número de texturas subidas en este turno. `renderer` es cualquier objeto con `initTexture( textura )`; `now` es una función que devuelve milisegundos y por defecto es `performance.now`.

- [ ] **Step 1: Escribir el test que todavía no pasa**

En `tests/stream.test.mjs`, antes de la línea final `console.log( fails === 0 ? ... )`, añade:

```js
console.log( '\n== el goteo de texturas ==' );

// El reloj es falso y lo mueve el propio trabajo: cada textura subida cuesta
// 2 ms. Así el presupuesto se puede comprobar contando, sin depender de lo
// rápido que vaya la máquina donde corre el test.
let ahora = 0;
const subidas = [];
const renderer = { initTexture: t => { subidas.push( t ); ahora += 2; } };

// Un modelo del tileset visto como lo ve la cola: un árbol que se recorre y del
// que salen materiales con texturas.
const modelo = ( ...mapas ) => ( {
	traverse( fn ) {

		for ( const map of mapas ) fn( { material: { map } } );

	},
} );

const cola = createTextureQueue( { renderer, budgetMs: 5, now: () => ahora } );

cola.enqueue( modelo( 'a', 'b', 'c', 'd', 'e', 'f' ) );
check( 'la cola apunta las texturas del modelo que llega', cola.pending === 6 );

check( 'el primer turno se para al agotar el presupuesto', cola.drain() === 3, `${ subidas.length } subidas` );
check( 'y deja el resto pendiente', cola.pending === 3 );

check( 'el turno siguiente retoma exactamente donde iba', cola.drain() === 3 );
check( 'sin repetir ni saltarse ninguna', subidas.join( '' ) === 'abcdef', subidas.join( '' ) );
check( 'y con la cola vacía no hace nada', cola.drain() === 0 && cola.pending === 0 );

// El presupuesto se lee en cada turno: es un deslizador de la pausa.
ahora = 0;
cola.enqueue( modelo( 'g', 'h', 'i', 'j' ) );
cola.budgetMs = 1;
check( 'con el presupuesto recortado en caliente sube menos', cola.drain() === 1 );

// Una textura suelta que falle no puede parar el goteo: en vuelo eso sería
// quedarse sin cargar nada más durante el resto de la partida.
ahora = 0;
const roto = { initTexture: t => { ahora += 2; if ( t === 'mala' ) throw new Error( 'textura rota' ); } };
const colaRota = createTextureQueue( { renderer: roto, budgetMs: 5, now: () => ahora } );
colaRota.enqueue( modelo( 'mala', 'buena' ) );
check( 'una textura rota no para el goteo', colaRota.drain() === 2 && colaRota.pending === 0 );

// Los tiles fotogramétricos traen un material por malla, pero three admite
// listas de materiales y el `map` no es el único mapa posible.
ahora = 0;
const variado = createTextureQueue( { renderer, budgetMs: 1000, now: () => ahora } );
variado.enqueue( {
	traverse( fn ) {

		fn( { material: [ { map: 'm1' }, { map: 'm2' } ] } );
		fn( { material: { emissiveMap: 'e1', normalMap: 'n1' } } );
		fn( {} );   // un nodo sin material, que los hay

	},
} );
check( 'recoge listas de materiales y los mapas que no son el difuso', variado.pending === 4 );
```

Y en la importación de la cabecera, añade `createTextureQueue`:

```js
import { createRefreshClock, recenterRegions, createTextureQueue, MIN_MOVE } from '../src/stream.js';
```

- [ ] **Step 2: Verlo fallar**

Run: `node tests/stream.test.mjs`
Expected: FAIL — `createTextureQueue is not a function`.

- [ ] **Step 3: Escribir la cola**

Al final de `src/stream.js`:

```js
/**
 * Cola de texturas por subir a la GPU, con techo por frame.
 *
 * Una textura llega a la GPU, por defecto, la primera vez que se dibuja. Con
 * miles de tiles eso es un goteo de micro-tirones durante todo el vuelo, y por
 * eso la precarga las fuerza todas antes de despegar. Aquí no se pueden forzar
 * todas: llegan sin parar. Se fuerzan a plazos, con un techo que no se rebasa
 * aunque queden mil pendientes — y ése es exactamente el punto donde se decide
 * romper la nitidez para no romper la fluidez.
 *
 * `budgetMs` es público porque es un deslizador de la pausa, y `now` se puede
 * sustituir para poder probar el presupuesto contando en vez de cronometrando.
 */
export function createTextureQueue( { renderer, budgetMs, now = () => performance.now() } ) {

	const pending = [];

	// Cursor en vez de `shift()`: en un vuelo sin final esta lista pasa por
	// decenas de miles de texturas, y sacar por la cabeza mueve el array entero
	// cada vez. Se compacta de tarde en tarde, cuando lo consumido pesa más que
	// lo que queda.
	let head = 0;

	return {

		budgetMs,

		get pending() {

			return pending.length - head;

		},

		/** Apunta las texturas de un modelo recién cargado. */
		enqueue( scene ) {

			scene.traverse( child => {

				const material = child.material;
				if ( ! material ) return;

				const list = Array.isArray( material ) ? material : [ material ];
				for ( const m of list ) {

					for ( const key of [ 'map', 'emissiveMap', 'normalMap' ] ) {

						if ( m[ key ] ) pending.push( m[ key ] );

					}

				}

			} );

		},

		/** Sube lo que quepa en el presupuesto. Devuelve cuántas subió. */
		drain() {

			const end = now() + this.budgetMs;
			let done = 0;

			while ( head < pending.length && now() < end ) {

				try {

					renderer.initTexture( pending[ head ] );

				} catch ( e ) {

					// Una textura suelta que falle no puede parar el goteo: eso
					// sería quedarse sin cargar nada más el resto del vuelo.

				}

				pending[ head ] = null;
				head ++;
				done ++;

			}

			if ( head > 4096 && head * 2 > pending.length ) {

				pending.splice( 0, head );
				head = 0;

			}

			return done;

		},

	};

}
```

- [ ] **Step 4: Verlo pasar**

Run: `npm test`
Expected: PASS. En la salida tiene que aparecer el bloque `== el goteo de texturas ==` con sus nueve `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/stream.js tests/stream.test.mjs
git commit -m "feat: las texturas del vuelo suben a la GPU a plazos

La precarga fuerza todas las texturas a la GPU antes de despegar porque, si no,
cada una se sube la primera vez que se dibuja y eso es un goteo de micro-tirones
durante todo el vuelo. En exploración no se pueden forzar todas —llegan sin
parar—, así que se fuerzan con un techo por frame que no se rebasa aunque queden
mil pendientes. Ahí es donde se decide romper la nitidez y no la fluidez.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 4: `createStream()`, las tres piezas enganchadas al tileset

El ensamblaje. Sigue sin usarlo nadie, pero al acabar esta tarea el modo entero está escrito y probado, y lo que queda son tres cables.

**Files:**
- Modify: `src/stream.js` (al final)
- Test: `tests/stream.test.mjs`

**Interfaces:**
- Consumes: `createRefreshClock`, `recenterRegions`, `createTextureQueue` de las tareas 2 y 3.
- Produces: `createStream( { tiles, renderer, regions, config } )` → `{ stats, update( nowMs, position ), dispose() }`. `stats` es `{ traversalMs, textures, bytes, errors }` y se reescribe en el sitio en cada `update`, así que quien lo lea puede quedárselo una vez.

- [ ] **Step 1: Escribir el test que todavía no pasa**

En `tests/stream.test.mjs`, antes de la línea final, añade:

```js
console.log( '\n== el modo montado sobre el tileset ==' );

// El tileset visto como lo ve el stream: un grupo con su transformación, una
// caché con su cuenta de bytes, un recorrido que se puede contar y oyentes.
const hacerTiles = () => {

	const oyentes = {};

	return {
		group: { matrixWorld: new Matrix4() },
		lruCache: { cachedBytes: 7 * 1048576, minBytesSize: 0, maxBytesSize: 0 },
		recorridos: 0,
		update() { this.recorridos ++; },
		addEventListener( tipo, fn ) { ( oyentes[ tipo ] ||= [] ).push( fn ); },
		removeEventListener( tipo, fn ) { oyentes[ tipo ] = ( oyentes[ tipo ] || [] ).filter( f => f !== fn ); },
		emitir( tipo, ev ) { for ( const fn of oyentes[ tipo ] || [] ) fn( ev ); },
	};

};

const cfg = { stream: { enabled: true, interval: 1, budgetMs: 1000, memoryMb: 1024 } };
const tiles = hacerTiles();
const esferas = [ { sphere: new Sphere( new Vector3(), 1100 ) } ];
ahora = 0;
const stream = createStream( { tiles, renderer, regions: esferas, config: cfg } );

stream.update( 0, new Vector3( 5, 6, 7 ) );
check( 'el primer turno recorre el árbol una vez', tiles.recorridos === 1 );
check( 'y deja las esferas sobre el dron', esferas[ 0 ].sphere.center.equals( new Vector3( 5, 6, 7 ) ) );

stream.update( 16, new Vector3( 5, 6, 7 ) );
check( 'el frame siguiente no vuelve a recorrerlo', tiles.recorridos === 1 );

stream.update( 2000, new Vector3( 500, 6, 7 ) );
check( 'pasado el intervalo y movido, sí', tiles.recorridos === 2 );

check( 'el presupuesto de memoria llega a la caché',
	tiles.lruCache.minBytesSize === 1024 * 1048576,
	`${ ( tiles.lruCache.minBytesSize / 1048576 ).toFixed( 0 ) } MB` );
check( 'con margen entre el mínimo y el máximo, o la caché desalojaría sin parar',
	tiles.lruCache.maxBytesSize > tiles.lruCache.minBytesSize );

// Un modelo que llega en vuelo: sus texturas se apuntan solas y suben en el
// siguiente turno, sin que nadie recorra el tileset entero buscándolas.
subidas.length = 0;
tiles.emitir( 'load-model', { scene: modelo( 'v1', 'v2' ) } );
check( 'un modelo que llega en vuelo no sube nada por su cuenta', subidas.length === 0 );
stream.update( 2016, new Vector3( 500, 6, 7 ) );
check( 'sus texturas suben en el turno siguiente', subidas.join( '' ) === 'v1v2', subidas.join( '' ) );
check( 'y la cola queda vacía', stream.stats.textures === 0 );

check( 'el OSD recibe el coste del recorrido', Number.isFinite( stream.stats.traversalMs ) );
check( 'y la memoria viva', stream.stats.bytes === 7 * 1048576 );

// Un tile que falle en vuelo se apunta y no echa del vuelo. Durante la precarga
// un error de carga aborta con su diagnóstico, y ahí está bien: no ha pasado
// nada todavía. En vuelo un 500 suelto no puede tumbar la partida.
tiles.emitir( 'load-error', { error: new Error( '500' ), url: 'https://tile' } );
stream.update( 4000, new Vector3( 900, 6, 7 ) );
check( 'un tile que falla en vuelo se apunta y se sigue volando', stream.stats.errors === 1 );

// Al descargar el mundo hay que soltar los oyentes: si no, el tileset viejo
// sigue alimentando la cola del stream muerto.
stream.dispose();
subidas.length = 0;
tiles.emitir( 'load-model', { scene: modelo( 'z1' ) } );
stream.update( 6000, new Vector3( 1400, 6, 7 ) );
check( 'tras soltarlo ya no apunta nada', subidas.length === 0 );
```

Y añade `createStream` a la importación de la cabecera:

```js
import {
	createRefreshClock, recenterRegions, createTextureQueue, createStream, MIN_MOVE,
} from '../src/stream.js';
```

- [ ] **Step 2: Verlo fallar**

Run: `node tests/stream.test.mjs`
Expected: FAIL — `createStream is not a function`.

- [ ] **Step 3: Escribir el ensamblaje**

Al final de `src/stream.js`:

```js
/**
 * El modo de exploración, montado sobre un tileset ya precargado.
 *
 * Se crea DESPUÉS de la precarga, nunca antes: la cola de texturas sólo tiene
 * que ocuparse de lo que llegue en vuelo, porque lo que ya está cargado lo
 * subió la precarga entera de una vez.
 *
 * Los cuatro ajustes se releen en cada turno en vez de copiarse al construir,
 * y por eso sus deslizadores hacen efecto en caliente: sólo encender o apagar
 * el modo obliga a recargar la zona.
 */
export function createStream( { tiles, renderer, regions, config } ) {

	const clock = createRefreshClock( { intervalS: config.stream.interval } );
	const textures = createTextureQueue( { renderer, budgetMs: config.stream.budgetMs } );

	const onModel = ( { scene } ) => textures.enqueue( scene );
	tiles.addEventListener( 'load-model', onModel );

	// En la precarga un error de carga aborta con su diagnóstico —API key,
	// facturación, restricciones de la clave— y ahí está bien, porque no ha
	// pasado nada todavía. En vuelo es inaceptable: un 500 suelto o un corte de
	// wifi de dos segundos no puede echar de la partida. Se cuenta y se sigue;
	// como mucho ese trozo se ve basto.
	let errors = 0;
	const onError = () => {

		errors ++;

	};

	tiles.addEventListener( 'load-error', onError );

	const stats = { traversalMs: 0, textures: 0, bytes: 0, errors: 0 };

	return {

		stats,

		update( nowMs, position ) {

			clock.intervalS = config.stream.interval;
			textures.budgetMs = config.stream.budgetMs;

			// El desalojo no es higiene: cuantos menos tiles vivos, más barato el
			// recorrido del árbol, que es la única parte que no se puede trocear.
			// El margen entre mínimo y máximo es lo que evita que la caché esté
			// desalojando en cada turno al rozar el techo.
			const bytes = config.stream.memoryMb * 1048576;
			tiles.lruCache.minBytesSize = bytes;
			tiles.lruCache.maxBytesSize = bytes * 1.25;

			if ( clock.due( nowMs, position ) ) {

				recenterRegions( regions, tiles.group, position );

				const t0 = performance.now();
				tiles.update();
				stats.traversalMs = performance.now() - t0;

			}

			textures.drain();

			stats.textures = textures.pending;
			stats.bytes = tiles.lruCache.cachedBytes;
			stats.errors = errors;

		},

		dispose() {

			tiles.removeEventListener( 'load-model', onModel );
			tiles.removeEventListener( 'load-error', onError );

		},

	};

}
```

- [ ] **Step 4: Verlo pasar**

Run: `npm test`
Expected: PASS, suite entera verde con el bloque `== el modo montado sobre el tileset ==`.

- [ ] **Step 5: Commit**

```bash
git add src/stream.js tests/stream.test.mjs
git commit -m "feat: el modo de exploración, montado sobre el tileset

Junta las tres piezas: al tocar el reloj recentra las esferas y recorre el
árbol; cada frame gotea las texturas que hayan llegado. Se monta después de la
precarga a propósito, para que la cola sólo se ocupe de lo que llegue en vuelo.

Un error de carga en vuelo se cuenta y no echa de la partida: durante la
precarga abortar con el diagnóstico está bien porque no ha pasado nada todavía,
pero un 500 suelto a mitad de vuelo, no.

Los ajustes se releen en cada turno, así que sus deslizadores harán efecto sin
recargar la zona. Todavía no lo llama nadie.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 5: El tileset sin congelar y con la caché acotada

Las dos decisiones del tileset que dependen del modo. Son pocas líneas y no llevan test nuevo: `world.js` necesita un contexto WebGL y `preload.js` necesita red, así que aquí la verificación es que la suite siga verde (nada se ha roto con el modo apagado) y leer el cambio.

**Files:**
- Modify: `src/world.js:226-230` (los límites de la caché)
- Modify: `src/preload.js:44` y `src/preload.js:258` (el congelado)

**Interfaces:**
- Consumes: `config.stream.enabled` y `config.stream.memoryMb` de la tarea 1.
- Produces: `createTiles()` sigue devolviendo `{ tiles, regions, center }` — sin cambios de firma; lo que cambia es cómo queda configurada la caché. `preloadRegion()` tampoco cambia de firma.

- [ ] **Step 1: Los límites de la caché, según el modo**

En `src/world.js`, sustituye el bloque:

```js
	// Nada se descarga: la zona cabe en memoria y la queremos entera.
	tiles.lruCache.minSize = 100000;
	tiles.lruCache.maxSize = 120000;
	tiles.lruCache.minBytesSize = Infinity;
	tiles.lruCache.maxBytesSize = Infinity;
```

por:

```js
	// Qué se suelta y qué no.
	//
	// En el modo normal la zona es finita y la queremos entera: no se suelta
	// nada. En exploración no hay zona finita que quepa, y el presupuesto de
	// memoria es lo único que separa un vuelo largo de una pestaña muerta.
	//
	// El tope por número de tiles se deja alto en los dos casos para que la
	// única regla en juego sea la de bytes: es la que se entiende, la que se
	// enseña en el OSD y la que tiene deslizador. Dos reglas compitiendo darían
	// desalojos que no se explican con lo que se ve en pantalla.
	tiles.lruCache.minSize = 100000;
	tiles.lruCache.maxSize = 120000;

	if ( config.stream.enabled ) {

		const bytes = config.stream.memoryMb * 1048576;
		tiles.lruCache.minBytesSize = bytes;
		tiles.lruCache.maxBytesSize = bytes * 1.25;

	} else {

		tiles.lruCache.minBytesSize = Infinity;
		tiles.lruCache.maxBytesSize = Infinity;

	}
```

- [ ] **Step 2: Congelar sólo en el modo de precarga**

En `src/preload.js`, dentro de `preloadRegion`, sustituye:

```js
			await compileShaders( { tiles, renderer, scene, camera, steps, signal } );
			freeze( tiles, config );
```

por:

```js
			await compileShaders( { tiles, renderer, scene, camera, steps, signal } );

			// Congelar el traversal es exactamente lo que hace finita la zona. En
			// exploración tiene que seguir corriendo, porque es lo que descubre
			// los tiles nuevos según la esfera de carga avanza con el dron.
			if ( ! config.stream.enabled ) freeze( tiles );
```

Y en la declaración de `freeze`, quita el parámetro que ya no usaba nadie:

```js
function freeze( tiles ) {
```

- [ ] **Step 3: Comprobar que el modo apagado no se ha movido**

Run: `npm test`
Expected: PASS, suite entera verde. Con `stream.enabled` en `false` los cuatro valores de la caché quedan en lo mismo que antes (`100000`, `120000`, `Infinity`, `Infinity`) y el congelado se sigue haciendo. Reléelo y confírmalo antes de commitear: es la garantía de que este trabajo no toca el modo que ya funciona.

- [ ] **Step 4: Commit**

```bash
git add src/world.js src/preload.js
git commit -m "feat: el tileset sabe no congelarse y soltar lo que queda atrás

Dos decisiones que ahora dependen del modo. En exploración el traversal no se
congela —congelarlo es justo lo que hace finita la zona— y la caché recupera un
tope de bytes, porque sin él un vuelo largo se come la memoria hasta matar la
pestaña.

El tope por número de tiles se queda alto en los dos casos para que la única
regla que desaloja sea la de bytes: es la que tiene deslizador y la que se
enseña en el OSD, y dos reglas compitiendo darían desalojos inexplicables.

Con el modo apagado no cambia ni un número.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 6: El modo, cableado en el vuelo

Aquí el modo empieza a funcionar de verdad. Al acabar esta tarea se puede volar sin borde poniendo `stream.enabled: true` en `vuela.config.js` a mano — el menú todavía no lo ofrece, y es el primer momento en que el dueño del repositorio puede probarlo.

**Files:**
- Modify: `src/main.js` (importación, `loadAndFly`, `teardownWorld`, `frame`, `RELOAD_KEYS`)

**Interfaces:**
- Consumes: `createStream` de la tarea 4; el `regions` que `createTiles` ya devolvía.
- Produces: `world.stream` — el objeto de la tarea 4, o `null` fuera del modo. Lo lee el OSD en la tarea 8.

- [ ] **Step 1: Importar el módulo**

En `src/main.js`, tras la línea de `preload.js`:

```js
import { preloadRegion, sampleGround } from './preload.js';
import { createStream } from './stream.js';
```

- [ ] **Step 2: No construir la rejilla en exploración**

Sustituye:

```js
		const needsGrid = config.collisions || config.showGrid;
```

por:

```js
		// En exploración no hay rejilla: se construye de una vez sobre una zona
		// finita y aquí la zona no acaba nunca. De paso se ahorra la parte más
		// cara del arranque, así que se despega bastante antes.
		const needsGrid = ! config.stream.enabled && ( config.collisions || config.showGrid );
```

- [ ] **Step 3: Quedarse con las regiones y montar el stream**

Sustituye la rama de Google de `loadAndFly`:

```js
			} else {

				tiles = createTiles( config, scene, camera, renderer ).tiles;
				source = tiles;
				world = { renderer, scene, camera, sky, tiles, demo: null, grid: null, gridView: null };
				resize( renderer, camera, tiles, config );
				stats = await preloadRegion( { tiles, renderer, scene, camera, config, steps, signal } );

			}
```

por:

```js
			} else {

				const created = createTiles( config, scene, camera, renderer );
				tiles = created.tiles;
				source = tiles;
				world = { renderer, scene, camera, sky, tiles, demo: null, grid: null, gridView: null, stream: null };
				resize( renderer, camera, tiles, config );
				stats = await preloadRegion( { tiles, renderer, scene, camera, config, steps, signal } );

				// Después de la precarga, nunca antes: la cola de texturas sólo
				// tiene que ocuparse de lo que llegue en vuelo, porque lo que ya
				// está cargado lo ha subido la precarga entera.
				if ( config.stream.enabled ) {

					const { inner, mid, backdrop } = created.regions;
					world.stream = createStream( {
						tiles, renderer, config,
						regions: [ inner, mid, backdrop ],
					} );

				}

			}
```

Y en la rama de demo, para que las dos formas de `world` coincidan:

```js
				world = { renderer, scene, camera, sky, tiles: null, demo: source, grid: null, gridView: null, stream: null };
```

- [ ] **Step 4: Llamarlo en el frame**

En `frame()`, justo después de `drone.applyToCamera(...)` y antes de la línea de `world.gridView?.update(...)`:

```js
	drone.update( frameMs / 1000, controls );
	drone.applyToCamera( camera, config.camTilt );

	// La zona sigue al dron. Va después de moverlo, para que las esferas de carga
	// no vayan un frame por detrás, y antes de dibujar, para que lo que suba a la
	// GPU en este turno ya se pueda usar en este fotograma.
	world.stream?.update( now, drone.position );
```

- [ ] **Step 5: Soltarlo al descargar el mundo**

En `teardownWorld()`, antes de `world.gridView?.dispose();`:

```js
			world.stream?.dispose();
			world.gridView?.dispose();
```

- [ ] **Step 6: Encender y apagar el modo obliga a recargar**

Sustituye:

```js
const RELOAD_KEYS = [ 'place', 'coords', 'radius', 'quality', 'antialias' ];
```

por:

```js
// `streamMode` está aquí y los tres números del modo no: encender o apagar la
// exploración cambia lo que se congela, lo que desaloja la caché y si hay
// rejilla, y eso se decide al cargar. Los tres números se releen en cada turno,
// así que sus deslizadores hacen efecto en el sitio.
const RELOAD_KEYS = [ 'place', 'coords', 'radius', 'quality', 'antialias', 'streamMode' ];
```

- [ ] **Step 7: Dejar constancia en la consola de arranque**

En el `console.info( '[vuela-vuela] zona lista', {...} )`, añade tras la línea de `modo`:

```js
				carga: config.stream.enabled ? 'continua' : 'precargada',
```

- [ ] **Step 8: Comprobar que el modo apagado no se ha movido**

Run: `npm test`
Expected: PASS, suite entera verde.

Y a mano, leyendo: con `stream.enabled` en `false`, `needsGrid` da lo mismo que antes, `world.stream` es `null`, la llamada del frame no hace nada por el `?.`, y `RELOAD_KEYS` sólo tiene una entrada de más que no dispara nadie.

- [ ] **Step 9: Commit**

```bash
git add src/main.js
git commit -m "feat: volar sin borde, encendiéndolo a mano en el fichero

Cableado del modo: si está encendido, después de la precarga se monta el stream
y el bucle de vuelo lo llama una vez por frame, justo después de mover el dron
y antes de dibujar. No se construye rejilla de colisiones —se construye de una
vez sobre una zona finita, y aquí la zona no acaba— y de paso se despega antes.

Encender o apagar el modo recarga la zona, porque cambia lo que se congela, lo
que desaloja la caché y si hay rejilla; los tres números del modo no, que se
releen en cada turno.

El menú todavía no lo ofrece: por ahora se enciende en vuela.config.js.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 7: El menú

El interruptor y los tres deslizadores, con sus rangos. Van juntos porque `tests/config.test.mjs` falla si un rango de `ui` no lo usa ningún control, y al revés.

**Files:**
- Modify: `vuela.config.js` (bloque `ui`)
- Modify: `src/menu.js` (`buildZonePanel`)
- Modify: `src/main.js` (`estimateText`)
- Test: `tests/config.test.mjs`

**Interfaces:**
- Consumes: `config.stream` de la tarea 1; la clave `streamMode` de `RELOAD_KEYS`, tarea 6.
- Produces: `ui.streamInterval`, `ui.streamBudget`, `ui.streamMemory`.

- [ ] **Step 1: Poner a salvo los ajustes a mano del fichero**

```bash
git status --porcelain vuela.config.js
# Si aparece algo, y SÓLO si aparece algo:
git stash push -- vuela.config.js
```

- [ ] **Step 2: Escribir el test que todavía no pasa**

En `tests/config.test.mjs`, junto a los demás sabotajes de `ui`, después de `catches( 'ui.mass.path apuntando a nada', ... )`:

```js
catches( 'ui.streamInterval.path apuntando a nada', c => {
	c.ui.streamInterval.path = 'stream.intervalo';
}, 'ui.streamInterval' );
```

- [ ] **Step 3: Verlo fallar**

Run: `npm test`
Expected: FAIL en `tests/config.test.mjs`, en el sabotaje nuevo: no hay `ui.streamInterval` que sabotear, así que asignarle `.path` peta o no produce error que cazar.

- [ ] **Step 4: Añadir los rangos**

En `vuela.config.js`, dentro de `ui`, tras la línea de `spawnHeight`:

```js
		streamInterval: { path: 'stream.interval', min: 0.25, max: 5, step: 0.25 },
		streamBudget:   { path: 'stream.budgetMs', min: 1, max: 6, step: 0.5 },
		streamMemory:   { path: 'stream.memoryMb', min: 500, max: 4000, step: 100 },
```

- [ ] **Step 5: Los controles, en el panel de zona**

En `src/menu.js`, dentro de `buildZonePanel`, después de la constante `zone` y antes de `refreshEstimate();`:

```js
	const stream = h( 'fieldset', {}, [
		h( 'legend', { text: 'Modo de exploración' } ),
		checkbox( 'La zona cargada sigue al dron', config.stream, 'enabled', () => {

			refreshEstimate();
			onChange?.( 'streamMode' );

		} ),
		h( 'p', { class: 'note', text: 'Sin él el mundo se acaba a 22 km del despegue. Con él puedes alejarte sin límite, a cambio de que el detalle aparezca según llega en vez de estar todo listo antes de despegar. No hay colisiones: el dron atraviesa edificios y terreno. Cuesta lo mismo, una sesión.' } ),
		h( 'div', { class: 'grid', style: 'margin-top:10px' }, [
			labelledSlider( 'Refresco de la carga', config.stream, 'interval', {
				...ui.streamInterval,
				format: v => `${ v.toFixed( 2 ) } s`,
				onChange,
			} ),
			labelledSlider( 'Trabajo por frame', config.stream, 'budgetMs', {
				...ui.streamBudget,
				format: v => `${ v.toFixed( 1 ) } ms`,
				onChange,
			} ),
			labelledSlider( 'Memoria para tiles', config.stream, 'memoryMb', {
				...ui.streamMemory,
				format: v => `${ ( v / 1024 ).toFixed( 1 ) } GB`,
				onChange,
			} ),
		] ),
		h( 'p', { class: 'note', text: 'Estos tres se aplican en el sitio, sin recargar la zona. Súbelos si el detalle no llega a tiempo; bájalos si el contador de tirones del OSD deja de marcar cero.' } ),
	] );
```

Y cambia el `return` de la función para incluirlo:

```js
	return { rows: [ account, zone, stream ], refreshEstimate };
```

- [ ] **Step 6: Que la estimación diga la verdad en cada modo**

En `src/main.js`, sustituye el `return` de `estimateText()`:

```js
	return `Zona de ${ ( config.radius * 2 / 1000 ).toFixed( 1 ) } km de diámetro a máximo detalle · ${ label }. Las recargas posteriores de la misma zona salen de la caché local y son mucho más rápidas.`;
```

por:

```js
	const base = `Zona de ${ ( config.radius * 2 / 1000 ).toFixed( 1 ) } km de diámetro a máximo detalle · ${ label }. Las recargas posteriores de la misma zona salen de la caché local y son mucho más rápidas.`;

	// En exploración este radio deja de ser el mundo entero y pasa a ser sólo lo
	// que hay listo al despegar. Decir lo mismo en los dos modos haría mentir a
	// la estimación justo en el modo que la vuelve poco importante.
	return config.stream.enabled
		? `${ base } En exploración esto es sólo lo que se carga antes de despegar: a partir de ahí la zona te sigue y no hay borde.`
		: base;
```

- [ ] **Step 7: Verlo pasar**

Run: `npm test`
Expected: PASS. En particular tienen que seguir verdes los dos guardianes: `ningún min/max/step literal en menu.js` (los tres controles usan `...ui.streamX`) y `todos los rangos de ui se usan en el menú` (los tres nombres aparecen literalmente en `menu.js`).

- [ ] **Step 8: Devolver los ajustes a mano, si los guardaste**

```bash
git stash pop        # sólo si el Step 1 guardó algo
```

- [ ] **Step 9: Commit**

```bash
git add vuela.config.js src/menu.js src/main.js tests/config.test.mjs
git commit -m "feat: el modo de exploración se enciende desde el menú

El interruptor y sus tres números, en la pestaña de zona, que es donde se decide
qué mundo cargas. El interruptor recarga la zona; los tres deslizadores se
aplican en el sitio, y su nota dice hacia dónde moverlos según lo que falle: el
detalle o los tirones.

La estimación de carga deja de mentir en exploración: ese radio ya no es el
mundo entero, es sólo lo que hay listo al despegar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 8: El OSD

Los dos números con los que se ajusta el modo: cuánto cuesta el recorrido del árbol y cuánta memoria ocupan los tiles vivos. Ninguno de los dos se acierta a ojo, y el primero es el riesgo conocido del diseño — el recorrido es la única parte que no se puede trocear, así que si sale caro se ve aquí y no adivinando.

**Files:**
- Modify: `index.html:27` (una línea en el bloque `osd-tr`)
- Modify: `src/hud.js` (`el`, `update`, `updateText`)
- Modify: `src/main.js` (la llamada a `hud.update`)

**Interfaces:**
- Consumes: `world.stream.stats` de las tareas 4 y 6 — `{ traversalMs, textures, bytes, errors }`.
- Produces: nada que use nadie más.

- [ ] **Step 1: El hueco en el OSD**

En `index.html`, dentro de `<div class="osd osd-tr">`, después de la línea de `osd-stutters`:

```html
			<div id="osd-stream" class="dim" hidden>carga --</div>
```

- [ ] **Step 2: Leerlo en el HUD**

En `src/hud.js`, en el objeto `this.el`, después de `stutters`:

```js
				stream: document.getElementById( 'osd-stream' ),
```

- [ ] **Step 3: Dejar pasar las estadísticas hasta el texto**

Cambia las dos firmas y la llamada interna:

```js
	/** @param {number} frameMs tiempo del frame anterior en ms */
	update( frameMs, drone, controls, config, stream = null ) {
```

```js
			this.updateText( drone, controls, config, stream );
```

```js
	updateText( drone, controls, config, stream ) {
```

- [ ] **Step 4: Pintar los dos números**

En `updateText`, justo antes de `el.crash.hidden = ! drone.crashed;`:

```js
		// Carga continua. Estos dos números son con los que se ajusta el modo de
		// exploración, y a ojo no se aciertan: el coste del recorrido del árbol
		// —la única parte que no se puede trocear, así que si se dispara sale
		// como un tirón por turno— y cuánta memoria ocupan los tiles vivos, que
		// es lo que separa un vuelo largo de una pestaña muerta.
		el.stream.hidden = ! stream;

		if ( stream ) {

			el.stream.textContent =
				`${ stream.traversalMs.toFixed( 1 ) } ms · ${ ( stream.bytes / 1048576 ).toFixed( 0 ) } MB`
				+ ( stream.textures ? ` · ${ stream.textures } tex` : '' )
				+ ( stream.errors ? ` · ${ stream.errors } fallos` : '' );
			el.stream.style.color = stream.traversalMs > 8 ? '#f59e0b' : '';

		}
```

- [ ] **Step 5: Pasárselas desde el bucle**

En `src/main.js`, al final de `frame()`:

```js
	hud.update( frameMs, drone, controls, config, world.stream?.stats );
```

- [ ] **Step 6: Comprobar**

Run: `npm test`
Expected: PASS, suite entera verde.

Fuera del modo, `world.stream` es `null`, el parámetro llega como `undefined`, el elemento queda oculto y el OSD se ve exactamente igual que hoy.

- [ ] **Step 7: Commit**

```bash
git add index.html src/hud.js src/main.js
git commit -m "feat: el OSD enseña lo que cuesta la carga continua

Dos números, sólo en exploración: los milisegundos del último recorrido del
árbol de tiles y la memoria que ocupan los tiles vivos. El primero es el riesgo
conocido del modo —el recorrido no se puede trocear, así que si se dispara sale
como un tirón por turno— y el segundo es lo que separa un vuelo largo de una
pestaña muerta. Ninguno de los dos se acierta a ojo, y ahora no hace falta.

Se pone ámbar pasando de 8 ms, que es cuando ya se está comiendo medio frame.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

### Task 9: La documentación

Los tres documentos que quedan desalineados: el que explica por qué no hay tirones, el que explica el fichero de configuración y el que explica qué cubren los tests.

**Files:**
- Modify: `docs/rendimiento.md` (sección nueva al final)
- Modify: `docs/configuracion.md` (sección `Escenario`)
- Modify: `docs/tests.md` (párrafo nuevo tras el de `schedule.test.mjs`)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: `docs/rendimiento.md`**

Al final del fichero, después del párrafo del OSD:

```markdown
## El otro trato: el modo de exploración

Todo lo de arriba descansa en que la zona sea finita y conocida antes de despegar. El precio
es que el mundo se acaba a 22 km del punto de despegue: fuera de esa esfera no se carga nada,
nunca, por diseño.

El modo de exploración cambia ese trato. Las tres esferas de carga —detalle, media y telón de
fondo— dejan de estar clavadas en el despegue y siguen al dron, con lo que desaparece el
borde. A cambio se pierde la garantía estructural, porque vuelve a haber trabajo pendiente
durante el vuelo, y en su lugar hay un presupuesto:

- **El recorrido del árbol** va una vez por segundo (ajustable), no por frame, y sólo si el
  dron se ha movido al menos 25 m desde el último. Quedarse quieto en el aire no cuesta nada.
- **La subida de texturas a la GPU** sigue yendo cada frame, en porciones diminutas, con un
  techo en milisegundos que no se rebasa aunque queden mil pendientes. Confundir los dos
  relojes tira abajo el diseño: agrupar las texturas una vez por segundo daría un tirón por
  segundo.
- **La caché recupera un tope de bytes** y suelta lo que queda atrás. No es higiene: cuantos
  menos tiles vivos, más barato el recorrido.
- **No se construye la rejilla de colisiones.** Se construye de una vez sobre una zona finita
  y aquí no la hay, así que el dron atraviesa edificios y terreno. De paso se despega antes,
  porque era la parte más cara del arranque.
- **Los materiales planos salen premiados.** Como todos los tiles comparten una sola variante
  de shader, el primero compila y los demás reutilizan el programa: de los tres costes que
  paga la precarga, el más traicionero en caliente casi desaparece.

Cuando el dron avanza más rápido de lo que la red y la GPU alimentan, lo que se rompe es la
nitidez —por delante se ve basto y va afinando conforme te acercas— y nunca la fluidez.

**El riesgo conocido:** recorrer el árbol es una llamada indivisible. Si con la zona cargada
cuesta 8 ms, hay un pico de 8 ms por turno y no lo arregla ningún presupuesto. Por eso el OSD
enseña su coste real junto a la memoria viva: si se dispara, la respuesta es bajar el radio o
espaciar el refresco, y eso se decide con el número delante.

Este modo llega hasta donde el marco local plano siga valiendo, o sea decenas de kilómetros:
a 50 km el suelo ha caído casi 200 m respecto al plano tangente y la vertical se ha girado
medio grado. Volar hasta cualquier punto del planeta pide re-anclar el mundo cada pocos
kilómetros reorientando la gravedad, y eso es otro proyecto.
```

- [ ] **Step 2: `docs/configuracion.md`**

En la sección `## Escenario`, después de la viñeta de **Ver la rejilla** y antes del párrafo que empieza «El coste de carga crece…»:

```markdown
- **Modo de exploración** — la zona cargada sigue al dron en vez de quedarse clavada en el
  punto de despegue, así que el mundo deja de acabarse a 22 km y puedes alejarte sin límite.
  A cambio el detalle aparece según llega y **no hay colisiones**: el dron atraviesa edificios
  y terreno. Cuesta lo mismo, una sesión. Encenderlo o apagarlo recarga la zona; sus tres
  números se aplican en el sitio:
  - *Refresco de la carga* (1 s) — cada cuánto se recorre el árbol de tiles. No baja de ahí
    porque el recorrido es una llamada indivisible: si sale cara, un refresco corto la
    convierte en un tirón por turno. Un turno se salta entero si el dron no se ha movido 25 m.
  - *Trabajo por frame* (3 ms) — techo de tiempo subiendo texturas a la GPU en cada frame.
    Súbelo si el detalle no llega a tiempo, bájalo si el contador de tirones deja de ser cero.
  - *Memoria para tiles* (1,5 GB) — presupuesto de la caché. Corto, descarta cosas que sigues
    viendo y las vuelve a pedir en bucle; largo, crece hasta matar la pestaña. El OSD enseña
    cuánta se está usando de verdad.
```

- [ ] **Step 3: `docs/tests.md`**

Después del párrafo de `tests/schedule.test.mjs` y antes del de `tests/world.test.mjs`:

```markdown
`tests/stream.test.mjs` cubre las piezas del modo de exploración, donde la zona cargada sigue
al dron. Nada de esto necesita navegador: son aritmética de tiempo, de distancia y de
matrices. El reloj de refresco tiene que exigir las dos condiciones —intervalo cumplido *y*
distancia recorrida—, no gastar un solo turno con el dron quieto en el aire, y responder en el
acto al volver a moverse, que es lo que se pierde si los turnos saltados se apuntan como
gastados. El recentrado tiene que dejar las esferas sobre el dron deshaciendo la
transformación con la que el tileset pone la zona en el origen, sin tocarles el radio. El
goteo de texturas se prueba con un reloj falso que mueve el propio trabajo, así que el
presupuesto se comprueba contando en vez de cronometrando: parar al agotarlo, retomar
exactamente donde iba sin repetir ni saltarse ninguna, y que una textura rota no deje el vuelo
sin cargar nada más. Y el montaje sobre un tileset falso comprueba lo que ata las tres piezas:
que un modelo que llega en vuelo apunte sus texturas solo, que el presupuesto de memoria llegue
a la caché con margen entre mínimo y máximo, que un tile que falla se cuente en vez de tumbar
el vuelo, y que soltar el modo desenganche los oyentes —si no, el tileset viejo seguiría
alimentando la cola de un modo ya muerto.
```

- [ ] **Step 4: Comprobar**

Run: `npm test`
Expected: PASS. Los documentos no los lee ningún test, pero conviene no cerrar con la suite roja.

Y lee los tres cambios comprobando que ninguno promete algo que el código no haga: los números citados (22 km, 25 m, 1 s, 3 ms, 1,5 GB, 8 ms) tienen que coincidir con los de `vuela.config.js` y `src/stream.js`.

- [ ] **Step 5: Commit**

```bash
git add docs/rendimiento.md docs/configuracion.md docs/tests.md
git commit -m "docs: el modo de exploración y por qué cambia el trato

El documento de rendimiento explicaba una garantía —cero tirones porque no queda
trabajo pendiente— que este modo cambia por un presupuesto, y callarlo dejaría
la explicación entera desalineada con la mitad del programa. Con el riesgo
conocido dicho por su nombre: el recorrido del árbol no se puede trocear.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

## Qué queda pendiente de verificación en vuelo

Nada de lo que sigue lo puede comprobar `npm test`, y todo se ve en el OSD o en el
administrador de tareas del navegador. Con `stream.enabled` encendido y un vuelo largo en
línea recta:

1. **Que el contador de tirones siga en cero.** Es el criterio principal. Si no, baja *Trabajo
   por frame* y mira si mejora; si no mejora, el culpable es el recorrido del árbol y lo dirá
   el número de milisegundos del OSD.
2. **Cuánto cuesta de verdad el recorrido.** Es el riesgo conocido del diseño. Ámbar en el OSD
   significa que se está comiendo medio frame.
3. **Que la memoria se estabilice** en vez de subir sin parar hasta el tope y quedarse pegada
   ahí — pegada al tope es la señal de que la caché está desalojando en bucle.
4. **Que a toda velocidad en línea recta el detalle aguante** en vez de volar hacia una papilla.
5. **Que no aparezcan agujeros por delante.** El telón de fondo alcanza 22 km, así que a 40 m/s
   hay nueve minutos de margen; si aparece un vacío, el margen no es lo que se creía.
6. **Que un corte de red y una sesión caducada no echen del vuelo.** El corte se prueba
   desconectando el wifi unos segundos: tiene que aparecer la cuenta de fallos en el OSD y
   seguirse volando. La sesión caducada sólo se ve en un vuelo de media hora larga.
