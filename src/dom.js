/*
 * El ayudante de DOM que usan el menú y el panel de mando.
 *
 * Vive aparte de los dos porque los dos lo necesitan: tenerlo en `menu.js` y
 * que `gamepadPanel.js` lo importara de ahí obligaba a que la dependencia
 * fuera en un solo sentido, y desde que el panel de mando se monta dentro de
 * los ajustes tiene que ir en los dos.
 */
export function h( tag, attrs = {}, children = [] ) {

	const el = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( attrs ) ) {

		if ( k === 'class' ) el.className = v;
		else if ( k === 'text' ) el.textContent = v;
		else if ( k === 'html' ) el.innerHTML = v;
		else if ( k.startsWith( 'on' ) ) el.addEventListener( k.slice( 2 ).toLowerCase(), v );
		else if ( v !== null && v !== undefined && v !== false ) el.setAttribute( k, v === true ? '' : v );

	}

	for ( const child of [].concat( children ) ) {

		if ( child ) el.appendChild( typeof child === 'string' ? document.createTextNode( child ) : child );

	}

	return el;

}
