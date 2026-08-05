import { BoxGeometry, PlaneGeometry, Mesh, MeshBasicMaterial, Group, Color, Float32BufferAttribute, SRGBColorSpace } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** PRNG determinista: la misma ciudad en cada arranque. */
function mulberry32( seed ) {

	return function () {

		seed |= 0;
		seed = seed + 0x6D2B79F5 | 0;
		let t = Math.imul( seed ^ seed >>> 15, 1 | seed );
		t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t;
		return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;

	};

}

/**
 * Ciudad procedural para volar sin API key.
 *
 * Sirve para dos cosas: ajustar rates y mando sin gastar cuota, y comprobar si
 * el equipo aguanta 60 fps estables antes de esperar una descarga larga.
 */
export function createDemoWorld( config, scene ) {

	const group = new Group();
	group.name = 'demo-city';

	const rand = mulberry32( 20260804 );
	const half = config.radius;
	const block = 58;
	const street = 16;

	const geometries = [];
	const color = new Color();

	// Suelo. Se teselan los triángulos para que el voxelizador pueda cubrirlo:
	// un único cuadrilátero de kilómetros dejaría el suelo lleno de agujeros.
	const ground = new PlaneGeometry( half * 6, half * 6, 110, 110 );
	ground.rotateX( - Math.PI / 2 );
	paint( ground, color.setHSL( 0.27, 0.16, 0.20, SRGBColorSpace ) );
	geometries.push( ground );

	for ( let x = - half; x < half; x += block + street ) {

		for ( let z = - half; z < half; z += block + street ) {

			const dist = Math.hypot( x, z );
			if ( dist > half ) continue;

			// Centro más alto, periferia más baja: da referencias visuales.
			const centrality = 1 - dist / half;
			const height = 12 + rand() * 40 + centrality * centrality * 150 * rand();
			const w = block * ( 0.55 + rand() * 0.4 );
			const d = block * ( 0.55 + rand() * 0.4 );

			const box = new BoxGeometry( w, height, d );
			box.translate(
				x + ( rand() - 0.5 ) * 8,
				height / 2,
				z + ( rand() - 0.5 ) * 8,
			);

			// Los colores se dan en sRGB: sin convertir a lineal la ciudad sale lavada.
			const shade = 0.30 + rand() * 0.28;
			paint( box, color.setHSL( 0.07 + rand() * 0.09, 0.05 + rand() * 0.14, shade, SRGBColorSpace ) );
			geometries.push( box );

		}

	}

	const merged = mergeGeometries( geometries, false );
	for ( const g of geometries ) g.dispose();

	const mesh = new Mesh( merged, new MeshBasicMaterial( { vertexColors: true, fog: true } ) );
	mesh.frustumCulled = false;
	group.add( mesh );
	scene.add( group );
	group.updateMatrixWorld( true );

	return {
		group,
		// Interfaz mínima que espera el voxelizador.
		forEachLoadedModel( callback ) {

			callback( group, null );

		},
		dispose() {

			merged.dispose();
			mesh.material.dispose();
			group.removeFromParent();

		},
	};

}

function paint( geometry, color ) {

	const count = geometry.attributes.position.count;
	const colors = new Float32Array( count * 3 );
	for ( let i = 0; i < count; i ++ ) {

		colors[ i * 3 ] = color.r;
		colors[ i * 3 + 1 ] = color.g;
		colors[ i * 3 + 2 ] = color.b;

	}

	geometry.setAttribute( 'color', new Float32BufferAttribute( colors, 3 ) );
	geometry.deleteAttribute( 'uv' );
	geometry.deleteAttribute( 'normal' );

}
