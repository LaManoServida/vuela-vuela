/*
 * Caché en disco para los tiles 3D de Google.
 *
 * Por qué: el coste facturable es la petición de "root tileset" (una por sesión),
 * no los tiles individuales, así que cachear no ahorra dinero — ahorra *tiempo*.
 * Recargar la misma zona pasa de minutos a segundos, que es lo que hace usable
 * iterar sobre el mismo escenario.
 *
 * Reglas:
 *  - Se respeta `Cache-Control: max-age` de la respuesta. Nada se guarda más
 *    tiempo del que Google autoriza; una entrada caducada se vuelve a pedir.
 *  - La clave ignora los parámetros `key` y `session` porque cambian en cada
 *    arranque pero apuntan al mismo contenido.
 *  - `root.json` NUNCA se cachea: esa petición es la que abre la sesión.
 */

const CACHE_NAME = 'g3d-tiles-v1';
const TILE_HOST = 'tile.googleapis.com';
const META_HEADER = 'x-vv-fetched-at';
const MAXAGE_HEADER = 'x-vv-max-age';

self.addEventListener( 'install', event => {

	self.skipWaiting();

} );

self.addEventListener( 'activate', event => {

	event.waitUntil( self.clients.claim() );

} );

self.addEventListener( 'message', event => {

	if ( event.data === 'vv:clear-cache' ) {

		event.waitUntil( caches.delete( CACHE_NAME ).then( () => {

			event.source?.postMessage( 'vv:cache-cleared' );

		} ) );

	}

} );

function isCacheable( url ) {

	if ( url.hostname !== TILE_HOST ) return false;
	// La petición raíz abre la sesión de facturación: debe ir siempre a la red.
	if ( url.pathname.endsWith( '/root.json' ) ) return false;
	return true;

}

// Clave estable: misma geometría => misma entrada, aunque cambien key/session.
function cacheKeyFor( url ) {

	const key = new URL( url.href );
	key.searchParams.delete( 'key' );
	key.searchParams.delete( 'session' );
	return new Request( key.href, { method: 'GET' } );

}

function parseMaxAge( response ) {

	const cc = response.headers.get( 'cache-control' ) || '';
	if ( /no-store|no-cache/i.test( cc ) ) return 0;
	const m = /max-age\s*=\s*(\d+)/i.exec( cc );
	return m ? parseInt( m[ 1 ], 10 ) : 0;

}

function isFresh( response ) {

	const fetchedAt = parseInt( response.headers.get( META_HEADER ) || '0', 10 );
	const maxAge = parseInt( response.headers.get( MAXAGE_HEADER ) || '0', 10 );
	if ( ! fetchedAt || ! maxAge ) return false;
	return ( Date.now() - fetchedAt ) / 1000 < maxAge;

}

// Reempaqueta la respuesta añadiendo la marca temporal para poder caducarla.
async function stamp( response ) {

	const body = await response.clone().arrayBuffer();
	const headers = new Headers( response.headers );
	headers.set( META_HEADER, String( Date.now() ) );
	headers.set( MAXAGE_HEADER, String( parseMaxAge( response ) ) );
	return new Response( body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	} );

}

self.addEventListener( 'fetch', event => {

	const request = event.request;
	if ( request.method !== 'GET' ) return;

	let url;
	try {

		url = new URL( request.url );

	} catch ( e ) {

		return;

	}

	if ( ! isCacheable( url ) ) return;

	event.respondWith( ( async () => {

		const cache = await caches.open( CACHE_NAME );
		const key = cacheKeyFor( url );
		const hit = await cache.match( key );

		if ( hit && isFresh( hit ) ) return hit;

		let network;
		try {

			network = await fetch( request );

		} catch ( err ) {

			// Sin red: mejor servir una copia caducada que romper el vuelo.
			if ( hit ) return hit;
			throw err;

		}

		if ( network.ok && parseMaxAge( network ) > 0 ) {

			const stamped = await stamp( network );
			// No bloqueamos la respuesta esperando a que se escriba en disco.
			event.waitUntil( cache.put( key, stamped.clone() ) );
			return stamped;

		}

		return network;

	} )() );

} );
