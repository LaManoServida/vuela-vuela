# Configuración única en fichero — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que todos los números configurables de vuela-vuela vivan en un único fichero editable a mano, leído al arrancar, sin `localStorage` ni mezcla profunda.

**Architecture:** Un `vuela.config.js` en la raíz exporta por defecto un objeto con **exactamente la forma que el código ya consume** (claves planas de zona/render/juego/entrada, más `flight` y `places`), ampliado con un bloque `ui` que aporta los rangos de los deslizadores. `src/config.js` deja de ser un almacén de valores y pasa a ser un cargador de ~50 líneas que valida y clona. Mantener la forma del objeto intacta es deliberado: `world.js`, `preload.js`, `voxels.js`, `input.js`, `hud.js`, `demoWorld.js` y `quad.js` no se tocan.

**Tech Stack:** JavaScript ESM puro, Vite 8, three.js. Sin dependencias nuevas. Tests caseros en Node (`node tests/*.mjs`, sin framework), con el ayudante `check( nombre, condición, info )` que ya usan los dos ficheros existentes.

## Global Constraints

- **Ningún número configurable en código.** Los valores del preset (célula, motor, variador, hélice, batería, tune de Betaflight), los valores por defecto de zona/render/juego/entrada, los rangos `min`/`max`/`step` del menú y las coordenadas de los sitios van al fichero.
- **Sí siguen en código**, porque no son ajustes sino definiciones: las escalas internas del firmware en `src/flight/betaflight.js` (`PTERM_SCALE`, `ITERM_SCALE`, `DTERM_SCALE`, `FEEDFORWARD_SCALE`, `PID_MIXER_SCALING`, `ITERM_LIMIT`, `AG_KI`, `D_MIN_GAIN_FACTOR`, `D_MIN_SETPOINT_GAIN_FACTOR`, `D_MIN_LOWPASS_HZ`, `D_MIN_RANGE_HZ`, `ITERM_RELAX_SETPOINT_THRESHOLD`), la geometría de signos de `QUAD_X`, y las constantes físicas de `prop.js` / `motor.js` / `rigidbody.js` (gravedad, densidad del aire, curva de Johnson, Cheeseman-Bennett, `Kt = 60/(2π·KV)`).
- **Sin `localStorage`.** Se elimina por completo, junto con `merge()`, `loadConfig()`, `saveConfig()` y `resetFlight()`.
- **El fichero no se reescribe nunca desde el navegador.** No hay plugin de Vite, ni endpoint, ni escritura. Los comentarios del fichero son permanentes.
- **La API key no va en el fichero.** Es una credencial: sigue en `.env.local` vía `import.meta.env.VITE_GOOGLE_API_KEY`, para que `vuela.config.js` sea versionable.
- **El menú sigue editando en memoria.** Los cambios se aplican en caliente y se pierden al recargar. Es el comportamiento pedido.
- **Sin dependencias nuevas.** El fichero es `.js` y no JSON precisamente para no meter un parser de JSON5 y no perder los comentarios.
- **Estilo del repositorio:** tabuladores para indentar, espacios dentro de los paréntesis (`fn( a, b )`), comentarios en castellano que expliquen el *porqué* físico, no el qué.

---

### Task 0: Poner el proyecto bajo control de versiones

El directorio **no es un repositorio git** (comprobado: `git rev-parse` falla). Este refactor borra ficheros y reescribe otros; sin historial no hay marcha atrás. Esta tarea es requisito de todas las demás porque cada una acaba en un commit.

**Files:**
- Create: `.gitignore` (ya existe; se verifica que cubre lo necesario)

**Interfaces:**
- Consumes: nada.
- Produces: un repositorio git con un commit inicial que contiene el estado actual del código.

- [ ] **Step 1: Verificar que no hay repositorio**

```bash
git -C /ruta/al/repo rev-parse --is-inside-work-tree
```

Expected: falla con `fatal: not a git repository`. Si en cambio imprime `true`, salta al Step 5 y sigue con la Task 1.

- [ ] **Step 2: Comprobar que `.gitignore` cubre lo que debe**

Leer `.gitignore`. Tiene que contener exactamente estas cinco líneas:

```
node_modules/
dist/
.env
.env.local
.DS_Store
```

Si falta alguna, añadirla. `docs/` **sí** se versiona: el plan forma parte del repositorio.

- [ ] **Step 3: Inicializar y hacer el commit inicial**

```bash
cd /ruta/al/repo
git init -b main
git add -A
git commit -m "chore: estado inicial antes del refactor de configuración"
```

- [ ] **Step 4: Verificar que el árbol queda limpio y que no se coló nada gordo**

```bash
git status --porcelain
git ls-files | wc -l
```

Expected: `git status --porcelain` no imprime nada. `git ls-files | wc -l` da un número del orden de 25–30 ficheros, **no** miles. Si da miles es que `node_modules/` entró: deshacer con `git rm -r --cached node_modules` y volver a commitear.

- [ ] **Step 5: Capturar la salida de los tests como referencia**

```bash
npm test > /tmp/baseline-tests.txt 2>&1; tail -3 /tmp/baseline-tests.txt
```

Expected: la última línea es `TODO OK`. Este fichero es la referencia contra la que comparar al final del refactor: **el comportamiento del vuelo no debe cambiar en ningún paso de este plan.**

---

### Task 1: Crear `vuela.config.js` con todos los valores

Nace el fichero único. Todavía no lo consume nadie: esta tarea sólo lo crea y demuestra con un test que su contenido es sano y completo. Separarla de la Task 2 permite verificar el dato antes de mover el código que lo usa.

**Files:**
- Create: `vuela.config.js`
- Create: `tests/config.test.mjs`
- Modify: `package.json:11` (añadir el nuevo test al script)

**Interfaces:**
- Consumes: nada.
- Produces: `export default` de un objeto con estas claves de primer nivel: `placeId`, `lat`, `lon`, `radius`, `quality`, `spawnHeight`, `renderScale`, `fov`, `camTilt`, `unlit`, `antialias`, `fogDensity`, `collisions`, `voxelSize`, `crashSpeed`, `battery`, `inputMode`, `deadzone`, `gamepadMap`, `mouseSens`, `places`, `flight`, `ui`.
  - `flight` tiene la forma `{ name, hint, frame, motor, esc, prop, battery, bf }` — idéntica a la que hoy devuelve `cloneAirframe( 'freestyle5' )` salvo que se le quita la clave `id`, que no la leía nadie.
  - `ui` es un objeto `{ [nombre]: { path?, min, max, step } }`. `path` es una ruta con puntos hasta el valor que ese rango gobierna (`'flight.frame.mass'`); las entradas sin `path` son rangos compartidos por varios controles (la rejilla de PID) y la validación no las recorre.
  - **No** contiene `apiKey` ni `airframe`. La primera va en `.env.local`; la segunda desaparece porque con un solo fichero ya no hay preset que seleccionar.

- [ ] **Step 1: Escribir el test que aún no puede pasar**

Crear `tests/config.test.mjs` con este contenido íntegro:

```js
/*
 * El fichero de configuración es la única fuente de números del simulador. Si
 * se cuela un NaN, un rango imposible o un valor fuera de su propio rango, el
 * modelo físico lo propaga y el dron aparece cayendo o girando a mil rpm sin
 * que nada avise. Estas comprobaciones son la red.
 */
import baseConfig from '../vuela.config.js';

let fails = 0;
const check = ( name, cond, info = '' ) => {
	if ( cond ) console.log( `  ok  ${ name } ${ info }` );
	else { console.log( `FAIL  ${ name } ${ info }` ); fails ++; }
};

/** Devuelve la ruta con puntos de todo número no finito que encuentre. */
function findBadNumbers( node, path = '' ) {

	const bad = [];

	for ( const [ key, value ] of Object.entries( node ) ) {

		const here = path ? `${ path }.${ key }` : key;

		if ( typeof value === 'number' ) {

			if ( ! Number.isFinite( value ) ) bad.push( here );

		} else if ( value && typeof value === 'object' ) {

			bad.push( ...findBadNumbers( value, here ) );

		}

	}

	return bad;

}

const at = ( obj, path ) => path.split( '.' ).reduce( ( o, k ) => o?.[ k ], obj );

console.log( '\n== integridad numérica ==' );

const bad = findBadNumbers( baseConfig );
check( 'ningún NaN ni Infinity en todo el fichero', bad.length === 0, bad.join( ', ' ) );

console.log( '\n== bloques que el modelo necesita ==' );

for ( const block of [ 'frame', 'motor', 'esc', 'prop', 'battery', 'bf' ] ) {

	check( `flight.${ block } existe`, baseConfig.flight?.[ block ] != null );

}

check( 'bf.pid tiene los tres ejes', baseConfig.flight.bf.pid.length === 3 );
check( 'el yaw no lleva D', baseConfig.flight.bf.pid[ 2 ].dMax === 0 );
check( 'frame.inertia tiene tres componentes', baseConfig.flight.frame.inertia.length === 3 );

console.log( '\n== curva del variador ==' );

const curve = baseConfig.flight.esc.curve;
check( 'tiene 65 puntos', curve.length === 65, `${ curve.length }` );
check( 'empieza en 0 y acaba en 1', curve[ 0 ] === 0 && curve[ curve.length - 1 ] === 1 );
check( 'es monótona creciente', curve.every( ( v, i ) => i === 0 || v > curve[ i - 1 ] ) );

console.log( '\n== rangos de la interfaz ==' );

let rangesOk = true, valuesOk = true, pathsOk = true;

for ( const [ name, range ] of Object.entries( baseConfig.ui ) ) {

	if ( ! ( range.min < range.max ) || ! ( range.step > 0 ) ) {

		console.log( `      rango imposible en ui.${ name }` );
		rangesOk = false;

	}

	if ( ! range.path ) continue;

	const value = at( baseConfig, range.path );

	if ( typeof value !== 'number' ) {

		console.log( `      ui.${ name }.path apunta a "${ range.path }", que no es un número` );
		pathsOk = false;
		continue;

	}

	if ( value < range.min || value > range.max ) {

		console.log( `      ${ range.path } = ${ value }, fuera de [${ range.min }, ${ range.max }]` );
		valuesOk = false;

	}

}

check( 'todos los rangos tienen min < max y step > 0', rangesOk );
check( 'todos los path apuntan a un número existente', pathsOk );
check( 'todos los valores caen dentro de su rango', valuesOk );

console.log( '\n== sitios ==' );

check( 'hay sitios definidos', baseConfig.places.length > 0, `${ baseConfig.places.length }` );
check(
	'todos tienen id, nombre y coordenadas válidas',
	baseConfig.places.every( p =>
		p.id && p.name
		&& Math.abs( p.lat ) <= 90 && Math.abs( p.lon ) <= 180 ),
);
check(
	'placeId por defecto existe en la lista',
	baseConfig.places.some( p => p.id === baseConfig.placeId ),
	baseConfig.placeId,
);

console.log( fails ? `\n${ fails } FALLOS\n` : '\nTODO OK\n' );
process.exit( fails ? 1 : 0 );
```

- [ ] **Step 2: Ejecutarlo para verlo fallar**

```bash
node tests/config.test.mjs
```

Expected: FALLA con `ERR_MODULE_NOT_FOUND` sobre `vuela.config.js`. El fichero aún no existe: ese es el fallo esperado.

- [ ] **Step 3: Crear `vuela.config.js`**

Los valores salen de tres sitios y **no se cambia ninguno**: `src/config.js:7-46` (`DEFAULTS`, menos `apiKey` y `airframe`), `src/flight/params.js:87-171` (el preset `freestyle5`) y `src/locations.js:3-16` (`PLACES`). Los rangos de `ui` salen de los `min`/`max`/`step` que hoy están repartidos por `src/menu.js`. Contenido íntegro:

```js
/*
 * Configuración de vuela-vuela.
 *
 * Este es el único sitio donde hay números ajustables. Se lee al arrancar y no
 * se reescribe nunca: edítalo a mano con el juego cerrado y recarga.
 *
 * Lo que toques desde el menú del juego se aplica al instante pero vive sólo en
 * memoria; al recargar vuelve a mandar lo que ponga aquí.
 *
 * La API key NO está en este fichero: es una credencial, va en `.env.local`
 * como VITE_GOOGLE_API_KEY. Así este fichero se puede versionar sin filtrarla.
 *
 * Todas las magnitudes están en unidades reales: kilos, metros, kg·m², ohmios,
 * amperios, grados. Los números de hardware son de componentes que existen
 * (motor EMAX MT2204, hélice Gemfan 5146, LiPo 4S 1300 mAh) y los del
 * controlador son los de una tune de Betaflight normal para 5 pulgadas.
 */

export default {

	// =====================================================================
	//  Zona de vuelo
	// =====================================================================

	placeId: 'nyc',            // id de `places`, o 'custom' si escribes lat/lon a mano
	lat: 40.7580,
	lon: - 73.9855,

	// Cuánto mapa se carga entero antes de despegar. Es EL parámetro que decide
	// el tiempo de carga y la memoria: el coste crece con el CUADRADO del radio.
	radius: 1100,              // m

	// Error geométrico objetivo dentro del radio. Menor = más detalle y más
	// descarga, también al cuadrado. 12 es alto; Google recomienda 20 para
	// navegación normal.
	quality: 12,

	spawnHeight: 45,           // m sobre el suelo

	// =====================================================================
	//  Imagen
	// =====================================================================

	renderScale: 1.0,          // multiplicador de resolución; bájalo antes que la calidad
	fov: 120,                  // grados, cámara FPV
	camTilt: 25,               // grados de inclinación de la cámara
	unlit: true,               // materiales planos: la textura fotogramétrica ya trae la luz horneada
	antialias: true,
	fogDensity: 0.9,           // multiplicador sobre la niebla automática

	// =====================================================================
	//  Juego
	// =====================================================================

	collisions: true,
	voxelSize: 2.0,            // m, resolución de la rejilla de colisión
	crashSpeed: 4.5,           // m/s de impacto que rompe el dron
	battery: true,

	// =====================================================================
	//  Entrada
	// =====================================================================

	inputMode: 'auto',         // 'auto' | 'gamepad' | 'mouse'
	deadzone: 0.04,
	mouseSens: 0.0028,

	// null = mapeo por defecto. Para fijar el tuyo a mano:
	//   { roll: { axis: 0, inv: false }, pitch: { axis: 1, inv: true },
	//     yaw:  { axis: 2, inv: false }, throttle: { axis: 3, inv: true } }
	gamepadMap: null,

	// =====================================================================
	//  Sitios
	// =====================================================================
	//  Buena cobertura fotogramétrica y volumen vertical interesante para FPV:
	//  cañones urbanos, puentes, costa.

	places: [
		{ id: 'nyc', name: 'Manhattan', hint: 'Midtown, Nueva York', lat: 40.7580, lon: - 73.9855 },
		{ id: 'gg', name: 'Golden Gate', hint: 'San Francisco', lat: 37.8199, lon: - 122.4783 },
		{ id: 'bcn', name: 'Sagrada Família', hint: 'Barcelona', lat: 41.4036, lon: 2.1744 },
		{ id: 'eiffel', name: 'Torre Eiffel', hint: 'París', lat: 48.8584, lon: 2.2945 },
		{ id: 'dubai', name: 'Dubai Marina', hint: 'Rascacielos + agua', lat: 25.0805, lon: 55.1403 },
		{ id: 'hk', name: 'Kowloon', hint: 'Hong Kong', lat: 22.3080, lon: 114.1700 },
		{ id: 'chi', name: 'Chicago River', hint: 'Cañón urbano', lat: 41.8885, lon: - 87.6250 },
		{ id: 'venice', name: 'Venecia', hint: 'Canales y campanile', lat: 45.4341, lon: 12.3388 },
		{ id: 'madrid', name: 'Gran Vía', hint: 'Madrid', lat: 40.4200, lon: - 3.7050 },
		{ id: 'rio', name: 'Cristo Redentor', hint: 'Río de Janeiro', lat: - 22.9519, lon: - 43.2105 },
		{ id: 'sydney', name: 'Ópera de Sídney', hint: 'Bahía', lat: - 33.8568, lon: 151.2153 },
		{ id: 'monaco', name: 'Mónaco', hint: 'Puerto y desnivel', lat: 43.7384, lon: 7.4246 },
	],

	// =====================================================================
	//  El aparato
	// =====================================================================

	flight: {

		name: '5" freestyle',
		hint: 'EMAX 2204 · Gemfan 5146 · 4S',

		frame: {
			mass: 0.601,                       // kg con batería

			// Tensor de inercia en ejes de cuerpo (x=cabeceo, y=guiñada, z=alabeo).
			// La guiñada casi dobla a las otras dos: toda la masa cuenta a brazo
			// completo. Es la razón de que el yaw se sienta más pesado.
			inertia: [ 0.0032, 0.0058, 0.0032 ],

			armRadius: 0.110,                  // m del centro al motor
			armAngle: 45,                      // grados desde el morro

			// Área de arrastre efectiva (Cd·A) por eje, m². La vertical es la
			// mayor: de plano el dron es una placa.
			dragArea: { x: 0.020, y: 0.030, z: 0.018 },

			angularDrag: 0.0016,               // N·m·s²/rad², amortiguamiento en giro
			gravityScale: 1.0,
		},

		motor: {
			kv: 2300,                          // RPM por voltio
			resistance: 0.0414,                // Ω por fase
			noLoadCurrent: 0.7,                // A, lo que se come en vacío
			currentLimit: 30,                  // A de pico (un 2204 no da más)
			ktEfficiency: 0.98,                // Kt real frente al ideal 60/(2π·KV)
			inertia: 1.8e-6,                   // kg·m², campana + imanes

			// Ganancia del lazo de velocidad del variador. Es el parámetro que
			// fija a qué RPM se estabiliza el motor con la hélice puesta: sin él
			// un 2300 KV a 4S subiría a 38.000 RPM en vacío teórico.
			msrGain: 0.30,
			rpmOffset: 2000,
			emfFactor: 1.0,
		},

		esc: {
			currentLimit: 30,                  // A
			resistance: 0.005,                 // Ω
			braking: true,                     // frenado activo
			cutoffCellV: 3.1,                  // V por celda a la que corta

			// Curva de respuesta de un variador de 5": mando de entrada → mando
			// efectivo. No es una recta; la zona baja tiene menos resolución de
			// la que parece. 65 puntos equiespaciados de 0 a 1.
			curve: [
				0.000, 0.011, 0.023, 0.034, 0.045, 0.057, 0.068, 0.080, 0.091, 0.103,
				0.115, 0.128, 0.140, 0.153, 0.165, 0.178, 0.191, 0.205, 0.218, 0.232,
				0.246, 0.260, 0.274, 0.288, 0.303, 0.317, 0.331, 0.345, 0.360, 0.374,
				0.388, 0.403, 0.418, 0.433, 0.448, 0.463, 0.479, 0.495, 0.511, 0.527,
				0.543, 0.558, 0.573, 0.589, 0.604, 0.620, 0.636, 0.653, 0.670, 0.687,
				0.705, 0.724, 0.742, 0.761, 0.780, 0.799, 0.819, 0.839, 0.860, 0.882,
				0.905, 0.928, 0.952, 0.976, 1.000,
			],
		},

		prop: {
			diameterIn: 5.1,
			pitchIn: 4.6,
			blades: 3,
			chordMm: 15,
			hubFraction: 0.20,
			inertia: 2.8e-6,                   // kg·m²

			// Polar de la pala.
			cd0: 0.035,
			dCdByCl2: 0.020,
			clMax: 0.70,
			clMin: - 0.80,
			dClByAlpha: 2.93,                  // por radián
			inducedPowerFactor: 1.15,          // κ: pérdidas de punta y flujo no uniforme

			// Estela.
			washFactor: 1.0,
			washRate: 20,                      // 1/s del paso bajo del downwash
			translationalRelief: 80,

			// Anillo de vórtices.
			vrsGain: 0.95,                     // recirculación en el pico, en unidades de vi
			vrsBuffet: 0.22,                   // amplitud del temblor
			vrsBuffetHz: 3.5,

			// Deformación de pala a alta carga (velocidad de sección, m/s).
			deformMin: 90,
			deformMax: 130,
			deformPercent: 0.12,
		},

		battery: {
			cells: 4,
			cellR: 0.003,                      // Ω por celda
			capacityAh: 1.3,
			cellFullV: 4.2,
			cellFlatV: 3.0,
			cutoffCellV: 3.1,
		},

		// -----------------------------------------------------------------
		//  Tune de Betaflight
		// -----------------------------------------------------------------
		//  Mismos nombres, unidades y escalas internas que el configurador de
		//  Betaflight: una tune que funcione aquí funciona en un dron real, y
		//  al revés. Puedes copiar los números de tu configurador tal cual.

		bf: {
			mode: 'acro',                  // 'acro' | 'angle' | 'horizon'

			// --- Rates ---
			rateType: 'betaflight',        // 'betaflight' | 'actual'
			rcRate: 0.95,
			superRate: 0.70,
			rcExpo: 0.00,
			rcYawRate: 0.80,
			superRateYaw: 0.70,
			rcYawExpo: 0.00,

			// --- PID (números de configurador, no ganancias crudas) ---
			pid: [
				{ p: 60, i: 45, dMax: 35, dMin: 25, f: 90 },   // roll
				{ p: 60, i: 45, dMax: 35, dMin: 25, f: 90 },   // pitch
				{ p: 100, i: 45, dMax: 0, dMin: 0, f: 90 },    // yaw (sin D, como manda BF)
			],

			// --- Modos autonivelados ---
			angleStrength: 50,
			horizonStrength: 50,
			angleLimit: 55,                // grados

			// --- Correctores ---
			tpaRate: 0.20,                 // cuánto se atenúan P y D con el gas alto
			tpaBreakpoint: 0.65,           // fracción de gas; en BF es 1650 µs
			antiGravityGain: 3.5,
			antiGravityCutoffHz: 15,
			itermRelax: true,
			itermRelaxCutoffHz: 15,
			dMinGain: 37,
			dMinAdvance: 20,

			// --- Filtros ---
			gyroLpfHz: 150,
			dtermLpfHz: 110,
			rcSmoothingHz: 28,             // suavizado del enlace de radio

			// --- Mezclador ---
			pidSumLimit: 500,
			pidSumLimitYaw: 400,
			throttleMid: 0.5,
			throttleExpo: 0.0,
			throttleCap: 1.0,
			airMode: true,
			motorIdle: 0.045,

			// --- Limitador de RPM (el gobernador de BF; normalmente apagado) ---
			rpmLimit: false,
			rpmLimitValue: 20000,
			rpmLimitP: 0.40,
			rpmLimitI: 0.40,
			rpmLimitD: 0.0006,
			rpmLimitLpfHz: 20,
		},

	},

	// =====================================================================
	//  Rangos de los controles del menú
	// =====================================================================
	//  `path` es la ruta al valor que ese control gobierna; sirve para que el
	//  test compruebe que el valor de arriba cae dentro de su propio rango.
	//  Las entradas sin `path` son rangos compartidos por varios controles.

	ui: {
		// Los campos de coordenadas son de escritura libre, pero declarar su
		// rango sirve para dos cosas: da el `step` del control y hace que una
		// latitud imposible se detecte al arrancar en vez de al pedir tiles.
		lat:           { path: 'lat', min: - 90, max: 90, step: 0.0001 },
		lon:           { path: 'lon', min: - 180, max: 180, step: 0.0001 },

		radius:        { path: 'radius', min: 300, max: 3000, step: 50 },
		quality:       { path: 'quality', min: 6, max: 40, step: 1 },
		spawnHeight:   { path: 'spawnHeight', min: 2, max: 300, step: 1 },

		fov:           { path: 'fov', min: 70, max: 160, step: 1 },
		camTilt:       { path: 'camTilt', min: 0, max: 55, step: 1 },
		renderScale:   { path: 'renderScale', min: 0.5, max: 1.5, step: 0.05 },
		fogDensity:    { path: 'fogDensity', min: 0, max: 2.5, step: 0.1 },

		rcRate:        { path: 'flight.bf.rcRate', min: 0.2, max: 2.5, step: 0.01 },
		superRate:     { path: 'flight.bf.superRate', min: 0, max: 0.95, step: 0.01 },
		rcExpo:        { path: 'flight.bf.rcExpo', min: 0, max: 0.9, step: 0.01 },
		rcYawRate:     { path: 'flight.bf.rcYawRate', min: 0.2, max: 2.5, step: 0.01 },
		superRateYaw:  { path: 'flight.bf.superRateYaw', min: 0, max: 0.95, step: 0.01 },
		angleLimit:    { path: 'flight.bf.angleLimit', min: 20, max: 80, step: 1 },
		antiGravity:   { path: 'flight.bf.antiGravityGain', min: 0, max: 10, step: 0.1 },
		tpaRate:       { path: 'flight.bf.tpaRate', min: 0, max: 0.8, step: 0.01 },

		// Compartido por las 12 casillas de la rejilla P/I/D/F.
		pidGain:       { min: 0, max: 250, step: 1 },

		mass:          { path: 'flight.frame.mass', min: 0.25, max: 1.4, step: 0.005 },
		armRadius:     { path: 'flight.frame.armRadius', min: 0.05, max: 0.30, step: 0.005 },
		dragFront:     { path: 'flight.frame.dragArea.z', min: 0.004, max: 0.06, step: 0.001 },
		motorKv:       { path: 'flight.motor.kv', min: 1200, max: 4000, step: 10 },
		motorCurrent:  { path: 'flight.motor.currentLimit', min: 10, max: 60, step: 1 },
		propDiameter:  { path: 'flight.prop.diameterIn', min: 2, max: 7, step: 0.1 },
		propPitch:     { path: 'flight.prop.pitchIn', min: 2, max: 7, step: 0.1 },
		batteryCells:  { path: 'flight.battery.cells', min: 2, max: 8, step: 1 },
	},

};
```

- [ ] **Step 4: Ejecutar el test y verlo pasar**

```bash
node tests/config.test.mjs
```

Expected: PASA, última línea `TODO OK`. Si falla en «todos los valores caen dentro de su rango», el rango de `ui` y el valor de arriba se contradicen: corrige el que esté mal, no ensanches el rango sin pensarlo.

- [ ] **Step 5: Añadirlo al script de tests**

En `package.json`, sustituir la línea 11 por:

```json
    "test": "node tests/config.test.mjs && node tests/flight.test.mjs && node tests/world.test.mjs"
```

Va primero a propósito: si la configuración está rota, los otros dos fallarían de formas confusas.

- [ ] **Step 6: Ejecutar la batería entera**

```bash
npm test 2>&1 | tail -5
```

Expected: `TODO OK`. Los otros dos tests siguen usando `params.js` y no se han enterado de nada todavía.

- [ ] **Step 7: Commit**

```bash
git add vuela.config.js tests/config.test.mjs package.json
git commit -m "feat: fichero único de configuración con todos los valores"
```

---

### Task 2: Convertir `src/config.js` en cargador y validador

Aquí muere `localStorage`. `src/config.js` pasa de almacenar 89 valores a leerlos del fichero, validarlos y exponerlos.

**Files:**
- Modify: `src/config.js` (reescritura completa, 117 → ~60 líneas)
- Modify: `tests/config.test.mjs` (añadir bloque para el cargador)

**Interfaces:**
- Consumes: el `export default` de `vuela.config.js` de la Task 1.
- Produces:
  - `export const config` — copia profunda validada del fichero, con `apiKey` añadida desde `import.meta.env.VITE_GOOGLE_API_KEY`. Es el objeto mutable que el menú edita en caliente. Sustituye a `loadConfig()`.
  - `export function cloneFlight()` — copia profunda de `config.flight`, para construir un `Quad` sin que comparta estado. Sustituye a `cloneAirframe( id )`.
  - `export const ui` — atajo a `config.ui`, para que `menu.js` no escriba `config.ui` treinta veces.
  - **Desaparecen** `loadConfig`, `saveConfig`, `resetFlight` y `DEFAULTS`.

- [ ] **Step 1: Escribir el test que aún no puede pasar**

Añadir al **final** de `tests/config.test.mjs`, justo **antes** de la línea `console.log( fails ? ... )`:

```js
console.log( '\n== cargador ==' );

const { config, cloneFlight, ui } = await import( '../src/config.js' );

check( 'config expone los valores del fichero', config.radius === baseConfig.radius, `${ config.radius }` );
check( 'ui es un atajo a config.ui', ui === config.ui );

// El cargador clona: tocar `config` no puede contaminar el fichero importado,
// porque el mismo módulo lo comparten los tests y el juego.
config.radius = 999;
check( 'config es una copia, no el objeto del fichero', baseConfig.radius !== 999 );
config.radius = baseConfig.radius;

const a = cloneFlight();
const b = cloneFlight();
a.frame.mass = 12.5;
check( 'cloneFlight devuelve copias independientes', b.frame.mass !== 12.5, `${ b.frame.mass }` );
check( 'cloneFlight no toca la config viva', config.flight.frame.mass !== 12.5 );
check( 'cloneFlight arrastra la tune', a.bf.pid.length === 3 );

check( 'apiKey existe como cadena', typeof config.apiKey === 'string' );
check( 'la apiKey no está en el fichero', baseConfig.apiKey === undefined );
```

- [ ] **Step 2: Ejecutarlo para verlo fallar**

```bash
node tests/config.test.mjs
```

Expected: FALLA. `src/config.js` todavía exporta `loadConfig`/`saveConfig`, así que `config`, `cloneFlight` y `ui` llegan como `undefined` y revientan las comprobaciones (`FAIL  config expone los valores del fichero`, y probablemente un `TypeError` al llamar a `cloneFlight()`).

- [ ] **Step 3: Reescribir `src/config.js`**

Sustituir el contenido completo por:

```js
/*
 * Cargador de la configuración.
 *
 * Todos los valores viven en `vuela.config.js`, en la raíz. Aquí sólo se
 * clonan, se validan y se exponen. No hay `localStorage` ni mezcla con valores
 * por defecto: si algo no está en el fichero, no existe.
 *
 * La validación no es paranoia: el fichero se edita a mano, y un número mal
 * escrito se propaga a NaN en un par de pasos del modelo físico. Un dron que
 * aparece cayendo o girando sin control es mucho más difícil de diagnosticar
 * que un error al arrancar que dice exactamente qué clave está mal.
 */
import baseConfig from '../vuela.config.js';

/** Devuelve la ruta con puntos de todo número no finito del objeto. */
function findBadNumbers( node, path = '' ) {

	const bad = [];

	for ( const [ key, value ] of Object.entries( node ) ) {

		const here = path ? `${ path }.${ key }` : key;

		if ( typeof value === 'number' ) {

			if ( ! Number.isFinite( value ) ) bad.push( here );

		} else if ( value && typeof value === 'object' ) {

			bad.push( ...findBadNumbers( value, here ) );

		}

	}

	return bad;

}

const at = ( obj, path ) => path.split( '.' ).reduce( ( o, k ) => o?.[ k ], obj );

function setAt( obj, path, value ) {

	const keys = path.split( '.' );
	const last = keys.pop();
	keys.reduce( ( o, k ) => o[ k ], obj )[ last ] = value;

}

/**
 * Recorta los valores que tienen rango declarado en `ui`. Editar el fichero a
 * mano y pasarse de un extremo no debe romper el simulador en silencio, pero
 * tampoco conviene que pase inadvertido: se avisa por consola.
 */
function clampToRanges( cfg ) {

	for ( const [ name, range ] of Object.entries( cfg.ui ) ) {

		if ( ! range.path ) continue;

		const value = at( cfg, range.path );
		if ( typeof value !== 'number' ) continue;

		const clamped = Math.min( range.max, Math.max( range.min, value ) );

		if ( clamped !== value ) {

			console.warn(
				`[vuela-vuela] ${ range.path } = ${ value } está fuera de `
				+ `[${ range.min }, ${ range.max }] (ui.${ name }); se usa ${ clamped }.`,
			);
			setAt( cfg, range.path, clamped );

		}

	}

}

function load() {

	const bad = findBadNumbers( baseConfig );

	if ( bad.length ) {

		throw new Error(
			`vuela.config.js tiene valores no numéricos en: ${ bad.join( ', ' ) }. `
			+ 'Revísalos: un NaN aquí se propaga a todo el modelo de vuelo.',
		);

	}

	// Copia profunda: el menú edita este objeto en caliente y el fichero
	// importado lo comparten los tests y el propio juego.
	const cfg = structuredClone( baseConfig );

	clampToRanges( cfg );

	// La credencial no vive en el fichero de configuración, para que ese sí se
	// pueda versionar. Ver `.env.example`.
	cfg.apiKey = import.meta.env?.VITE_GOOGLE_API_KEY || '';

	return cfg;

}

export const config = load();

export const ui = config.ui;

/** Copia profunda del aparato, para construir un Quad sin compartir estado. */
export function cloneFlight() {

	return structuredClone( config.flight );

}
```

- [ ] **Step 4: Ejecutar el test y verlo pasar**

```bash
node tests/config.test.mjs
```

Expected: PASA con `TODO OK`.

- [ ] **Step 5: Comprobar que la batería entera sigue en verde**

```bash
npm test 2>&1 | tail -3
```

Expected: `TODO OK`. `params.js` todavía existe y `flight.test.mjs` y `world.test.mjs` lo siguen usando, así que en este punto conviven las dos fuentes de números sin pisarse. La Task 3 elimina la duplicidad.

- [ ] **Step 6: Commit**

```bash
git add src/config.js tests/config.test.mjs
git commit -m "refactor: config.js pasa a cargar y validar el fichero único"
```

---

### Task 3: Migrar los consumidores y borrar `params.js` y `locations.js`

`params.js` y `locations.js` dejan de tener razón de ser: sus números ya están en el fichero. Se actualizan los cinco puntos de llamada y se borran.

**Files:**
- Modify: `tests/flight.test.mjs:10,25,255`
- Modify: `tests/world.test.mjs:9,28`
- Modify: `src/main.js:3,35,163,218,351,470-473`
- Modify: `src/menu.js:1,178,217,224-231`
- Delete: `src/flight/params.js`
- Delete: `src/locations.js`

**Interfaces:**
- Consumes: `config`, `cloneFlight` de `src/config.js` (Task 2).
- Produces: ningún símbolo nuevo. Al acabar, `grep -r "params.js\|locations.js\|saveConfig\|loadConfig\|cloneAirframe" src/ tests/` no devuelve nada.

- [ ] **Step 1: Confirmar el punto de partida**

```bash
npm test 2>&1 | tail -3
```

Expected: `TODO OK`. Los tres tests pasan: `params.js` sigue en su sitio y nadie se ha roto todavía. Esta tarea le quita los consumidores uno a uno y sólo entonces lo borra, de modo que el árbol nunca queda a medias.

- [ ] **Step 2: Migrar `tests/flight.test.mjs`**

Sustituir la línea 10:

```js
import { cloneAirframe } from '../src/flight/params.js';
```

por:

```js
import { cloneFlight } from '../src/config.js';
```

Y las dos llamadas, en las líneas 25 y 255:

```js
	const p = cloneAirframe( 'freestyle5' );
```

por:

```js
	const p = cloneFlight();
```

- [ ] **Step 3: Migrar `tests/world.test.mjs`**

Sustituir la línea 9:

```js
import { cloneAirframe } from '../src/flight/params.js';
```

por:

```js
import { cloneFlight } from '../src/config.js';
```

Y la línea 28:

```js
	const params = cloneAirframe( 'freestyle5' );
```

por:

```js
	const params = cloneFlight();
```

- [ ] **Step 4: Ejecutar los tests y verlos pasar contra la configuración nueva**

```bash
npm test 2>&1 | tail -3
```

Expected: `TODO OK`. Éste es el paso que demuestra que el fichero nuevo reproduce el aparato exacto: las comprobaciones de empuje por motor, empuje/peso, gas de sustentación y figura de mérito siguen dentro de sus rangos de 5" real.

- [ ] **Step 5: Comparar con la referencia para asegurar que nada cambió**

```bash
npm test > /tmp/after-tests.txt 2>&1
diff <( sed -n '/curvas de rates/,$p' /tmp/baseline-tests.txt ) \
     <( sed -n '/curvas de rates/,$p' /tmp/after-tests.txt ) && echo "IDÉNTICO"
```

Expected: imprime `IDÉNTICO`. El `sed` recorta ambas salidas desde el mismo punto, así que la comparación ignora el test de configuración (que no existía en la referencia) y confronta sólo vuelo y mundo. Los tests publican **valores medidos**, no sólo `ok`: empuje por motor, empuje/peso, RPM, gas de sustentación, figura de mérito. Que salgan idénticos demuestra que el fichero reproduce el aparato exacto.

Si hay diferencias, algún número se copió mal. Localízalo comparando con el original:

```bash
git show HEAD~2:src/flight/params.js > /tmp/params-original.js
```

- [ ] **Step 6: Migrar `src/main.js`**

Sustituir la línea 3:

```js
import { loadConfig, saveConfig } from './config.js';
```

por:

```js
import { config } from './config.js';
```

Borrar la línea 35 entera (`const config = loadConfig();`), porque `config` ahora llega importado.

Borrar la línea 163 (`saveConfig( config );`) dentro de `loadAndFly`, junto con la línea en blanco que la sigue.

Borrar la línea 351 (`saveConfig( config );`) dentro de `pauseFlight`.

**No tocar la línea 218.** `drone = new Quad( config.flight, { … } )` se queda exactamente como está. Es tentador clonar ahí, pero sería un error: `Quad` guarda lo que recibe en `this.params` y lee de ahí la tune en cada paso (`quad.js:441`), y tanto `buildFlightPanel` como `buildPauseSettings` editan `config.flight.bf`. Que sean el mismo objeto es **la razón por la que los ajustes de pausa se aplican al instante**. Hoy ya se comparte, porque `loadConfig()` se llamaba una sola vez al cargar el módulo.

Sustituir el cuerpo de `setupMenu()` (líneas 470-473):

```js
	buildMenu( dom.menuBody, config, {
		onChange: () => saveConfig( config ),
		onEstimate: estimateText,
	} );
```

por:

```js
	// No hay `onChange` de persistencia: la configuración vive en
	// `vuela.config.js` y el menú sólo edita la copia en memoria.
	buildMenu( dom.menuBody, config, { onEstimate: estimateText } );
```

- [ ] **Step 7: Migrar `src/menu.js`**

Sustituir la línea 1:

```js
import { PLACES } from './locations.js';
```

por:

```js
import { ui } from './config.js';
```

Sustituir la firma de `buildMenu` en la línea 178:

```js
export function buildMenu( container, config, { onChange, onEstimate } ) {
```

por:

```js
export function buildMenu( container, config, { onChange, onEstimate } = {} ) {
```

`onChange` pasa a ser opcional en todo el fichero; ya se invoca en todas partes con `onChange?.( … )`, así que no hay más que tocar por ese lado.

Sustituir la línea 217:

```js
	for ( const place of PLACES ) {
```

por:

```js
	for ( const place of config.places ) {
```

Sustituir las líneas 204-205, que llevan el `step` de los campos de coordenadas como literal entre comillas:

```js
	const latInput = h( 'input', { type: 'number', step: '0.0001', value: config.lat } );
	const lonInput = h( 'input', { type: 'number', step: '0.0001', value: config.lon } );
```

por:

```js
	const latInput = h( 'input', { type: 'number', step: ui.lat.step, value: config.lat } );
	const lonInput = h( 'input', { type: 'number', step: ui.lon.step, value: config.lon } );
```

- [ ] **Step 8: Borrar los ficheros muertos**

```bash
git rm src/flight/params.js src/locations.js
```

- [ ] **Step 9: Verificar que no queda ninguna referencia**

```bash
grep -rn "params\.js\|locations\.js\|saveConfig\|loadConfig\|cloneAirframe\|AIRFRAMES\|resetFlight\|localStorage\|PLACES" src/ tests/ ; echo "salida vacía = bien (exit $?)"
```

Expected: no imprime ninguna coincidencia. Si aparece alguna, migrarla antes de seguir.

- [ ] **Step 10: Arrancar el juego y comprobar que carga**

```bash
npm run dev
```

Abrir `http://127.0.0.1:5173`, pulsar **«Volar en la ciudad de prueba»** (no gasta cuota de Google), volar diez segundos y pulsar `Esc`.

Expected: la ciudad procedural carga, el dron vuela, el OSD muestra datos y la pausa abre los ajustes rápidos. En la consola del navegador no debe haber ningún error ni ningún aviso `[vuela-vuela] … está fuera de …`. Parar con `Ctrl+C`.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: consumidores leen del fichero único; fuera params.js y locations.js"
```

---

### Task 4: Sacar del menú los rangos hardcodeados

Quedan 30 `min`/`max`/`step` incrustados en `menu.js`. Pasan a leerse de `config.ui`, con lo que además desaparece la duplicación entre el menú principal y los ajustes de pausa.

**Files:**
- Modify: `src/menu.js` (24 controles en `buildMenu`, `buildFlightPanel`, `buildHardwarePanel`, `buildPauseSettings`)
- Modify: `tests/config.test.mjs` (añadir la comprobación de cobertura)

**Interfaces:**
- Consumes: `ui` de `src/config.js` (importado en la Task 3, Step 7).
- Produces: ninguna exportación nueva. `menu.js` no vuelve a contener literales numéricos en `min`, `max` ni `step`.

- [ ] **Step 1: Escribir el test que aún no puede pasar**

Añadir al final de `tests/config.test.mjs`, antes de la línea del recuento:

```js
console.log( '\n== el menú no tiene rangos propios ==' );

const menuSource = await ( await import( 'node:fs/promises' ) ).readFile(
	new URL( '../src/menu.js', import.meta.url ), 'utf8' );

// Un `min: 0.2` en el fuente del menú es un número de configuración escondido
// en código, que es justo lo que este refactor viene a eliminar. La comilla
// opcional es para que `step: '0.0001'` tampoco se escape por ir en cadena.
const literals = menuSource.match( /\b(min|max|step)\s*:\s*'?-?[0-9.]+/g ) || [];
check( 'ningún min/max/step literal en menu.js', literals.length === 0, literals.join( ', ' ) );

// Y al revés: un rango declarado que no use nadie es peso muerto.
const unused = Object.keys( baseConfig.ui ).filter( name => ! menuSource.includes( `ui.${ name }` ) );
check( 'todos los rangos de ui se usan en el menú', unused.length === 0, unused.join( ', ' ) );
```

- [ ] **Step 2: Ejecutarlo para verlo fallar**

```bash
node tests/config.test.mjs 2>&1 | tail -6
```

Expected: FALLA con `FAIL  ningún min/max/step literal en menu.js` seguido de la lista de los 30 literales, y `FAIL  todos los rangos de ui se usan en el menú` con los 24 nombres.

- [ ] **Step 3: Sustituir los rangos en `buildMenu`**

En el bloque de zona (líneas ~267-280), sustituir los tres `labelledSlider` por:

```js
			labelledSlider( 'Radio a máximo detalle', config, 'radius', {
				...ui.radius,
				format: v => `${ v } m`,
				onChange: () => { refreshEstimate(); onChange?.( 'radius' ); },
			} ),
			labelledSlider( 'Calidad (menor = más detalle)', config, 'quality', {
				...ui.quality,
				format: v => `${ v }`,
				onChange: () => { refreshEstimate(); onChange?.( 'quality' ); },
			} ),
			labelledSlider( 'Altura de aparición', config, 'spawnHeight', {
				...ui.spawnHeight,
				format: v => `${ v } m`,
			} ),
```

El *spread* funciona porque `labelledSlider` lee `opts.min`, `opts.max` y `opts.step`, exactamente los nombres que trae cada entrada de `ui`. La clave `path` sobra ahí dentro y no molesta: nadie la lee.

En el bloque de imagen (líneas ~297-308):

```js
			labelledSlider( 'FOV', config, 'fov', {
				...ui.fov, format: v => `${ v }°`, onChange,
			} ),
			labelledSlider( 'Inclinación de cámara', config, 'camTilt', {
				...ui.camTilt, format: v => `${ v }°`, onChange,
			} ),
			labelledSlider( 'Escala de render', config, 'renderScale', {
				...ui.renderScale, format: v => `${ Math.round( v * 100 ) }%`, onChange,
			} ),
			labelledSlider( 'Niebla', config, 'fogDensity', {
				...ui.fogDensity, format: v => v.toFixed( 1 ), onChange,
			} ),
```

- [ ] **Step 4: Sustituir los rangos en `buildFlightPanel`**

El array `rp` (líneas ~342-363) pasa a:

```js
	const rp = [
		nestedSlider( 'RC rate', bf, 'rcRate', {
			...ui.rcRate, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
		nestedSlider( 'Super rate', bf, 'superRate', {
			...ui.superRate, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
		nestedSlider( 'Expo', bf, 'rcExpo', {
			...ui.rcExpo, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
		nestedSlider( 'RC rate de yaw', bf, 'rcYawRate', {
			...ui.rcYawRate, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
		nestedSlider( 'Super rate de yaw', bf, 'superRateYaw', {
			...ui.superRateYaw, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
	];
```

En la rejilla de PID (línea ~376), sustituir:

```js
						type: 'number', min: 0, max: 250, step: 1,
```

por:

```js
						type: 'number', min: ui.pidGain.min, max: ui.pidGain.max, step: ui.pidGain.step,
```

Y los dos deslizadores de correctores (líneas ~424-433):

```js
			nestedSlider( 'Anti-gravity', bf, 'antiGravityGain', {
				...ui.antiGravity,
				format: v => v === 0 ? 'apagado' : v.toFixed( 1 ),
				onChange, notify: 'iterm',
			} ),
			nestedSlider( 'TPA (atenúa P y D con gas alto)', bf, 'tpaRate', {
				...ui.tpaRate,
				format: v => v === 0 ? 'apagada' : `${ Math.round( v * 100 ) } %`,
				onChange, notify: 'tpa',
			} ),
```

- [ ] **Step 5: Sustituir los rangos en `buildHardwarePanel`**

Las ocho entradas de la rejilla (líneas ~478-512) pasan a:

```js
			nestedSlider( 'Masa con batería', f.frame, 'mass', {
				...ui.mass,
				format: v => `${ ( v * 1000 ).toFixed( 0 ) } g`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'KV del motor', f.motor, 'kv', {
				...ui.motorKv, format: v => `${ v } KV`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Límite de corriente', f.motor, 'currentLimit', {
				...ui.motorCurrent, format: v => `${ v } A`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Diámetro de hélice', f.prop, 'diameterIn', {
				...ui.propDiameter, format: v => `${ v.toFixed( 1 ) }"`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Paso de hélice', f.prop, 'pitchIn', {
				...ui.propPitch, format: v => `${ v.toFixed( 1 ) }"`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Celdas de la batería', f.battery, 'cells', {
				...ui.batteryCells, format: v => `${ v }S (${ ( v * 4.2 ).toFixed( 1 ) } V)`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Longitud de brazo', f.frame, 'armRadius', {
				...ui.armRadius,
				format: v => `${ ( v * 1000 ).toFixed( 0 ) } mm`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Arrastre frontal', f.frame.dragArea, 'z', {
				...ui.dragFront,
				format: v => `${ ( v * 10000 ).toFixed( 0 ) } cm²`,
				onChange: refresh, notify: 'drag',
			} ),
```

Nota: el `4.2` de la etiqueta de celdas es la tensión nominal de una celda LiPo llena y ya está en el fichero como `flight.battery.cellFullV`. Sustituir esa etiqueta por:

```js
				format: v => `${ v }S (${ ( v * f.battery.cellFullV ).toFixed( 1 ) } V)`,
```

- [ ] **Step 6: Sustituir los rangos en `buildPauseSettings`**

Los siete deslizadores (líneas ~754-777) pasan a:

```js
			labelledSlider( 'FOV', config, 'fov', {
				...ui.fov, format: v => `${ v }°`, onChange,
			} ),
			labelledSlider( 'Inclinación de cámara', config, 'camTilt', {
				...ui.camTilt, format: v => `${ v }°`, onChange,
			} ),
			labelledSlider( 'Escala de render', config, 'renderScale', {
				...ui.renderScale, format: v => `${ Math.round( v * 100 ) }%`, onChange,
			} ),
			nestedSlider( 'RC rate', bf, 'rcRate', {
				...ui.rcRate, format: v => v.toFixed( 2 ),
				onChange: refreshRates, notify: 'rates',
			} ),
			nestedSlider( 'Super rate', bf, 'superRate', {
				...ui.superRate, format: v => v.toFixed( 2 ),
				onChange: refreshRates, notify: 'rates',
			} ),
			nestedSlider( 'Expo', bf, 'rcExpo', {
				...ui.rcExpo, format: v => v.toFixed( 2 ),
				onChange: refreshRates, notify: 'rates',
			} ),
			nestedSlider( 'Límite de inclinación (angle)', bf, 'angleLimit', {
				...ui.angleLimit, format: v => `${ v }°`, onChange, notify: 'mode',
			} ),
```

- [ ] **Step 7: Ejecutar el test y verlo pasar**

```bash
node tests/config.test.mjs 2>&1 | tail -6
```

Expected: PASA, `TODO OK`. Si sigue apareciendo algún literal, la lista que imprime el test dice cuál falta.

- [ ] **Step 8: Comprobar el menú en el navegador**

```bash
npm run dev
```

En `http://127.0.0.1:5173`, sin cargar ninguna zona, recorrer el menú entero: cada deslizador tiene que moverse en el mismo recorrido que antes y mostrar el valor formateado igual (metros, grados, gramos, KV, pulgadas, `4S (16.8 V)`). Comprobar en especial la rejilla de P/I/D/F: sigue aceptando 0–250 y la casilla de D del yaw sigue deshabilitada. Parar con `Ctrl+C`.

- [ ] **Step 9: Commit**

```bash
git add src/menu.js tests/config.test.mjs
git commit -m "refactor: los rangos del menú salen del fichero de configuración"
```

---

### Task 5: Actualizar documentación

El README describe un comportamiento que ya no existe: habla de guardar la clave en el navegador, de que los ajustes persisten y de `vv.config` como sitio donde afinar. Y falta documentar el fichero, que ahora es la pieza central.

**Files:**
- Modify: `README.md` (secciones 2, 4 y 8)
- Modify: `.env.example`

**Interfaces:**
- Consumes: el comportamiento resultante de las tareas 1-4.
- Produces: nada ejecutable.

- [ ] **Step 1: Reescribir el paso 6 de «Conseguir la API key»**

En `README.md`, dentro de la sección 2, sustituir:

```
6. Pega la clave en el menú del juego (se guarda en el navegador), o crea `.env.local`:
```

por:

```
6. Crea `.env.local` con la clave:
```

Y justo después del bloque de código `VITE_GOOGLE_API_KEY=AIza...`, añadir:

```markdown
También puedes pegarla en el menú del juego, pero **sólo dura esa sesión**: no
se guarda en ningún sitio. La clave es lo único que no vive en
`vuela.config.js`, precisamente para que ese fichero se pueda versionar.
```

- [ ] **Step 2: Añadir la sección del fichero de configuración**

Insertar en `README.md`, como apartado nuevo al final de la sección 2 (justo antes del `---` que abre la sección 3):

```markdown
### El fichero de configuración

Todos los números ajustables del simulador están en **`vuela.config.js`**, en la
raíz: la zona, la calidad, el aparato entero (masa, motor, hélice, batería), la
tune de Betaflight y los recorridos de los deslizadores del menú.

Se lee al arrancar y **no se reescribe nunca**. Para cambiar algo de forma
permanente, edítalo con el juego cerrado y recarga. Lo que toques desde el menú
o desde la consola se aplica al instante pero vive sólo en memoria: al recargar
vuelve a mandar el fichero.

No hay nada guardado en el navegador. Si un valor se sale de su rango declarado
en el bloque `ui`, se recorta y se avisa por consola; si se cuela un `NaN`, el
arranque falla diciendo exactamente qué clave está mal, en vez de dejarte un
dron que aparece cayendo sin explicación.
```

- [ ] **Step 3: Corregir la sección 4**

En la sección «4. Ajustes que importan», sustituir la frase del final de «Escenario»:

```
El menú te da una estimación en vivo.
```

por:

```
El menú te da una estimación en vivo. Todos estos valores, y sus recorridos,
salen de `vuela.config.js`.
```

- [ ] **Step 4: Corregir la sección 8**

En «8. Consola», sustituir el comentario de la primera línea del bloque de código:

```js
// Controlador: se lee en cada paso, así que el cambio es inmediato.
```

por:

```js
// Controlador: se lee en cada paso, así que el cambio es inmediato.
// Nada de esto persiste: al recargar vuelve a mandar vuela.config.js.
```

Y sustituir el bloque de hardware, porque `vv.config.flight` ya no es el objeto que usa el dron (`main.js` le pasa una copia):

```js
// Hardware: hay que rehacer lo que se derivó de los parámetros.
vv.config.flight.frame.mass = 0.45
vv.drone.refresh()
vv.drone.hoverThrottle                 // recalculado
```

por:

```js
// Hardware: hay que rehacer lo que se derivó de los parámetros.
// `vv.config.flight` y `vv.drone.params` son el mismo objeto durante el vuelo.
vv.config.flight.frame.mass = 0.45
vv.drone.refresh()
vv.drone.hoverThrottle                 // recalculado
```

Es decir: sólo cambia el comentario, no el código. `main.js` pasa `config.flight`
a `Quad` sin clonar (verificado: `quad.js:63` hace `this.params = params`), así
que las dos rutas llevan al mismo sitio.

- [ ] **Step 5: Actualizar `.env.example`**

Sustituir el contenido completo por:

```
# Copia este archivo a .env.local y pon tu clave de Map Tiles API.
# Es lo único que no vive en vuela.config.js: al ser una credencial, se queda
# fuera para que ese fichero se pueda versionar sin filtrarla.
# También puedes pegarla en el menú del juego, pero sólo dura esa sesión.
VITE_GOOGLE_API_KEY=
```

- [ ] **Step 6: Verificar que el README no promete nada que ya no exista**

```bash
grep -n "se guarda en el navegador\|localStorage\|params\.js\|locations\.js" README.md ; echo "(vacío = bien)"
```

Expected: no imprime coincidencias.

- [ ] **Step 7: Commit**

```bash
git add README.md .env.example
git commit -m "docs: documentar el fichero único de configuración"
```

---

### Task 6: Verificación final

Una pasada completa contra la referencia del principio, para poder afirmar que el vuelo no cambió.

**Files:** ninguno. Sólo se ejecuta y se comprueba.

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la confirmación de que el modelo físico da los mismos números que antes del refactor.

- [ ] **Step 1: Batería completa**

```bash
npm test 2>&1 | tail -3
```

Expected: `TODO OK`.

- [ ] **Step 2: Comparar cifra a cifra con la referencia**

Dos de las líneas que imprimen los tests son medidas de reloj de pared —el coste
en `ms/s` del modelo y la latencia en `ns` de `isSolid`— y **nunca** salen
iguales dos ejecuciones seguidas, tenga o nada que ver con el refactor. Hay que
excluirlas o el `diff` da una falsa alarma en cada pasada:

```bash
npm test > /tmp/final-tests.txt 2>&1
sin_relojes() { sed -n '/curvas de rates/,$p' "$1" | grep -vE 'ms/s|isSolid por debajo'; }
diff <( sin_relojes /tmp/baseline-tests.txt ) \
     <( sin_relojes /tmp/final-tests.txt ) && echo "IDÉNTICO"
```

Expected: imprime `IDÉNTICO`. Los tests de vuelo publican valores medidos (empuje por motor, empuje/peso, RPM, gas de sustentación, figura de mérito), así que una salida idéntica demuestra que el modelo recibe exactamente los mismos parámetros que antes. **Si hay diferencias, no continúes**: algún número se transcribió mal al fichero. Localízalo comparando contra `git show <sha-del-Task-0>:src/flight/params.js`.

- [ ] **Step 3: Comprobar que no queda estado en el navegador**

```bash
grep -rn "localStorage\|sessionStorage" src/ public/ ; echo "(vacío = bien)"
```

Expected: sin coincidencias. `public/sw.js` usa la Cache API para los tiles, que es otra cosa y sí debe seguir.

- [ ] **Step 4: Prueba manual del ciclo completo**

```bash
npm run dev
```

En `http://127.0.0.1:5173`:

1. Volar en la ciudad de prueba. Comprobar que el dron sustenta cerca del 30 % de gas.
2. `Esc` → cambiar el modo a *Angle* en los ajustes rápidos → reanudar. El autonivelado tiene que responder al instante.
3. `Esc` → *Menú* → subir la masa a ~900 g → volver a volar. El dron tiene que notarse claramente más pesado.
4. **Recargar (F5).** El menú tiene que volver a mostrar 601 g: el cambio de masa no persiste, que es exactamente lo que se busca.
5. Editar `vuela.config.js` y poner `mass: 0.9`. Recargar. Ahora sí: el menú muestra 900 g.
6. Devolver `mass` a `0.601`.

Expected: los seis pasos se comportan como se describe. El 4 y el 5 son la prueba de que la fuente de verdad es el fichero.

- [ ] **Step 5: Verificar que el build sigue saliendo**

```bash
npm run build 2>&1 | tail -5
```

Expected: termina sin errores. `vuela.config.js` se empaqueta como cualquier otro módulo. En el build no hay servidor de Vite, así que el fichero queda congelado dentro del bundle: para cambiar algo hay que reconstruir. Para uso en `npm run dev` da igual.

- [ ] **Step 6: Commit final**

```bash
git add -A
git commit -m "chore: verificación del refactor de configuración" --allow-empty
```

---

## Fuera de alcance (decisión pendiente)

Quedan constantes numéricas en código que **no** están en este plan porque caen en la frontera entre ajuste y definición. Van aquí para que la decisión sea explícita y no un olvido:

| Dónde | Qué | Argumento para sacarlas | Argumento para dejarlas |
|---|---|---|---|
| `src/world.js:20-26` | `BACKDROP_RADIUS` 22000, `BACKDROP_ERROR` 900, `MID_ERROR` 90, los tres colores de cielo y niebla | son puro ajuste visual, se tocarían para probar | nadie los ha tocado nunca; el color no es un número configurable |
| `src/world.js:129` | el `0.00012` base de la niebla | `fogDensity` lo multiplica, así que es media constante ya | es la escala física de la exponencial, no una preferencia |
| `src/main.js:456-462` | los umbrales `0.6 / 2 / 6` de la estimación de carga | son puros números mágicos | sólo cambian un texto de ayuda |
| `src/hud.js:1` | `SAMPLES` 180 | es el ancho del gráfico de frametime | es el tamaño de un búfer, no un ajuste |
| `src/input.js` | curvas de teclado y de gas | afectan al pilotaje | son la definición del modo teclado |

Sacarlas es una Task 7 de una hora larga. Recomendación: dejarlas por ahora y mover sólo las de `world.js`, que son las únicas que alguien tocaría de verdad, si en algún momento apetece.

---

## Notas sobre riesgos

- **No clonar `config.flight` al construir el `Quad`.** `quad.js:63` guarda el objeto tal cual en `this.params` y lee de él en cada paso (`quad.js:441` mira `this.params.bf.rpmLimit`), mientras que `buildFlightPanel` y `buildPauseSettings` editan `config.flight.bf`. Que sean **el mismo objeto** es justo lo que hace que los ajustes de pausa se apliquen al instante. Un `structuredClone` bien intencionado ahí rompe el menú de pausa sin dar ningún error: los sliders se mueven y no pasa nada. La Task 6, Step 4.2 lo comprueba explícitamente.
- **El vuelo arrastra los cambios de hardware entre sesiones.** Como `config.flight` se comparte con el dron y `drone.refresh()` recalcula sobre él, subir la masa en el menú y volver a cargar zona mantiene la masa nueva mientras no recargues la página. Es el comportamiento de siempre, no una regresión del refactor, y la Task 6, Step 4.4 lo delimita: lo que borra el cambio es F5.
- **El test de la Task 4 lee el fuente de `menu.js` con una expresión regular.** Es frágil a propósito: sirve para que un `min: 0.2` nuevo no se cuele sin que nadie se entere. Si algún día un `step:` legítimo tiene que ser literal, el test dirá dónde y se decide entonces.
