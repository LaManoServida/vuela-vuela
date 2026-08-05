import { Vector3, Box3, Matrix4 } from 'three';

const nextFrame = () => new Promise( r => requestAnimationFrame( r ) );

const MAX_BYTES = 64 * 1024 * 1024;   // techo de memoria de la rejilla
const MAX_SAMPLES_PER_TRI = 64;       // tope de subdivisión por triángulo

/**
 * Rejilla de ocupación en bits.
 *
 * Colisionar contra la malla real requeriría un raycast por frame sobre cientos
 * de miles de triángulos. Voxelizar una vez durante la carga convierte eso en
 * una consulta O(1) de coste constante: exactamente lo que hace falta para que
 * ningún frame se salga del presupuesto.
 */
export class VoxelGrid {

	constructor( min, max, voxelSize ) {

		this.min = min.clone();
		this.voxelSize = voxelSize;
		this.inv = 1 / voxelSize;

		this.nx = Math.max( 1, Math.ceil( ( max.x - min.x ) * this.inv ) );
		this.ny = Math.max( 1, Math.ceil( ( max.y - min.y ) * this.inv ) );
		this.nz = Math.max( 1, Math.ceil( ( max.z - min.z ) * this.inv ) );

		this.max = new Vector3(
			min.x + this.nx * voxelSize,
			min.y + this.ny * voxelSize,
			min.z + this.nz * voxelSize,
		);

		this.strideZ = this.nx;
		this.strideY = this.nx * this.nz;
		this.bits = new Uint32Array( Math.ceil( ( this.nx * this.ny * this.nz ) / 32 ) );
		this.filled = 0;

	}

	get bytes() {

		return this.bits.byteLength;

	}

	markWorld( x, y, z ) {

		const ix = ( x - this.min.x ) * this.inv | 0;
		const iy = ( y - this.min.y ) * this.inv | 0;
		const iz = ( z - this.min.z ) * this.inv | 0;
		if ( ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz ) return;

		const index = iy * this.strideY + iz * this.strideZ + ix;
		const word = index >>> 5;
		const bit = 1 << ( index & 31 );
		if ( ( this.bits[ word ] & bit ) === 0 ) {

			this.bits[ word ] |= bit;
			this.filled ++;

		}

	}

	/** Sólido = hay geometría, o estamos por debajo del suelo de la rejilla. */
	isSolid( x, y, z ) {

		const ix = ( x - this.min.x ) * this.inv | 0;
		const iy = ( y - this.min.y ) * this.inv | 0;
		const iz = ( z - this.min.z ) * this.inv | 0;

		if ( ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz ) return false; // fuera de la zona: aire
		if ( iy < 0 ) return true;                                             // bajo el terreno
		if ( iy >= this.ny ) return false;                                     // por encima de todo

		const index = iy * this.strideY + iz * this.strideZ + ix;
		return ( this.bits[ index >>> 5 ] & ( 1 << ( index & 31 ) ) ) !== 0;

	}

	/** Normal aproximada por gradiente de ocupación en los 6 vecinos. */
	normalAt( x, y, z, target ) {

		const s = this.voxelSize;
		let nx = 0, ny = 0, nz = 0;

		if ( ! this.isSolid( x + s, y, z ) ) nx += 1;
		if ( ! this.isSolid( x - s, y, z ) ) nx -= 1;
		if ( ! this.isSolid( x, y + s, z ) ) ny += 1;
		if ( ! this.isSolid( x, y - s, z ) ) ny -= 1;
		if ( ! this.isSolid( x, y, z + s ) ) nz += 1;
		if ( ! this.isSolid( x, y, z - s ) ) nz -= 1;

		target.set( nx, ny, nz );
		if ( target.lengthSq() === 0 ) target.set( 0, 1, 0 );
		return target.normalize();

	}

}

const _box = new Box3();
const _worldBox = new Box3();
const _mat = new Matrix4();

/**
 * Recorre las mallas que el tileset está DIBUJANDO, no las que tiene cargadas.
 *
 * No es lo mismo: la caché está puesta para no descartar nada (`world.js`), así
 * que cuando un tile se refina sus ancestros siguen en memoria aunque ya no se
 * pinten. Y los ancestros de un tileset planetario son el globo entero resuelto
 * con un par de cientos de triángulos: cajas envolventes de miles de kilómetros
 * que CONTIENEN la zona —así que ningún filtro lateral las descarta— y que
 * arrastraban la altura de la rejilla a la escala del planeta. Con Manhattan
 * cargado eso pedía 12 GB y el navegador respondía `RangeError`.
 *
 * Colisionar contra lo que se ve es además lo correcto: los ancestros son una
 * versión basta del mismo terreno, a decenas de metros de donde está de verdad.
 *
 * `visibleTiles` lo mantiene el TilesRenderer; la ciudad de demo no lo tiene y
 * cae al recorrido normal, que en su caso es exactamente lo que se dibuja.
 */
function forEachDisplayedModel( source, callback ) {

	if ( ! source.visibleTiles ) {

		source.forEachLoadedModel( callback );
		return;

	}

	for ( const tile of source.visibleTiles ) {

		const scene = tile.engineData && tile.engineData.scene;
		if ( scene ) callback( scene, tile );

	}

}

/**
 * Construye la rejilla a partir de la geometría ya cargada. Se trocea en
 * ventanas de unos milisegundos para que la pantalla de carga siga viva.
 */
export async function buildCollisionGrid( { tiles, config, steps, signal } ) {

	steps.begin( 'collision', 'Construyendo la rejilla de colisiones' );

	const half = config.radius * 1.25;

	// Extensión vertical real de lo que hay dentro de la zona jugable: usar el
	// bounding box global metería el telón de fondo de 22 km y desperdiciaría
	// la rejilla entera.
	const meshes = [];
	let minY = Infinity;
	let maxY = - Infinity;

	forEachDisplayedModel( tiles, scene => {

		scene.traverse( child => {

			if ( ! child.isMesh || ! child.geometry ) return;

			const geometry = child.geometry;
			if ( ! geometry.boundingBox ) geometry.computeBoundingBox();
			_worldBox.copy( geometry.boundingBox ).applyMatrix4( child.matrixWorld );

			if ( _worldBox.max.x < - half || _worldBox.min.x > half ) return;
			if ( _worldBox.max.z < - half || _worldBox.min.z > half ) return;

			meshes.push( child );
			minY = Math.min( minY, _worldBox.min.y );
			maxY = Math.max( maxY, _worldBox.max.y );

		} );

	} );

	if ( ! meshes.length ) {

		steps.done( 'collision', 'sin geometría, colisiones desactivadas' );
		return null;

	}

	minY -= 8;
	maxY += 60; // margen para volar por encima de las antenas

	const min = new Vector3( - half, minY, - half );
	const max = new Vector3( half, maxY, half );

	// Ajusta el tamaño de vóxel hasta caber en el presupuesto de memoria. El
	// tope no es orientativo y el bucle no se rinde: con un número fijo de
	// pasos, una extensión bastante mayor de lo previsto agotaba los intentos y
	// la rejilla se construía igual, pidiendo gigabytes que el navegador no da.
	// Vale más una rejilla basta que una pestaña muerta. Termina siempre: las
	// celdas bajan con el cubo del tamaño de vóxel.
	const cellsFor = size =>
		Math.ceil( ( max.x - min.x ) / size ) *
		Math.ceil( ( max.y - min.y ) / size ) *
		Math.ceil( ( max.z - min.z ) / size );

	let voxelSize = config.voxelSize;
	while ( cellsFor( voxelSize ) / 8 > MAX_BYTES ) voxelSize *= 1.25;

	const grid = new VoxelGrid( min, max, voxelSize );

	// Buffer reutilizado para las posiciones transformadas a mundo.
	let world = new Float32Array( 0 );

	for ( let m = 0; m < meshes.length; m ++ ) {

		if ( signal?.aborted ) throw new DOMException( 'Cancelado', 'AbortError' );

		const mesh = meshes[ m ];
		const geometry = mesh.geometry;
		const position = geometry.attributes.position;
		const index = geometry.index;
		const count = position.count;

		if ( world.length < count * 3 ) world = new Float32Array( count * 3 );
		_mat.copy( mesh.matrixWorld );
		transformPositions( position, _mat, world );

		const triCount = index ? index.count / 3 : count / 3;
		let t = 0;

		while ( t < triCount ) {

			const budgetEnd = performance.now() + 8;
			while ( t < triCount && performance.now() < budgetEnd ) {

				const i0 = index ? index.getX( t * 3 ) : t * 3;
				const i1 = index ? index.getX( t * 3 + 1 ) : t * 3 + 1;
				const i2 = index ? index.getX( t * 3 + 2 ) : t * 3 + 2;
				rasterizeTriangle( grid, world, i0, i1, i2, voxelSize );
				t ++;

			}

			steps.progress( ( m + t / triCount ) / meshes.length, `${ m + 1 } / ${ meshes.length } mallas` );
			await nextFrame();

		}

	}

	steps.done(
		'collision',
		`${ voxelSize.toFixed( 2 ) } m · ${ ( grid.filled / 1e6 ).toFixed( 1 ) }M vóxeles · ${ ( grid.bytes / 1048576 ).toFixed( 0 ) } MB`,
	);

	return grid;

}

function transformPositions( attribute, matrix, out ) {

	const e = matrix.elements;
	const count = attribute.count;

	for ( let i = 0; i < count; i ++ ) {

		const x = attribute.getX( i );
		const y = attribute.getY( i );
		const z = attribute.getZ( i );
		const w = 1 / ( e[ 3 ] * x + e[ 7 ] * y + e[ 11 ] * z + e[ 15 ] || 1 );
		const o = i * 3;
		out[ o ] = ( e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z + e[ 12 ] ) * w;
		out[ o + 1 ] = ( e[ 1 ] * x + e[ 5 ] * y + e[ 9 ] * z + e[ 13 ] ) * w;
		out[ o + 2 ] = ( e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z + e[ 14 ] ) * w;

	}

}

/**
 * Muestrea el triángulo con densidad suficiente para no dejar huecos: los
 * triángulos menores que un vóxel se resuelven con sus tres vértices, los
 * grandes se subdividen en baricéntricas.
 */
function rasterizeTriangle( grid, p, i0, i1, i2, voxelSize ) {

	const ax = p[ i0 * 3 ], ay = p[ i0 * 3 + 1 ], az = p[ i0 * 3 + 2 ];
	const bx = p[ i1 * 3 ], by = p[ i1 * 3 + 1 ], bz = p[ i1 * 3 + 2 ];
	const cx = p[ i2 * 3 ], cy = p[ i2 * 3 + 1 ], cz = p[ i2 * 3 + 2 ];

	// Descarte por plano separador: sin esto, un triángulo enorme fuera de la
	// zona (el suelo lejano) se subdividiría entero para no marcar nada.
	const min = grid.min, max = grid.max;
	if ( ( ax < min.x && bx < min.x && cx < min.x ) || ( ax > max.x && bx > max.x && cx > max.x ) ) return;
	if ( ( ay < min.y && by < min.y && cy < min.y ) || ( ay > max.y && by > max.y && cy > max.y ) ) return;
	if ( ( az < min.z && bz < min.z && cz < min.z ) || ( az > max.z && bz > max.z && cz > max.z ) ) return;

	const abx = bx - ax, aby = by - ay, abz = bz - az;
	const acx = cx - ax, acy = cy - ay, acz = cz - az;
	const bcx = cx - bx, bcy = cy - by, bcz = cz - bz;

	const maxEdgeSq = Math.max(
		abx * abx + aby * aby + abz * abz,
		acx * acx + acy * acy + acz * acz,
		bcx * bcx + bcy * bcy + bcz * bcz,
	);

	const n = Math.min(
		MAX_SAMPLES_PER_TRI,
		Math.max( 1, Math.ceil( Math.sqrt( maxEdgeSq ) / ( voxelSize * 0.6 ) ) ),
	);

	if ( n === 1 ) {

		grid.markWorld( ax, ay, az );
		grid.markWorld( bx, by, bz );
		grid.markWorld( cx, cy, cz );
		return;

	}

	const inv = 1 / n;
	for ( let i = 0; i <= n; i ++ ) {

		const u = i * inv;
		for ( let j = 0; j <= n - i; j ++ ) {

			const v = j * inv;
			grid.markWorld(
				ax + abx * u + acx * v,
				ay + aby * u + acy * v,
				az + abz * u + acz * v,
			);

		}

	}

}
