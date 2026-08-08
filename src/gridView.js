import { BoxGeometry, InstancedMesh, MeshBasicMaterial, Matrix4, DynamicDrawUsage } from 'three';

/*
 * Vista de depuración de la rejilla de colisiones.
 *
 * La rejilla que construye `voxels.js` es invisible: cuando el dron rebota donde
 * no hay nada, o atraviesa una pared, no hay forma de mirar contra qué está
 * chocando de verdad. Esto la dibuja.
 *
 * Se dibujan cubos rojos translúcidos y no aristas ni caras opacas: es lo único
 * que deja ver la fachada por debajo, y comparar la rejilla con la geometría es
 * la mitad de para qué sirve la vista. La otra mitad —entender un choque— sale
 * igual de bien.
 */

// Tope de cubos en pantalla. Con 50 m de radio y vóxeles de 2 m la ventana tiene
// 132.651 celdas y salen unos 11.000 cubos sobre la ciudad de demo: sólo la piel
// se dibuja y la ciudad es cáscara. El tope está para que un radio grande o una
// geometría rara no pidan varios MB de matrices por sorpresa.
const MAX_CUBES = 60000;

// Los cubos van encogidos respecto a su celda. Sin esto sus caras quedan
// coplanares con la fachada que representan y aparece z-fighting; con el hueco
// además se ve la textura entre cubo y cubo, que es lo que se viene a mirar.
const SHRINK = 0.9;

const COLOR = 0xff3030;
const OPACITY = 0.35;

/**
 * Ocupación de una celda por índices enteros.
 *
 * Repite la regla de `VoxelGrid.isSolid` —fuera de la zona es aire, bajo el
 * suelo de la rejilla es sólido— pero sin convertir de coordenadas de mundo: la
 * ventana recorre decenas de miles de celdas y ahí la conversión se nota. Que
 * las dos rutas coincidan lo comprueba el test contra `isSolid`.
 */
export function solidAtCell( grid, ix, iy, iz ) {

	if ( ix < 0 || iz < 0 || ix >= grid.nx || iz >= grid.nz ) return false;
	if ( iy < 0 ) return true;
	if ( iy >= grid.ny ) return false;

	const index = iy * grid.strideY + iz * grid.strideZ + ix;
	return ( grid.bits[ index >>> 5 ] & ( 1 << ( index & 31 ) ) ) !== 0;

}

/**
 * Centros de las celdas sólidas con al menos una vecina de aire, dentro de un
 * cubo de lado `2·radius` centrado en `center`. Escribe tripletas x,y,z en `out`
 * y devuelve cuántas escribió; nunca pasa de lo que `out` admite.
 *
 * Se descartan las celdas con las seis vecinas sólidas porque no se ven nunca y
 * en un material translúcido sólo añaden capas. El filtro sale barato: sólo se
 * pregunta por las vecinas de las celdas que ya son sólidas, que en una ciudad
 * fotogramétrica —cascarones, no volúmenes— son una fracción pequeña de la
 * ventana.
 *
 * El coste crece con el cubo del radio, y medido sobre la ciudad de demo son
 * 0,28 ms a 30 m, 0,99 ms a 50 m y 4,0 ms a 80 m. Por eso el radio por defecto
 * es 50: a 80 m una reconstrucción ya no cabe en un frame de 120 Hz, y esto se
 * reconstruye unas diez veces por segundo volando recto.
 */
export function collectSurfaceCells( grid, center, radius, out ) {

	const size = grid.voxelSize;
	const r = Math.max( 1, Math.ceil( radius / size ) );
	const capacity = ( out.length / 3 ) | 0;

	// `Math.floor` y no `| 0`: la ventana se sale por debajo del origen de la
	// rejilla y ahí truncar hacia cero devuelve la celda equivocada.
	const cx = Math.floor( ( center.x - grid.min.x ) / size );
	const cy = Math.floor( ( center.y - grid.min.y ) / size );
	const cz = Math.floor( ( center.z - grid.min.z ) / size );

	let n = 0;

	for ( let iy = cy - r; iy <= cy + r; iy ++ ) {

		for ( let iz = cz - r; iz <= cz + r; iz ++ ) {

			for ( let ix = cx - r; ix <= cx + r; ix ++ ) {

				if ( ! solidAtCell( grid, ix, iy, iz ) ) continue;

				if ( solidAtCell( grid, ix + 1, iy, iz ) && solidAtCell( grid, ix - 1, iy, iz )
					&& solidAtCell( grid, ix, iy + 1, iz ) && solidAtCell( grid, ix, iy - 1, iz )
					&& solidAtCell( grid, ix, iy, iz + 1 ) && solidAtCell( grid, ix, iy, iz - 1 ) ) continue;

				if ( n >= capacity ) return n;

				const o = n * 3;
				out[ o ] = grid.min.x + ( ix + 0.5 ) * size;
				out[ o + 1 ] = grid.min.y + ( iy + 0.5 ) * size;
				out[ o + 2 ] = grid.min.z + ( iz + 0.5 ) * size;
				n ++;

			}

		}

	}

	return n;

}

const _matrix = new Matrix4();

/**
 * La vista en sí. Apagada no existe: no hay malla, ni buffer, ni VRAM ocupada.
 * Encendida se reconstruye sólo cuando el dron cruza de celda —volando recto,
 * unas diez veces por segundo; parado, nunca— y siempre sobre el mismo buffer.
 */
export function createGridView( { grid, scene, config } ) {

	if ( ! grid ) return null;

	const radius = config.gridRadius;
	const period = config.gridRefresh * 1000;
	const side = Math.ceil( radius / grid.voxelSize ) * 2 + 1;
	const capacity = Math.min( MAX_CUBES, side * side * side );

	let mesh = null;
	let cells = null;
	let visible = false;
	let warned = false;

	// Celda ocupada en la última reconstrucción. `NaN` fuerza la primera.
	let lastX = NaN, lastY = NaN, lastZ = NaN;
	let lastBuild = - Infinity;

	function build() {

		cells = new Float32Array( capacity * 3 );

		const size = grid.voxelSize * SHRINK;
		const geometry = new BoxGeometry( size, size, size );
		const material = new MeshBasicMaterial( {
			color: COLOR,
			transparent: true,
			opacity: OPACITY,
			depthWrite: false,   // los cubos no se tapan entre sí: tapizan el espacio
			fog: false,          // una ayuda de depuración no se difumina con la niebla
		} );

		mesh = new InstancedMesh( geometry, material, capacity );
		mesh.instanceMatrix.setUsage( DynamicDrawUsage );
		mesh.frustumCulled = false;   // la caja envolvente cambia en cada reconstrucción
		mesh.renderOrder = 10;
		mesh.count = 0;
		scene.add( mesh );

		lastX = lastY = lastZ = NaN;
		lastBuild = - Infinity;

	}

	function destroy() {

		if ( ! mesh ) return;

		scene.remove( mesh );
		mesh.geometry.dispose();
		mesh.material.dispose();
		mesh.dispose();
		mesh = null;
		cells = null;

	}

	return {

		/**
		 * Reconstruye la ventana, como mucho una vez cada `gridRefresh` y sólo si
		 * el dron ha cambiado de celda.
		 *
		 * Las dos condiciones hacen cosas distintas. La celda evita reconstruir lo
		 * mismo: parado no se toca nada nunca. El reloj limita la frecuencia en
		 * movimiento, que es lo que reparte el coste — aunque no lo reduce: el
		 * frame que reconstruye cuesta igual, sólo llega diez veces menos a menudo.
		 *
		 * Lo que se paga a cambio es que la ventana deja de estar centrada en el
		 * dron entre reconstrucciones: a 20 m/s se descentra 20 m en un segundo, y
		 * lo que se ve por delante encoge de 50 a 30 m antes de dar el salto. Para
		 * mirar contra qué se choca —parado o despacio, que es cuando se usa esto—
		 * no importa; a toda velocidad se nota el salto.
		 */
		update( position ) {

			if ( ! visible ) return;

			const size = grid.voxelSize;
			const ix = Math.floor( ( position.x - grid.min.x ) / size );
			const iy = Math.floor( ( position.y - grid.min.y ) / size );
			const iz = Math.floor( ( position.z - grid.min.z ) / size );

			if ( ix === lastX && iy === lastY && iz === lastZ ) return;

			const now = performance.now();
			if ( now - lastBuild < period ) return;

			lastX = ix; lastY = iy; lastZ = iz;
			lastBuild = now;

			const n = collectSurfaceCells( grid, position, radius, cells );

			for ( let i = 0; i < n; i ++ ) {

				_matrix.makeTranslation( cells[ i * 3 ], cells[ i * 3 + 1 ], cells[ i * 3 + 2 ] );
				mesh.setMatrixAt( i, _matrix );

			}

			mesh.count = n;
			mesh.instanceMatrix.needsUpdate = true;

			if ( n === capacity && ! warned ) {

				warned = true;
				console.warn(
					`[vuela-vuela] la vista de la rejilla llegó al tope de ${ capacity } cubos: `
					+ 'lo que se ve está recortado. Baja `gridRadius` en vuela.config.js.',
				);

			}

		},

		setVisible( on ) {

			if ( on === visible ) return;

			visible = on;
			if ( on ) build();
			else destroy();

		},

		dispose: destroy,

	};

}
