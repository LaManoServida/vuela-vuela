/*
 * Prueba las piezas del modo de exploración, en el que la zona cargada sigue al
 * dron en vez de estar clavada en el punto de despegue.
 *
 * Lo que se comprueba aquí es lo que decide el coste: cuándo toca recorrer el
 * árbol de tiles —que es una llamada indivisible y cara— y dónde se ponen las
 * esferas de carga. El navegador no está, pero ninguna de las dos lo necesita:
 * una es aritmética de tiempo y distancia, la otra de matrices.
 */
import { Matrix4, Vector3, Sphere } from 'three';
import { createRefreshClock, recenterRegions, MIN_MOVE } from '../src/stream.js';

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

console.log( fails === 0 ? '\nTODO OK\n' : `\n${ fails } FALLOS\n` );
process.exit( fails === 0 ? 0 : 1 );
