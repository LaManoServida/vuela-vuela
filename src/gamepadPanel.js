import { AXES, AxisPicker, Calibration, isCompleteMap, mapSnippet, usedAxes } from './input.js';
import { h } from './menu.js';

/*
 * El panel de mando: qué mando hay, cómo se mueven sus cuatro ejes y qué hacer
 * si no está calibrado.
 *
 * Lo que aquí NO hay es lógica de calibración: encontrar el eje que se mueve y
 * encadenar los cuatro pasos son piezas de `input.js`, probadas en Node. Este
 * fichero las alimenta con las muestras del mando y pinta lo que digan.
 */

/** Hacia dónde hay que mover cada stick para que se le vea. */
const DIRS = {
	roll: 'a la DERECHA',
	pitch: 'hacia ARRIBA (morro arriba)',
	yaw: 'a la DERECHA',
	throttle: 'a TOPE',
};

/**
 * ¿Es el mismo mapeo? Se compara eje por eje según `AXES`, no con un
 * `JSON.stringify` de los objetos enteros: el orden en que se rellenan las
 * claves depende de qué fila se detectó primero, y eso no puede hacer que dos
 * mapeos con los mismos ejes parezcan distintos.
 */
function sameMap( a, b ) {

	if ( ! a || ! b ) return a === b;
	return AXES.every( ( { id } ) => a[ id ]?.axis === b[ id ]?.axis && !! a[ id ]?.inv === !! b[ id ]?.inv );

}

export function buildGamepadPanel( container, config, input, { onChange } = {} ) {

	const rows = [];
	const status = h( 'p', { class: 'note' } );
	const hint = h( 'p', { class: 'note' } );
	const list = h( 'div', { class: 'axes' } );

	// Una detección suelta ({ axis, picker, t0, padId }) o la guiada de los
	// cuatro (una `Calibration` con un `padId` añadido). El `padId` es de qué
	// mando es la foto de referencia del picker, para poder soltarla si el
	// mando cambia a media detección.
	let single = null;
	let guided = null;

	for ( const axis of AXES ) {

		const bar = h( 'div', { class: 'axis-bar' }, [ h( 'i' ) ] );
		const tag = h( 'span', { class: 'tag', text: '—' } );

		const detect = h( 'button', { text: 'Detectar', onclick: () => startSingle( axis ) } );

		const invert = h( 'label', { class: 'check' }, [
			h( 'input', {
				type: 'checkbox',
				onchange: e => {

					// Sin eje asignado no hay nada que invertir: antes esto creaba
					// un mapeo entero por defecto.
					const m = config.gamepadMap?.[ axis.id ];
					if ( ! m ) { e.target.checked = false; return; }

					m.inv = e.target.checked;
					changed();

				},
			} ),
			'inv',
		] );

		rows.push( { axis, bar: bar.firstChild, tag, invert: invert.firstChild } );
		list.appendChild( h( 'div', { class: 'axis-row' }, [
			h( 'span', { text: axis.label } ),
			bar,
			tag,
			h( 'span', { class: 'row' }, [ invert, detect ] ),
		] ) );

	}

	const snippet = h( 'textarea', { class: 'snippet', rows: '7', spellcheck: 'false', readonly: true } );
	const snippetBox = h( 'div', { hidden: true }, [
		h( 'p', {
			class: 'note',
			html: 'Pega esto dentro de <code>gamepads</code>, en <code>vuela.config.js</code>, '
				+ 'y este mando quedará reconocido en todos los arranques.',
		} ),
		snippet,
		h( 'button', {
			text: 'Copiar mapeo',
			onclick: () => {

				snippet.select();

				// Sobre http:// a una IP de LAN —una forma normal de llegar al Vite
				// de desarrollo desde otro aparato— `navigator.clipboard` no
				// existe. El texto ya queda seleccionado, así que Ctrl+C funciona
				// aunque el botón no pueda.
				if ( ! navigator.clipboard ) {

					hint.textContent = 'Sin acceso al portapapeles aquí (¿http sin TLS?). El texto ya está seleccionado: Ctrl+C.';
					return;

				}

				navigator.clipboard.writeText( snippet.value ).catch( () => {

					hint.textContent = 'No se pudo copiar. El texto ya está seleccionado: Ctrl+C.';

				} );

			},
		} ),
	] );

	function changed() {

		refreshSnippet();
		onChange?.();

	}

	function refreshSnippet() {

		const pad = input.getGamepad();
		const guardado = pad && config.gamepads?.[ pad.id ];

		// El cuadro se enseña exactamente cuando hay algo que pegar: el mapeo
		// activo está completo y además es distinto del que el fichero ya
		// guarda para este mando. Con un mando desconocido `guardado` es
		// undefined y cualquier mapeo completo cuenta como «distinto»; con uno
		// conocido, sólo cuenta si se ha recalibrado a otra cosa — recalibrar
		// un mando que SÍ está en el fichero también debe volver a enseñarlo.
		const hayAlgoQuePegar = !! pad && isCompleteMap( config.gamepadMap ) && ! sameMap( config.gamepadMap, guardado );

		snippetBox.hidden = ! hayAlgoQuePegar;
		if ( hayAlgoQuePegar ) snippet.value = mapSnippet( pad.id, config.gamepadMap );

	}

	function startSingle( axis ) {

		const pad = input.getGamepad();
		if ( ! pad ) return;

		guided = null;

		// Los ejes de las otras filas quedan fuera: dos filas no pueden leer el
		// mismo eje físico. `usedAxes` vive en input.js y está probada allí.
		const exclude = usedAxes( config.gamepadMap, axis.id );

		single = { axis, picker: new AxisPicker( pad.axes, { exclude } ), t0: performance.now() / 1000, padId: pad.id };
		hint.textContent = `${ axis.label }: mueve ${ DIRS[ axis.id ] }…`;

	}

	function startGuided() {

		const pad = input.getGamepad();
		if ( ! pad ) return;

		single = null;
		guided = new Calibration();
		guided.begin( pad.axes, performance.now() / 1000 );
		guided.padId = pad.id;

		// Se calibra desde cero: nada heredado que luego no sepas de dónde salió.
		config.gamepadMap = null;
		changed();

	}

	function tick( now ) {

		raf = requestAnimationFrame( tick );

		const t = now / 1000;
		const pad = input.getGamepad();

		if ( ! pad ) {

			status.textContent = 'Mueve un stick para detectar el mando.';
			hint.textContent = 'El navegador no enseña el mando hasta que lo tocas; no es cosa del juego.';
			single = guided = null;
			snippetBox.hidden = true;

			for ( const row of rows ) {

				row.tag.textContent = '—';
				row.bar.style.left = '50%';
				row.invert.checked = false;

			}

			return;

		}

		// Con dos mandos a la vez, el navegador no deja un frame sin mando entre
		// desenchufar uno y que el otro tome su sitio: el freno de arriba no
		// llega a correr. Sin esto, el picker en marcha seguiría comparando
		// contra la foto del mando anterior y aceptaría el primer desajuste
		// entre los dos aparatos como si el piloto lo hubiera movido — justo lo
		// que esta función existe para no hacer nunca.
		if ( single && single.padId !== pad.id ) {

			single = null;
			hint.textContent = 'El mando cambió a mitad de la detección: pulsa Detectar otra vez.';

		}

		if ( guided && guided.padId !== pad.id ) {

			guided = null;
			hint.textContent = 'El mando cambió a mitad de la calibración: pulsa Calibrar otra vez.';

		}

		const conocido = config.gamepads?.[ pad.id ] !== undefined;
		const estado = conocido ? 'mapeo del fichero'
			: isCompleteMap( config.gamepadMap ) ? 'calibrado en esta sesión'
				: 'sin calibrar';

		status.textContent = `Mando: ${ pad.id } · ${ pad.axes.length } ejes · ${ estado }`;

		for ( const row of rows ) {

			const m = config.gamepadMap?.[ row.axis.id ];
			const raw = m && pad.axes[ m.axis ] !== undefined ? pad.axes[ m.axis ] * ( m.inv ? - 1 : 1 ) : 0;

			row.bar.style.left = `${ ( raw * 0.5 + 0.5 ) * 100 }%`;
			row.tag.textContent = m ? `eje ${ m.axis } · ${ raw.toFixed( 2 ) }` : '—';
			row.invert.checked = !! m?.inv;

		}

		// Cada frame, no sólo cuando algo cambia: así una caída de un solo frame
		// del mando —o cualquier otra cosa que deje el cuadro oculto— se
		// corrige sola en cuanto vuelve a haber mando, sin esperar a la próxima
		// acción del piloto.
		refreshSnippet();

		if ( single ) {

			const got = single.picker.sample( pad.axes, t - single.t0 );

			if ( got && got.axis === null ) {

				hint.textContent = `No se detectó movimiento en ${ single.axis.label.toLowerCase() }.`;
				single = null;

			} else if ( got ) {

				config.gamepadMap = { ...config.gamepadMap, [ single.axis.id ]: { axis: got.axis, inv: got.inv } };
				hint.textContent = `${ single.axis.label }: eje ${ got.axis } ✓`;
				single = null;
				changed();

			}

		}

		if ( guided ) {

			const antes = Object.keys( guided.map ).length;
			const paso = guided.sample( pad.axes, t );

			if ( Object.keys( guided.map ).length !== antes ) {

				config.gamepadMap = { ...guided.map };
				changed();

			}

			if ( paso === 'buscando' ) hint.textContent = `${ guided.step.label }: mueve ${ DIRS[ guided.step.id ] }…`;
			else if ( paso === 'suelta' ) hint.textContent = 'Suelta el stick…';
			else if ( paso === 'hecho' ) { hint.textContent = 'Los cuatro ejes calibrados.'; guided = null; }
			else {

				const fallado = AXES.find( a => a.id === guided.failed );
				hint.textContent = `No se detectó movimiento en ${ fallado.label.toLowerCase() }. Vuelve a empezar.`;
				guided = null;

			}

		}

	}

	let raf = requestAnimationFrame( tick );

	container.replaceChildren( h( 'fieldset', {}, [
		h( 'legend', { text: 'Mando' } ),
		status,
		list,
		hint,
		h( 'div', { class: 'row', style: 'margin-top:10px' }, [
			h( 'button', { class: 'primary', text: 'Calibrar los cuatro ejes', onclick: startGuided } ),
			h( 'button', {
				text: 'Borrar mapeo',
				onclick: () => {

					single = guided = null;
					config.gamepadMap = null;
					hint.textContent = '';
					changed();

				},
			} ),
		] ),
		snippetBox,
		h( 'p', {
			class: 'note',
			html: 'Se vuela con mando y los cuatro ejes tienen que estar mapeados. Un mando '
				+ 'guardado en <code>gamepads</code> no hay que calibrarlo nunca más. Del teclado '
				+ 'sólo queda <kbd>Esc</kbd>, que pausa y reanuda; tras un choque se reaparece solo.',
		} ),
	] ) );

	refreshSnippet();

	return {
		dispose() {

			cancelAnimationFrame( raf );

		},
	};

}
