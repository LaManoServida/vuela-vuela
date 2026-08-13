import { Matrix4, Vector3 } from 'three';

/*
 * Modo de exploración: la zona cargada sigue al dron.
 *
 * El modo normal precarga una zona finita y congela el recorrido del árbol de
 * tiles. Es lo que garantiza que no haya un solo tirón —no queda trabajo
 * pendiente que pueda caer en mitad de un frame— y también lo que hace que el
 * mundo se acabe a 22 km del despegue.
 *
 * Aquí se cambia esa garantía por un presupuesto. Las esferas de carga siguen
 * al dron, así que hay trabajo nuevo continuamente, y ese trabajo se paga a
 * plazos con un techo por frame que no se rebasa. Si el dron avanza más rápido
 * de lo que la red y la GPU alimentan, lo que se rompe es la nitidez —por
 * delante se ve basto y va afinando— y nunca la fluidez.
 *
 * Hay dos relojes distintos y confundirlos tira abajo el diseño entero:
 *
 *  - Recorrer el árbol es UNA llamada indivisible y cara. Va cada `interval`
 *    segundos. A 40 m/s eso son 40 metros entre pasada y pasada, nada frente a
 *    un radio de detalle de cientos.
 *  - Subir texturas a la GPU va CADA frame, en porciones diminutas. Es lo que
 *    reparte el coste: agruparlo una vez por segundo daría un tirón por segundo.
 */

// Cuánto hay que moverse para que un turno de recorrido valga la pena. Frente a
// un radio de detalle de cientos de metros, veinticinco no cambian qué tiles
// hacen falta. Es una constante y no un deslizador a propósito: nadie va a
// querer tocarla y el menú ya va servido.
export const MIN_MOVE = 25;

/**
 * Decide si toca recorrer el árbol de tiles.
 *
 * Dos condiciones y tienen que darse las dos: que haya pasado el intervalo y
 * que el dron se haya movido lo suficiente. Quedarse quieto en el aire no
 * cuesta nada, que es medio motivo de que la distancia esté aquí.
 *
 * El otro medio: cuando el intervalo se cumple pero el dron no se ha movido, no
 * se apunta nada. Así el turno que se salta no cuenta como gastado y, en cuanto
 * el dron arranca, la carga responde en el acto en vez de esperar otro ciclo.
 *
 * `intervalS` y `minMoveM` se leen en cada consulta y son públicos a propósito:
 * los deslizadores de la pausa los cambian en caliente, sin recargar la zona.
 */
export function createRefreshClock( { intervalS, minMoveM = MIN_MOVE } ) {

	let lastMs = - Infinity;
	let lastX = Infinity;
	let lastY = Infinity;
	let lastZ = Infinity;

	return {

		intervalS,
		minMoveM,

		due( nowMs, position ) {

			if ( nowMs - lastMs < this.intervalS * 1000 ) return false;

			const dx = position.x - lastX;
			const dy = position.y - lastY;
			const dz = position.z - lastZ;
			if ( dx * dx + dy * dy + dz * dz < this.minMoveM * this.minMoveM ) return false;

			lastMs = nowMs;
			lastX = position.x;
			lastY = position.y;
			lastZ = position.z;
			return true;

		},

	};

}

const _inverse = new Matrix4();
const _local = new Vector3();

/**
 * Lleva las esferas de carga a donde está el dron.
 *
 * Las regiones del `LoadRegionPlugin` viven en el marco del tileset —ECEF, con
 * el planeta entero alrededor del centro de la Tierra—, no en el de la escena:
 * el plugin de reorientación es el que pone la zona elegida en el origen con +Y
 * arriba. Así que hay que deshacer esa transformación para saber a qué punto
 * del planeta corresponde la posición del dron.
 *
 * Mutar el centro basta: el plugin relee las esferas en cada recorrido.
 *
 * Lo que devuelve es el vector de trabajo del módulo, no una copia: sirve para
 * leerlo en el acto y nada más, porque la llamada siguiente lo pisa. Quien
 * necesite guardarlo tiene que clonarlo.
 */
export function recenterRegions( regions, group, position ) {

	_inverse.copy( group.matrixWorld ).invert();
	_local.copy( position ).applyMatrix4( _inverse );

	for ( const region of regions ) region.sphere.center.copy( _local );

	return _local;

}

// Margen entre el mínimo y el máximo de bytes de la caché. El desalojo es
// continuo y apunta al mínimo: salta en cuanto la caché lo supera con algún
// tile sin usar, sin esperar a que toque el máximo. El máximo sólo alimenta
// `isFull()`, que es lo que corta la admisión de tiles nuevos. Sin margen
// los dos límites coincidirían y, como el desalojo va por pasadas y no de
// golpe, la caché se pasaría el vuelo marcándose llena y readmitiendo tile
// a tile.
export const CACHE_HEADROOM = 1.25;

/**
 * Los dos topes de bytes de la caché de tiles que corresponden a la
 * configuración dada.
 *
 * Vive aquí y se exporta porque lo usan dos sitios —el montaje del tileset en
 * `world.js` y cada turno del modo, que relee el deslizador—, y si divergen la
 * caché cambiaría de tamaño sola en el primer turno de vuelo.
 */
export const cacheBytesFor = config => {

	const bytes = config.stream.memoryMb * 1048576;
	return { min: bytes, max: bytes * CACHE_HEADROOM };

};

// Umbral de compactación de la cola de texturas: por debajo de esto, el hueco
// que dejan las texturas ya subidas es pequeño frente al coste del propio
// `splice`, así que no vale la pena tocar el array. Un vuelo normal ni se
// acerca a esta cifra en una sola vida de la cola; sólo importa en exploración
// larga, donde la cola sí pasa por aquí muchas veces.
export const QUEUE_COMPACT_THRESHOLD = 4096;

/**
 * Cola de texturas por subir a la GPU, con techo por frame.
 *
 * Una textura llega a la GPU, por defecto, la primera vez que se dibuja. Con
 * miles de tiles eso es un goteo de micro-tirones durante todo el vuelo, y por
 * eso la precarga las fuerza todas antes de despegar. Aquí no se pueden forzar
 * todas: llegan sin parar. Se fuerzan a plazos, con un techo que no se rebasa
 * aunque queden mil pendientes — y ése es exactamente el punto donde se decide
 * romper la nitidez para no romper la fluidez.
 *
 * Este es el único techo en milisegundos que hay en todo el modo, y sólo cubre
 * esto. La descarga y el parseo del glTF van por las colas del propio tileset
 * (`downloadQueue`, `parseQueue`), que se limitan por trabajos en paralelo y no
 * por tiempo: un parseo gordo cae entero dentro de un frame y `budgetMs` no lo
 * ve. El recorrido del árbol tampoco pasa por aquí —es indivisible, por eso el
 * OSD enseña su coste aparte— ni el desalojo de la caché, que corre en una
 * microtarea cuando el frame ya ha devuelto. Quien crea que este número gobierna
 * el goteo entero interpretará mal el primer tirón que vea.
 *
 * `budgetMs` es público porque es un deslizador de la pausa, y `now` se puede
 * sustituir para poder probar el presupuesto contando en vez de cronometrando.
 */
export function createTextureQueue( { renderer, budgetMs, now = () => performance.now() } ) {

	const pending = [];

	// Cursor en vez de `shift()`: en un vuelo sin final esta lista pasa por
	// decenas de miles de texturas, y sacar por la cabeza mueve el array entero
	// cada vez. Se compacta de tarde en tarde, cuando lo consumido pesa más que
	// lo que queda.
	let head = 0;

	return {

		budgetMs,

		get pending() {

			return pending.length - head;

		},

		/** Apunta las texturas de un modelo recién cargado. */
		enqueue( scene ) {

			// Un tile fotogramétrico parte su geometría en varias mallas que
			// comparten la textura del tile, así que sin deduplicar aquí la misma
			// textura entraría varias veces y `drain()` gastaría presupuesto en
			// volver a subir algo que ya está subido.
			const seen = new Set();

			scene.traverse( child => {

				const material = child.material;
				if ( ! material ) return;

				const list = Array.isArray( material ) ? material : [ material ];
				for ( const m of list ) {

					for ( const key of [ 'map', 'emissiveMap', 'normalMap' ] ) {

						if ( m[ key ] ) seen.add( m[ key ] );

					}

				}

			} );

			for ( const texture of seen ) pending.push( texture );

		},

		/** Sube lo que quepa en el presupuesto. Devuelve cuántas subió. */
		drain() {

			// `initTexture` es una llamada síncrona y no hay forma de cortarla a
			// mitad, así que el presupuesto sólo garantiza que no se EMPIEZA una
			// subida pasado el plazo, no que el turno TERMINE dentro de él. Una
			// textura suelta que tarde, ella sola, más que `budgetMs` entero se
			// sube igual y ese frame se pasa de techo. Es el mismo patrón —y el
			// mismo límite— que ya asume la precarga en `preload.js`.
			const end = now() + this.budgetMs;
			let done = 0;

			while ( head < pending.length && now() < end ) {

				const texture = pending[ head ];
				pending[ head ] = null;
				head ++;

				// La cola guarda referencias fuertes, así que la caché puede haber
				// desalojado el tile mientras su textura esperaba turno —basta con
				// pausar un rato: los modelos siguen llegando y el goteo no corre—.
				// Al desalojar, la librería cierra el `ImageBitmap` y llama a
				// `dispose()`. Subir eso a la GPU no sólo no sirve: three crea una
				// textura nueva cuyo `dispose` ya se disparó y no volverá a
				// dispararse, así que el handle queda huérfano para siempre. Es una
				// fuga de VRAM que ni siquiera sale en los MB del OSD, porque esos
				// son los de la caché. Un bitmap cerrado se delata en que se queda
				// sin ancho ni alto; lo que no sabemos medir se intenta subir como
				// siempre.
				const image = texture && texture.image;
				if ( image && ( image.width === 0 || image.height === 0 ) ) continue;

				try {

					renderer.initTexture( texture );

				} catch ( e ) {

					// Una textura suelta que falle no puede parar el goteo: eso
					// sería quedarse sin cargar nada más el resto del vuelo.

				}

				done ++;

			}

			if ( head > QUEUE_COMPACT_THRESHOLD && head * 2 > pending.length ) {

				pending.splice( 0, head );
				head = 0;

			}

			return done;

		},

	};

}

// Cada cuánto se les da otra oportunidad a los tiles que fallaron. Un corte de
// wifi o un 5xx duran segundos, así que reintentar antes es tirar peticiones
// contra una red que sigue caída; y diez segundos es mucho menos de lo que dura
// la sensación de haberse quedado con un trozo basto delante. Con el freno de
// «sólo si hay fallos nuevos», una red caída de verdad cuesta un reintento cada
// diez segundos y no uno por turno.
export const RETRY_INTERVAL_S = 10;

/**
 * El modo de exploración, montado sobre un tileset ya precargado.
 *
 * Se crea DESPUÉS de la precarga, nunca antes: la cola de texturas sólo tiene
 * que ocuparse de lo que llegue en vuelo, porque lo que ya está cargado lo
 * subió la precarga entera de una vez.
 *
 * Los tres números del modo —intervalo, presupuesto por frame y memoria— se
 * releen en cada turno en vez de copiarse al construir, y por eso sus
 * deslizadores hacen efecto en caliente. El cuarto ajuste, `enabled`, no se lee
 * aquí: quien decide si este módulo existe es `main.js`, y encenderlo o apagarlo
 * obliga a recargar la zona.
 */
export function createStream( { tiles, renderer, regions, config } ) {

	const clock = createRefreshClock( { intervalS: config.stream.interval } );
	const textures = createTextureQueue( { renderer, budgetMs: config.stream.budgetMs } );

	const onModel = ( { scene } ) => textures.enqueue( scene );
	tiles.addEventListener( 'load-model', onModel );

	// En la precarga un error de carga aborta con su diagnóstico —API key,
	// facturación, restricciones de la clave— y ahí está bien, porque no ha
	// pasado nada todavía. En vuelo es inaceptable: un 500 suelto o un corte de
	// wifi de dos segundos no puede echar de la partida. Se cuenta y se sigue;
	// como mucho ese trozo se ve basto.
	let errors = 0;
	let retriedErrors = 0;
	let lastRetryMs = - Infinity;
	const onError = () => {

		errors ++;

	};

	tiles.addEventListener( 'load-error', onError );

	const stats = { traversalMs: 0, textures: 0, bytes: 0, errors: 0 };

	return {

		stats,

		update( nowMs, position ) {

			clock.intervalS = config.stream.interval;
			textures.budgetMs = config.stream.budgetMs;

			// El desalojo no es higiene: cuantos menos tiles vivos, más barato el
			// recorrido del árbol, que es la única parte que no se puede trocear.
			const cache = cacheBytesFor( config );
			tiles.lruCache.minBytesSize = cache.min;
			tiles.lruCache.maxBytesSize = cache.max;

			// Un tile que falla se queda marcado como fallido y nadie vuelve a
			// pedirlo nunca; tampoco lo suelta la caché mientras siga dentro de la
			// esfera de carga. Sin esto, un 5xx o un corte de wifi de dos segundos
			// dejaban una burbuja basta ahí clavada para el resto del vuelo.
			//
			// El reintento se cobra su propio turno de recorrido, y no es un
			// capricho: desmarcar los tiles no pide nada a la red, quien los vuelve
			// a pedir es el recorrido del árbol. Si el corte te pilla parado no
			// habría turno nunca y el reintento no serviría de nada.
			//
			// La primera condición es la que hace que un vuelo limpio no pague por
			// esto: una comparación de enteros por frame y a otra cosa.
			const retry = errors > retriedErrors && nowMs - lastRetryMs >= RETRY_INTERVAL_S * 1000;

			if ( retry ) {

				tiles.resetFailedTiles();
				retriedErrors = errors;
				lastRetryMs = nowMs;

			}

			// El reloj se consulta siempre, también en un turno de reintento: así el
			// reintento gasta el turno que tocaba en vez de encadenar dos recorridos
			// en dos frames seguidos.
			if ( clock.due( nowMs, position ) || retry ) {

				recenterRegions( regions, tiles.group, position );

				const t0 = performance.now();
				tiles.update();
				stats.traversalMs = performance.now() - t0;

			}

			textures.drain();

			stats.textures = textures.pending;
			stats.bytes = tiles.lruCache.cachedBytes;
			stats.errors = errors;

		},

		dispose() {

			tiles.removeEventListener( 'load-model', onModel );
			tiles.removeEventListener( 'load-error', onError );

		},

	};

}
