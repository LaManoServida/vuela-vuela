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
