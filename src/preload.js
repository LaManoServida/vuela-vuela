import { Vector3, Euler, Quaternion } from 'three';

const nextFrame = () => new Promise( r => requestAnimationFrame( r ) );

/**
 * Precarga completa de la zona.
 *
 * La idea de todo el simulador está aquí: se paga *todo* el coste (red, parseo,
 * subida a GPU, compilación de shaders) antes de que el dron se mueva. Durante
 * el vuelo no queda ningún trabajo diferido que pueda provocar un tirón.
 */
export async function preloadRegion( { tiles, renderer, scene, camera, config, steps, signal } ) {

	const errors = [];
	const onError = ( { error, url } ) => {

		errors.push( { error, url: String( url ) } );

	};

	tiles.addEventListener( 'load-error', onError );

	try {

		await waitForRoot( tiles, errors, steps, signal );
		const stats = await downloadEverything( { tiles, steps, signal } );
		await uploadTextures( { tiles, renderer, steps, signal } );
		await compileShaders( { tiles, renderer, scene, camera, steps, signal } );
		freeze( tiles, config );
		return { ...stats, errors: errors.length };

	} finally {

		tiles.removeEventListener( 'load-error', onError );

	}

}

function checkAbort( signal ) {

	if ( signal?.aborted ) throw new DOMException( 'Cancelado', 'AbortError' );

}

async function waitForRoot( tiles, errors, steps, signal ) {

	steps.begin( 'root', 'Abriendo sesión y leyendo el tileset raíz' );

	const start = performance.now();
	while ( ! tiles.root ) {

		checkAbort( signal );
		tiles.update();
		await nextFrame();

		if ( errors.length ) {

			const first = errors[ 0 ];
			const text = first.error?.message || String( first.error );
			const rejected = /\b(400|401|403)\b/.test( text );
			throw new Error( rejected
				? `Google rechazó la petición (${ text.match( /\b(400|401|403)\b/ )[ 0 ] }). Comprueba que la API key es correcta, que "Map Tiles API" está habilitada en el proyecto, que el proyecto tiene facturación activa y que las restricciones de la clave permiten http://127.0.0.1:5173`
				: `No se pudo cargar el tileset: ${ text }` );

		}

		if ( performance.now() - start > 30000 ) {

			throw new Error( 'Tiempo agotado esperando al tileset raíz. ¿Hay conexión y la API key es correcta?' );

		}

	}

	tiles.group.updateMatrixWorld( true );
	steps.done( 'root' );

}

async function downloadEverything( { tiles, steps, signal } ) {

	steps.begin( 'tiles', 'Descargando y parseando geometría' );

	const { downloadQueue, parseQueue, processNodeQueue, stats } = tiles;
	let quietFrames = 0;
	let peakPending = 1;
	const start = performance.now();

	while ( quietFrames < 20 ) {

		checkAbort( signal );
		tiles.update();

		const pending =
			downloadQueue.items.length + downloadQueue.currJobs +
			parseQueue.items.length + parseQueue.currJobs +
			processNodeQueue.items.length + processNodeQueue.currJobs;

		peakPending = Math.max( peakPending, pending + stats.inCache );

		// "Terminado" = varios frames seguidos sin nada en vuelo. El traversal
		// puede destapar hijos nuevos un frame después de parsear al padre, así
		// que un solo frame en silencio no basta.
		quietFrames = pending === 0 ? quietFrames + 1 : 0;

		const done = Math.max( 0, peakPending - pending );
		steps.progress( done / Math.max( 1, peakPending ), `${ stats.inCache } tiles · ${ pending } en cola` );

		await nextFrame();

		if ( performance.now() - start > 15 * 60 * 1000 ) {

			throw new Error( 'La descarga está tardando demasiado. Prueba con un radio menor o menos calidad.' );

		}

	}

	let meshes = 0;
	let triangles = 0;
	tiles.forEachLoadedModel( scene => {

		scene.traverse( child => {

			if ( ! child.isMesh ) return;
			meshes ++;
			const geometry = child.geometry;
			triangles += ( geometry.index ? geometry.index.count : geometry.attributes.position.count ) / 3;

		} );

	} );

	steps.done( 'tiles', `${ stats.inCache } tiles · ${ meshes } mallas · ${ ( triangles / 1e6 ).toFixed( 1 ) }M triángulos` );

	return { tileCount: stats.inCache, meshes, triangles: Math.round( triangles ) };

}

/**
 * La subida de una textura a la GPU ocurre, por defecto, la primera vez que se
 * dibuja. Con miles de texturas eso es un goteo de micro-tirones durante todo
 * el vuelo. `initTexture` lo fuerza aquí, troceado para no bloquear la UI.
 */
async function uploadTextures( { tiles, renderer, steps, signal } ) {

	steps.begin( 'textures', 'Subiendo texturas a la GPU' );

	const textures = new Set();
	tiles.forEachLoadedModel( scene => {

		scene.traverse( child => {

			const material = child.material;
			if ( ! material ) return;
			const list = Array.isArray( material ) ? material : [ material ];
			for ( const m of list ) {

				for ( const key of [ 'map', 'emissiveMap', 'normalMap' ] ) {

					if ( m[ key ] ) textures.add( m[ key ] );

				}

			}

		} );

	} );

	const all = [ ...textures ];
	let i = 0;
	while ( i < all.length ) {

		checkAbort( signal );
		const budgetEnd = performance.now() + 6;
		while ( i < all.length && performance.now() < budgetEnd ) {

			try {

				renderer.initTexture( all[ i ] );

			} catch ( e ) {

				// Una textura suelta que falle no debe tumbar la carga.

			}

			i ++;

		}

		steps.progress( i / Math.max( 1, all.length ), `${ i } / ${ all.length }` );
		await nextFrame();

	}

	steps.done( 'textures', `${ all.length } texturas` );

}

async function compileShaders( { tiles, renderer, scene, camera, steps, signal } ) {

	steps.begin( 'shaders', 'Compilando shaders y calentando el pipeline' );
	checkAbort( signal );

	await renderer.compileAsync( tiles.group, camera, scene );

	// Un barrido real de 360°: obliga a recorrer de verdad el camino de dibujo
	// (estados, bindings, primer uso de cada programa) antes de ceder el control.
	const savedQuat = camera.quaternion.clone();
	const euler = new Euler( 0, 0, 0, 'YXZ' );
	const quat = new Quaternion();
	const sweeps = 12;

	for ( let i = 0; i < sweeps; i ++ ) {

		checkAbort( signal );
		euler.set(
			i % 2 === 0 ? - 0.25 : 0.15,
			( i / sweeps ) * Math.PI * 2,
			0,
		);
		camera.quaternion.setFromEuler( euler );
		camera.updateMatrixWorld( true );
		renderer.render( scene, camera );
		steps.progress( ( i + 1 ) / sweeps );
		await nextFrame();

	}

	camera.quaternion.copy( savedQuat );
	camera.updateMatrixWorld( true );
	steps.done( 'shaders' );

}

/**
 * Congela el tileset: nada se descarga, nada se descarta, y las matrices del
 * subárbol dejan de recalcularse cada frame.
 */
function freeze( tiles, config ) {

	tiles.group.updateMatrixWorld( true );

	// A partir de aquí nadie llama a tiles.update(), así que el árbol de tiles
	// queda tal cual. Desactivar la actualización de matrices del subárbol le
	// ahorra a three recorrer cientos de objetos inmóviles en cada frame.
	tiles.group.matrixWorldAutoUpdate = false;

}

/** Altura del terreno en (x, z) usando el raycast acelerado del tileset. */
export function sampleGround( tiles, raycaster, x, z, from = 9000 ) {

	raycaster.set( new Vector3( x, from, z ), new Vector3( 0, - 1, 0 ) );
	raycaster.firstHitOnly = true;
	raycaster.near = 0;
	raycaster.far = from + 12000;

	const hits = [];
	tiles.raycast( raycaster, hits );
	if ( ! hits.length ) return null;

	hits.sort( ( a, b ) => a.distance - b.distance );
	return hits[ 0 ].point.y;

}
