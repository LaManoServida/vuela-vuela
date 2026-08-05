import { cloneAirframe } from './flight/params.js';

// v2: el modelo de vuelo pasó de "rates + empuje/peso" a una simulación física
// completa, así que la configuración antigua ya no significa nada.
const STORAGE_KEY = 'vuela-vuela/config/v2';

export const DEFAULTS = {

	// --- Cuenta ---
	apiKey: import.meta.env?.VITE_GOOGLE_API_KEY || '',

	// --- Zona ---
	placeId: 'nyc',
	lat: 40.7580,
	lon: - 73.9855,
	radius: 1100,          // m de escenario a máxima calidad
	quality: 12,           // errorTarget dentro del radio (menor = más detalle)
	spawnHeight: 45,       // m sobre el suelo

	// --- Render ---
	renderScale: 1.0,      // multiplicador de resolución
	fov: 120,              // FOV de la cámara FPV (grados)
	camTilt: 25,           // inclinación de la cámara (grados)
	unlit: true,           // materiales planos: la textura ya trae luz horneada
	antialias: true,
	fogDensity: 0.9,       // 0..2, multiplicador sobre la niebla automática

	// --- Juego ---
	airframe: 'freestyle5',
	collisions: true,
	voxelSize: 2.0,        // m, resolución de la rejilla de colisión
	crashSpeed: 4.5,       // m/s de impacto que rompe el dron
	battery: true,

	// --- Entrada ---
	inputMode: 'auto',     // 'auto' | 'gamepad' | 'mouse'
	deadzone: 0.04,
	gamepadMap: null,      // { roll:{axis,inv}, pitch:{...}, yaw:{...}, throttle:{...} }
	mouseSens: 0.0028,

	// --- Modelo de vuelo ---
	// Célula, motores, hélices, variadores, batería y tune de Betaflight. Todo
	// en unidades reales; ver src/flight/params.js.
	flight: cloneAirframe( 'freestyle5' ),

};

/**
 * Mezcla en profundidad lo guardado sobre los valores por defecto.
 *
 * Hace falta para `flight`: si en el futuro se añade un parámetro nuevo, una
 * configuración guardada antes no debe dejarlo sin definir — un `undefined`
 * suelto en el modelo físico se propaga a NaN en un par de pasos.
 */
function merge( base, stored ) {

	if ( ! stored || typeof stored !== 'object' || Array.isArray( stored ) ) {

		return stored === undefined ? base : stored;

	}

	const out = Array.isArray( base ) ? [ ...base ] : { ...base };

	for ( const [ key, value ] of Object.entries( stored ) ) {

		out[ key ] = ( key in out ) ? merge( out[ key ], value ) : value;

	}

	return out;

}

export function loadConfig() {

	let stored = {};
	try {

		stored = JSON.parse( localStorage.getItem( STORAGE_KEY ) || '{}' );

	} catch ( e ) {

		stored = {};

	}

	const config = merge( DEFAULTS, stored );

	// La clave del .env gana si el usuario no ha escrito una a mano.
	if ( ! stored.apiKey && DEFAULTS.apiKey ) config.apiKey = DEFAULTS.apiKey;

	return config;

}

export function saveConfig( config ) {

	try {

		localStorage.setItem( STORAGE_KEY, JSON.stringify( config ) );

	} catch ( e ) {

		console.warn( 'No se pudo guardar la configuración', e );

	}

}

/** Devuelve el modelo de vuelo a los valores de fábrica del aparato elegido. */
export function resetFlight( config ) {

	config.flight = cloneAirframe( config.airframe );
	return config.flight;

}
