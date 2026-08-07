/*
 * El fichero de configuración es la única fuente de números del simulador. Si
 * se cuela un NaN, un rango imposible o un valor fuera de su propio rango, el
 * modelo físico lo propaga y el dron aparece cayendo o girando a mil rpm sin
 * que nada avise. Estas comprobaciones son la red.
 *
 * Dos direcciones distintas, y hacen falta las dos:
 *  - que el fichero que hay ahora sea sano (secciones de arriba);
 *  - que el contrato de `src/config.js` cace las ediciones a mano que lo
 *    rompen, porque el flujo documentado es «edítalo y recarga», no «edítalo y
 *    npm test»: el arranque tiene que fallar solo, diciendo qué clave está mal.
 *
 * Los ayudantes que se usan aquí (`findBadNumbers`, `at`, `validate`) se
 * importan de producción a propósito. Son las piezas de las que depende que el
 * arranque falle bien; una copia en el test sólo demostraría que la copia
 * funciona.
 */
import baseConfig from '../vuela.config.js';
import {
	config, cloneFlight, quadOptions, ui,
	findBadNumbers, at, validate,
} from '../src/config.js';

let fails = 0;
const check = ( name, cond, info = '' ) => {
	if ( cond ) console.log( `  ok  ${ name } ${ info }` );
	else { console.log( `FAIL  ${ name } ${ info }` ); fails ++; }
};

console.log( '\n== integridad numérica ==' );

const bad = findBadNumbers( baseConfig );
check( 'ningún NaN ni Infinity en todo el fichero', bad.length === 0, bad.join( ', ' ) );

console.log( '\n== bloques que el modelo necesita ==' );

for ( const block of [ 'frame', 'motor', 'esc', 'prop', 'battery', 'bf' ] ) {

	check( `flight.${ block } existe`, baseConfig.flight?.[ block ] != null );

}

check( 'bf.pid tiene los tres ejes', baseConfig.flight.bf.pid.length === 3 );
check( 'el yaw no lleva D', baseConfig.flight.bf.pid[ 2 ].dMax === 0 && baseConfig.flight.bf.pid[ 2 ].dMin === 0 );
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

console.log( '\n== el contrato caza las ediciones a mano ==' );

/*
 * Cada caso es una edición razonable de alguien tocando el fichero a mano. La
 * comprobación no es «da algún error», es «da un error que nombra la ruta
 * exacta»: un mensaje que no dice dónde mirar no sirve de nada.
 */
const catches = ( name, sabotage, path ) => {

	const copy = structuredClone( baseConfig );
	sabotage( copy );

	const problems = [
		...findBadNumbers( copy ).map( p => `${ p }: no es un número finito` ),
		...validate( copy ).errors,
	];
	const hit = problems.find( e => e.includes( path ) );

	check( name, !! hit, hit ? `→ «${ hit }»` : `NO lo caza (${ problems.length } problemas detectados)` );

};

catches( 'borrar la clave radius', c => { delete c.radius; }, 'radius' );
catches( 'radius como cadena', c => { c.radius = '1100'; }, 'radius' );
catches( 'mass escrito masa', c => {
	c.flight.frame.masa = c.flight.frame.mass;
	delete c.flight.frame.mass;
}, 'flight.frame.mass' );
catches( 'inertia con dos componentes', c => {
	c.flight.frame.inertia = c.flight.frame.inertia.slice( 0, 2 );
}, 'flight.frame.inertia' );
catches( 'ui.mass.path apuntando a nada', c => {
	c.ui.mass.path = 'flight.frame.masa';
}, 'ui.mass' );
catches( 'borrar el bloque flight.motor', c => { delete c.flight.motor; }, 'flight.motor' );
catches( 'voxelSize a cero', c => { c.voxelSize = 0; }, 'voxelSize' );
catches( 'borrar deadzone', c => { delete c.deadzone; }, 'deadzone' );

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
// Dos filas leyendo el mismo eje físico es exactamente el síntoma que había que
// matar —timón y gas en el mismo stick—, y por el fichero se cuela sin que el
// panel intervenga: cada eje es válido por separado.
catches( 'dos ejes del mismo mando apuntando al mismo índice', c => {
	c.gamepads = { 'Mando de prueba': {
		roll: { axis: 2, inv: false },
		pitch: { axis: 1, inv: true },
		yaw: { axis: 2, inv: false },
		throttle: { axis: 3, inv: true },
	} };
}, 'gamepads.Mando de prueba: roll y yaw apuntan al mismo eje (2)' );

// Los topes del stick. Medio juego describe un recorrido que nadie barrió, y
// unos topes cruzados o pegados dejan el eje hipersensible o muerto: las dos
// cosas se cuelan por el fichero sin que el panel intervenga.
const conEje = ( eje, extra ) => c => {
	c.gamepads = { 'Mando de prueba': {
		roll: { axis: 0, inv: false },
		pitch: { axis: 1, inv: true },
		yaw: { axis: 2, inv: false },
		throttle: { axis: 3, inv: true },
	} };
	Object.assign( c.gamepads[ 'Mando de prueba' ][ eje ], extra );
};

catches( 'topes a medias', conEje( 'roll', { max: 0.96 } ),
	'gamepads.Mando de prueba.roll: los topes van los tres juntos (falta zero y min)' );
catches( 'topes cruzados', conEje( 'yaw', { zero: 0, min: 0.5, max: - 0.5 } ),
	'gamepads.Mando de prueba.yaw: los topes tienen que ir min < zero < max' );
catches( 'topes pegados', conEje( 'pitch', { zero: 0, min: 0, max: 0 } ),
	'gamepads.Mando de prueba.pitch: los topes tienen que ir min < zero < max' );
catches( 'un tope fuera de lo que da un eje', conEje( 'throttle', { zero: 0, min: - 3, max: 1 } ),
	'gamepads.Mando de prueba.throttle.min' );

const conTopes = structuredClone( baseConfig );
conEje( 'roll', { zero: - 0.0196, min: - 0.9686, max: 0.9608 } )( conTopes );
check( 'un mando con topes medidos es válido', validate( conTopes ).errors.length === 0 );

const vacio = structuredClone( baseConfig );
vacio.gamepads = {};
check( 'un fichero sin mandos guardados es válido', validate( vacio ).errors.length === 0 );

// Los otros huecos que el modelo daba por hechos.
catches( 'borrar el bloque ui', c => { delete c.ui; }, 'ui' );
catches( 'borrar el bloque places', c => { delete c.places; }, 'places' );
catches( 'curva del variador con 64 puntos', c => {
	c.flight.esc.curve = c.flight.esc.curve.slice( 0, 64 );
}, 'flight.esc.curve' );
catches( 'bf.pid con dos ejes', c => {
	c.flight.bf.pid = c.flight.bf.pid.slice( 0, 2 );
}, 'flight.bf.pid' );
catches( 'un NaN suelto', c => { c.flight.frame.mass = NaN; }, 'flight.frame.mass' );
catches( 'un modo de vuelo que no existe', c => { c.flight.bf.mode = 'cinematic'; }, 'flight.bf.mode' );

// Y al revés: el fichero de verdad tiene que pasar el contrato limpio.
const real = validate( baseConfig );
check( 'el fichero actual cumple el contrato', real.errors.length === 0, real.errors.join( ' | ' ) );
check( 'no hay claves que no lea nadie', real.unknown.length === 0, real.unknown.join( ', ' ) );

console.log( '\n== cargador ==' );

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

// Los cuatro números de la respuesta al choque llegan al dron desde el fichero
// y no desde un valor por defecto escondido en `quad.js`.
const opts = quadOptions();
check( 'quadOptions trae la respuesta al choque del fichero',
	opts.crashSpeed === baseConfig.crashSpeed
	&& opts.restitution === baseConfig.restitution
	&& opts.friction === baseConfig.friction
	&& opts.maxSpin === baseConfig.maxSpin,
	`crash ${ opts.crashSpeed } · rest ${ opts.restitution } · fric ${ opts.friction } · spin ${ opts.maxSpin }` );
check( 'quadOptions admite sobrescribir lo del entorno de prueba',
	quadOptions( { battery: false } ).battery === false );

console.log( '\n== ningún número de ajuste escondido en código ==' );

const read = async name => ( await import( 'node:fs/promises' ) ).readFile(
	new URL( `../src/${ name }`, import.meta.url ), 'utf8' );

const menuSource = await read( 'menu.js' );

// Un `min: 0.2` en el fuente del menú es un número de configuración escondido
// en código, que es justo lo que este refactor viene a eliminar. Detalles del
// patrón: la comilla opcional es para que `step: '0.0001'` tampoco se escape
// por ir en cadena, y el signo admite espacio detrás porque así escribe este
// repositorio los negativos (`lon: - 73.9855`). Sin eso, `min: - 0.5` pasaba.
const literals = menuSource.match( /\b(min|max|step)\s*:\s*'?[-+]?\s*[0-9.]+/g ) || [];
check( 'ningún min/max/step literal en menu.js', literals.length === 0, literals.join( ', ' ) );

// Y al revés: un rango declarado que no use nadie es peso muerto. Con `\b` al
// final, porque si no `ui.superRate` da un falso "usado" en cuanto aparece
// `ui.superRateYaw`: la subcadena sin límite de palabra no distingue una cosa
// de la otra.
//
// El guardián no admite excepciones: `ui` es el recorrido de los deslizadores y
// nada más. Los valores sin control —`voxelSize`, `crashSpeed`, `deadzone`,
// `restitution`, `friction`, `maxSpin`— no tienen entrada aquí; lo que los
// valida es el contrato de `src/config.js`, que es otra cosa y se comprueba
// arriba.
const unused = Object.keys( baseConfig.ui ).filter( name => ! new RegExp( `ui\\.${ name }\\b` ).test( menuSource ) );
check( 'todos los rangos de ui se usan en el menú', unused.length === 0, unused.join( ', ' ) );

// La escala de la niebla se escribía en dos sitios: si se toca uno, la niebla
// del deslizador deja de coincidir con la de la carga.
const worldSource = await read( 'world.js' );
const mainSource = await read( 'main.js' );
check( 'la escala de la niebla vive en un solo sitio',
	! /0\.00012/.test( mainSource ) && ( worldSource.match( /0\.00012/g ) || [] ).length === 1 );

console.log( '\n== el vuelo por ratón y teclado no vuelve ==' );

// Es el tipo de código que reaparece solo: alguien echa de menos poder probar
// sin mando y vuelve a colar un stick virtual. El camino se quitó a propósito
// —se pilota con mando— y esto lo deja por escrito donde falla. Ojo: lo que se
// caza son estos nombres literales, no la idea de "vuelo con ratón y teclado"
// —un `readVirtualStick()` nuevo en `input.js` seguiría en verde—. Es una
// alarma contra que vuelva el camino conocido, no una prueba general.
const inputSource = await read( 'input.js' );
const panelSource = await read( 'gamepadPanel.js' );
const configSource = await read( 'config.js' );
const fileSource = await ( await import( 'node:fs/promises' ) ).readFile(
	new URL( '../vuela.config.js', import.meta.url ), 'utf8' );

const todo = inputSource + mainSource + menuSource + panelSource + configSource + fileSource;

for ( const rastro of [ 'mouseSens', 'inputMode', 'readMouseKeyboard', 'requestPointerLock', 'pointerlockchange' ] ) {

	check( `sin rastro de ${ rastro }`, ! todo.includes( rastro ) );

}

console.log( fails ? `\n${ fails } FALLOS\n` : '\nTODO OK\n' );
process.exit( fails ? 1 : 0 );
