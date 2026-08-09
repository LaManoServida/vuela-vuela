# Magnitudes acopladas derivadas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que mover un deslizador del panel «Aparato» arrastre sus consecuencias físicas: la masa a la inercia, el KV a la resistencia, el diámetro de hélice a su cuerda y su inercia, el brazo a la inercia y al arrastre, y las celdas al peso.

**Architecture:** Un módulo puro nuevo, `src/flight/derive.js`, con una función `deriveAircraft( flight )` que rellena en el sitio las seis magnitudes derivadas. Cada fórmula es «valor de referencia × ley de escala», anclada en los números medidos del TBS Oblivion, de modo que en el punto de referencia devuelve exactamente lo que hoy está escrito a mano —sin redondeos—. La llaman la carga de configuración (`config.js`) y el `Quad`, en su constructor y en `refresh()`, que es el que ya corre al soltar un deslizador.

**Tech Stack:** JavaScript ESM puro, Vite 8, three.js. Sin dependencias nuevas. Tests caseros en Node (`node tests/*.mjs`, sin framework) con el ayudante `check( nombre, condición, info )`.

**Spec:** `docs/superpowers/specs/2026-08-09-magnitudes-derivadas-design.md`

## Global Constraints

- **Estilo del repositorio:** tabuladores para indentar, espacios dentro de los paréntesis (`fn( a, b )`), línea en blanco tras la apertura de un bloque de función y antes del cierre, comentarios en castellano que expliquen el *porqué*, no el qué.
- **`deriveAircraft` tiene que ser idempotente.** Corre en cada `refresh()`, así que ninguna magnitud derivada puede calcularse a partir de sí misma. Por eso el arrastre declarado cambia de nombre a `dragAreaRef` y el derivado se queda con `dragArea`: escribir el escalado encima del declarado lo multiplicaría otra vez en cada llamada.
- **Los valores de referencia, exactos** (son los del Oblivion que ya están en `vuela.config.js`): masa total **0.529** kg, masa en seco **0.353** kg, pack **0.176** kg, brazo **0.110** m, inercia **0.00175** kg·m², KV **1428**, resistencia **0.1270** Ω, diámetro **5.1**", palas **3**, cuerda **15** mm, inercia de hélice **2.8e-6** kg·m², celdas **4**, capacidad **1.3** Ah.
- **En el punto de referencia no cambia ni un número.** El suite entero tiene que seguir verde sin tocar un solo umbral. Si alguno se mueve, la calibración está mal y hay que parar.
- **`vuela.config.js` se toca en este plan, y a propósito.** Si al empezar hay cambios sin commitear en ese fichero: `git stash push -- vuela.config.js`, hacer la tarea, y devolverlos después.
- **Cada tarea acaba con `npm test` en verde y un commit.** Y con push, sin esperar a que lo pidan.

---

### Task 1: El módulo de derivación, con su calibración probada

`src/flight/derive.js` nuevo, con las seis fórmulas y sus constantes. Todavía no lo llama nadie: al acabar esta tarea el juego se comporta exactamente igual, y lo que hay de más es un módulo probado que nadie usa.

Se hace primero y aparte porque es la pieza que sostiene todo lo demás: si las constantes están mal calibradas, enchufarla cambiaría cómo vuela el aparato de referencia y no habría forma de saber si el fallo está en la fórmula o en el cableado.

**Files:**
- Create: `src/flight/derive.js`
- Test: `tests/flight.test.mjs` (bloque nuevo al final, antes del `console.log` de recuento)

**Interfaces:**
- Consumes: nada.
- Produces: `deriveAircraft( flight )` — recibe un bloque `flight` (el de `cloneFlight()`), lo modifica **en el sitio** y lo devuelve. Escribe `flight.frame.mass`, `flight.frame.inertia`, `flight.frame.dragArea`, `flight.motor.resistance`, `flight.prop.chordMm` y `flight.prop.inertia`. Lee `flight.frame.dryMass`, `flight.frame.armRadius`, `flight.frame.dragAreaRef`, `flight.motor.kv`, `flight.prop.diameterIn`, `flight.prop.blades`, `flight.battery.cells` y `flight.battery.capacityAh`.

- [ ] **Step 1: Escribir el módulo**

Crea `src/flight/derive.js`:

```js
/*
 * Lo que se deduce del aparato, en vez de teclearse.
 *
 * Los números de `vuela.config.js` se copiaron uno a uno de la base de datos de
 * componentes de Velocidrone: cada uno es una medida de UN aparato, el TBS
 * Oblivion, no una fórmula. Eso reproduce ese aparato clavado y miente en cuanto
 * mueves un deslizador —la masa no llegaba a la inercia, el KV no llegaba a la
 * resistencia, el brazo no llegaba a ninguno de los dos—.
 *
 * Aquí cada magnitud acoplada se calcula de la que manda sobre ella, con la
 * forma «valor medido × ley de escala». Anclarlo en la medida y no en la física
 * de primeros principios tiene una ventaja concreta: en el punto de referencia
 * la ley vale 1 y sale EXACTAMENTE el número medido, sin redondeos. Lo que
 * cambia no es cómo vuela el Oblivion, es qué pasa al salirse de él.
 *
 * El principio que ordena todo esto: mover el brazo escala el aparato entero.
 * No es el mismo dron con brazos más largos, es un dron más grande. De ahí que
 * el brazo mande a la vez sobre la inercia y sobre el área de arrastre.
 */

/**
 * El punto de referencia: el TBS Oblivion tal y como lo publica Velocidrone.
 * Cambiar cualquiera de estos números re-ancla TODAS las fórmulas, así que no
 * se tocan para afinar el vuelo —para eso están los deslizadores—.
 */
const REF = {
	mass: 0.529,          // kg con batería
	armRadius: 0.110,     // m
	inertia: 0.00175,     // kg·m², los tres ejes
	kv: 1428,
	resistance: 0.1270,   // Ω por fase
	diameterIn: 5.1,
	blades: 3,
	chordMm: 15,
	propInertia: 2.8e-6,  // kg·m²
	cells: 4,
	capacityAh: 1.3,
	packMass: 0.176,      // kg del 4S 1300
};

/**
 * Rellena las magnitudes que se deducen de otras. Modifica `flight` en el sitio
 * y lo devuelve.
 *
 * Es idempotente a propósito —corre en cada `refresh()`, o sea cada vez que se
 * suelta un deslizador—: ninguna magnitud derivada se calcula a partir de sí
 * misma. El arrastre es el caso a vigilar, y por eso lo declarado y lo derivado
 * tienen nombres distintos: `dragAreaRef` entra, `dragArea` sale.
 */
export function deriveAircraft( flight ) {

	const { frame, motor, prop, battery } = flight;

	// La masa primero: la inercia depende de ella, así que tiene que estar puesta
	// antes. La energía de un pack va con celdas × amperios-hora, y la energía
	// por kilo de un LiPo es casi la misma en todos: de ahí que su peso escale
	// con el producto.
	const packMass = REF.packMass
		* ( battery.cells / REF.cells )
		* ( battery.capacityAh / REF.capacityAh );

	frame.mass = frame.dryMass + packMass;

	// Radio de giro proporcional al brazo, e inercia = masa × radio². Con los
	// valores de referencia el radio de giro sale en 57,5 mm, entre los 110 de
	// los motores en la punta y los ~47 de la masa central. Doblar el brazo
	// cuadruplica la inercia; doblar la masa la dobla.
	const armScale = frame.armRadius / REF.armRadius;
	const inertia = REF.inertia * ( frame.mass / REF.mass ) * armScale * armScale;
	frame.inertia = [ inertia, inertia, inertia ];

	// Un área escala con el cuadrado de la longitud, y los tres ejes con el mismo
	// factor: el aparato crece entero, no se estira por un lado.
	frame.dragArea = {
		x: frame.dragAreaRef.x * armScale * armScale,
		y: frame.dragAreaRef.y * armScale * armScale,
		z: frame.dragAreaRef.z * armScale * armScale,
	};

	// Para un motor del mismo tamaño, menos vueltas por voltio es más espiras, y
	// más espiras es más cobre en serie: la resistencia va con 1/KV².
	const kvRatio = REF.kv / motor.kv;
	motor.resistance = REF.resistance * kvRatio * kvRatio;

	// Semejanza geométrica: una hélice mayor es la misma hélice más grande, así
	// que la cuerda va con el diámetro.
	const propScale = prop.diameterIn / REF.diameterIn;
	prop.chordMm = REF.chordMm * propScale;

	// Y su inercia con la quinta potencia: la masa de una pala va con el cubo del
	// diámetro y su brazo con el diámetro, y la inercia es masa × brazo².
	prop.inertia = REF.propInertia
		* Math.pow( propScale, 5 )
		* ( prop.blades / REF.blades );

	return flight;

}
```

- [ ] **Step 2: Escribir el bloque de pruebas**

En `tests/flight.test.mjs`, añade el import al principio del fichero, junto a los que ya hay:

```js
import { deriveAircraft } from '../src/flight/derive.js';
```

Y este bloque justo **antes** de la línea `console.log( fails === 0 ? '\nTODO OK\n' : ... )` del final:

```js
console.log( '\n== lo que se deduce del aparato ==' );
{
	/*
	 * El aparato de referencia, escrito aquí a mano: son los números que
	 * Velocidrone publica del TBS Oblivion y contra los que están calibradas
	 * todas las fórmulas. Que estén repetidos aquí y en `derive.js` es
	 * deliberado: si alguien re-ancla las constantes sin querer, esta prueba lo
	 * dice. Un `import` de las mismas constantes no comprobaría nada.
	 */
	const ref = () => deriveAircraft( {
		frame: { dryMass: 0.353, armRadius: 0.110, dragAreaRef: { x: 0.00742, y: 0.014, z: 0.00399 } },
		motor: { kv: 1428 },
		prop: { diameterIn: 5.1, blades: 3 },
		battery: { cells: 4, capacityAh: 1.3 },
	} );

	const cerca = ( a, b, tol = 1e-9 ) => Math.abs( a - b ) <= tol * Math.max( 1, Math.abs( b ) );

	// La prueba que sostiene a todas las demás: en el punto de referencia cada
	// fórmula devuelve el número medido, exacto. Si esto falla, lo que venga
	// detrás no significa nada.
	const r = ref();
	check( 'la masa de referencia sale de la seca más el pack', cerca( r.frame.mass, 0.529 ),
		`${ r.frame.mass.toFixed( 4 ) } kg` );
	check( 'la inercia de referencia es la medida', cerca( r.frame.inertia[ 0 ], 0.00175 ),
		`${ r.frame.inertia[ 0 ].toExponential( 4 ) }` );
	check( 'y es igual en los tres ejes',
		r.frame.inertia[ 0 ] === r.frame.inertia[ 1 ] && r.frame.inertia[ 1 ] === r.frame.inertia[ 2 ] );
	check( 'el arrastre de referencia es el declarado', cerca( r.frame.dragArea.z, 0.00399 ),
		`${ r.frame.dragArea.z.toExponential( 4 ) } m²` );
	check( 'la resistencia de referencia es la medida', cerca( r.motor.resistance, 0.1270 ),
		`${ r.motor.resistance.toFixed( 4 ) } Ω` );
	check( 'la cuerda de referencia es la medida', cerca( r.prop.chordMm, 15 ),
		`${ r.prop.chordMm.toFixed( 3 ) } mm` );
	check( 'la inercia de hélice de referencia es la medida', cerca( r.prop.inertia, 2.8e-6 ),
		`${ r.prop.inertia.toExponential( 4 ) }` );

	// Las leyes de escala, cada una en su exponente.
	const conBrazo = f => { const p = ref(); p.frame.armRadius = 0.110 * f; return deriveAircraft( p ); };
	check( 'doblar el brazo cuadruplica la inercia',
		cerca( conBrazo( 2 ).frame.inertia[ 0 ], 0.00175 * 4, 1e-6 ),
		`×${ ( conBrazo( 2 ).frame.inertia[ 0 ] / 0.00175 ).toFixed( 2 ) }` );
	check( 'y cuadruplica el área de arrastre',
		cerca( conBrazo( 2 ).frame.dragArea.z, 0.00399 * 4, 1e-6 ),
		`×${ ( conBrazo( 2 ).frame.dragArea.z / 0.00399 ).toFixed( 2 ) }` );

	// Ojo: doblar la masa EN SECO no dobla la total, porque el pack no cambia.
	// Lo que se comprueba es que la inercia sigue a la masa total, que es de la
	// que depende.
	const conSeca = f => { const p = ref(); p.frame.dryMass = 0.353 * f; return deriveAircraft( p ); };
	check( 'la inercia sigue a la masa total',
		cerca( conSeca( 2 ).frame.inertia[ 0 ] / conSeca( 1 ).frame.inertia[ 0 ],
			conSeca( 2 ).frame.mass / conSeca( 1 ).frame.mass, 1e-9 ),
		`×${ ( conSeca( 2 ).frame.inertia[ 0 ] / conSeca( 1 ).frame.inertia[ 0 ] ).toFixed( 4 ) } de inercia por ×${ ( conSeca( 2 ).frame.mass / conSeca( 1 ).frame.mass ).toFixed( 4 ) } de masa` );

	const conKv = f => { const p = ref(); p.motor.kv = 1428 * f; return deriveAircraft( p ); };
	check( 'doblar el KV divide la resistencia por cuatro',
		cerca( conKv( 2 ).motor.resistance, 0.1270 / 4, 1e-9 ),
		`${ conKv( 2 ).motor.resistance.toFixed( 5 ) } Ω` );

	const conDiam = f => { const p = ref(); p.prop.diameterIn = 5.1 * f; return deriveAircraft( p ); };
	check( 'doblar el diámetro dobla la cuerda', cerca( conDiam( 2 ).prop.chordMm, 30, 1e-9 ),
		`${ conDiam( 2 ).prop.chordMm.toFixed( 2 ) } mm` );
	check( 'y multiplica por 32 la inercia de la hélice',
		cerca( conDiam( 2 ).prop.inertia, 2.8e-6 * 32, 1e-9 ),
		`×${ ( conDiam( 2 ).prop.inertia / 2.8e-6 ).toFixed( 1 ) }` );

	const cuatroPalas = () => { const p = ref(); p.prop.blades = 4; return deriveAircraft( p ); };
	check( 'una pala más sube la inercia de la hélice a proporción',
		cerca( cuatroPalas().prop.inertia, 2.8e-6 * 4 / 3, 1e-9 ),
		`×${ ( cuatroPalas().prop.inertia / 2.8e-6 ).toFixed( 3 ) }` );

	const seisS = () => { const p = ref(); p.battery.cells = 6; return deriveAircraft( p ); };
	check( 'de 4S a 6S el pack pesa la mitad más',
		cerca( seisS().frame.mass - 0.353, 0.176 * 1.5, 1e-9 ),
		`${ ( ( seisS().frame.mass - 0.353 ) * 1000 ).toFixed( 0 ) } g de pack` );

	// Corre en cada `refresh()`: si una magnitud se calculara a partir de sí
	// misma, la segunda pasada daría otro número. El arrastre es el que lo
	// destaparía, porque es el único que tiene un declarado y un derivado.
	const dosVeces = ref();
	const antes = { ...dosVeces.frame.dragArea, m: dosVeces.frame.mass, i: dosVeces.frame.inertia[ 0 ] };
	deriveAircraft( dosVeces );
	deriveAircraft( dosVeces );
	check( 'derivar tres veces da lo mismo que derivar una',
		dosVeces.frame.dragArea.z === antes.z && dosVeces.frame.mass === antes.m
			&& dosVeces.frame.inertia[ 0 ] === antes.i,
		`arrastre ${ dosVeces.frame.dragArea.z.toExponential( 4 ) }` );
}
```

- [ ] **Step 3: Correr las pruebas**

Run: `npm test`
Expected: TODO OK, con el bloque nuevo entero en verde. Si falla alguna de las siete primeras —«…de referencia es la medida»— **para**: la calibración está mal y no tiene sentido seguir.

- [ ] **Step 4: Commit**

```bash
git add src/flight/derive.js tests/flight.test.mjs
git commit -m "$(cat <<'EOF'
feat: las magnitudes acopladas del aparato, en fórmulas

Los números del aparato se copiaron uno a uno de la base de datos de
Velocidrone: cada uno es una medida del TBS Oblivion, no una fórmula. Clava
ese aparato y miente en cuanto se mueve un deslizador.

`deriveAircraft` calcula cada magnitud acoplada de la que manda sobre ella,
con la forma «valor medido × ley de escala». Anclarlo en la medida hace que en
el punto de referencia la ley valga 1 y salga el número medido exacto, sin
redondeos: comprobado contra los siete que hay escritos a mano.

Todavía no lo llama nadie.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 2: Enchufarlo, y quitar del fichero lo que ya se calcula

Aquí es donde el cambio se nota. Al acabar, `vuela.config.js` ya no declara las cuatro magnitudes derivadas, la masa es masa en seco y el arrastre es el de referencia; y el aparato de referencia vuela exactamente igual que antes.

**Files:**
- Modify: `src/flight/quad.js` (el constructor y `refresh()`)
- Modify: `src/config.js` (el contrato de `flight.frame`, `flight.motor`, `flight.prop`; la llamada en `load()`; el `path` de dos entradas de `ui`)
- Modify: `vuela.config.js` (fuera cuatro claves, `mass` → `dryMass`, `dragArea` → `dragAreaRef`, y los dos `path` de `ui`)
- Modify: `tests/world.test.mjs:139` (usa `p.frame.dragArea`)
- Modify: `tests/flight.test.mjs` (dos comprobaciones nuevas, en los bloques `el hardware manda de verdad` y `el aparato se rehace en caliente`)

**Interfaces:**
- Consumes: `deriveAircraft( flight )` de `src/flight/derive.js` (Task 1).
- Produces: `flight.frame.dryMass` (kg, número) y `flight.frame.dragAreaRef` (`{ x, y, z }` en m²) pasan a ser las claves declaradas. `flight.frame.mass`, `flight.frame.inertia`, `flight.frame.dragArea`, `flight.motor.resistance`, `flight.prop.chordMm` y `flight.prop.inertia` siguen existiendo con los mismos nombres y unidades, pero ya calculados: quien los lee no cambia.

- [ ] **Step 1: Que el `Quad` derive antes de construirse y al rehacerse**

En `src/flight/quad.js`, añade el import junto a los demás de `./`:

```js
import { deriveAircraft } from './derive.js';
```

En el constructor, **justo antes** de `this.body = new RigidBody( {`, añade:

```js
		// Antes de tocar nada: las magnitudes acopladas se calculan de las que
		// mandan sobre ellas. Aquí y en `refresh()` son los dos únicos sitios,
		// porque son los dos momentos en que los parámetros pueden haber
		// cambiado —y los tests construyen `Quad` con parámetros retocados a
		// mano, que también tienen que salir coherentes—.
		deriveAircraft( params );

```

Y en `refresh()`, **justo después** de `const p = this.params;`, añade:

```js
		deriveAircraft( p );

```

- [ ] **Step 2: Mover el contrato de `config.js`**

En `src/config.js`, el bloque `frame` pasa de:

```js
		frame: block( {
			mass: pos(),
			// Tres componentes: el sólido rígido las lee por índice y con dos
			// la física entera sale NaN en el primer paso.
			inertia: list( pos(), { length: 3 } ),
			armRadius: pos(),
			armAngle: num( 0, 90 ),
			dragArea: block( { x: num( 0 ), y: num( 0 ), z: num( 0 ) } ),
			angularDrag: num( 0 ),
			gravityScale: num( 0 ),
		} ),
```

a:

```js
		frame: block( {
			// En seco, sin batería: el pack pesa según sus celdas y su capacidad
			// y se suma aparte. `frame.mass` existe igual, pero se calcula.
			dryMass: pos(),
			armRadius: pos(),
			armAngle: num( 0, 90 ),
			// El del aparato de referencia: el de verdad escala con el brazo.
			dragAreaRef: block( { x: num( 0 ), y: num( 0 ), z: num( 0 ) } ),
			angularDrag: num( 0 ),
			gravityScale: num( 0 ),
		} ),
```

En el bloque `motor`, borra la línea `resistance: pos(),`.

En el bloque `prop`, borra las líneas `chordMm: pos(),` y `inertia: pos(),`.

En el bloque `ui`, cambia los dos `path`:

```js
		mass:          { path: 'flight.frame.dryMass', min: 0.05, max: 0.8, step: 0.005 },
```

```js
		dragFront:     { path: 'flight.frame.dragAreaRef.z', min: 0.002, max: 0.06, step: 0.0005 },
```

- [ ] **Step 3: Derivar al cargar**

En `src/config.js`, dentro de `load()`, **justo después** de `clampToRanges( cfg );` añade:

```js
	// Después de recortar a los rangos, no antes: lo que se deriva tiene que
	// salir de los valores que de verdad van a usarse.
	deriveAircraft( cfg.flight );

```

Y el import correspondiente al principio del fichero:

```js
import { deriveAircraft } from './flight/derive.js';
```

- [ ] **Step 4: Migrar `vuela.config.js`**

Cuatro claves se van y dos cambian de nombre. En `frame`:

- La línea `mass: 0.529,` con su comentario pasa a ser `dryMass: 0.353,` con este comentario, que conserva la aritmética de dónde salen los dos números:

```js
			// 353 g de aparato, la ficha del Oblivion. La batería es un
			// componente aparte en la base de datos de Velocidrone, con su peso
			// propio (176 g el 4S 1300), y ahora se suma aparte también aquí:
			// `frame.mass` sale de esto más lo que pese el pack que lleves.
			//
			// Que el total son 529 y no 353 lo confirma la inercia que declara
			// el propio Velocidrone: con moi = 0.004 kg·m², un aparato de 353 g
			// exigiría que su masa central tuviera un radio de giro de 119 mm
			// —más largo que el brazo entero, 110— y eso no lo cumple ningún
			// cuerpo compacto. Con 529 g salen 89 mm, que sí.
			dryMass: 0.353,                    // kg sin batería
```

- El bloque `inertia: [ 0.00175, 0.00175, 0.00175 ],` se borra **entero, con su comentario largo**. Ese razonamiento no se pierde: se resume en `derive.js`, que es donde ahora vive el número. Pega esto en su lugar:

```js
			// La inercia ya no se declara: sale de la masa y del brazo, en
			// `src/flight/derive.js`. Está calibrada con el 0.00175 que
			// Velocidrone declara para este chasis, que es la única de sus tres
			// cifras (`moi` 0.00175, `bf_model_moi` 0.003, `vd_model_moi` 0.004)
			// que describe un cuerpo que puede existir y que pone la respuesta
			// donde está la de un 5" de verdad: 24 ms al 63 % del rate en
			// alabeo, cuando con 0.004 eran 39.
```

- `dragArea: { x: 0.00742, y: 0.014, z: 0.00399 },` pasa a `dragAreaRef: { ... }` con los mismos números, y su comentario gana una línea al final:

```js
			// Es la del aparato de referencia: la de verdad escala con el brazo.
			dragAreaRef: { x: 0.00742, y: 0.014, z: 0.00399 },
```

En `motor`, borra `resistance: 0.1270,` y añade en su sitio:

```js
			// La resistencia ya no se declara: sale del KV con 1/KV², calibrada
			// en los 0.1270 Ω que hacen pareja con estos 1428.
```

En `prop`, borra `chordMm: 15,` y `inertia: 2.8e-6,` y añade en su sitio:

```js
			// Cuerda e inercia ya no se declaran: salen del diámetro y del
			// número de palas por semejanza geométrica, calibradas en los 15 mm
			// y los 2.8e-6 kg·m² de esta hélice.
```

- [ ] **Step 5: Arreglar el test que tocaba `dragArea` a mano**

En `tests/world.test.mjs`, la línea 139:

```js
			p.frame.dragArea = { x: 0, y: 0, z: 0 };
```

pasa a:

```js
			p.frame.dragAreaRef = { x: 0, y: 0, z: 0 };
```

Es lo declarado lo que hay que poner a cero: el derivado lo pisa `deriveAircraft` en cuanto se construye el `Quad`.

- [ ] **Step 6: Probar que la masa llega ya a la inercia, y que llega en caliente**

Son las dos comprobaciones que antes no podían existir: la primera porque la inercia no dependía de la masa, y la segunda porque no había nada que recalcular.

En `tests/flight.test.mjs`, dentro del bloque `== el hardware manda de verdad ==`, **justo después** de las dos comprobaciones de `heavy`, añade:

```js
	// Y ahora la masa llega a la INERCIA, no sólo al empuje/peso. Se mide a los
	// 15 ms, cuando el giro todavía está limitado por el par y no por el tope
	// del controlador: a esas alturas el más pesado ha girado menos.
	const alabeoA15ms = q => {

		fly( q, { roll: 1, throttle: q.hoverThrottle }, 0.015 );
		return Math.abs( q.body.omega.z );

	};

	check( 'más masa es también más inercia, no sólo menos empuje/peso',
		alabeoA15ms( makeQuad( p => { p.frame.dryMass *= 2; } ) ) < alabeoA15ms( makeQuad() ),
		`${ alabeoA15ms( makeQuad() ).toFixed( 2 ) } → ${ alabeoA15ms( makeQuad( p => { p.frame.dryMass *= 2; } ) ).toFixed( 2 ) } rad/s` );
```

Y en el bloque `== el aparato se rehace en caliente ==`, **justo después** de la comprobación `'y sin parar los rotores'`, añade:

```js
	// Lo que antes no pasaba: la inercia se rehace con la masa, en el sitio.
	check( 'y la inercia se rehace con ella', drone.body.inertia.x < antes.inercia,
		`${ antes.inercia.toExponential( 3 ) } → ${ drone.body.inertia.x.toExponential( 3 ) } kg·m²` );
```

Para que exista `antes.inercia`, en ese mismo bloque la línea que captura el estado previo:

```js
	const antes = { ep: drone.thrustToWeight, y: drone.position.y, rpm: drone.averageRpm, gas: drone.hoverThrottle };
```

pasa a:

```js
	const antes = {
		ep: drone.thrustToWeight, y: drone.position.y, rpm: drone.averageRpm,
		gas: drone.hoverThrottle, inercia: drone.body.inertia.x,
	};
```

Y la línea que cambia la masa, que hoy es `drone.params.frame.mass /= 2;`, pasa a `drone.params.frame.dryMass /= 2;` — `mass` ya no es lo que se declara, y escribir encima de un valor derivado no serviría de nada: `refresh()` lo pisa.

- [ ] **Step 7: Correr las pruebas**

Run: `npm test`
Expected: TODO OK, **sin haber tocado ni un umbral de los que ya existían**. Esto es lo que dice que la calibración es correcta y que el aparato de referencia vuela exactamente igual que antes. Si alguna prueba de prestaciones o de respuesta se mueve, para y revisa `REF` en `derive.js` contra los valores que había en `vuela.config.js` antes de esta tarea (`git show HEAD~1:vuela.config.js`).

Si aparece un aviso `claves que no lee nadie en vuela.config.js`, es que ha quedado alguna de las cuatro borradas: quítala.

- [ ] **Step 8: Comprobar que arranca**

Run: `npm run build`
Expected: compila sin errores. Y `npm run dev`, abrir el menú: el panel «Aparato» se pinta y sus deslizadores se mueven.

- [ ] **Step 9: Commit**

```bash
git add src/flight/quad.js src/config.js vuela.config.js tests/world.test.mjs tests/flight.test.mjs
git commit -m "$(cat <<'EOF'
feat: la inercia sale de la masa, y la resistencia del KV

El dron deriva sus magnitudes acopladas al construirse y al rehacerse, que es
lo que ya corría al soltar un deslizador. Mover la masa, el brazo, el KV, el
diámetro de hélice, las palas o la batería arrastra ahora sus consecuencias.

Cuatro claves se van de `vuela.config.js` porque se calculan: la inercia del
chasis, la resistencia del motor, y la cuerda y la inercia de la hélice.
Dejarlas escritas sin efecto era la mentira que esto viene a quitar.

Dos cambian de significado: `mass` pasa a ser `dryMass` —el pack pesa según
sus celdas y su capacidad, y se suma aparte— y `dragArea` pasa a ser
`dragAreaRef`, la del aparato de referencia, porque la de verdad escala con el
brazo.

El suite entero sigue verde sin tocar un solo umbral, que es lo que dice que
el aparato de referencia vuela exactamente igual que antes. Y dos
comprobaciones que hasta ahora no podían existir: que más masa es también más
inercia y no sólo menos empuje/peso, y que esa inercia se rehace en caliente.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 3: Que el menú diga la verdad

Dos deslizadores mueven ahora algo distinto de lo que su etiqueta dice, y uno de ellos da un número que no es el que sale. Se arreglan los dos con el patrón que ya usa el de resolución de rejilla: lo pedido y lo que sale de verdad.

**Files:**
- Modify: `src/menu.js` (`buildHardwarePanel`: el deslizador de masa, el de arrastre y la nota del panel)

**Interfaces:**
- Consumes: `flight.frame.dryMass` y `flight.frame.dragAreaRef` (Task 2); `deriveAircraft` ya deja `frame.mass` y `frame.dragArea` puestos en el objeto que el menú edita.
- Produces: nada.

- [ ] **Step 1: El deslizador de masa pasa a ser de masa en seco**

En `src/menu.js`, dentro de `buildHardwarePanel`, este deslizador:

```js
			nestedSlider( 'Masa con batería', f.frame, 'mass', {
				...ui.mass,
				format: v => `${ ( v * 1000 ).toFixed( 0 ) } g`,
				onChange: refresh, notify: 'hardware',
			} ),
```

pasa a:

```js
			nestedSlider( 'Masa en seco', f.frame, 'dryMass', {
				...ui.mass,
				// Lo pedido y lo que pesa de verdad: el pack se suma según sus
				// celdas y su capacidad, así que cambiar la batería mueve este
				// número sin tocar el deslizador.
				format: v => `${ ( v * 1000 ).toFixed( 0 ) } g → ${ ( ( v + packMass() ) * 1000 ).toFixed( 0 ) } g con el pack`,
				onChange: refresh, notify: 'hardware',
			} ),
```

Y añade este ayudante **antes** del `return h( 'fieldset', …)` de `buildHardwarePanel`, junto a `refresh`:

```js
	// Lo que pesa el pack de ahora. Sale de restar, y no de repetir aquí la
	// fórmula de `derive.js`: dos copias de una fórmula acaban diciendo cosas
	// distintas, que es justo lo que este cambio viene a quitar.
	const packMass = () => f.frame.mass - f.frame.dryMass;
```

- [ ] **Step 2: El deslizador de arrastre enseña lo que sale**

Este otro:

```js
			nestedSlider( 'Arrastre frontal', f.frame.dragArea, 'z', {
				...ui.dragFront,
				format: v => `${ ( v * 10000 ).toFixed( 0 ) } cm²`,
				onChange: refresh, notify: 'drag',
			} ),
```

pasa a:

```js
			nestedSlider( 'Arrastre frontal', f.frame.dragAreaRef, 'z', {
				...ui.dragFront,
				// Se declara para el aparato de referencia y escala con el brazo,
				// porque un aparato más grande da más cara al aire. Cuando el
				// brazo no es el de referencia, lo pedido y lo real no coinciden
				// y callárselo dejaría el deslizador mintiendo.
				format: v => {

					const real = f.frame.dragArea.z;
					return Math.abs( real - v ) > 1e-6
						? `${ ( v * 10000 ).toFixed( 0 ) } cm² → ${ ( real * 10000 ).toFixed( 0 ) } cm² con este brazo`
						: `${ ( v * 10000 ).toFixed( 0 ) } cm²`;

				},
				onChange: refresh, notify: 'drag',
			} ),
```

- [ ] **Step 3: Que la nota del panel deje de prometer de más**

La nota de `buildHardwarePanel` dice hoy que cambiar las magnitudes cambia el vuelo por la vía correcta, y hasta ahora no era cierto del todo. En el comentario de cabecera de la función, sustituye:

```js
/**
 * El aparato en sí. Todo son magnitudes físicas, así que cambiarlas cambia el
 * vuelo por la vía correcta: más masa es menos empuje/peso y más inercia, no un
 * número de "agilidad" bajado a mano.
 */
```

por:

```js
/**
 * El aparato en sí. Todo son magnitudes físicas y ahora sí arrastran lo que
 * cuelga de ellas —la masa y el brazo mandan sobre la inercia, el KV sobre la
 * resistencia, el diámetro sobre la cuerda y la inercia de la hélice, las
 * celdas sobre el peso—, así que cambiarlas cambia el vuelo por la vía
 * correcta y no por un número de "agilidad" bajado a mano.
 *
 * Ver `src/flight/derive.js` para las fórmulas.
 */
```

Y en el texto de la nota que se pinta, añade una frase al final. De:

```js
			+ `Todo esto se aplica al soltar el deslizador: el aparato se rehace en el sitio, sin tocar la escena.`;
```

a:

```js
			+ `Todo esto se aplica al soltar el deslizador: el aparato se rehace en el sitio, sin tocar la escena. `
			+ `Lo que cuelga de estas magnitudes se recalcula con ellas: la inercia sigue a la masa y al brazo, `
			+ `la resistencia del motor al KV, y la cuerda y la inercia de la hélice a su diámetro y sus palas.`;
```

- [ ] **Step 4: Correr las pruebas**

Run: `npm test`
Expected: TODO OK. En particular `tests/config.test.mjs` sigue en verde: comprueba que todos los rangos de `ui` se usan en el menú, y `ui.mass` y `ui.dragFront` se siguen usando aunque hayan cambiado de clave.

- [ ] **Step 5: Comprobar en el menú**

Run: `npm run dev`
Expected:
- «Masa en seco» dice `353 g → 529 g con el pack`, y al mover celdas o capacidad el segundo número cambia solo.
- «Arrastre frontal» dice `40 cm²` a secas con el brazo de referencia; al alargar el brazo pasa a decir `40 cm² → 61 cm² con este brazo`.
- Mover la masa o el brazo en la pausa y reanudar: el aparato responde distinto, no sólo pesa distinto.

- [ ] **Step 6: Commit**

```bash
git add src/menu.js
git commit -m "$(cat <<'EOF'
fix: el panel del aparato deja de prometer más de lo que cumplía

Su nota decía que cambiar una magnitud física cambia el vuelo por la vía
correcta. Ahora que es cierto, los dos deslizadores que dan un número distinto
del que sale lo dicen, con el mismo patrón que el de resolución de rejilla.

«Masa con batería» pasa a ser «Masa en seco» y enseña el total con el pack
puesto, que cambia solo al mover celdas o capacidad. «Arrastre frontal»
enseña lo que sale con el brazo de ahora cuando no es el de referencia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Qué queda por mirar volando

Lo que `npm test` no puede ver:

- Que los dos deslizadores nuevos digan números creíbles y que el segundo se mueva al cambiar la batería o el brazo.
- **Que el aparato de referencia se sienta igual que antes.** El suite lo dice en números, pero el tacto lo dices tú: si algo se ha movido en la calibración, se notaría aquí antes que en ninguna prueba.
- Que mover la masa o el brazo en la pausa y reanudar cambie la agilidad, no sólo el empuje/peso. Es lo que antes no pasaba.
