/*
 * Prueba el voxelizador contra geometría real (la ciudad de demo) en lugar de
 * una losa sintética: es donde se ve si el muestreo de triángulos deja agujeros.
 */
import { Scene, Vector3 } from 'three';
import { createDemoWorld } from '../src/demoWorld.js';
import { buildCollisionGrid } from '../src/voxels.js';
import { Quad } from '../src/flight/quad.js';
import { cloneAirframe } from '../src/flight/params.js';

// Shims mínimos para poder ejecutar el bucle troceado fuera del navegador.
globalThis.requestAnimationFrame = cb => setImmediate( () => cb( performance.now() ) );

let fails = 0;
const check = ( name, cond, info = '' ) => {
	if ( cond ) console.log( `  ok  ${ name } ${ info }` );
	else { console.log( `FAIL  ${ name } ${ info }` ); fails ++; }
};

const steps = { begin() {}, progress() {}, done( id, detail ) { console.log( `      (${ id }: ${ detail })` ); } };

const config = { radius: 700, collisions: true, battery: false, voxelSize: 2.0 };
const scene = new Scene();

/** Un quad de 5" con el modelo de vuelo completo, listo para soltarlo. */
function makeQuad( tweak = () => {} ) {

	const params = cloneAirframe( 'freestyle5' );
	tweak( params );
	return new Quad( params, { collisions: true, battery: false, crashSpeed: 4.5 } );

}

console.log( '\n== voxelización de la ciudad de demo ==' );
const t0 = performance.now();
const demo = createDemoWorld( config, scene );
const grid = await buildCollisionGrid( { tiles: demo, config, steps } );
const buildMs = performance.now() - t0;

check( 'la rejilla se construye', !! grid );
check( 'tarda menos de 20 s', buildMs < 20000, `${ ( buildMs / 1000 ).toFixed( 1 ) } s` );
check( 'ocupa menos de 64 MB', grid.bytes < 64 * 1048576, `${ ( grid.bytes / 1048576 ).toFixed( 0 ) } MB` );

console.log( '\n== cobertura del suelo ==' );
{
	let holes = 0, tested = 0;
	for ( let x = - 690; x <= 690; x += 11 ) {
		for ( let z = - 690; z <= 690; z += 11 ) {
			tested ++;
			let solid = false;
			for ( let y = grid.min.y; y < 8; y += grid.voxelSize * 0.5 ) {
				if ( grid.isSolid( x, y, z ) ) { solid = true; break; }
			}
			if ( ! solid ) holes ++;
		}
	}
	check( 'ningún agujero en el suelo', holes === 0, `${ holes } de ${ tested } puntos` );
}

console.log( '\n== los edificios son obstáculos ==' );
{
	// Se voxeliza la superficie, no el volumen: los edificios son cascarones.
	// Para colisión da igual (no se puede entrar sin cruzar una pared), así que
	// lo que hay que comprobar es que las paredes bloquean de verdad.
	let blocked = 0;
	const RAYS = 180;
	for ( let i = 0; i < RAYS; i ++ ) {
		const a = ( i / RAYS ) * Math.PI * 2;
		const dx = Math.cos( a ), dz = Math.sin( a );
		for ( let t = 5; t < 650; t += 0.5 ) {
			if ( grid.isSolid( dx * t, 20, dz * t ) ) { blocked ++; break; }
		}
	}
	check( 'casi cualquier dirección topa con un edificio', blocked > RAYS * 0.9, `${ blocked } de ${ RAYS }` );

	// Y el cascarón tiene grosor suficiente para que no se cuele nada: a 500 Hz
	// y 40 m/s el dron avanza 8 cm por subpaso, muy por debajo de un vóxel.
	let shell = 0, tested = 0;
	for ( let x = - 400; x <= 400; x += 7 ) {
		for ( let z = - 400; z <= 400; z += 7 ) {
			tested ++;
			if ( grid.isSolid( x, 10, z ) ) shell ++;
		}
	}
	check( 'la trama son paredes, no bloques macizos', shell / tested > 0.02 && shell / tested < 0.25,
		`${ ( shell / tested * 100 ).toFixed( 0 ) } % de la superficie` );
}

console.log( '\n== caída libre sobre la ciudad ==' );
{
	const drone = makeQuad();
	drone.grid = grid;
	drone.setSpawn( 30, 400, 30 );

	const zero = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
	let landed = - 1;
	for ( let i = 0; i < 60 * 1000; i ++ ) {          // hasta 60 s simulados
		drone.step( 0.001, zero );
		if ( drone.crashed && Math.abs( drone.velocity.y ) < 0.3 ) { landed = i / 1000; break; }
	}

	check( 'se detiene sobre la ciudad', landed >= 0, `a los ${ landed.toFixed( 1 ) } s` );
	check( 'marca crash', drone.crashed, `impacto ${ drone.crashSpeed.toFixed( 1 ) } m/s` );
	check( 'ningún punto del chasis queda dentro de la geometría',
		drone.contacts.every( c => {
			const w = c.clone().applyQuaternion( drone.quaternion ).add( drone.position );
			return ! grid.isSolid( w.x, w.y, w.z );
		} ),
		`y=${ drone.position.y.toFixed( 1 ) }` );
	check( 'queda por encima del suelo', drone.position.y > 0, `y=${ drone.position.y.toFixed( 1 ) }` );
}

console.log( '\n== volar contra una pared ==' );
{
	// Se busca una fachada con 60 m de aire por delante y se lanza el dron
	// contra ella en horizontal.
	let target = null, lane = null;
	for ( let z = - 300; z <= 300 && target === null; z += 1 ) {
		for ( let x = 80; x < 400; x += 1 ) {
			if ( ! grid.isSolid( x, 20, z ) ) continue;
			let clear = true;
			for ( let b = x - 62; b < x - 1; b += 0.5 ) {
				if ( grid.isSolid( b, 20, z ) ) { clear = false; break; }
			}
			if ( clear ) { target = x; lane = z; }
			break;
		}
	}

	check( 'hay una fachada que golpear', target !== null, `x=${ target } z=${ lane }` );

	if ( target !== null ) {
		// Sin arrastre aerodinámico: aquí se prueba la colisión, no la
		// aerodinámica, y con arrastre el dron frenaría antes de llegar.
		const drone = makeQuad( p => {
			p.frame.dragArea = { x: 0, y: 0, z: 0 };
		} );
		drone.grid = grid;
		drone.setSpawn( target - 60, 20, lane );
		drone.velocity.set( 25, 0, 0 );

		const hold = { roll: 0, pitch: 0, yaw: 0, throttle: drone.hoverThrottle };
		for ( let i = 0; i < 5 * 1000; i ++ ) {
			drone.step( 0.001, hold );
			if ( drone.crashed ) break;
		}
		check( 'chocar a 90 km/h rompe el dron', drone.crashed, `impacto ${ drone.crashSpeed.toFixed( 1 ) } m/s` );
		check( 'no atraviesa la pared', drone.position.x < target + grid.voxelSize * 2,
			`x=${ drone.position.x.toFixed( 1 ) } vs pared ${ target }` );

		// El golpe es descentrado, así que además de parar tiene que voltear:
		// eso sólo pasa si el impulso se aplica en el punto de contacto.
		check( 'el impacto le mete un giro', drone.body.omega.length() > 0.5,
			`|ω|=${ drone.body.omega.length().toFixed( 2 ) } rad/s` );
	}
}

console.log( '\n== posarse y quedarse quieto ==' );
{
	// Sin este comportamiento el dron vibra sobre el suelo y es imposible aterrizar.
	const drone = makeQuad();
	drone.grid = grid;
	drone.setSpawn( 30, 60, 30 );

	const idle = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
	for ( let i = 0; i < 20000; i ++ ) drone.step( 0.001, idle );

	const restY = drone.position.y;
	for ( let i = 0; i < 3000; i ++ ) drone.step( 0.001, idle );

	check( 'acaba en reposo sobre el tejado', Math.abs( drone.position.y - restY ) < 0.25,
		`deriva ${ Math.abs( drone.position.y - restY ).toFixed( 3 ) } m en 3 s` );
	check( 'sin rebotar', Math.abs( drone.velocity.y ) < 0.5,
		`vy=${ drone.velocity.y.toFixed( 3 ) } m/s` );
}

console.log( '\n== coste por consulta ==' );
{
	const n = 2000000;
	const t = performance.now();
	let hits = 0;
	for ( let i = 0; i < n; i ++ ) {
		if ( grid.isSolid( ( i % 1200 ) - 600, ( i % 137 ), ( ( i * 7 ) % 1200 ) - 600 ) ) hits ++;
	}
	const ns = ( performance.now() - t ) * 1e6 / n;
	check( 'isSolid por debajo de 100 ns', ns < 100, `${ ns.toFixed( 0 ) } ns (${ hits } impactos)` );
}

demo.dispose();
console.log( fails === 0 ? '\nTODO OK\n' : `\n${ fails } FALLOS\n` );
process.exit( fails === 0 ? 0 : 1 );
