import { Raycaster, MathUtils } from 'three';

import { config, quadOptions } from './config.js';
import { createRenderer, createScene, createTiles, resize, fogDensityFor } from './world.js';
import { preloadRegion, sampleGround } from './preload.js';
import { buildCollisionGrid } from './voxels.js';
import { createGridView } from './gridView.js';
import { createDemoWorld } from './demoWorld.js';
import { Quad } from './flight/quad.js';
import { InputManager } from './input.js';
import { Hud } from './hud.js';
import { buildMenu, buildPauseSettings } from './menu.js';
import { buildGamepadPanel } from './gamepadPanel.js';

const dom = {
	canvas: document.getElementById( 'viewport' ),
	menu: document.getElementById( 'menu' ),
	menuBody: document.getElementById( 'menu-body' ),
	menuNote: document.getElementById( 'menu-note' ),
	btnFly: document.getElementById( 'btn-fly' ),
	btnDemo: document.getElementById( 'btn-demo' ),
	loading: document.getElementById( 'loading' ),
	loadTitle: document.getElementById( 'load-title' ),
	loadBar: document.getElementById( 'load-bar' ),
	loadDetail: document.getElementById( 'load-detail' ),
	loadSteps: document.getElementById( 'load-steps' ),
	btnCancel: document.getElementById( 'btn-cancel' ),
	pause: document.getElementById( 'pause' ),
	pauseNote: document.getElementById( 'pause-note' ),
	pauseGamepad: document.getElementById( 'pause-gamepad' ),
	pauseSettings: document.getElementById( 'pause-settings' ),
	btnResume: document.getElementById( 'btn-resume' ),
	btnRespawn: document.getElementById( 'btn-respawn' ),
	btnMenu: document.getElementById( 'btn-menu' ),
	attribution: document.getElementById( 'attribution' ),
};

const input = new InputManager( config );
const hud = new Hud();
const raycaster = new Raycaster();

let world = null;          // { renderer, scene, camera, sky, tiles, grid }
let drone = null;
let phase = 'menu';        // 'menu' | 'loading' | 'flying' | 'paused'
let abortController = null;
let rafId = 0;
let lastTime = 0;
let pauseGamepad = null;   // panel de mapeo montado en la pausa

// ---------------------------------------------------------------------------
// Pantalla de carga
// ---------------------------------------------------------------------------

const STEP_LABELS = {
	root: 'Sesión y tileset raíz',
	tiles: 'Descarga de geometría',
	textures: 'Texturas a la GPU',
	shaders: 'Shaders y calentamiento',
	collision: 'Rejilla de colisiones',
	spawn: 'Punto de aparición',
};

const steps = {

	order: [],
	current: null,
	results: {},

	init( ids ) {

		this.order = ids;
		this.current = null;
		this.results = {};
		this.render();

	},

	begin( id, title ) {

		this.current = id;
		dom.loadTitle.textContent = title;
		dom.loadDetail.textContent = '';
		dom.loadBar.style.width = '0%';
		this.render();

	},

	progress( fraction, detail = '' ) {

		dom.loadBar.style.width = `${ Math.round( MathUtils.clamp( fraction, 0, 1 ) * 100 ) }%`;
		if ( detail ) dom.loadDetail.textContent = detail;

	},

	done( id, detail = '' ) {

		this.results[ id ] = detail || true;
		dom.loadBar.style.width = '100%';
		this.render();

	},

	render() {

		dom.loadSteps.replaceChildren( ...this.order.map( id => {

			const li = document.createElement( 'li' );
			const detail = this.results[ id ];
			li.className = detail ? 'done' : id === this.current ? 'active' : 'todo';
			li.textContent = STEP_LABELS[ id ] + ( typeof detail === 'string' && detail ? ` — ${ detail }` : '' );
			return li;

		} ) );

	},

};

// ---------------------------------------------------------------------------
// Ciclo de vida del mundo
// ---------------------------------------------------------------------------

function freshCanvas() {

	// Un contexto WebGL no se puede recrear sobre el mismo canvas, así que cada
	// carga estrena elemento. También garantiza que no arrastramos VRAM.
	const old = dom.canvas;
	const canvas = document.createElement( 'canvas' );
	canvas.id = 'viewport';
	old.replaceWith( canvas );
	dom.canvas = canvas;
	return canvas;

}

function teardownWorld() {

	if ( ! world ) return;

	try {

		world.gridView?.dispose();
		world.tiles?.dispose();
		world.demo?.dispose();
		world.renderer.dispose();
		world.renderer.forceContextLoss?.();

	} catch ( e ) {

		console.warn( 'Error liberando el mundo anterior', e );

	}

	world = null;

}

async function loadAndFly( { demo = false } = {} ) {

	if ( ! demo && ! config.apiKey ) {

		dom.menuNote.textContent = 'Falta la API key de Google Maps Platform. Si sólo quieres probar los mandos y los fps, usa "Volar en la ciudad de prueba".';
		return;

	}

	phase = 'loading';
	dom.menu.hidden = true;
	dom.loading.hidden = false;
	hud.hide();
	dom.attribution.replaceChildren();

	abortController = new AbortController();
	const signal = abortController.signal;

	// La vista de depuración dibuja la rejilla, así que también la necesita: sin
	// esto, arrancar con las colisiones apagadas dejaría la casilla «Ver la
	// rejilla» encendida y sin nada que enseñar.
	const needsGrid = config.collisions || config.showGrid;

	const usedSteps = demo ? [] : [ 'root', 'tiles', 'textures', 'shaders' ];
	if ( needsGrid ) usedSteps.push( 'collision' );
	usedSteps.push( 'spawn' );
	steps.init( usedSteps );

	teardownWorld();

	try {

		const canvas = freshCanvas();
		const renderer = createRenderer( canvas, config );
		const { scene, camera, sky } = createScene( config );

		let tiles = null;
		let source;
		let stats = null;

		if ( demo ) {

			source = createDemoWorld( config, scene );
			world = { renderer, scene, camera, sky, tiles: null, demo: source, grid: null, gridView: null };
			resize( renderer, camera, null, config );
			await renderer.compileAsync( source.group, camera, scene );

		} else {

			tiles = createTiles( config, scene, camera, renderer ).tiles;
			source = tiles;
			world = { renderer, scene, camera, sky, tiles, demo: null, grid: null, gridView: null };
			resize( renderer, camera, tiles, config );
			stats = await preloadRegion( { tiles, renderer, scene, camera, config, steps, signal } );

		}

		if ( needsGrid ) {

			world.grid = await buildCollisionGrid( { tiles: source, config, steps, signal } );
			world.gridView = createGridView( { grid: world.grid, scene, config } );
			world.gridView?.setVisible( config.showGrid );

		}

		steps.begin( 'spawn', 'Buscando el suelo' );
		const groundY = findGroundHeight( tiles, world.grid );
		steps.done( 'spawn', `terreno a ${ groundY.toFixed( 0 ) } m` );

		// `config.flight` va sin clonar a propósito: el dron y el menú de pausa
		// comparten ese objeto, y por eso tocar un PID en pausa se nota al
		// instante. Lo demás —colisión, batería, respuesta al choque— sale del
		// fichero por `quadOptions()`.
		drone = new Quad( config.flight, quadOptions() );
		drone.grid = world.grid;
		drone.setSpawn( 0, groundY + config.spawnHeight, 0, 0 );

		if ( tiles ) renderAttribution( tiles );
		else dom.attribution.textContent = 'Ciudad de prueba · sin datos de Google';

		dom.loading.hidden = true;
		startFlying();

		console.info( '[vuela-vuela] zona lista', {
			...stats,
			modo: demo ? 'demo' : 'google',
			profundidad: renderer.depthMode,
			colisiones: world.grid ? `${ world.grid.voxelSize.toFixed( 2 ) } m` : 'off',
			aparato: config.flight.name,
			empujePeso: `${ drone.thrustToWeight.toFixed( 2 ) }:1`,
			gasSustentacion: `${ ( drone.hoverThrottle * 100 ).toFixed( 0 ) } %`,
		} );

	} catch ( error ) {

		if ( error?.name === 'AbortError' ) {

			teardownWorld();
			backToMenu();
			return;

		}

		console.error( error );
		dom.loading.hidden = true;
		dom.menu.hidden = false;
		dom.menuNote.textContent = error.message || String( error );
		phase = 'menu';

	} finally {

		abortController = null;

	}

}

function findGroundHeight( tiles, grid ) {

	if ( ! tiles && ! grid ) return 0;

	// Con rejilla: el vóxel sólido más alto bajo el origen — coherente con lo
	// que luego usará la colisión. Sin rejilla: un raycast puntual.
	if ( grid ) {

		for ( let iy = grid.ny - 1; iy >= 0; iy -- ) {

			const y = grid.min.y + ( iy + 0.5 ) * grid.voxelSize;
			if ( grid.isSolid( 0, y, 0 ) ) return y;

		}

	}

	if ( ! tiles ) return 0;
	const hit = sampleGround( tiles, raycaster, 0, 0 );
	return hit === null ? 0 : hit;

}

function renderAttribution( tiles ) {

	const parts = tiles.getAttributions( [] );
	dom.attribution.replaceChildren();

	for ( const part of parts ) {

		if ( part.type === 'image' && part.value ) {

			const img = document.createElement( 'img' );
			img.src = part.value;
			img.alt = 'Google';
			dom.attribution.appendChild( img );

		} else if ( part.value ) {

			const span = document.createElement( 'span' );
			span.textContent = part.value;
			dom.attribution.appendChild( span );

		}

	}

	if ( ! dom.attribution.childNodes.length ) {

		dom.attribution.textContent = 'Google';

	}

}

// ---------------------------------------------------------------------------
// Vuelo
// ---------------------------------------------------------------------------

function startFlying() {

	// Sin mando no se despega. La zona ya cargada NO se tira: se espera en
	// pausa, que es donde se puede mapear el mando sin perder la descarga.
	if ( ! input.hasControl ) {

		phase = 'paused';
		cancelAnimationFrame( rafId );
		hud.hide();
		openPause();
		return;

	}

	phase = 'flying';
	closePause();
	hud.show();
	hud.skipFrames( 12 );

	// El menú o la pausa pueden dejar un `Esc` pendiente —tocado por reflejo,
	// por ejemplo al intentar despausar—; sin vaciarlo se dispara solo en el
	// primer frame de vuelo. Ver `InputManager.resetKeys`.
	input.resetKeys();

	lastTime = performance.now();
	cancelAnimationFrame( rafId );
	rafId = requestAnimationFrame( frame );

}

function pauseFlight() {

	if ( phase !== 'flying' ) return;

	phase = 'paused';
	cancelAnimationFrame( rafId );
	hud.hide();
	openPause();

}

/**
 * Monta la pantalla de pausa. El panel de mando va aquí y no sólo en el menú
 * principal a propósito: llegar al menú desde el vuelo es «Cambiar de zona», que
 * descarga el mundo, y quedarse sin mando no puede costar una descarga entera.
 */
function openPause() {

	dom.pause.hidden = false;
	buildPauseSettings( dom.pauseSettings, config, onLiveSettingChange );

	pauseGamepad?.dispose();
	pauseGamepad = buildGamepadPanel( dom.pauseGamepad, config, input, { onChange: refreshResume } );

	refreshResume();

}

function closePause() {

	dom.pause.hidden = true;
	pauseGamepad?.dispose();
	pauseGamepad = null;

}

/** Reanudar sólo está disponible si hay con qué pilotar. */
function refreshResume() {

	const ready = input.hasControl;

	dom.btnResume.disabled = ! ready;
	dom.btnRespawn.disabled = ! ready;
	dom.pauseNote.textContent = ready
		? 'La zona ya está cargada en memoria: reanudar es instantáneo. Esc también reanuda.'
		: 'Sin mando no se vuela. Conéctalo y mapea los cuatro ejes aquí abajo; la zona sigue cargada.';

}

function backToMenu() {

	phase = 'menu';
	cancelAnimationFrame( rafId );
	hud.hide();
	closePause();
	dom.loading.hidden = true;
	dom.menu.hidden = false;
	dom.menuNote.textContent = '';

}

function frame( now ) {

	rafId = requestAnimationFrame( frame );

	const frameMs = now - lastTime;
	lastTime = now;

	const { renderer, scene, camera, sky, tiles } = world;
	const controls = input.update();

	// Reaparecer no se pide: el choque desarma los motores, se ve el volteo
	// durante `respawnDelay` segundos y el dron vuelve solo al punto de
	// aparición. El reloj lo lleva el propio dron, en tiempo de simulación.
	if ( drone.crashed && drone.crashTime >= config.respawnDelay ) {

		drone.respawn();
		hud.skipFrames( 4 );

	}

	if ( input.consumeKey( 'Escape' ) ) {

		pauseFlight();
		return;

	}

	drone.update( frameMs / 1000, controls );
	drone.applyToCamera( camera, config.camTilt );

	// Apagada sale por la primera línea; encendida reconstruye como mucho una vez
	// por segundo. Va después de mover el dron para que la ventana no vaya un frame por detrás.
	world.gridView?.update( drone.position );

	// La cúpula del cielo viaja con la cámara: siempre a distancia infinita.
	sky.position.copy( camera.position );

	renderer.render( scene, camera );

	hud.update( frameMs, drone, controls, config );

}

// ---------------------------------------------------------------------------
// Ajustes en caliente
// ---------------------------------------------------------------------------

function onLiveSettingChange( key ) {

	if ( ! world ) return;

	if ( key === 'fov' ) {

		world.camera.fov = config.fov;
		world.camera.updateProjectionMatrix();

	}

	if ( key === 'renderScale' ) {

		resize( world.renderer, world.camera, world.tiles, config );

	}

	if ( key === 'fogDensity' && world.scene.fog ) {

		world.scene.fog.density = fogDensityFor( config );

	}

	if ( key === 'collisions' ) {

		drone.options.collisions = config.collisions;
		drone.grid = config.collisions ? world.grid : null;

	}

	// La vista de la rejilla es independiente de que la colisión esté activa:
	// enseña contra qué se chocaría, y eso se quiere ver también volando a través.
	// Lo que no puede es enseñar una rejilla que no se construyó al cargar.
	if ( key === 'showGrid' ) {

		if ( world.gridView ) world.gridView.setVisible( config.showGrid );
		else if ( config.showGrid ) console.warn(
			'[vuela-vuela] no hay rejilla que dibujar: esta zona se cargó con las '
			+ 'colisiones apagadas. Vuelve a cargarla con «Ver la rejilla» ya marcada.',
		);

	}

	// `crashSpeed` y la respuesta al choque no tienen control en el menú: se
	// editan en el fichero y se leen al construir el dron.
	if ( key === 'battery' ) drone.options.battery = config.battery;

	// El bloque `flight.bf` (PID, rates, modo, filtros) lo lee el controlador en
	// cada paso, así que esos cambios ya están aplicados. El hardware —masa,
	// hélice, motor, batería— se derivó al construir el aparato y hay que rehacerlo.
	if ( key === 'hardware' ) drone.refresh();

}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function estimateText() {

	// Índice relativo de trabajo: área × densidad de detalle.
	const index = Math.pow( config.radius / 1000, 2 ) * Math.pow( 16 / config.quality, 2 );

	let label;
	if ( index < 0.6 ) label = 'carga rápida (menos de un minuto)';
	else if ( index < 2 ) label = 'carga moderada (1–3 min la primera vez)';
	else if ( index < 6 ) label = 'carga larga (3–8 min) y bastante RAM/VRAM';
	else label = 'carga muy larga y riesgo de quedarse sin memoria';

	return `Zona de ${ ( config.radius * 2 / 1000 ).toFixed( 1 ) } km de diámetro a máximo detalle · ${ label }. Las recargas posteriores de la misma zona salen de la caché local y son mucho más rápidas.`;

}

function setupMenu() {

	// No hay `onChange` de persistencia: la configuración vive en
	// `vuela.config.js` y el menú sólo edita la copia en memoria.
	buildMenu( dom.menuBody, config, { onEstimate: estimateText } );

	const gamepadHost = document.createElement( 'div' );
	dom.menuBody.appendChild( gamepadHost );
	buildGamepadPanel( gamepadHost, config, input );

}

function registerServiceWorker() {

	if ( ! ( 'serviceWorker' in navigator ) ) return;

	navigator.serviceWorker.register( '/sw.js' )
		.catch( err => console.warn( 'Sin caché de tiles:', err ) );

	navigator.storage?.persist?.().catch( () => {} );

}

function init() {

	// Consola: window.vv.drone / vv.world / vv.config para afinar en caliente.
	window.vv = {
		get drone() { return drone; },
		get world() { return world; },
		get phase() { return phase; },
		config,
	};

	registerServiceWorker();
	input.attach();
	setupMenu();

	dom.btnFly.addEventListener( 'click', () => loadAndFly( { demo: false } ) );
	dom.btnDemo.addEventListener( 'click', () => loadAndFly( { demo: true } ) );
	dom.btnCancel.addEventListener( 'click', () => abortController?.abort() );
	dom.btnResume.addEventListener( 'click', startFlying );
	dom.btnRespawn.addEventListener( 'click', () => {

		drone.respawn();
		startFlying();

	} );
	dom.btnMenu.addEventListener( 'click', () => {

		teardownWorld();
		backToMenu();

	} );

	// `Esc` en la pausa reanuda. Va como oyente suelto y no por `consumeKey()`
	// porque en pausa el bucle de vuelo está parado y nadie llama a
	// `input.update()`: la tecla se quedaría encolada hasta el siguiente vuelo.
	//
	// Tiene que registrarse DESPUÉS de `input.attach()` —los oyentes de un mismo
	// evento corren en orden de registro—: así el `resetKeys()` de
	// `startFlying()` borra esta misma pulsación, y no queda pendiente para el
	// primer frame de vuelo, que volvería a pausar al instante.
	window.addEventListener( 'keydown', e => {

		if ( e.code !== 'Escape' || phase !== 'paused' ) return;

		// Sin mando no se reanuda, igual que el botón «Reanudar» está apagado.
		if ( ! input.hasControl ) return;

		startFlying();

	} );

	window.addEventListener( 'resize', () => {

		if ( world ) resize( world.renderer, world.camera, world.tiles, config );

	} );

	document.addEventListener( 'visibilitychange', () => {

		if ( document.hidden ) pauseFlight();

	} );

	window.addEventListener( 'gamepadconnected', () => {

		if ( phase === 'paused' ) refreshResume();

	} );

	// Quedarse sin mando en vuelo es quedarse sin control: se pausa, igual que
	// al perder el foco de la pestaña.
	window.addEventListener( 'gamepaddisconnected', () => {

		if ( phase === 'flying' ) pauseFlight();
		else if ( phase === 'paused' ) refreshResume();

	} );

}

init();
