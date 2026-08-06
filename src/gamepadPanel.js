import { AXES, AxisPicker, Calibration, isCompleteMap, mapSnippet } from './input.js';
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

export function buildGamepadPanel( container, config, input, { onChange } = {} ) {

	const rows = [];
	const status = h( 'p', { class: 'note' } );
	const hint = h( 'p', { class: 'note' } );
	const list = h( 'div', { class: 'axes' } );

	// Una detección suelta ({ axis, picker, t0 }) o la guiada de los cuatro.
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
				navigator.clipboard?.writeText( snippet.value ).catch( () => {} );

			},
		} ),
	] );

	function changed() {

		refreshSnippet();
		onChange?.();

	}

	function refreshSnippet() {

		const pad = input.getGamepad();
		const listo = !! pad && isCompleteMap( config.gamepadMap );

		snippetBox.hidden = ! listo;
		if ( listo ) snippet.value = mapSnippet( pad.id, config.gamepadMap );

	}

	function startSingle( axis ) {

		const pad = input.getGamepad();
		if ( ! pad ) return;

		guided = null;

		// Los ejes de las otras filas quedan fuera: dos mandos no pueden leer el
		// mismo eje físico.
		const exclude = AXES
			.filter( a => a.id !== axis.id )
			.map( a => config.gamepadMap?.[ a.id ]?.axis )
			.filter( a => a !== undefined );

		single = { axis, picker: new AxisPicker( pad.axes, { exclude } ), t0: performance.now() / 1000 };
		hint.textContent = `${ axis.label }: mueve ${ DIRS[ axis.id ] }…`;

	}

	function startGuided() {

		const pad = input.getGamepad();
		if ( ! pad ) return;

		single = null;
		guided = new Calibration();
		guided.begin( pad.axes, performance.now() / 1000 );

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

			}

			return;

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
