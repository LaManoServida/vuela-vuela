/*
 * Cargador de la configuración.
 *
 * Todos los valores viven en `vuela.config.js`, en la raíz. Aquí sólo se
 * validan, se clonan y se exponen. No hay almacenamiento del navegador ni
 * mezcla con valores por defecto: si algo no está en el fichero, no existe.
 *
 * Y justamente porque no hay valores por defecto hay que validar en serio. El
 * `merge()` que este cargador sustituye tapaba los huecos; sin él, una clave que
 * falte llega al modelo como `undefined` y sale como NaN dos multiplicaciones
 * después: el dron aparece cayendo, o el alabeo deja de responder, o los sticks
 * dejan de hacer nada, y no se imprime un solo mensaje. Diagnosticar eso cuesta
 * una tarde; leer «falta flight.frame.mass» cuesta cinco segundos.
 *
 * Por eso el arranque falla, nombrando la ruta exacta, ante una clave ausente,
 * un tipo equivocado, una estructura incompleta (la inercia con dos componentes,
 * la curva del variador con 64 puntos) o un número fuera de lo que el código
 * sabe calcular.
 */
import baseConfig from '../vuela.config.js';

// ===========================================================================
//  Vocabulario del contrato
// ===========================================================================

/*
 * Los límites que se declaran aquí NO son ajustes: son la frontera de lo que el
 * código sabe calcular. `deadzone` tiene que quedarse por debajo de 1 porque
 * `input.js` divide por `1 - deadzone`; `voxelSize` tiene que ser mayor que 0
 * porque `voxels.js` divide por él y una rejilla de lado 0 pide un array de
 * longitud Infinity; `fov` vive en (0, 180) porque es lo que admite una matriz
 * de proyección. Que estén en código y no en el fichero es deliberado: el
 * fichero es lo que se valida, y algo que se valida a sí mismo no valida nada.
 *
 * El recorrido de los deslizadores del menú es otra cosa —lo que es cómodo
 * ofrecer, no lo que es válido— y ése sí vive en el fichero, en el bloque `ui`.
 */

/** Número finito dentro de [ min, max ], ambos inclusive. */
const num = ( min = - Infinity, max = Infinity ) => ( { kind: 'number', min, max } );

/** Número estrictamente mayor que cero (el caso de casi todo lo físico). */
const pos = ( max = Infinity ) => ( { kind: 'number', min: 0, max, exclusiveMin: true } );

const bool = () => ( { kind: 'boolean' } );

/** Cadena; con argumentos, sólo una de las admitidas. */
const text = ( ...allowed ) => ( { kind: 'string', allowed } );

/** Lista de longitud exacta (`length`) o de al menos `min` elementos. */
const list = ( item, { length = null, min = 1 } = {} ) => ( { kind: 'array', item, length, minLength: min } );

/** Bloque de claves conocidas. */
const block = fields => ( { kind: 'object', fields } );

/** Diccionario de claves libres, todas con la misma forma (el bloque `ui`). */
const record = item => ( { kind: 'record', item } );

const optional = spec => ( { ...spec, optional: true } );

const place = block( {
	id: text(),
	name: text(),
	hint: optional( text() ),
	lat: num( - 90, 90 ),
	lon: num( - 180, 180 ),
} );

const padAxis = block( {
	axis: num( 0, 31 ),
	inv: bool(),
} );

// Los números del configurador de Betaflight: todos positivos o cero.
const pidAxis = block( {
	p: num( 0 ),
	i: num( 0 ),
	dMax: num( 0 ),
	dMin: num( 0 ),
	f: num( 0 ),
} );

const uiRange = block( {
	path: optional( text() ),
	min: num(),
	max: num(),
	step: pos(),
} );

/** Lo que el código exige del fichero, clave a clave. */
export const SCHEMA = block( {

	// --- Zona ---
	placeId: text(),
	lat: num( - 90, 90 ),
	lon: num( - 180, 180 ),
	radius: pos(),
	quality: pos(),
	spawnHeight: num( 0 ),

	// --- Imagen ---
	renderScale: pos( 4 ),
	fov: num( 1, 179 ),                // fuera de (0, 180) no hay proyección
	camTilt: num( - 90, 90 ),
	unlit: bool(),
	antialias: bool(),
	fogDensity: num( 0 ),

	// --- Juego ---
	collisions: bool(),
	// Por debajo de 0.25 m la rejilla no cabe en memoria ni con el reajuste
	// automático de `voxels.js`; 0 pide un Uint32Array de longitud Infinity.
	voxelSize: num( 0.25, 64 ),
	crashSpeed: num( 0 ),
	restitution: num( 0, 1 ),          // coeficiente de restitución, por definición
	friction: num( 0 ),
	maxSpin: num( 0 ),
	respawnDelay: num( 0 ),
	battery: bool(),

	// --- Entrada ---
	deadzone: num( 0, 0.9 ),           // `input.js` divide por `1 - deadzone`
	// Un mapeo por mando, guardado bajo el `id` que reporta el navegador. Es lo
	// que permite enchufar y volar sin calibrar nada; el mapa que se está usando
	// no vive aquí, porque depende de qué mando haya enchufado ahora mismo.
	gamepads: record( block( {
		roll: padAxis,
		pitch: padAxis,
		yaw: padAxis,
		throttle: padAxis,
	} ) ),

	places: list( place, { min: 1 } ),

	// --- El aparato ---
	flight: block( {

		name: text(),
		hint: optional( text() ),

		frame: block( {
			mass: pos(),
			// Tres componentes: el sólido rígido las lee por índice y con dos
			// la física entera sale NaN en el primer paso.
			inertia: list( pos(), { length: 3 } ),
			armRadius: pos(),
			armAngle: num( 0, 90 ),
			dragArea: block( { x: num( 0 ), y: num( 0 ), z: num( 0 ) } ),
			angularDrag: num( 0 ),
			gravityScale: num( 0 ),
		} ),

		motor: block( {
			kv: pos(),
			resistance: pos(),
			noLoadCurrent: num( 0 ),
			currentLimit: pos(),
			ktEfficiency: pos( 1 ),
			inertia: pos(),
			msrGain: num( 0 ),
			rpmOffset: num( 0 ),
			emfFactor: num( 0 ),
		} ),

		esc: block( {
			currentLimit: pos(),
			resistance: num( 0 ),
			braking: bool(),
			cutoffCellV: pos(),
			// 65 puntos equiespaciados de 0 a 1: la interpolación asume el paso
			// constante, así que una tabla más corta desplaza la curva entera.
			curve: list( num( 0, 1 ), { length: 65 } ),
		} ),

		prop: block( {
			diameterIn: pos(),
			pitchIn: pos(),
			blades: pos(),
			chordMm: pos(),
			hubFraction: num( 0, 0.9 ),
			inertia: pos(),
			cd0: num( 0 ),
			dCdByCl2: num( 0 ),
			clMax: num(),
			clMin: num(),
			dClByAlpha: pos(),
			inducedPowerFactor: pos(),
			washFactor: num( 0 ),
			washRate: num( 0 ),
			translationalRelief: num( 0 ),
			vrsGain: num( 0 ),
			vrsBuffet: num( 0 ),
			vrsBuffetHz: num( 0 ),
			deformMin: num( 0 ),
			deformMax: num( 0 ),
			deformPercent: num( 0, 1 ),
		} ),

		battery: block( {
			cells: pos(),
			cellR: num( 0 ),
			capacityAh: pos(),
			cellFullV: pos(),
			cellFlatV: pos(),
			cutoffCellV: pos(),
		} ),

		bf: block( {
			mode: text( 'acro', 'angle', 'horizon' ),
			rateType: text( 'betaflight', 'actual' ),
			rcRate: pos(),
			// A partir de 1 la curva de super rate se hace vertical: en el
			// configurador de Betaflight tampoco se pasa de 0.99.
			superRate: num( 0, 0.99 ),
			rcExpo: num( 0, 1 ),
			rcYawRate: pos(),
			superRateYaw: num( 0, 0.99 ),
			rcYawExpo: num( 0, 1 ),
			// Tres ejes en el orden roll, pitch, yaw: el mezclador los lee por
			// índice.
			pid: list( pidAxis, { length: 3 } ),
			angleStrength: num( 0 ),
			horizonStrength: num( 0 ),
			angleLimit: num( 0, 90 ),
			tpaRate: num( 0, 1 ),
			tpaBreakpoint: num( 0, 0.99 ),   // se divide por `1 - tpaBreakpoint`
			antiGravityGain: num( 0 ),
			antiGravityCutoffHz: pos(),
			itermRelax: bool(),
			itermRelaxCutoffHz: pos(),
			dMinGain: num( 0 ),
			dMinAdvance: num( 0 ),
			gyroLpfHz: pos(),
			dtermLpfHz: pos(),
			rcSmoothingHz: pos(),
			pidSumLimit: pos(),
			pidSumLimitYaw: pos(),
			throttleMid: num( 0, 1 ),
			throttleExpo: num( 0, 1 ),
			throttleCap: num( 0, 1 ),
			airMode: bool(),
			motorIdle: num( 0, 1 ),
			rpmLimit: bool(),
			rpmLimitValue: pos(),
			rpmLimitP: num( 0 ),
			rpmLimitI: num( 0 ),
			rpmLimitD: num( 0 ),
			rpmLimitLpfHz: pos(),
		} ),

	} ),

	ui: record( uiRange ),

} );

// ===========================================================================
//  Validación
// ===========================================================================

/** Devuelve la ruta con puntos de todo número no finito del objeto. */
export function findBadNumbers( node, path = '' ) {

	const bad = [];

	for ( const [ key, value ] of Object.entries( node ) ) {

		const here = path ? `${ path }.${ key }` : key;

		if ( typeof value === 'number' ) {

			if ( ! Number.isFinite( value ) ) bad.push( here );

		} else if ( value && typeof value === 'object' ) {

			bad.push( ...findBadNumbers( value, here ) );

		}

	}

	return bad;

}

/** Sigue una ruta con puntos (`flight.frame.mass`) sin reventar por el camino. */
export const at = ( obj, path ) => path.split( '.' ).reduce( ( o, k ) => o?.[ k ], obj );

function describeNumber( spec ) {

	const { min, max, exclusiveMin } = spec;

	if ( min === - Infinity && max === Infinity ) return 'un número finito';
	if ( min === - Infinity ) return `un número ≤ ${ max }`;
	if ( max === Infinity ) return exclusiveMin ? `un número mayor que ${ min }` : `un número ≥ ${ min }`;
	return exclusiveMin ? `un número mayor que ${ min } y ≤ ${ max }` : `un número entre ${ min } y ${ max }`;

}

function describe( spec ) {

	switch ( spec.kind ) {

		case 'number': return describeNumber( spec );
		case 'boolean': return 'true o false';
		case 'string': return spec.allowed?.length ? `uno de: ${ spec.allowed.join( ', ' ) }` : 'un texto';
		case 'array': return spec.length === null ? 'una lista' : `una lista de ${ spec.length } elementos`;
		default: return 'un bloque de claves';

	}

}

function found( value ) {

	if ( value === null ) return 'hay null';
	if ( typeof value === 'string' ) return `hay la cadena "${ value }"`;
	if ( Array.isArray( value ) ) return `hay una lista de ${ value.length }`;
	if ( typeof value === 'number' ) return `hay ${ value }`;
	if ( typeof value === 'object' ) return 'hay un bloque';
	return `hay ${ typeof value }`;

}

function checkNode( value, spec, path, out ) {

	const where = path || 'la raíz del fichero';

	if ( value === undefined ) {

		if ( ! spec.optional ) out.errors.push( `falta ${ where } (tiene que ser ${ describe( spec ) })` );
		return;

	}

	if ( value === null ) {

		if ( ! spec.nullable ) out.errors.push( `${ where }: hay null y tiene que ser ${ describe( spec ) }` );
		return;

	}

	switch ( spec.kind ) {

		case 'number':

			if ( typeof value !== 'number' || ! Number.isFinite( value ) ) {

				out.errors.push( `${ where }: ${ found( value ) } y tiene que ser ${ describe( spec ) }` );

			} else if ( value < spec.min || value > spec.max || ( spec.exclusiveMin && value === spec.min ) ) {

				out.errors.push( `${ where } = ${ value }: el código necesita ${ describe( spec ) }` );

			}

			break;

		case 'boolean':

			if ( typeof value !== 'boolean' ) out.errors.push( `${ where }: ${ found( value ) } y tiene que ser ${ describe( spec ) }` );
			break;

		case 'string':

			if ( typeof value !== 'string' || ! value ) out.errors.push( `${ where }: ${ found( value ) } y tiene que ser ${ describe( spec ) }` );
			else if ( spec.allowed?.length && ! spec.allowed.includes( value ) ) out.errors.push( `${ where } = "${ value }": tiene que ser ${ describe( spec ) }` );
			break;

		case 'array': {

			if ( ! Array.isArray( value ) ) {

				out.errors.push( `${ where }: ${ found( value ) } y tiene que ser ${ describe( spec ) }` );
				break;

			}

			if ( spec.length !== null && value.length !== spec.length ) {

				out.errors.push( `${ where }: tiene ${ value.length } elementos y el código necesita ${ spec.length }` );

			} else if ( value.length < spec.minLength ) {

				out.errors.push( `${ where }: hacen falta al menos ${ spec.minLength } elementos y hay ${ value.length }` );

			}

			for ( let i = 0; i < value.length; i ++ ) checkNode( value[ i ], spec.item, `${ where }[${ i }]`, out );
			break;

		}

		case 'object': {

			if ( typeof value !== 'object' || Array.isArray( value ) ) {

				out.errors.push( `${ where }: ${ found( value ) } y tiene que ser ${ describe( spec ) }` );
				break;

			}

			for ( const [ key, sub ] of Object.entries( spec.fields ) ) {

				checkNode( value[ key ], sub, path ? `${ path }.${ key }` : key, out );

			}

			// Una clave que sobra no rompe nada —simplemente no la lee nadie—
			// pero casi siempre es una errata: `masa` por `mass`, y el valor
			// bueno perdido. Se avisa sin impedir el arranque.
			for ( const key of Object.keys( value ) ) {

				if ( ! ( key in spec.fields ) ) out.unknown.push( path ? `${ path }.${ key }` : key );

			}

			break;

		}

		case 'record': {

			if ( typeof value !== 'object' || Array.isArray( value ) ) {

				out.errors.push( `${ where }: ${ found( value ) } y tiene que ser ${ describe( spec ) }` );
				break;

			}

			for ( const [ key, sub ] of Object.entries( value ) ) {

				checkNode( sub, spec.item, path ? `${ path }.${ key }` : key, out );

			}

			break;

		}

	}

}

/**
 * Los `path` del bloque `ui` son punteros a valores del propio fichero. Si uno
 * apunta a una clave que ya no existe —o que dejó de ser un número—, el
 * deslizador correspondiente se queda sin efecto y no lo nota nadie hasta que
 * alguien se pregunta por qué mover la masa no cambia nada. Es un error, no un
 * aviso.
 */
function checkUi( cfg, out ) {

	if ( ! cfg.ui || typeof cfg.ui !== 'object' ) return;

	for ( const [ name, range ] of Object.entries( cfg.ui ) ) {

		if ( ! range || typeof range !== 'object' ) continue;

		if ( typeof range.min === 'number' && typeof range.max === 'number' && ! ( range.min < range.max ) ) {

			out.errors.push( `ui.${ name }: min (${ range.min }) tiene que ser menor que max (${ range.max })` );

		}

		if ( range.path === undefined ) continue;

		if ( typeof at( cfg, range.path ) !== 'number' ) {

			out.errors.push( `ui.${ name }.path apunta a "${ range.path }", que no existe o no es un número` );

		}

	}

}

/**
 * Dos ejes de un mismo mando no pueden apuntar al mismo eje físico. Es la
 * mitad del contrato que el esquema no ve: `axis: 2` es válido en `roll` y es
 * válido en `yaw`, y los dos a la vez son el síntoma original —timón y gas
 * leyendo el mismo stick—. Aquí importa porque `gamepads` se edita a mano por
 * diseño y `input.js` lo copia tal cual: sin esto, una errata de una tecla
 * devuelve el fallo entero sin que el panel de calibración intervenga.
 */
function checkGamepads( cfg, out ) {

	if ( ! cfg.gamepads || typeof cfg.gamepads !== 'object' ) return;

	// Los cuatro nombres salen del propio contrato, no de una lista repetida
	// aquí que se quedaría vieja en cuanto el esquema cambiara.
	const ejes = Object.keys( SCHEMA.fields.gamepads.item.fields );

	for ( const [ id, map ] of Object.entries( cfg.gamepads ) ) {

		if ( ! map || typeof map !== 'object' ) continue;

		const dueño = new Map();

		for ( const eje of ejes ) {

			const axis = map[ eje ]?.axis;
			if ( typeof axis !== 'number' ) continue;

			if ( dueño.has( axis ) ) {

				out.errors.push( `gamepads.${ id }: ${ dueño.get( axis ) } y ${ eje } apuntan al mismo eje (${ axis })` );

			} else {

				dueño.set( axis, eje );

			}

		}

	}

}

/**
 * Comprueba un objeto de configuración contra el contrato.
 *
 * Devuelve `errors` (lo que impide arrancar) y `unknown` (claves que sobran, que
 * sólo se avisan). Lo usan el cargador y el test: el test le pasa copias
 * saboteadas para demostrar que cada agujero se caza.
 */
export function validate( raw ) {

	const out = { errors: [], unknown: [] };

	if ( ! raw || typeof raw !== 'object' ) {

		out.errors.push( 'el fichero no exporta un objeto' );
		return out;

	}

	checkNode( raw, SCHEMA, '', out );
	checkUi( raw, out );
	checkGamepads( raw, out );

	return out;

}

// ===========================================================================
//  Carga
// ===========================================================================

function setAt( obj, path, value ) {

	const keys = path.split( '.' );
	const last = keys.pop();
	keys.reduce( ( o, k ) => o[ k ], obj )[ last ] = value;

}

/**
 * Recorta los valores al recorrido que el menú ofrece para ellos. Un valor
 * legal pero fuera del deslizador dejaría la interfaz mintiendo, así que se
 * recorta; no es un error, pero tampoco conviene que pase inadvertido.
 */
function clampToRanges( cfg ) {

	for ( const [ name, range ] of Object.entries( cfg.ui ) ) {

		if ( ! range.path ) continue;

		const value = at( cfg, range.path );
		const clamped = Math.min( range.max, Math.max( range.min, value ) );

		if ( clamped !== value ) {

			console.warn(
				`[vuela-vuela] ${ range.path } = ${ value } está fuera de `
				+ `[${ range.min }, ${ range.max }] (ui.${ name }); se usa ${ clamped }.`,
			);
			setAt( cfg, range.path, clamped );

		}

	}

}

function load() {

	// Primera pasada: NaN e Infinity en cualquier rincón, esté o no en el
	// contrato. Es el fallo más traicionero y merece su propio mensaje.
	const bad = findBadNumbers( baseConfig );

	if ( bad.length ) {

		throw new Error(
			`vuela.config.js tiene valores no numéricos en: ${ bad.join( ', ' ) }. `
			+ 'Revísalos: un NaN aquí se propaga a todo el modelo de vuelo.',
		);

	}

	// Segunda pasada: el contrato completo —claves ausentes, tipos, estructura
	// y límites—, porque un `undefined` hace tanto daño como un NaN y no se ve.
	const { errors, unknown } = validate( baseConfig );

	if ( errors.length ) {

		throw new Error(
			'vuela.config.js no cumple lo que el código espera:\n'
			+ errors.map( e => `  · ${ e }` ).join( '\n' )
			+ '\nCorrige esas claves y recarga. Sin ellas el modelo trabaja con '
			+ 'undefined, que sale como NaN a los dos pasos y sin ningún aviso.',
		);

	}

	if ( unknown.length ) {

		console.warn(
			`[vuela-vuela] claves que no lee nadie en vuela.config.js: ${ unknown.join( ', ' ) }. `
			+ 'Suelen ser una errata en el nombre; el valor bueno se ha perdido.',
		);

	}

	// Copia profunda: el menú edita este objeto en caliente y el fichero
	// importado lo comparten los tests y el propio juego.
	const cfg = structuredClone( baseConfig );

	clampToRanges( cfg );

	// La credencial no vive en el fichero de configuración, para que ese sí se
	// pueda versionar. Ver `.env.example`.
	cfg.apiKey = import.meta.env?.VITE_GOOGLE_API_KEY || '';

	return cfg;

}

export const config = load();

export const ui = config.ui;

/**
 * Opciones de simulación que no forman parte del aparato: colisión, batería y
 * la respuesta al choque. Las comparten `main.js` y los tests para que los tres
 * construyan el mismo `Quad` sin repetir la lista —y sin que ningún número de
 * éstos vuelva a tener un duplicado escrito en el código.
 */
export function quadOptions( overrides = {} ) {

	return {
		collisions: config.collisions,
		crashSpeed: config.crashSpeed,
		restitution: config.restitution,
		friction: config.friction,
		maxSpin: config.maxSpin,
		battery: config.battery,
		...overrides,
	};

}

/**
 * Copia profunda e independiente del aparato. Es lo que usan los tests para
 * montar quads de usar y tirar sin pisarse entre ellos.
 *
 * **No es lo que hay que pasarle al `Quad` del juego.** `main.js` le entrega
 * `config.flight` sin clonar, a propósito: `Quad` guarda ese objeto en
 * `this.params` y lee de él en cada paso, y el menú de pausa edita
 * `config.flight.bf`. Que sean el mismo objeto es justo lo que hace que tocar
 * un PID en pausa se note al instante. Un `cloneFlight()` bien intencionado ahí
 * rompe el menú de pausa sin dar ningún error: los deslizadores se mueven y no
 * pasa nada.
 */
export function cloneFlight() {

	return structuredClone( config.flight );

}
