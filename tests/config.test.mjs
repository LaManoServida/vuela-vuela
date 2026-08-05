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
