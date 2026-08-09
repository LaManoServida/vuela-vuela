import { Raycaster, MathUtils } from 'three';

import { config, quadOptions } from './config.js';
import { createRenderer, createScene, createTiles, resize, fogDensityFor, applyUnlit } from './world.js';
import { preloadRegion, sampleGround } from './preload.js';
import { buildCollisionGrid, effectiveVoxelSize } from './voxels.js';
import { createGridView } from './gridView.js';
import { createDemoWorld } from './demoWorld.js';
import { Quad } from './flight/quad.js';
import { InputManager } from './input.js';
import { Hud } from './hud.js';
import { buildSettings } from './menu.js';

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
let menuSettings = null;   // los ajustes del menú de arranque, montados una vez
let pauseSettings = null;  // los de la pausa, que se rehacen en cada apertura
let pauseTab = 'zona';     // la pestaña donde dejaste la pausa, mientras dure la página

// Lo que se ha tocado en la pausa y no se puede aplicar en el sitio. No se
// aplica al mover el control —un deslizador pasa por decenas de valores en un
// segundo y cada uno costaría una reconstrucción, o una sesión de Google— sino
// al salir de la pausa, una sola vez y con su barra de progreso.
const pending = { grid: false, reload: false };

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

		// El aviso sale al pie del menú y señala un campo que puede estar detrás
		// de otra pestaña. Sacarlo a la vista es parte del aviso.
		menuSettings?.showTab( 'zona' );
		dom.menuNote.textContent = 'Falta la API key de Google Maps Platform. Si sólo quieres probar los mandos y los fps, usa "Volar en la ciudad de prueba".';
		return;

	}

	pending.grid = false;
	pending.reload = false;

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
			dron: config.flight.name,
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
 *
 * Con `onVoxelSize`, al revés que el menú: aquí sí hay zona cargada, así que se
 * puede decir qué resolución de rejilla va a caber de verdad.
 */
function openPause() {

	dom.pause.hidden = false;

	pauseSettings?.dispose();
	pauseSettings = buildSettings( dom.pauseSettings, config, {
		onChange: onLiveSettingChange,
		onVoxelSize: realVoxelSize,
		input,
		onGamepadChange: refreshResume,
		// El aviso de la pausa manda a mapear los cuatro ejes: la pestaña que los
		// tiene no puede quedarse detrás de otra.
		initialTab: input.hasControl ? pauseTab : 'mando',
	} );

	refreshResume();

}

function closePause() {

	dom.pause.hidden = true;

	// Antes de soltarlo, quedarse con dónde lo dejó: si estaba afinando el PID,
	// la próxima pausa abre en «Vuelo» y no le hace volver a buscarlo.
	if ( pauseSettings ) pauseTab = pauseSettings.tab;
	pauseSettings?.dispose();
	pauseSettings = null;

}

/**
 * Tamaño de vóxel que saldría de verdad al pedir `requested` en la zona cargada.
 *
 * Lo usa el deslizador de la pausa para no prometer lo que la memoria no va a
 * dar. Sin rejilla en memoria no hay caja que medir: entonces no se sabe, y el
 * menú enseña lo pedido a secas.
 */
function realVoxelSize( requested ) {

	return world?.grid ? effectiveVoxelSize( world.grid.box, requested ) : null;

}

/**
 * ¿Hay trabajo de rejilla esperando a que se reanude?
 *
 * Se pregunta en vez de apuntarse porque así se cancela solo: quien enciende las
 * colisiones y se arrepiente antes de reanudar no paga una construcción que ya
 * no quiere. Sólo `voxelSize` deja marca (`pending.grid`), porque ahí la rejilla
 * existe y hay que rehacerla; el resto se deduce de si la hay y de si alguien la
 * va a usar. Sin colisiones y sin vista no la usa nadie: construirla son
 * segundos para nada.
 */
function gridPending() {

	if ( ! config.collisions && ! config.showGrid ) return false;
	return ! world?.grid || pending.grid;

}

/** Reanudar sólo está disponible si hay con qué pilotar. */
function refreshResume() {

	const ready = input.hasControl;

	dom.btnResume.disabled = ! ready;
	dom.btnRespawn.disabled = ! ready;
	dom.pauseNote.textContent = ! ready
		? 'Sin mando no se vuela. Conéctalo y mapea los cuatro ejes aquí abajo; la zona sigue cargada.'
		: pending.reload
			? 'Has tocado algo que obliga a recargar la zona: al reanudar se recarga sola. Cuesta una de las 1.000 sesiones gratuitas del mes.'
			: gridPending()
				? 'Al reanudar se construye la rejilla de colisiones con la resolución de ahora. Son unos segundos y no cuesta cuota.'
				: 'La zona ya está cargada en memoria: reanudar es instantáneo. Esc también reanuda.';

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

	// Colisiones y vista de la rejilla necesitan una rejilla, y la zona puede
	// haberse cargado sin ella. Encenderlas no puede quedarse en nada: si no hay,
	// `gridPending()` lo ve y se construye al reanudar, como cualquier otro
	// pendiente. Apagarlas otra vez lo cancela solo, porque no se apunta nada.
	if ( key === 'collisions' ) {

		drone.options.collisions = config.collisions;
		drone.grid = config.collisions ? world.grid : null;
		refreshResume();

	}

	// La vista de la rejilla es independiente de que la colisión esté activa:
	// enseña contra qué se chocaría, y eso se quiere ver también volando a través.
	// El alcance y el refresco se leen al montar la vista, así que se rehace. Es
	// instantáneo: la rejilla no se toca, sólo la malla que la dibuja.
	if ( key === 'gridRadius' || key === 'gridRefresh' ) {

		world.gridView?.dispose();
		world.gridView = createGridView( { grid: world.grid, scene: world.scene, config } );
		world.gridView?.setVisible( config.showGrid );

	}

	// Materiales planos: se cambian en el sitio. No hace falta pedirle nada a
	// Google, sólo decidir con qué shader se pinta lo que ya está en memoria.
	if ( key === 'unlit' ) {

		applyUnlit( { tiles: world.tiles, scene: world.scene, renderer: world.renderer, config } );

	}

	if ( key === 'showGrid' ) {

		world.gridView?.setVisible( config.showGrid );
		refreshResume();

	}

	// La respuesta al choque se copia a `drone.options` al construir el aparato,
	// así que hay que empujarla a mano: si no, sus deslizadores se moverían sin
	// efecto y no lo notaría nadie hasta el siguiente choque.
	if ( [ 'crashSpeed', 'restitution', 'friction', 'maxSpin' ].includes( key ) ) {

		drone.options[ key ] = config[ key ];

	}

	if ( key === 'battery' ) drone.options.battery = config.battery;

	// --- Lo que no se puede aplicar en el sitio se rehace solo ---
	//
	// Ningún control se mueve sin efecto. Si un ajuste obliga a reconstruir algo,
	// se reconstruye al soltarlo, con su barra de progreso, sin que haya que ir a
	// buscar un botón. Son dos costes muy distintos y por eso van por vías
	// distintas: la rejilla se rehace con la geometría que ya está en memoria y no
	// cuesta nada; la zona y el antialiasing abren sesión nueva con Google, que es
	// una de las 1.000 del mes.
	//
	// Y pedir una resolución que el techo de memoria va a redondear a la que ya
	// está puesta no es un cambio: reconstruir para dejar la rejilla idéntica son
	// segundos tirados. El deslizador ya enseña el tamaño que saldría de verdad.
	if ( key === 'voxelSize' ) {

		if ( realVoxelSize( config.voxelSize ) !== world.grid?.voxelSize ) pending.grid = true;
		refreshResume();
		return;

	}

	if ( RELOAD_KEYS.includes( key ) ) {

		pending.reload = true;
		refreshResume();
		return;

	}

	// El bloque `flight.bf` (PID, rates, modo, filtros) lo lee el controlador en
	// cada paso, así que esos cambios ya están aplicados. El hardware —masa,
	// hélice, motor, batería— se derivó al construir el aparato y hay que rehacerlo.
	if ( key === 'hardware' ) drone.refresh();

}

/**
 * Salir de la pausa. Antes de volver al vuelo se aplica lo que quedara pendiente:
 * una recarga de zona se lo lleva todo por delante, y si no, se rehace la rejilla.
 */
async function resumeFlight() {

	if ( pending.reload ) {

		pending.reload = false;
		pending.grid = false;
		reloadZone();
		return;

	}

	if ( gridPending() ) await rebuildGrid();

	startFlying();

}

/** Ajustes que sólo se pueden aplicar volviendo a cargar la zona. */
const RELOAD_KEYS = [ 'place', 'coords', 'radius', 'quality', 'antialias' ];

/**
 * Construye o rehace la rejilla de colisiones sin tocar la escena.
 *
 * La geometría ya está descargada, así que esto es trabajo de CPU y nada más: ni
 * una petición a Google. Se hace en pausa, con la pantalla de carga puesta,
 * porque son segundos y `buildCollisionGrid` ya sabe trocearse para no congelar.
 */
async function rebuildGrid() {

	const source = world.tiles || world.demo;
	if ( ! source ) return;

	abortController = new AbortController();

	dom.pause.hidden = true;
	dom.loading.hidden = false;
	steps.init( [ 'collision' ] );

	try {

		world.gridView?.dispose();
		world.grid = await buildCollisionGrid( { tiles: source, config, steps, signal: abortController.signal } );
		world.gridView = createGridView( { grid: world.grid, scene: world.scene, config } );
		world.gridView?.setVisible( config.showGrid );

		drone.grid = config.collisions ? world.grid : null;

		// Se borra aquí y no al pedir la reconstrucción: si ésta falla o se
		// cancela, el pendiente sigue vivo y se vuelve a intentar al reanudar.
		pending.grid = false;

	} catch ( error ) {

		if ( error?.name !== 'AbortError' ) console.error( error );

	} finally {

		abortController = null;
		dom.loading.hidden = true;
		if ( phase === 'paused' ) dom.pause.hidden = false;

	}

}

/**
 * Vuelve a cargar la zona entera con los ajustes de ahora.
 *
 * Es lo mismo que pulsar «Cargar zona y volar», y cuesta lo mismo: una de las
 * 1.000 sesiones gratuitas del mes. Se dispara al SOLTAR el control, nunca
 * mientras se arrastra, para que mover un deslizador cueste una y no cincuenta.
 */
function reloadZone() {

	if ( phase === 'menu' || phase === 'loading' ) return;

	const demo = ! world.tiles;
	closePause();
    loadAndFly( { demo } );

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
	//
	// Y sin `onVoxelSize`: aquí todavía no hay zona cargada, así que no hay caja
	// que medir y no se puede saber qué resolución cabrá. El deslizador enseña lo
	// pedido a secas, que es lo único cierto en ese momento.
	menuSettings = buildSettings( dom.menuBody, config, {
		onEstimate: estimateText,
		input,
	} );

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
	dom.btnResume.addEventListener( 'click', resumeFlight );
	dom.btnRespawn.addEventListener( 'click', () => {

		drone.respawn();
		resumeFlight();

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

		resumeFlight();

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
