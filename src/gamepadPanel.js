import { AXES } from './input.js';
import { h } from './menu.js';

/*
 * El panel de mando: estado del mando, las cuatro barras de ejes y la
 * calibración. Vive aparte de `menu.js` porque se monta en dos sitios —el menú
 * principal y la pantalla de pausa— y porque `menu.js` ya es largo de sobra.
 */

export function buildGamepadPanel( container, config, input, { onChange } = {} ) {

	const rows = [];
	const status = h( 'p', { class: 'note' } );

	const list = h( 'div', { class: 'axes' } );

	for ( const axis of AXES ) {

		const bar = h( 'div', { class: 'axis-bar' }, [ h( 'i' ) ] );
		const tag = h( 'span', { class: 'tag', text: '—' } );

		const detect = h( 'button', {
			text: 'Detectar',
			onclick: () => startDetect( axis, tag ),
		} );

		const invert = h( 'label', { class: 'check' }, [
			h( 'input', {
				type: 'checkbox',
				onchange: e => {

					ensureMap();
					config.gamepadMap[ axis.id ].inv = e.target.checked;
					onChange?.();

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

	function ensureMap() {

		if ( ! config.gamepadMap ) {

			config.gamepadMap = {
				roll: { axis: 0, inv: false },
				pitch: { axis: 1, inv: true },
				yaw: { axis: 2, inv: false },
				throttle: { axis: 3, inv: true },
			};

		}

		return config.gamepadMap;

	}

	let detecting = null;

	function startDetect( axis, tag ) {

		const pad = input.getGamepad();
		if ( ! pad ) {

			tag.textContent = 'sin mando';
			return;

		}

		const dirs = {
			roll: 'a la DERECHA',
			pitch: 'hacia ARRIBA (morro arriba)',
			yaw: 'a la DERECHA',
			throttle: 'a TOPE',
		};

		detecting = {
			axis,
			tag,
			base: Float32Array.from( pad.axes ),
			best: - 1,
			bestAxis: - 1,
			bestValue: 0,
			until: performance.now() + 3000,
		};

		tag.textContent = `mueve ${ dirs[ axis.id ] }…`;

	}

	function tick() {

		const pad = input.getGamepad();
		status.textContent = pad
			? `Mando: ${ pad.id } · ${ pad.axes.length } ejes`
			: 'Sin mando detectado. Conéctalo y mueve un stick: sin mando no se puede volar.';

		if ( pad ) {

			const map = config.gamepadMap;
			for ( const row of rows ) {

				const m = map?.[ row.axis.id ];
				const raw = m && pad.axes[ m.axis ] !== undefined ? pad.axes[ m.axis ] * ( m.inv ? - 1 : 1 ) : 0;
				row.bar.style.left = `${ ( raw * 0.5 + 0.5 ) * 100 }%`;
				if ( detecting?.axis.id !== row.axis.id ) {

					row.tag.textContent = m ? `eje ${ m.axis } · ${ raw.toFixed( 2 ) }` : '—';

				}

				if ( m ) row.invert.checked = !! m.inv;

			}

			if ( detecting ) {

				for ( let i = 0; i < pad.axes.length; i ++ ) {

					const delta = Math.abs( pad.axes[ i ] - detecting.base[ i ] );
					if ( delta > detecting.best ) {

						detecting.best = delta;
						detecting.bestAxis = i;
						detecting.bestValue = pad.axes[ i ];

					}

				}

				if ( performance.now() > detecting.until ) {

					if ( detecting.best > 0.25 ) {

						ensureMap();
						config.gamepadMap[ detecting.axis.id ] = {
							axis: detecting.bestAxis,
							inv: detecting.bestValue < 0,
						};
						detecting.tag.textContent = `eje ${ detecting.bestAxis } ✓`;
						onChange?.();

					} else {

						detecting.tag.textContent = 'no se detectó movimiento';

					}

					detecting = null;

				}

			}

		}

		raf = requestAnimationFrame( tick );

	}

	let raf = requestAnimationFrame( tick );

	container.replaceChildren( h( 'fieldset', {}, [
		h( 'legend', { text: 'Mando' } ),
		status,
		list,
		h( 'div', { class: 'row', style: 'margin-top:10px' }, [
			h( 'button', {
				text: 'Mapeo por defecto',
				onclick: () => {

					config.gamepadMap = null;
					ensureMap();
					onChange?.();

				},
			} ),
		] ),
		h( 'p', {
			class: 'note',
			html: 'Se vuela con mando: los cuatro ejes tienen que estar mapeados. Del teclado sólo queda <kbd>Esc</kbd>, que pausa y reanuda; tras un choque se reaparece solo.',
		} ),
	] ) );

	return {
		dispose() {

			cancelAnimationFrame( raf );

		},
	};

}
