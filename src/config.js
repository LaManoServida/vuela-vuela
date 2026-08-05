/*
 * Cargador de la configuración.
 *
 * Todos los valores viven en `vuela.config.js`, en la raíz. Aquí sólo se
 * clonan, se validan y se exponen. No hay almacenamiento del navegador ni
 * mezcla con valores por defecto: si algo no está en el fichero, no existe.
 *
 * La validación no es paranoia: el fichero se edita a mano, y un número mal
 * escrito se propaga a NaN en un par de pasos del modelo físico. Un dron que
 * aparece cayendo o girando sin control es mucho más difícil de diagnosticar
 * que un error al arrancar que dice exactamente qué clave está mal.
 */
import baseConfig from '../vuela.config.js';

/** Devuelve la ruta con puntos de todo número no finito del objeto. */
function findBadNumbers( node, path = '' ) {

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

const at = ( obj, path ) => path.split( '.' ).reduce( ( o, k ) => o?.[ k ], obj );

function setAt( obj, path, value ) {

	const keys = path.split( '.' );
	const last = keys.pop();
	keys.reduce( ( o, k ) => o[ k ], obj )[ last ] = value;

}

/**
 * Recorta los valores que tienen rango declarado en `ui`. Editar el fichero a
 * mano y pasarse de un extremo no debe romper el simulador en silencio, pero
 * tampoco conviene que pase inadvertido: se avisa por consola.
 */
function clampToRanges( cfg ) {

	for ( const [ name, range ] of Object.entries( cfg.ui ) ) {

		if ( ! range.path ) continue;

		const value = at( cfg, range.path );
		if ( typeof value !== 'number' ) continue;

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

	const bad = findBadNumbers( baseConfig );

	if ( bad.length ) {

		throw new Error(
			`vuela.config.js tiene valores no numéricos en: ${ bad.join( ', ' ) }. `
			+ 'Revísalos: un NaN aquí se propaga a todo el modelo de vuelo.',
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

/** Copia profunda del aparato, para construir un Quad sin compartir estado. */
export function cloneFlight() {

	return structuredClone( config.flight );

}
