import { PLACES } from './locations.js';
import { AXES } from './input.js';

function h( tag, attrs = {}, children = [] ) {

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

function field( label, control, valueEl ) {

	return h( 'label', { class: 'field' }, [
		h( 'span', {}, [ label, valueEl ? h( 'span', { class: 'val' }, [ ' ', valueEl ] ) : null ] ),
		control,
	] );

}

function slider( config, key, { min, max, step, format, onChange } ) {

	const value = h( 'span', { text: format( config[ key ] ) } );
	const input = h( 'input', {
		type: 'range', min, max, step, value: config[ key ],
		oninput: e => {

			config[ key ] = parseFloat( e.target.value );
			value.textContent = format( config[ key ] );
			onChange?.( key );

		},
	} );
	return { row: field( '', input, value ), value, input, setLabel: t => {} };

}

function labelledSlider( text, config, key, opts ) {

	const value = h( 'span', { class: 'val', text: opts.format( config[ key ] ) } );
	const input = h( 'input', {
		type: 'range', min: opts.min, max: opts.max, step: opts.step, value: config[ key ],
		oninput: e => {

			config[ key ] = parseFloat( e.target.value );
			value.textContent = opts.format( config[ key ] );
			opts.onChange?.( key );

		},
	} );

	return h( 'label', { class: 'field' }, [
		h( 'span', {}, [ text, ' ', value ] ),
		input,
	] );

}

function checkbox( text, config, key, onChange ) {

	return h( 'label', { class: 'check' }, [
		h( 'input', {
			type: 'checkbox',
			checked: config[ key ] === true,
			onchange: e => {

				config[ key ] = e.target.checked;
				onChange?.( key );

			},
		} ),
		text,
	] );

}

function select( text, config, key, options, onChange ) {

	const el = h( 'select', {
		onchange: e => {

			config[ key ] = e.target.value;
			onChange?.( key );

		},
	}, options.map( o => h( 'option', { value: o.value, selected: config[ key ] === o.value, text: o.label } ) ) );

	return field( text, el );

}

/** Igual que `labelledSlider` pero sobre un objeto anidado (config.flight.…). */
function nestedSlider( text, obj, key, opts ) {

	const value = h( 'span', { class: 'val', text: opts.format( obj[ key ] ) } );
	const input = h( 'input', {
		type: 'range', min: opts.min, max: opts.max, step: opts.step, value: obj[ key ],
		oninput: e => {

			obj[ key ] = parseFloat( e.target.value );
			value.textContent = opts.format( obj[ key ] );
			opts.onChange?.( opts.notify || key );

		},
	} );

	return h( 'label', { class: 'field' }, [
		h( 'span', {}, [ text, ' ', value ] ),
		input,
	] );

}

function nestedCheckbox( text, obj, key, onChange, notify ) {

	return h( 'label', { class: 'check' }, [
		h( 'input', {
			type: 'checkbox',
			checked: obj[ key ] === true,
			onchange: e => {

				obj[ key ] = e.target.checked;
				onChange?.( notify || key );

			},
		} ),
		text,
	] );

}

function nestedSelect( text, obj, key, options, onChange, notify ) {

	const el = h( 'select', {
		onchange: e => {

			obj[ key ] = e.target.value;
			onChange?.( notify || key );

		},
	}, options.map( o => h( 'option', { value: o.value, selected: obj[ key ] === o.value, text: o.label } ) ) );

	return field( text, el );

}

/**
 * Velocidad máxima que alcanzan las rates configuradas, con la curva real de
 * Betaflight: 200·rcRate/(1−superRate) para el tipo clásico.
 */
function maxRate( bf, yaw = false ) {

	const rcRate = yaw ? bf.rcYawRate : bf.rcRate;
	const superRate = yaw ? bf.superRateYaw : bf.superRate;

	if ( bf.rateType === 'actual' ) return Math.max( rcRate, superRate ) * 10;
	return 200 * rcRate / Math.max( 0.01, 1 - superRate );

}

// ---------------------------------------------------------------------------

export function buildMenu( container, config, { onChange, onEstimate } ) {

	container.replaceChildren();

	// --- API key ---
	const keyInput = h( 'input', {
		type: 'text',
		placeholder: 'AIza…',
		value: config.apiKey,
		spellcheck: 'false',
		oninput: e => {

			config.apiKey = e.target.value.trim();
			onChange?.( 'apiKey' );

		},
	} );

	container.appendChild( h( 'fieldset', {}, [
		h( 'legend', { text: 'Cuenta de Google' } ),
		field( 'API key de Google Maps Platform (Map Tiles API)', keyInput ),
		h( 'p', { class: 'note', html: 'Cada arranque consume <b>1</b> de las 1.000 peticiones de "root tileset" gratuitas al mes. Los tiles que se descarguen después no se facturan aparte. Ver <code>README.md</code> para crear la clave.' } ),
	] ) );

	// --- Zona ---
	const placeGrid = h( 'div', { class: 'places' } );
	const latInput = h( 'input', { type: 'number', step: '0.0001', value: config.lat } );
	const lonInput = h( 'input', { type: 'number', step: '0.0001', value: config.lon } );

	const syncPlaceSelection = () => {

		for ( const btn of placeGrid.children ) {

			btn.classList.toggle( 'sel', btn.dataset.id === config.placeId );

		}

	};

	for ( const place of PLACES ) {

		placeGrid.appendChild( h( 'button', {
			class: 'place',
			'data-id': place.id,
			onclick: () => {

				config.placeId = place.id;
				config.lat = place.lat;
				config.lon = place.lon;
				latInput.value = place.lat;
				lonInput.value = place.lon;
				syncPlaceSelection();
				onChange?.( 'place' );

			},
		}, [ place.name, h( 'small', { text: place.hint } ) ] ) );

	}

	syncPlaceSelection();

	const onCoord = () => {

		config.lat = parseFloat( latInput.value );
		config.lon = parseFloat( lonInput.value );
		config.placeId = 'custom';
		syncPlaceSelection();
		onChange?.( 'coords' );

	};

	latInput.addEventListener( 'change', onCoord );
	lonInput.addEventListener( 'change', onCoord );

	const estimate = h( 'p', { class: 'note' } );
	const refreshEstimate = () => {

		estimate.textContent = onEstimate?.() || '';

	};

	container.appendChild( h( 'fieldset', {}, [
		h( 'legend', { text: 'Zona de vuelo' } ),
		placeGrid,
		h( 'div', { class: 'grid', style: 'margin-top:12px' }, [
			field( 'Latitud', latInput ),
			field( 'Longitud', lonInput ),
		] ),
		h( 'div', { class: 'grid', style: 'margin-top:6px' }, [
			labelledSlider( 'Radio a máximo detalle', config, 'radius', {
				min: 300, max: 3000, step: 50,
				format: v => `${ v } m`,
				onChange: () => { refreshEstimate(); onChange?.( 'radius' ); },
			} ),
			labelledSlider( 'Calidad (menor = más detalle)', config, 'quality', {
				min: 6, max: 40, step: 1,
				format: v => `${ v }`,
				onChange: () => { refreshEstimate(); onChange?.( 'quality' ); },
			} ),
			labelledSlider( 'Altura de aparición', config, 'spawnHeight', {
				min: 2, max: 300, step: 1,
				format: v => `${ v } m`,
			} ),
		] ),
		estimate,
	] ) );

	refreshEstimate();

	// --- Vuelo: mando y controlador ---
	container.appendChild( buildFlightPanel( config, onChange ) );

	// --- Aparato ---
	container.appendChild( buildHardwarePanel( config, onChange ) );

	// --- Render ---
	container.appendChild( h( 'fieldset', {}, [
		h( 'legend', { text: 'Imagen' } ),
		h( 'div', { class: 'grid' }, [
			labelledSlider( 'FOV', config, 'fov', {
				min: 70, max: 160, step: 1, format: v => `${ v }°`, onChange,
			} ),
			labelledSlider( 'Inclinación de cámara', config, 'camTilt', {
				min: 0, max: 55, step: 1, format: v => `${ v }°`, onChange,
			} ),
			labelledSlider( 'Escala de render', config, 'renderScale', {
				min: 0.5, max: 1.5, step: 0.05, format: v => `${ Math.round( v * 100 ) }%`, onChange,
			} ),
			labelledSlider( 'Niebla', config, 'fogDensity', {
				min: 0, max: 2.5, step: 0.1, format: v => v.toFixed( 1 ), onChange,
			} ),
		] ),
		h( 'div', { class: 'row', style: 'margin-top:10px' }, [
			checkbox( 'Antialiasing', config, 'antialias' ),
			checkbox( 'Materiales planos (recomendado)', config, 'unlit' ),
		] ),
		h( 'p', { class: 'note', text: 'Antialiasing y materiales planos sólo se aplican al recargar la zona.' } ),
	] ) );

	return { refreshEstimate };

}

// ---------------------------------------------------------------------------

/**
 * Rates y PID, con los mismos nombres y unidades que el configurador de
 * Betaflight: lo que funcione aquí funciona en un dron de verdad y al revés.
 */
export function buildFlightPanel( config, onChange ) {

	const bf = config.flight.bf;
	const rateNote = h( 'p', { class: 'note' } );

	const refreshRates = () => {

		rateNote.textContent = `Con esta curva, el stick a fondo pide `
			+ `${ Math.round( maxRate( bf ) ) } °/s en roll y pitch y `
			+ `${ Math.round( maxRate( bf, true ) ) } °/s en yaw. `
			+ `Un giro completo tarda ${ ( 360 / maxRate( bf ) ).toFixed( 2 ) } s.`;
		onChange?.( 'rates' );

	};

	const rp = [
		nestedSlider( 'RC rate', bf, 'rcRate', {
			min: 0.2, max: 2.5, step: 0.01, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
		nestedSlider( 'Super rate', bf, 'superRate', {
			min: 0, max: 0.95, step: 0.01, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
		nestedSlider( 'Expo', bf, 'rcExpo', {
			min: 0, max: 0.9, step: 0.01, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
		nestedSlider( 'RC rate de yaw', bf, 'rcYawRate', {
			min: 0.2, max: 2.5, step: 0.01, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
		nestedSlider( 'Super rate de yaw', bf, 'superRateYaw', {
			min: 0, max: 0.95, step: 0.01, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
	];

	const pidRows = [ 'Roll', 'Pitch', 'Yaw' ].map( ( axisName, i ) => {

		const axis = bf.pid[ i ];
		return h( 'div', { class: 'pid-row' }, [
			h( 'span', { class: 'pid-axis', text: axisName } ),
			...[ 'p', 'i', 'dMax', 'f' ].map( k => {

				const disabled = i === 2 && k === 'dMax';
				return h( 'label', { class: 'pid-cell' }, [
					h( 'span', { text: k === 'dMax' ? 'D' : k.toUpperCase() } ),
					h( 'input', {
						type: 'number', min: 0, max: 250, step: 1,
						value: axis[ k ],
						disabled: disabled || null,
						title: disabled ? 'En un cuadricóptero el yaw no lleva D: el mezclador sólo suma P+I+F en ese eje' : null,
						oninput: e => {

							axis[ k ] = Math.max( 0, parseFloat( e.target.value ) || 0 );
							// D-min sigue a D para que no quede por encima.
							if ( k === 'dMax' ) axis.dMin = Math.min( axis.dMin, axis.dMax );
							onChange?.( 'pid' );

						},
					} ),
				] );

			} ),
		] );

	} );

	refreshRates();

	return h( 'fieldset', {}, [
		h( 'legend', { text: 'Mando y controlador' } ),

		nestedSelect( 'Modo de vuelo', bf, 'mode', [
			{ value: 'acro', label: 'Acro (rate) — FPV de verdad' },
			{ value: 'angle', label: 'Angle — autonivelado' },
			{ value: 'horizon', label: 'Horizon — nivela con el stick centrado' },
		], onChange, 'mode' ),

		nestedSelect( 'Tipo de rates', bf, 'rateType', [
			{ value: 'betaflight', label: 'Betaflight (RC rate + super)' },
			{ value: 'actual', label: 'Actual (centro + máximo)' },
		], () => refreshRates(), 'rates' ),

		h( 'div', { class: 'grid' }, rp ),
		rateNote,

		h( 'div', { class: 'pid-table' }, pidRows ),
		h( 'p', {
			class: 'note',
			html: 'Los números son los del configurador de Betaflight y se aplican con sus mismas escalas internas. '
				+ '<b>P</b> es la fuerza con que corrige, <b>I</b> lo que aguanta contra el viento, '
				+ '<b>D</b> el amortiguamiento y <b>F</b> lo que se adelanta al stick. Empieza tocando P.',
		} ),

		h( 'div', { class: 'grid' }, [
			nestedSlider( 'Anti-gravity', bf, 'antiGravityGain', {
				min: 0, max: 10, step: 0.1,
				format: v => v === 0 ? 'apagado' : v.toFixed( 1 ),
				onChange, notify: 'iterm',
			} ),
			nestedSlider( 'TPA (atenúa P y D con gas alto)', bf, 'tpaRate', {
				min: 0, max: 0.8, step: 0.01,
				format: v => v === 0 ? 'apagada' : `${ Math.round( v * 100 ) } %`,
				onChange, notify: 'tpa',
			} ),
		] ),
		h( 'p', {
			class: 'note',
			text: 'Anti-gravity sube la I mientras el gas cambia deprisa: sin ella el dron '
				+ 'cabecea al dar y quitar gas de golpe.',
		} ),

		h( 'div', { class: 'row', style: 'margin-top:10px' }, [
			nestedCheckbox( 'Airmode', bf, 'airMode', onChange, 'airmode' ),
			nestedCheckbox( 'I-term relax', bf, 'itermRelax', onChange, 'iterm' ),
			checkbox( 'Colisiones', config, 'collisions', onChange ),
			checkbox( 'Batería', config, 'battery', onChange ),
		] ),
	] );

}

/**
 * El aparato en sí. Todo son magnitudes físicas, así que cambiarlas cambia el
 * vuelo por la vía correcta: más masa es menos empuje/peso y más inercia, no un
 * número de "agilidad" bajado a mano.
 */
export function buildHardwarePanel( config, onChange ) {

	const f = config.flight;
	const note = h( 'p', { class: 'note' } );

	const refresh = () => {

		// Estimación rápida de empuje: T ∝ ω²·(área de pala). Sirve para que el
		// deslizador dé una lectura útil sin resolver el modelo entero.
		note.textContent = `${ f.name } · ${ ( f.frame.mass * 1000 ).toFixed( 0 ) } g `
			+ `· ${ f.prop.diameterIn }×${ f.prop.pitchIn }" de ${ f.prop.blades } palas `
			+ `· ${ f.motor.kv } KV · ${ f.battery.cells }S ${ ( f.battery.capacityAh * 1000 ).toFixed( 0 ) } mAh. `
			+ `Los cambios de hardware se aplican al cargar la zona.`;
		onChange?.( 'hardware' );

	};

	refresh();

	return h( 'fieldset', {}, [
		h( 'legend', { text: 'Aparato' } ),
		h( 'div', { class: 'grid' }, [
			nestedSlider( 'Masa con batería', f.frame, 'mass', {
				min: 0.25, max: 1.4, step: 0.005,
				format: v => `${ ( v * 1000 ).toFixed( 0 ) } g`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'KV del motor', f.motor, 'kv', {
				min: 1200, max: 4000, step: 10, format: v => `${ v } KV`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Límite de corriente', f.motor, 'currentLimit', {
				min: 10, max: 60, step: 1, format: v => `${ v } A`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Diámetro de hélice', f.prop, 'diameterIn', {
				min: 2, max: 7, step: 0.1, format: v => `${ v.toFixed( 1 ) }"`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Paso de hélice', f.prop, 'pitchIn', {
				min: 2, max: 7, step: 0.1, format: v => `${ v.toFixed( 1 ) }"`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Celdas de la batería', f.battery, 'cells', {
				min: 2, max: 8, step: 1, format: v => `${ v }S (${ ( v * 4.2 ).toFixed( 1 ) } V)`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Longitud de brazo', f.frame, 'armRadius', {
				min: 0.05, max: 0.30, step: 0.005,
				format: v => `${ ( v * 1000 ).toFixed( 0 ) } mm`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Arrastre frontal', f.frame.dragArea, 'z', {
				min: 0.004, max: 0.06, step: 0.001,
				format: v => `${ ( v * 10000 ).toFixed( 0 ) } cm²`,
				onChange: refresh, notify: 'drag',
			} ),
		] ),
		note,
	] );

}

// ---------------------------------------------------------------------------

export function buildGamepadPanel( container, config, input ) {

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
			: 'Sin mando detectado. Conéctalo y mueve un stick. Mientras tanto se usan ratón y teclado.';

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

				},
			} ),
			h( 'button', {
				text: 'Usar sólo ratón y teclado',
				onclick: () => {

					config.inputMode = 'mouse';
					status.textContent = 'Forzado a ratón y teclado.';

				},
			} ),
		] ),
		h( 'p', {
			class: 'note',
			html: '<b>Ratón y teclado:</b> el ratón es el stick derecho (roll/pitch) y <i>no se autocentra</i>, como unos gimbals reales. <kbd>W</kbd>/<kbd>S</kbd> gas, <kbd>A</kbd>/<kbd>D</kbd> yaw, <kbd>Shift</kbd> gas máximo, <kbd>Espacio</kbd> corta gas, <kbd>R</kbd> reaparecer, <kbd>Esc</kbd> pausa.',
		} ),
	] ) );

	return {
		dispose() {

			cancelAnimationFrame( raf );

		},
	};

}

// ---------------------------------------------------------------------------

/**
 * Ajustes que se pueden tocar en pausa sin recargar la zona.
 *
 * Todo lo que hay aquí lo lee el modelo en cada paso, así que reanudar aplica
 * el cambio al instante. El hardware (masa, hélice, motor) no está: eso se
 * deriva al construir el aparato y vive en el menú principal.
 */
export function buildPauseSettings( container, config, onChange ) {

	const bf = config.flight.bf;
	const rateNote = h( 'p', { class: 'note' } );

	const refreshRates = () => {

		rateNote.textContent = `${ Math.round( maxRate( bf ) ) } °/s en roll y pitch, `
			+ `${ Math.round( maxRate( bf, true ) ) } °/s en yaw.`;
		onChange?.( 'rates' );

	};

	refreshRates();

	container.replaceChildren( h( 'fieldset', {}, [
		h( 'legend', { text: 'Ajustes rápidos' } ),
		h( 'div', { class: 'grid' }, [
			nestedSelect( 'Modo', bf, 'mode', [
				{ value: 'acro', label: 'Acro (rate)' },
				{ value: 'angle', label: 'Angle (autonivelado)' },
				{ value: 'horizon', label: 'Horizon' },
			], onChange, 'mode' ),
			labelledSlider( 'FOV', config, 'fov', {
				min: 70, max: 160, step: 1, format: v => `${ v }°`, onChange,
			} ),
			labelledSlider( 'Inclinación de cámara', config, 'camTilt', {
				min: 0, max: 55, step: 1, format: v => `${ v }°`, onChange,
			} ),
			labelledSlider( 'Escala de render', config, 'renderScale', {
				min: 0.5, max: 1.5, step: 0.05, format: v => `${ Math.round( v * 100 ) }%`, onChange,
			} ),
			nestedSlider( 'RC rate', bf, 'rcRate', {
				min: 0.2, max: 2.5, step: 0.01, format: v => v.toFixed( 2 ),
				onChange: refreshRates, notify: 'rates',
			} ),
			nestedSlider( 'Super rate', bf, 'superRate', {
				min: 0, max: 0.95, step: 0.01, format: v => v.toFixed( 2 ),
				onChange: refreshRates, notify: 'rates',
			} ),
			nestedSlider( 'Expo', bf, 'rcExpo', {
				min: 0, max: 0.9, step: 0.01, format: v => v.toFixed( 2 ),
				onChange: refreshRates, notify: 'rates',
			} ),
			nestedSlider( 'Límite de inclinación (angle)', bf, 'angleLimit', {
				min: 20, max: 80, step: 1, format: v => `${ v }°`, onChange, notify: 'mode',
			} ),
		] ),
		rateNote,
		h( 'div', { class: 'row', style: 'margin-top:10px' }, [
			nestedCheckbox( 'Airmode', bf, 'airMode', onChange, 'airmode' ),
			checkbox( 'Colisiones', config, 'collisions', onChange ),
			checkbox( 'Batería', config, 'battery', onChange ),
		] ),
	] ) );

}

export { h };
