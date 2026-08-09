/*
 * Turnos de trabajo que no se paran al perder el foco.
 *
 * Toda la carga —tiles, texturas, shaders, rejilla— avanza a trozos, cediendo el
 * control entre uno y otro para que la pantalla de carga siga respondiendo. Ese
 * turno era un `requestAnimationFrame`, y ahí estaba el problema: el navegador
 * deja de dar frames en cuanto la pestaña no se ve —otra pestaña, ventana
 * minimizada, ventana tapada—, así que la carga se quedaba helada a la mitad
 * hasta volver a mirarla.
 *
 * Fuera de la vista el reloj no puede ser el del documento: el navegador
 * estrangula sus temporizadores a uno por segundo, y a uno por minuto pasados
 * cinco minutos oculto. Los temporizadores de un worker se libran de ese
 * estrangulamiento. Y por si algún navegador acabara estrangulándolos también,
 * se mide cuánto tarda de verdad el turno; si tarda de más se pasa a
 * `MessageChannel`, que no es un temporizador y por tanto nadie estrangula, a
 * cambio de girar sin pausa.
 */

const TICK_MS = 16;

// El estrangulamiento del navegador empieza en un segundo, así que medio segundo
// separa de sobra un turno estrangulado de un frame simplemente lento.
const TARDE_MS = 500;
const AVISOS = 3;

const RELOJ = 'onmessage = e => setTimeout( () => postMessage( e.data.id ), e.data.ms );';

let worker;
let canal;
let girando = false;
let avisos = 0;
let ultimoId = 0;
const esperando = new Map();
const encolados = [];

/**
 * Cede el control hasta el siguiente turno. Con la pestaña a la vista es el
 * siguiente frame; sin ella, un reloj que el navegador no puede parar.
 */
export function nextTick() {

	if ( ! enSegundoPlano() ) return new Promise( resolve => requestAnimationFrame( () => resolve() ) );

	if ( girando ) return macrotarea();

	const inicio = performance.now();
	return dormir( TICK_MS ).then( () => {

		avisos = performance.now() - inicio > TARDE_MS ? avisos + 1 : 0;
		if ( avisos >= AVISOS ) girando = true;

	} );

}

/**
 * Sin foco cuenta igual que oculta: el reloj propio sirve para las dos, y así da
 * lo mismo qué haya hecho exactamente el navegador con los frames.
 */
export function enSegundoPlano() {

	if ( typeof document === 'undefined' ) return false;
	if ( document.hidden ) return true;
	return typeof document.hasFocus === 'function' && ! document.hasFocus();

}

function dormir( ms ) {

	const w = reloj();
	if ( ! w ) return macrotarea();

	return new Promise( resolve => {

		const id = ++ ultimoId;
		esperando.set( id, resolve );
		w.postMessage( { id, ms } );

	} );

}

function reloj() {

	if ( worker !== undefined ) return worker;

	try {

		const url = URL.createObjectURL( new Blob( [ RELOJ ], { type: 'text/javascript' } ) );
		worker = new Worker( url );
		worker.onmessage = ( { data } ) => {

			URL.revokeObjectURL( url );
			const resolve = esperando.get( data );
			if ( ! resolve ) return;
			esperando.delete( data );
			resolve();

		};

	} catch ( e ) {

		// Sin worker queda el giro: peor, pero avanza.
		worker = null;

	}

	return worker;

}

function macrotarea() {

	if ( ! canal ) {

		canal = new MessageChannel();
		canal.port1.onmessage = () => encolados.shift()?.();

	}

	return new Promise( resolve => {

		encolados.push( resolve );
		canal.port2.postMessage( 0 );

	} );

}
