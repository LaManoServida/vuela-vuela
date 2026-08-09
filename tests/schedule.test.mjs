/*
 * Prueba los turnos con los que avanza la carga. Lo que se comprueba aquí es que
 * sobreviven a la pestaña en segundo plano: toda la precarga cede el control
 * entre trozo y trozo, y si ese turno depende de que haya frames, dejar de mirar
 * la pestaña la deja helada a medias.
 *
 * El navegador no está, así que se falsean las tres piezas que se usan: los
 * frames (que aquí no llegan nunca por su cuenta), el estado de la pestaña y el
 * worker que hace de reloj cuando no hay frames.
 */

let fails = 0;
const check = ( name, cond, info = '' ) => {
	if ( cond ) console.log( `  ok  ${ name } ${ info }` );
	else { console.log( `FAIL  ${ name } ${ info }` ); fails ++; }
};

const espera = ms => new Promise( r => setTimeout( r, ms ) );

// Frames pendientes: aquí no los suelta nadie salvo el propio test, que es
// exactamente lo que hace el navegador con una pestaña que no se ve.
const frames = [];
globalThis.requestAnimationFrame = cb => frames.push( cb );
globalThis.cancelAnimationFrame = () => {};

const doc = { hidden: false, hasFocus: () => true };
globalThis.document = doc;

// El worker que hace de reloj. `retraso` simula un navegador que también
// estrangulase sus temporizadores: contesta tarde pese a pedirle 16 ms.
let retraso = null;
let workers = 0;
globalThis.Worker = class {
	constructor() { workers ++; }
	postMessage( { id, ms } ) { setTimeout( () => this.onmessage( { data: id } ), retraso ?? ms ); }
};
globalThis.URL.createObjectURL = () => 'blob:falso';
globalThis.URL.revokeObjectURL = () => {};

const { nextTick } = await import( '../src/schedule.js' );

console.log( '\n== turnos de la carga ==' );

// Con la pestaña a la vista el turno es el frame: nada cambia respecto a antes.
doc.hidden = false;
let soltado = false;
nextTick().then( () => { soltado = true; } );
await espera( 30 );
check( 'a la vista, el turno espera al frame', soltado === false && frames.length === 1 );
frames.shift()();
await espera( 0 );
check( 'y llega en cuanto hay frame', soltado === true );

// En segundo plano no hay frames. El turno tiene que llegar igual.
doc.hidden = true;
frames.length = 0;
let t = performance.now();
await nextTick();
check( 'en segundo plano llega sin un solo frame',
	frames.length === 0 && performance.now() - t < 200,
	`(${ ( performance.now() - t ).toFixed( 0 ) } ms)` );
check( 'y el reloj lo pone un worker', workers === 1 );

// Sin foco pero a la vista cuenta como segundo plano: es el caso que da la cara
// —minimizar, tapar la ventana— y el reloj propio vale igual que el frame.
doc.hidden = false;
doc.hasFocus = () => false;
frames.length = 0;
await nextTick();
check( 'sin foco tampoco depende del frame', frames.length === 0 );
doc.hasFocus = () => true;
doc.hidden = true;

// Si el navegador estrangulase también los temporizadores del worker, el turno
// dejaría de llegar a tiempo. Se mide y se cambia de mecanismo.
retraso = 600;
for ( let i = 0; i < 3; i ++ ) await nextTick();
await nextTick();   // el primero por el mecanismo nuevo paga su arranque
t = performance.now();
await nextTick();
check( 'con el reloj estrangulado, el turno sigue llegando',
	performance.now() - t < 50,
	`(${ ( performance.now() - t ).toFixed( 0 ) } ms)` );

console.log( '\n== las colas del tileset ==' );

const { Scheduler } = await import( '3d-tiles-renderer' );
const { tick } = await import( '../src/preload.js' );

// El tileset difiere a un frame su siguiente turno de descarga y parseo. Sin
// frames ese turno no llega nunca y las colas se quedan a medias: es la mitad
// del problema que no arregla tener nuestro propio reloj.
doc.hidden = true;
frames.length = 0;
let colaCorrida = false;
Scheduler.requestAnimationFrame( () => { colaCorrida = true; } );
await tick();
check( 'un turno de precarga despierta las colas paradas', colaCorrida === true );

console.log( fails === 0 ? '\nTODO OK\n' : `\n${ fails } FALLOS\n` );
process.exit( fails === 0 ? 0 : 1 );
