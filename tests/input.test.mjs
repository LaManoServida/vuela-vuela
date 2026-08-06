/*
 * La entrada tiene un solo camino: el mando. Aquí se comprueban las dos mitades
 * de esa regla —sin mando no hay mandos, con mando y mapeo los ejes llegan con
 * su inversión y su banda muerta— y la única tecla que sobrevive (`Esc`): que no
 * se dispare sola por haberse pulsado antes de que arranque el vuelo, y que sí
 * llegue, una sola vez, mientras se vuela. Todo sin abrir un navegador.
 */
import { InputManager, isCompleteMap, AxisPicker, hasReturned, Calibration, mapSnippet, AXES } from '../src/input.js';

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

console.log( fails === 0 ? '\nTODO OK\n' : `\n${ fails } FALLOS\n` );
process.exit( fails === 0 ? 0 : 1 );
