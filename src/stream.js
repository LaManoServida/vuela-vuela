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
 */
export function recenterRegions( regions, group, position ) {

	_inverse.copy( group.matrixWorld ).invert();
	_local.copy( position ).applyMatrix4( _inverse );

	for ( const region of regions ) region.sphere.center.copy( _local );

	return _local;

}

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

			scene.traverse( child => {

				const material = child.material;
				if ( ! material ) return;

				const list = Array.isArray( material ) ? material : [ material ];
				for ( const m of list ) {

					for ( const key of [ 'map', 'emissiveMap', 'normalMap' ] ) {

						if ( m[ key ] ) pending.push( m[ key ] );

					}

				}

			} );

		},

		/** Sube lo que quepa en el presupuesto. Devuelve cuántas subió. */
		drain() {

			const end = now() + this.budgetMs;
			let done = 0;

			while ( head < pending.length && now() < end ) {

				try {

					renderer.initTexture( pending[ head ] );

				} catch ( e ) {

					// Una textura suelta que falle no puede parar el goteo: eso
					// sería quedarse sin cargar nada más el resto del vuelo.

				}

				pending[ head ] = null;
				head ++;
				done ++;

			}

			if ( head > 4096 && head * 2 > pending.length ) {

				pending.splice( 0, head );
				head = 0;

			}

			return done;

		},

	};

}
