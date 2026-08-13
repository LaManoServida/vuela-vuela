/*
 * Prueba las piezas del modo de exploración, en el que la zona cargada sigue al
 * dron en vez de estar clavada en el punto de despegue.
 *
 * Lo que se comprueba aquí es lo que decide el coste: cuándo toca recorrer el
 * árbol de tiles —que es una llamada indivisible y cara— y dónde se ponen las
 * esferas de carga. El navegador no está, pero ninguna de las dos lo necesita:
 * una es aritmética de tiempo y distancia, la otra de matrices.
 */
import { Matrix4, Vector3, Sphere, Quaternion, Euler } from 'three';
import { createRefreshClock, recenterRegions, createTextureQueue, createStream, QUEUE_COMPACT_THRESHOLD, MIN_MOVE } from '../src/stream.js';

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

// La matriz de verdad no es una traslación pura: el ReorientationPlugin también
// rota, para dejar +Y arriba y +Z al norte. Con sólo traslación, una
// implementación que se limitase a restar el origen del tileset pasaría este
// test igual que la que deshace la rotación con `invert()`. El resultado
// esperado se calcula aquí por otra vía —aplicando la rotación inversa a mano—
// para no repetir el mismo cálculo que hace el propio módulo.
const rotacion = new Quaternion().setFromEuler( new Euler( 0.3, 0.7, - 0.4, 'XYZ' ) );
const traslacion = new Vector3( 500, - 700, 1200 );
const groupRotado = { matrixWorld: new Matrix4().compose( traslacion, rotacion, new Vector3( 1, 1, 1 ) ) };
const regionRotada = [ { sphere: new Sphere( new Vector3(), 500 ) } ];
const posicionDron = new Vector3( 120, - 45, 980 );

const localRotado = recenterRegions( regionRotada, groupRotado, posicionDron );
const esperado = posicionDron.clone().sub( traslacion ).applyQuaternion( rotacion.clone().invert() );

check( 'con rotación y traslación, deshace también la rotación',
	localRotado.distanceTo( esperado ) < 1e-9,
	`${ localRotado.toArray().join( ', ' ) } vs ${ esperado.toArray().join( ', ' ) }` );
check( 'la esfera rotada queda en ese mismo punto',
	regionRotada[ 0 ].sphere.center.distanceTo( esperado ) < 1e-9 );

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

// Un tile fotogramétrico parte su geometría en varias mallas que comparten la
// textura del tile: sin deduplicar, la misma entraría varias veces en la cola
// y el número de pendientes que enseña el OSD mentiría.
ahora = 0;
const compartida = createTextureQueue( { renderer, budgetMs: 1000, now: () => ahora } );
compartida.enqueue( modelo( 'x', 'x', 'x' ) );
check( 'mallas que comparten textura no la duplican en la cola', compartida.pending === 1 );

console.log( '\n== compactación de la cola de texturas ==' );

// El caso que de verdad arriesga algo no es compactar con la cola ya vacía
// —ahí `head === pending.length` y de poco sirve la prueba—, sino compactar
// con la cola todavía viva: el presupuesto se agota a propósito antes de
// drenarla entera, así que al compactar queda `head < pending.length`, y lo
// que faltaba por subir tiene que sobrevivir al recorte del array.
const total = QUEUE_COMPACT_THRESHOLD + 2000;
const identificadores = [];
for ( let i = 0; i < total; i ++ ) identificadores.push( `t${ i }` );

const primerTurno = 5000;   // > umbral, y su doble > total: cruza las dos condiciones de sobra
const restante = total - primerTurno;

const subidasGrandes = [];
const rendererGrande = { initTexture: t => { subidasGrandes.push( t ); ahora += 2; } };
// El presupuesto se ajusta para agotarse justo tras `primerTurno` subidas: con
// el reloj falso a coste fijo de 2 ms por textura, ese es el único número que
// hace falta.
const grande = createTextureQueue( { renderer: rendererGrande, budgetMs: primerTurno * 2, now: () => ahora } );
grande.enqueue( modelo( ...identificadores ) );
ahora = 0;

// La compactación no cambia nada observable desde fuera —por diseño: si
// cambiase algo, no sería segura—, así que lo único que delata que ha ocurrido
// es la propia llamada a `splice`. Se espía un instante, sólo alrededor de este
// `drain()`, y se repone enseguida para no dejar el espía puesto en el resto de
// la suite.
const spliceOriginal = Array.prototype.splice;
let compactado = false;
Array.prototype.splice = function ( ...args ) {

	compactado = true;
	return spliceOriginal.apply( this, args );

};

let subidasPrimerTurno;
try {

	subidasPrimerTurno = grande.drain();

} finally {

	Array.prototype.splice = spliceOriginal;

}

check( 'el primer turno se para donde manda el presupuesto, con la cola aún viva',
	subidasPrimerTurno === primerTurno );
check( 'cruzado el umbral con texturas todavía sin subir, se compacta sola', compactado );
check( 'lo que quedaba pendiente sigue ahí, completo, tras compactar', grande.pending === restante );

// Turno siguiente, con presupuesto de sobra: si la compactación hubiera
// tirado también lo pendiente en vez de sólo lo ya subido, aquí faltarían
// texturas por drenar.
const subidasSegundoTurno = grande.drain();
check( 'y ese resto se acaba subiendo, sin que falte ni una',
	subidasSegundoTurno === restante && grande.pending === 0 );
check( 'nada se pierde ni se repite en toda la operación, ni cambia el orden',
	subidasGrandes.join( ',' ) === identificadores.join( ',' ) );

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

console.log( fails === 0 ? '\nTODO OK\n' : `\n${ fails } FALLOS\n` );
process.exit( fails === 0 ? 0 : 1 );
