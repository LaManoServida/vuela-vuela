import {
	Scene, PerspectiveCamera, WebGLRenderer, FogExp2, Color, Vector3, Sphere,
	MeshBasicMaterial, MeshStandardMaterial, BackSide, ShaderMaterial, SphereGeometry, Mesh,
	HemisphereLight, DirectionalLight, MathUtils, NoToneMapping, ACESFilmicToneMapping,
} from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import {
	GoogleCloudAuthPlugin,
	TileCompressionPlugin,
	ReorientationPlugin,
	LoadRegionPlugin,
	SphereRegion,
} from '3d-tiles-renderer/plugins';

export const NEAR = 0.15;
export const FAR = 40000;

// Radio del "telón de fondo": geometría muy basta para que el horizonte no
// sea un vacío. Cuesta poquísimos tiles.
const BACKDROP_RADIUS = 22000;
const BACKDROP_ERROR = 900;
const MID_ERROR = 90;

// Escala física de la niebla exponencial: con `fogDensity` a 1.0 la mitad del
// contraste se ha ido hacia los 7 km, que es lo que se ve en un día claro de
// ciudad. Vive aquí y se exporta porque la usan dos sitios —la creación de la
// escena y el deslizador de niebla en caliente— y si divergen, la niebla pega
// un salto en cuanto tocas el control.
const BASE_FOG_DENSITY = 0.00012;

/** Densidad de niebla que corresponde a la configuración dada. */
export const fogDensityFor = config => BASE_FOG_DENSITY * config.fogDensity;

const SKY_TOP = new Color( 0x2a6fb5 );
const SKY_HORIZON = new Color( 0xbcd4e6 );
const FOG_COLOR = new Color( 0xb4cbdd );

function supportsReversedDepth() {

	try {

		const gl = document.createElement( 'canvas' ).getContext( 'webgl2' );
		const ok = !! gl && !! gl.getExtension( 'EXT_clip_control' );
		gl?.getExtension( 'WEBGL_lose_context' )?.loseContext();
		return ok;

	} catch ( e ) {

		return false;

	}

}

export function createRenderer( canvas, config ) {

	const reversed = supportsReversedDepth();

	const renderer = new WebGLRenderer( {
		canvas,
		antialias: config.antialias,
		powerPreference: 'high-performance',
		// Profundidad invertida: precisión excelente de 0.15 m a 40 km sin el
		// coste en vértices del depth logarítmico. Si no hay EXT_clip_control
		// caemos al logarítmico.
		reversedDepthBuffer: reversed,
		logarithmicDepthBuffer: ! reversed,
		stencil: false,
		depth: true,
	} );

	renderer.setPixelRatio( 1 );
	renderer.toneMapping = config.unlit ? NoToneMapping : ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;
	renderer.shadowMap.enabled = false;
	renderer.info.autoReset = true;
	renderer.depthMode = reversed ? 'reversed' : 'logarithmic';

	return renderer;

}

function createSky() {

	// El cielo se resuelve por profundidad, no por orden de dibujado: three
	// invierte la lista opaca entera cuando el depth buffer está invertido, con
	// lo que un `renderOrder` negativo acabaría pintándose el último y taparía
	// la escena. Con depthTest activo y la cúpula casi en el plano lejano da
	// igual cuándo se dibuje.
	const material = new ShaderMaterial( {
		side: BackSide,
		depthWrite: false,
		depthTest: true,
		fog: false,
		uniforms: {
			topColor: { value: SKY_TOP },
			horizonColor: { value: SKY_HORIZON },
			sunDir: { value: new Vector3( 0.42, 0.68, 0.6 ).normalize() },
		},
		vertexShader: /* glsl */`
			varying vec3 vDir;
			void main() {
				vDir = normalize( position );
				vec4 mv = modelViewMatrix * vec4( position, 1.0 );
				gl_Position = projectionMatrix * mv;
			}
		`,
		fragmentShader: /* glsl */`
			uniform vec3 topColor;
			uniform vec3 horizonColor;
			uniform vec3 sunDir;
			varying vec3 vDir;
			void main() {
				vec3 d = normalize( vDir );
				float h = clamp( d.y * 0.5 + 0.5, 0.0, 1.0 );
				float t = pow( clamp( d.y, 0.0, 1.0 ), 0.55 );
				vec3 col = mix( horizonColor, topColor, t );
				// Halo solar suave, sin deslumbrar.
				float sun = pow( max( dot( d, normalize( sunDir ) ), 0.0 ), 220.0 );
				float glow = pow( max( dot( d, normalize( sunDir ) ), 0.0 ), 6.0 ) * 0.16;
				col += vec3( 1.0, 0.94, 0.82 ) * ( sun * 0.9 + glow );
				// Bruma justo bajo el horizonte para fundir con el borde de los tiles.
				col = mix( col, horizonColor * 0.92, smoothstep( 0.5, 0.44, h ) );
				gl_FragColor = vec4( col, 1.0 );
			}
		`,
	} );

	const sky = new Mesh( new SphereGeometry( 1, 32, 16 ), material );
	sky.frustumCulled = false;
	sky.scale.setScalar( FAR * 0.95 );
	return sky;

}

export function createScene( config ) {

	const scene = new Scene();
	scene.fog = new FogExp2( FOG_COLOR.getHex(), fogDensityFor( config ) );
	scene.background = null;

	const sky = createSky();
	scene.add( sky );

	// Las luces las pone `applyUnlit()`, que también sabe quitarlas en caliente.

	const camera = new PerspectiveCamera( config.fov, 1, NEAR, FAR );
	camera.rotation.order = 'YXZ';
	scene.add( camera );

	return { scene, camera, sky };

}

/**
 * Crea el TilesRenderer apuntando a la zona pedida.
 *
 * Detalle clave: LoadRegionPlugin hace que el error geométrico dependa de una
 * *región*, no de la cámara. Con ello los tiles del radio elegido se cargan y
 * se marcan visibles mires donde mires, así que una vez terminada la precarga
 * el conjunto visible ya no cambia y podemos congelar el traversal durante el
 * vuelo — que es de donde vienen los tirones.
 */
export function createTiles( config, scene, camera, renderer ) {

	const tiles = new TilesRenderer();

	tiles.registerPlugin( new GoogleCloudAuthPlugin( {
		apiToken: config.apiKey,
		autoRefreshToken: true,
	} ) );

	// Comprime atributos a tipos pequeños: menos VRAM, menos ancho de banda al GPU.
	tiles.registerPlugin( new TileCompressionPlugin( {
		generateNormals: false,
		compressIndex: true,
		compressNormals: true,
		compressUvs: true,
		compressPosition: false,
	} ) );

	// Coloca la zona en el origen con +Y arriba, +Z al norte y +X al oeste.
	tiles.registerPlugin( new ReorientationPlugin( {
		lat: MathUtils.degToRad( config.lat ),
		lon: MathUtils.degToRad( config.lon ),
		height: 0,
		recenter: true,
	} ) );

	// Regiones de carga (coordenadas ECEF, el marco local del tileset).
	const center = new Vector3();
	tiles.ellipsoid.getCartographicToPosition(
		MathUtils.degToRad( config.lat ),
		MathUtils.degToRad( config.lon ),
		0,
		center,
	);

	const regions = {
		inner: new SphereRegion( {
			sphere: new Sphere( center, config.radius ),
			errorTarget: config.quality,
		} ),
		mid: new SphereRegion( {
			sphere: new Sphere( center, config.radius * 2.6 ),
			errorTarget: MID_ERROR,
		} ),
		backdrop: new SphereRegion( {
			sphere: new Sphere( center, BACKDROP_RADIUS ),
			errorTarget: BACKDROP_ERROR,
			mask: true, // nada fuera de este radio se descarga jamás
		} ),
	};

	tiles.registerPlugin( new LoadRegionPlugin( {
		regions: [ regions.inner, regions.mid, regions.backdrop ],
	} ) );

	tiles.errorTarget = config.quality;

	// Que three haga el culling por objeto: cuando congelemos el traversal el
	// TilesRenderer deja de ocultar lo que queda fuera de cámara, y sin esto
	// dibujaríamos la zona entera cada frame.
	tiles.autoDisableRendererCulling = false;

	// Nada se descarga: la zona cabe en memoria y la queremos entera.
	tiles.lruCache.minSize = 100000;
	tiles.lruCache.maxSize = 120000;
	tiles.lruCache.minBytesSize = Infinity;
	tiles.lruCache.maxBytesSize = Infinity;

	tiles.setCamera( camera );
	tiles.setResolutionFromRenderer( camera, renderer );
	scene.add( tiles.group );

	applyUnlit( { tiles, scene, renderer, config } );

	return { tiles, regions, center };

}

/**
 * Los tiles fotogramétricos ya llevan la iluminación horneada en la textura.
 * Cambiar a MeshBasicMaterial da el aspecto exacto de Google Earth, elimina
 * variantes de shader (una sola compilación) y quita trabajo por píxel.
 */
function toBasic( material ) {

	return new MeshBasicMaterial( {
		map: material.map || null,
		color: material.color ? material.color.clone() : new Color( 0xffffff ),
		vertexColors: material.vertexColors,
		transparent: material.transparent,
		alphaTest: material.alphaTest,
		side: material.side,
		fog: true,
	} );

}

function toLit( material ) {

	return new MeshStandardMaterial( {
		map: material.map || null,
		color: material.color ? material.color.clone() : new Color( 0xffffff ),
		vertexColors: material.vertexColors,
		transparent: material.transparent,
		alphaTest: material.alphaTest,
		side: material.side,
		roughness: 1,
		metalness: 0,
		fog: true,
	} );

}

function convertLoaded( source, hacia ) {

	const convertir = scene => scene.traverse( child => {

		const material = child.material;
		if ( ! material ) return;
		if ( hacia === 'basic' && material.isMeshBasicMaterial ) return;
		if ( hacia === 'lit' && ! material.isMeshBasicMaterial ) return;

		child.material = hacia === 'basic' ? toBasic( material ) : toLit( material );
		material.dispose();

	} );

	if ( source.forEachLoadedModel ) source.forEachLoadedModel( convertir );
	else if ( source.group ) convertir( source.group );

}

/**
 * Materiales planos, encendible y apagable en caliente.
 *
 * Los tiles fotogramétricos ya llevan la iluminación horneada en la textura.
 * `MeshBasicMaterial` da el aspecto exacto de Google Earth, elimina variantes de
 * shader (una sola compilación) y quita trabajo por píxel.
 *
 * Se puede cambiar sin recargar porque no hace falta pedirle nada a Google: la
 * geometría y las texturas ya están en memoria, y esto sólo decide con qué
 * shader se pintan. Convierte lo que ya está cargado, deja enganchada la
 * conversión para lo que llegue después, enciende o apaga las luces y ajusta el
 * mapeo de tonos.
 */
export function applyUnlit( { tiles, scene, renderer, config } ) {

	const unlit = config.unlit;

	if ( renderer ) renderer.toneMapping = unlit ? NoToneMapping : ACESFilmicToneMapping;

	// Luces: sólo hacen falta cuando los materiales responden a ellas.
	const existentes = scene.children.filter( o => o.isHemisphereLight || o.isDirectionalLight );

	if ( unlit ) {

		for ( const luz of existentes ) scene.remove( luz );

	} else if ( existentes.length === 0 ) {

		const hemi = new HemisphereLight( 0xcfe4ff, 0x50504a, 2.2 );
		scene.add( hemi );
		const sun = new DirectionalLight( 0xfff2df, 2.4 );
		sun.position.set( 0.42, 0.68, 0.6 ).multiplyScalar( 1000 );
		scene.add( sun );

	}

	if ( ! tiles ) return;

	// Lo que llegue después. El oyente se guarda en el propio tileset para poder
	// quitarlo: dejar dos enganchados convertiría de ida y vuelta cada tile.
	if ( tiles._vvUnlit ) {

		tiles.removeEventListener( 'load-model', tiles._vvUnlit );
		tiles._vvUnlit = null;

	}

	if ( unlit ) {

		tiles._vvUnlit = ( { scene: cargado } ) => cargado.traverse( child => {

			const material = child.material;
			if ( ! material || material.isMeshBasicMaterial ) return;
			child.material = toBasic( material );
			material.dispose();

		} );
		tiles.addEventListener( 'load-model', tiles._vvUnlit );

	}

	convertLoaded( tiles, unlit ? 'basic' : 'lit' );

}

export function resize( renderer, camera, tiles, config ) {

	const w = Math.max( 1, Math.floor( window.innerWidth * config.renderScale ) );
	const h = Math.max( 1, Math.floor( window.innerHeight * config.renderScale ) );

	renderer.setSize( w, h, false );
	renderer.domElement.style.width = '100%';
	renderer.domElement.style.height = '100%';

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	if ( tiles ) tiles.setResolutionFromRenderer( camera, renderer );

}
