/*
 * La entrada tiene un solo camino: el mando. Aquí se comprueban las dos mitades
 * de esa regla —sin mando no hay mandos, con mando y mapeo los ejes llegan con
 * su inversión y su banda muerta— y la única tecla que sobrevive (`Esc`): que no
 * se dispare sola por haberse pulsado antes de que arranque el vuelo, y que sí
 * llegue, una sola vez, mientras se vuela. Todo sin abrir un navegador.
 */
import { InputManager, isCompleteMap } from '../src/input.js';

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

const fakePad = ( axes, id = 'Mando de prueba' ) => ( { index: 0, id, connected: true, axes } );

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

console.log( '\n== no queda API de ratón ==' );
{
	const input = new InputManager( { deadzone: 0.04, gamepadMap: null } );
	check( 'sin requestCapture', input.requestCapture === undefined );
	check( 'sin releaseCapture', input.releaseCapture === undefined );
	check( 'sin readMouseKeyboard', input.readMouseKeyboard === undefined );
	check( 'sin resetStick', input.resetStick === undefined );
}

// `window` no existe en Node: se finge uno mínimo para poder llamar a
// `attach()` y disparar `keydown` a mano, como haría un teclado de verdad.
const fakeWindow = () => {

	const handlers = {};
	globalThis.window = {
		addEventListener: ( type, fn ) => { ( handlers[ type ] ||= [] ).push( fn ); },
		removeEventListener() {},
	};
	return handlers;

};

const press = ( handlers, code ) => handlers.keydown.forEach( fn => fn( { code, repeat: false } ) );

console.log( '\n== las teclas de antes de volar no se disparan solas en el primer frame ==' );
{
	// Reproduce el bug: `Esc` tocado en el menú o en la pausa —antes de que
	// arranque el bucle de vuelo— no debe ejecutarse en cuanto `update()` corre
	// por primera vez. `resetKeys()` es lo que rompe ese arrastre.
	setPads( [] );
	const handlers = fakeWindow();
	const input = new InputManager( { deadzone: 0.04, gamepadMap: null } );
	input.attach();

	press( handlers, 'Escape' );

	input.resetKeys();
	input.update();

	check( 'Escape no llega solo por haberse pulsado antes de volar', input.consumeKey( 'Escape' ) === false );
}

console.log( '\n== una tecla pulsada durante el vuelo llega una sola vez ==' );
{
	setPads( [] );
	const handlers = fakeWindow();
	const input = new InputManager( { deadzone: 0.04, gamepadMap: null } );
	input.attach();
	input.update(); // primer frame, ya sin pulsaciones pendientes

	press( handlers, 'Escape' );
	input.update();

	check( 'consumeKey ve la pulsación', input.consumeKey( 'Escape' ) === true );
	check( 'consumeKey no la ve una segunda vez', input.consumeKey( 'Escape' ) === false );
}

console.log( fails === 0 ? '\nTODO OK\n' : `\n${ fails } FALLOS\n` );
process.exit( fails === 0 ? 0 : 1 );
