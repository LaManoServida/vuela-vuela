/*
 * Prueba el voxelizador contra geometría real (la ciudad de demo) en lugar de
 * una losa sintética: es donde se ve si el muestreo de triángulos deja agujeros.
 */
import { Scene, Vector3, Group, Mesh, BufferGeometry, BufferAttribute } from 'three';
import { createDemoWorld } from '../src/demoWorld.js';
import { buildCollisionGrid } from '../src/voxels.js';
import { collectSurfaceCells, createGridView } from '../src/gridView.js';
import { Quad } from '../src/flight/quad.js';
import { cloneFlight, quadOptions } from '../src/config.js';

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

	const params = cloneFlight();
	tweak( params );
	// La velocidad de rotura y la respuesta al choque salen del fichero: aquí se
	// prueba la colisión con los mismos números con los que se vuela.
	return new Quad( params, quadOptions( { collisions: true, battery: false } ) );

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
	// Lo que se mide: el coste medio de una consulta `isSolid` sobre 2 M puntos
	// dispersos, incluido el fallo de caché (la rejilla no cabe en L2).
	//
	// El umbral está a 250 ns y no a 100 por una razón: la medida depende de la
	// máquina y del momento (aquí sale sobre 40 ns; en la máquina de la revisión
	// daba entre 94 y 114 ns en reposo), así que un tope de 100 fallaba 2 de
	// cada 7 ejecuciones sin que nada estuviera roto. Una batería que se pone
	// roja al azar entrena a ignorar el rojo, y esta batería es lo único que
	// caza los agujeros de validación del fichero de configuración. Lo que hay
	// que detectar es una regresión de verdad —volver a un raycast sería dos
	// órdenes de magnitud más— no el ruido del planificador.
	const n = 2000000;
	const t = performance.now();
	let hits = 0;
	for ( let i = 0; i < n; i ++ ) {
		if ( grid.isSolid( ( i % 1200 ) - 600, ( i % 137 ), ( ( i * 7 ) % 1200 ) - 600 ) ) hits ++;
	}
	const ns = ( performance.now() - t ) * 1e6 / n;
	check( 'isSolid por debajo de 250 ns por consulta', ns < 250,
		`${ ns.toFixed( 0 ) } ns de media en 2 M consultas (${ hits } impactos)` );
}

console.log( '\n== los tiles que no se dibujan no entran en la rejilla ==' );
{
	// Lo que manda Google: junto a los tiles finos de la zona siguen CARGADOS sus
	// ancestros —el globo entero resuelto con 251 triángulos—, porque la caché
	// está puesta para no descartar nada. No se dibujan, pero contienen la zona,
	// así que ningún filtro lateral los descarta y su caja envolvente mide miles
	// de kilómetros de alto. Si entran en el cálculo de la extensión, la rejilla
	// pide gigabytes y el navegador tira `RangeError`.

	/** Una malla suelta dentro de su propio grupo, como llega cada tile. */
	const tileScene = positions => {

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( positions ), 3 ) );
		const group = new Group();
		group.add( new Mesh( geometry ) );
		group.updateMatrixWorld( true );
		return group;

	};

	// Tile fino: suelo con un edificio, dentro de la zona. El suelo va en
	// triángulos de 20 m, como los de un tile fotogramétrico de verdad: con uno
	// solo de 1,2 km el tope de 64 muestras por triángulo lo dejaría agujereado
	// y estaríamos midiendo eso en vez de lo que toca.
	const suelo = [];
	for ( let x = - 600; x < 600; x += 20 ) {
		for ( let z = - 600; z < 600; z += 20 ) {
			suelo.push(
				x, 0, z, x + 20, 0, z, x + 20, 0, z + 20,
				x, 0, z, x + 20, 0, z + 20, x, 0, z + 20,
			);
		}
	}
	const fino = tileScene( [ ...suelo, - 40, 0, - 40, 40, 0, - 40, 0, 120, 0 ] );

	// Ancestro basto: 8.000 km de lado, del otro lado del planeta hasta arriba.
	const ancestro = tileScene( [
		- 4e6, - 12.7e6, - 4e6, 4e6, 2e6, - 4e6, 0, 6e6, 4e6,
	] );

	const fuente = {
		visibleTiles: new Set( [ { engineData: { scene: fino } } ] ),
		forEachLoadedModel( callback ) { callback( fino, null ); callback( ancestro, null ); },
	};

	const g = await buildCollisionGrid( { tiles: fuente, config, steps } );

	check( 'la rejilla se construye', !! g );
	check( 'la altura sale de lo que se dibuja', g && g.max.y - g.min.y < 1000,
		g ? `${ Math.round( g.max.y - g.min.y ) } m` : '' );
	check( 'conserva el tamaño de vóxel pedido', g && g.voxelSize === config.voxelSize,
		g ? `${ g.voxelSize.toFixed( 2 ) } m` : '' );
	check( 'el suelo del tile fino es sólido', g && g.isSolid( 100, 0, 100 ) );
}

console.log( '\n== el presupuesto de memoria no es negociable ==' );
{
	// Segunda línea de defensa: aunque la extensión sea absurda —una fuente sin
	// lista de visibles, un sitio con un desnivel salvaje—, la rejilla tiene que
	// caber en el tope. Rendirse y reservar de más es lo que rompe la pestaña.
	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [
		- 600, - 600000, - 600, 600, 0, - 600, 600, 0, 600,
	] ), 3 ) );
	const group = new Group();
	group.add( new Mesh( geometry ) );
	group.updateMatrixWorld( true );

	const fuente = { forEachLoadedModel( callback ) { callback( group, null ); } };
	const g = await buildCollisionGrid( { tiles: fuente, config, steps } );

	check( 'cabe en el tope de 64 MB', g && g.bytes <= 64 * 1048576,
		g ? `${ ( g.bytes / 1048576 ).toFixed( 0 ) } MB` : '' );
}

console.log( '\n== la ventana que dibuja la vista de la rejilla ==' );
{
	// La vista de depuración dibuja las celdas sólidas alrededor del dron. Lo que
	// se prueba aquí es la selección —qué celdas entran—, que es lo único que no
	// necesita GPU. Que se vean rojas y encajen con la fachada se verifica volando.
	const RADIUS = 20;
	const r = Math.ceil( RADIUS / grid.voxelSize );
	const out = new Float32Array( 60000 * 3 );

	// Un punto a media altura dentro de la ciudad, elegido para que la ventana
	// entera caiga en índices no negativos: por debajo de `min.y` la rejilla
	// declara sólido todo, y comparar contra eso mediría el borde, no el filtro.
	const center = new Vector3( 30, grid.min.y + 30, 30 );
	const n = collectSurfaceCells( grid, center, RADIUS, out );

	check( 'encuentra celdas dentro de la ciudad', n > 0, `${ n } cubos` );

	const size = grid.voxelSize;
	// La celda más lejana tiene su centro a exactamente esto. La holgura es por
	// el buffer, que es de float32: a mil metros del origen eso cuantiza a unas
	// micras, y la última capa cae justo en el límite. Un milímetro de margen
	// sigue estando tres órdenes por debajo de un vóxel.
	const reach = ( r + 0.5 ) * size + 1e-3;
	let fuera = 0, hueca = 0, maciza = 0;

	for ( let i = 0; i < n; i ++ ) {

		const x = out[ i * 3 ], y = out[ i * 3 + 1 ], z = out[ i * 3 + 2 ];

		if ( Math.abs( x - center.x ) > reach || Math.abs( y - center.y ) > reach || Math.abs( z - center.z ) > reach ) fuera ++;
		if ( ! grid.isSolid( x, y, z ) ) hueca ++;

		// Piel: al menos una de las seis vecinas tiene que ser aire.
		if ( grid.isSolid( x + size, y, z ) && grid.isSolid( x - size, y, z )
			&& grid.isSolid( x, y + size, z ) && grid.isSolid( x, y - size, z )
			&& grid.isSolid( x, y, z + size ) && grid.isSolid( x, y, z - size ) ) maciza ++;

	}

	check( 'ninguna celda se sale del radio', fuera === 0, `${ fuera } fuera` );
	check( 'todas las celdas son sólidas', hueca === 0, `${ hueca } huecas` );
	check( 'ninguna celda tiene las seis vecinas sólidas', maciza === 0, `${ maciza } macizas` );

	// Y al revés: que no se deje ninguna. La cuenta de referencia se hace aquí a
	// mano, con `isSolid` sobre coordenadas de mundo, que es el camino que usa el
	// vuelo — si las dos rutas discreparan, la vista mentiría.
	const cx = Math.floor( ( center.x - grid.min.x ) / size );
	const cy = Math.floor( ( center.y - grid.min.y ) / size );
	const cz = Math.floor( ( center.z - grid.min.z ) / size );
	const world = ( i, axis ) => grid.min[ axis ] + ( i + 0.5 ) * size;

	let esperadas = 0;
	for ( let iy = cy - r; iy <= cy + r; iy ++ ) {
		for ( let iz = cz - r; iz <= cz + r; iz ++ ) {
			for ( let ix = cx - r; ix <= cx + r; ix ++ ) {
				const x = world( ix, 'x' ), y = world( iy, 'y' ), z = world( iz, 'z' );
				if ( ! grid.isSolid( x, y, z ) ) continue;
				if ( grid.isSolid( x + size, y, z ) && grid.isSolid( x - size, y, z )
					&& grid.isSolid( x, y + size, z ) && grid.isSolid( x, y - size, z )
					&& grid.isSolid( x, y, z + size ) && grid.isSolid( x, y, z - size ) ) continue;
				esperadas ++;
			}
		}
	}

	check( 'no se deja ninguna celda de la piel', n === esperadas, `${ n } de ${ esperadas }` );

	// Por encima de todo no hay nada que dibujar: la rejilla deja 60 m de aire
	// sobre la antena más alta.
	const arriba = collectSurfaceCells( grid, new Vector3( 30, grid.max.y - 30, 30 ), RADIUS, out );
	check( 'sobre la ciudad no dibuja nada', arriba === 0, `${ arriba } cubos` );

	// El buffer manda: con sitio para 10 cubos salen 10, no 11 ni un desbordamiento.
	const corto = new Float32Array( 10 * 3 );
	const recortadas = collectSurfaceCells( grid, center, RADIUS, corto );
	check( 'nunca desborda el buffer', recortadas === 10, `${ recortadas } cubos en hueco para 10` );
}

console.log( '\n== la vista se rehace sólo cuando toca ==' );
{
	// Un `InstancedMesh` se construye sin GPU, así que la cadencia —que es lo que
	// decide si esto puede penalizar el rendimiento— se prueba aquí y no volando.
	// El testigo de que ha habido reconstrucción es la versión del buffer de
	// instancias: sólo sube cuando se reescriben las matrices.
	const sala = new Scene();
	const vista = createGridView( {
		grid,
		scene: sala,
		config: { gridRadius: 20, gridRefresh: 0.05 },
	} );

	check( 'apagada no monta nada', sala.children.length === 0 );

	vista.setVisible( true );
	const mesh = sala.children[ 0 ];
	check( 'encendida monta la malla', !! mesh );

	const aqui = new Vector3( 30, grid.min.y + 30, 30 );
	vista.update( aqui );
	check( 'la primera vez dibuja', mesh.count > 0, `${ mesh.count } cubos` );

	const version = mesh.instanceMatrix.version;
	vista.update( aqui );
	check( 'sin moverse no rehace nada', mesh.instanceMatrix.version === version );

	// Cambiar de celda no basta: manda el reloj.
	const alla = aqui.clone().addScaledVector( new Vector3( 1, 0, 0 ), grid.voxelSize * 3 );
	vista.update( alla );
	check( 'cambiar de celda antes de tiempo tampoco', mesh.instanceMatrix.version === version );

	await new Promise( r => setTimeout( r, 80 ) );
	vista.update( alla );
	check( 'pasado gridRefresh sí rehace', mesh.instanceMatrix.version > version );

	vista.setVisible( false );
	check( 'apagarla la quita de la escena', sala.children.length === 0 );
}

demo.dispose();
console.log( fails === 0 ? '\nTODO OK\n' : `\n${ fails } FALLOS\n` );
process.exit( fails === 0 ? 0 : 1 );
