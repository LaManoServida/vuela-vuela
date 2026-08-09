import { ui } from './config.js';

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

/**
 * Todas las secciones de ajustes, en orden.
 *
 * Hay un solo constructor de menú y lo usan los dos sitios —el menú de arranque
 * y la pausa—, porque tener dos listas distintas garantizaba que una de las dos
 * se quedara vieja: la mitad de los ajustes sólo se podían tocar cerrando el
 * juego y editando el fichero, que es justo lo que no queremos.
 *
 * Lo que no se puede aplicar en caliente no se esconde: se muestra con su aviso
 * al lado. Saber que un ajuste existe y que hace falta recargar es mejor que no
 * saber que existe.
 */
export function buildSettings( container, config, { onChange, onEstimate, onVoxelSize } = {} ) {

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
	const latInput = h( 'input', { type: 'number', step: ui.lat.step, value: config.lat } );
	const lonInput = h( 'input', { type: 'number', step: ui.lon.step, value: config.lon } );

	const syncPlaceSelection = () => {

		for ( const btn of placeGrid.children ) {

			btn.classList.toggle( 'sel', btn.dataset.id === config.placeId );

		}

	};

	for ( const place of config.places ) {

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
				...ui.radius,
				format: v => `${ v } m`,
				onChange: () => { refreshEstimate(); onChange?.( 'radius' ); },
			} ),
			labelledSlider( 'Calidad (menor = más detalle)', config, 'quality', {
				...ui.quality,
				format: v => `${ v }`,
				onChange: () => { refreshEstimate(); onChange?.( 'quality' ); },
			} ),
			labelledSlider( 'Altura de aparición', config, 'spawnHeight', {
				...ui.spawnHeight,
				format: v => `${ v } m`,
			} ),
		] ),
		estimate,
		h( 'p', { class: 'note', text: 'La zona se congela al cargarla: cambiar esto en pausa no afecta al vuelo en curso, se aplica la próxima vez que cargues.' } ),
	] ) );

	refreshEstimate();

	// --- Vuelo: mando y controlador ---
	container.appendChild( buildFlightPanel( config, onChange ) );

	// --- Aparato ---
	container.appendChild( buildHardwarePanel( config, onChange ) );

	// --- Juego ---
	container.appendChild( buildGamePanel( config, onChange, onVoxelSize ) );

	// --- Entrada ---
	container.appendChild( h( 'fieldset', {}, [
		h( 'legend', { text: 'Entrada' } ),
		h( 'div', { class: 'grid' }, [
			labelledSlider( 'Zona muerta de los sticks', config, 'deadzone', {
				...ui.deadzone,
				format: v => v === 0 ? 'sin zona muerta' : `${ ( v * 100 ).toFixed( 0 ) } %`,
				onChange,
			} ),
		] ),
		h( 'p', { class: 'note', text: 'Cuánto hay que mover un stick desde el centro para que empiece a contar. Súbela sólo si el mando tiembla en reposo: de más, se come la precisión alrededor del centro, que es donde se vuela.' } ),
	] ) );

	// --- Render ---
	container.appendChild( h( 'fieldset', {}, [
		h( 'legend', { text: 'Imagen' } ),
		h( 'div', { class: 'grid' }, [
			labelledSlider( 'FOV', config, 'fov', {
				...ui.fov, format: v => `${ v }°`, onChange,
			} ),
			labelledSlider( 'Inclinación de cámara', config, 'camTilt', {
				...ui.camTilt, format: v => `${ v }°`, onChange,
			} ),
			labelledSlider( 'Escala de render', config, 'renderScale', {
				...ui.renderScale, format: v => `${ Math.round( v * 100 ) }%`, onChange,
			} ),
			labelledSlider( 'Niebla', config, 'fogDensity', {
				...ui.fogDensity, format: v => v.toFixed( 1 ), onChange,
			} ),
		] ),
		h( 'div', { class: 'row', style: 'margin-top:10px' }, [
			checkbox( 'Antialiasing', config, 'antialias', onChange ),
			checkbox( 'Materiales planos (recomendado)', config, 'unlit', onChange ),
		] ),
		h( 'p', { class: 'note', text: 'Los materiales planos se cambian en el sitio, sobre lo que ya está descargado. El antialiasing no puede: se fija al crear el contexto de vídeo, así que al reanudar se recarga la zona sola —y eso cuesta una de las 1.000 sesiones gratuitas del mes.' } ),
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
			...ui.rcRate, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
		nestedSlider( 'Super rate', bf, 'superRate', {
			...ui.superRate, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
		nestedSlider( 'Expo', bf, 'rcExpo', {
			...ui.rcExpo, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
		nestedSlider( 'RC rate de yaw', bf, 'rcYawRate', {
			...ui.rcYawRate, format: v => v.toFixed( 2 ),
			onChange: refreshRates, notify: 'rates',
		} ),
		nestedSlider( 'Super rate de yaw', bf, 'superRateYaw', {
			...ui.superRateYaw, format: v => v.toFixed( 2 ),
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
						type: 'number', min: ui.pidGain.min, max: ui.pidGain.max, step: ui.pidGain.step,
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
				...ui.antiGravity,
				format: v => v === 0 ? 'apagado' : v.toFixed( 1 ),
				onChange, notify: 'iterm',
			} ),
			nestedSlider( 'TPA (atenúa P y D con gas alto)', bf, 'tpaRate', {
				...ui.tpaRate,
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
		] ),

		// --- Lo que en Betaflight vive fuera de la pantalla principal ---
		h( 'p', { class: 'note', style: 'margin-top:14px', text: 'Lo de abajo casi nunca se toca, pero estaba sólo en el fichero y ahora no.' } ),

		h( 'div', { class: 'grid' }, [
			nestedSlider( 'Expo de yaw', bf, 'rcYawExpo', {
				...ui.rcYawExpo, format: v => v.toFixed( 2 ), onChange, notify: 'rates',
			} ),
			nestedSlider( 'Límite de inclinación (angle)', bf, 'angleLimit', {
				...ui.angleLimit, format: v => `${ v }°`, onChange, notify: 'mode',
			} ),
			nestedSlider( 'Fuerza de autonivelado (angle)', bf, 'angleStrength', {
				...ui.angleStrength, format: v => `${ v }`, onChange, notify: 'mode',
			} ),
			nestedSlider( 'Fuerza de autonivelado (horizon)', bf, 'horizonStrength', {
				...ui.horizonStrength, format: v => `${ v }`, onChange, notify: 'mode',
			} ),
			nestedSlider( 'Gas al que empieza la TPA', bf, 'tpaBreakpoint', {
				...ui.tpaBreakpoint, format: v => `${ Math.round( v * 100 ) } %`, onChange, notify: 'tpa',
			} ),
			nestedSlider( 'Corte del anti-gravity', bf, 'antiGravityCutoffHz', {
				...ui.antiGravityHz, format: v => `${ v } Hz`, onChange, notify: 'iterm',
			} ),
			nestedSlider( 'Corte del I-term relax', bf, 'itermRelaxCutoffHz', {
				...ui.itermRelaxHz, format: v => `${ v } Hz`, onChange, notify: 'iterm',
			} ),
			nestedSlider( 'Anti-windup de la I', bf, 'itermWindup', {
				...ui.itermWindup, format: v => `${ v } % de mezcla`, onChange, notify: 'iterm',
			} ),
			nestedSlider( 'Ganancia de D-min', bf, 'dMinGain', {
				...ui.dMinGain, format: v => `${ v }`, onChange, notify: 'pid',
			} ),
			nestedSlider( 'Adelanto de D-min', bf, 'dMinAdvance', {
				...ui.dMinAdvance, format: v => `${ v }`, onChange, notify: 'pid',
			} ),
			nestedSlider( 'Filtro del giróscopo', bf, 'gyroLpfHz', {
				...ui.gyroLpfHz, format: v => `${ v } Hz`, onChange, notify: 'filtros',
			} ),
			nestedSlider( 'Filtro de la D', bf, 'dtermLpfHz', {
				...ui.dtermLpfHz, format: v => `${ v } Hz`, onChange, notify: 'filtros',
			} ),
			nestedSlider( 'Suavizado del mando', bf, 'rcSmoothingHz', {
				...ui.rcSmoothingHz, format: v => `${ v } Hz`, onChange, notify: 'filtros',
			} ),
			nestedSlider( 'Tope de suma del PID', bf, 'pidSumLimit', {
				...ui.pidSumLimit, format: v => `${ v }`, onChange, notify: 'pid',
			} ),
			nestedSlider( 'Tope de suma en yaw', bf, 'pidSumLimitYaw', {
				...ui.pidSumLimitYaw, format: v => `${ v }`, onChange, notify: 'pid',
			} ),
		] ),

		h( 'p', { class: 'note', style: 'margin-top:14px', text: 'Curva de gas y ralentí. El ralentí dinámico sostiene unas vueltas mínimas para que las hélices no se calen al cortar gas: a 0 se apaga, y entonces cortar del todo en pleno ascenso desestabiliza el aparato.' } ),

		h( 'div', { class: 'grid' }, [
			nestedSlider( 'Centro de la curva de gas', bf, 'throttleMid', {
				...ui.throttleMid, format: v => `${ Math.round( v * 100 ) } %`, onChange, notify: 'gas',
			} ),
			nestedSlider( 'Expo de gas', bf, 'throttleExpo', {
				...ui.throttleExpo, format: v => v === 0 ? 'lineal' : v.toFixed( 2 ), onChange, notify: 'gas',
			} ),
			nestedSlider( 'Tope de gas', bf, 'throttleCap', {
				...ui.throttleCap, format: v => `${ Math.round( v * 100 ) } %`, onChange, notify: 'gas',
			} ),
			nestedSlider( 'Ralentí dinámico', bf, 'dynIdleMinRpm', {
				...ui.dynIdleMinRpm, format: v => v === 0 ? 'apagado' : `${ v } RPM`, onChange, notify: 'gas',
			} ),
			nestedSlider( 'Ralentí de los motores', bf, 'motorIdle', {
				...ui.motorIdle, format: v => `${ ( v * 100 ).toFixed( 1 ) } %`, onChange, notify: 'gas',
			} ),
		] ),

		h( 'p', { class: 'note', style: 'margin-top:14px', text: 'Limitador de RPM: mantiene las vueltas por debajo de un tope, como el gobernador de Betaflight. Apagado en el aparato de referencia.' } ),

		h( 'div', { class: 'row' }, [
			nestedCheckbox( 'Limitador de RPM', bf, 'rpmLimit', onChange, 'rpm' ),
		] ),
		h( 'div', { class: 'grid' }, [
			nestedSlider( 'RPM máximas', bf, 'rpmLimitValue', {
				...ui.rpmLimitValue, format: v => `${ v } RPM`, onChange, notify: 'rpm',
			} ),
			nestedSlider( 'P del limitador', bf, 'rpmLimitP', {
				...ui.rpmLimitGain, format: v => `${ v }`, onChange, notify: 'rpm',
			} ),
			nestedSlider( 'I del limitador', bf, 'rpmLimitI', {
				...ui.rpmLimitGain, format: v => `${ v }`, onChange, notify: 'rpm',
			} ),
			nestedSlider( 'D del limitador', bf, 'rpmLimitD', {
				...ui.rpmLimitGain, format: v => `${ v }`, onChange, notify: 'rpm',
			} ),
			nestedSlider( 'Filtro del limitador', bf, 'rpmLimitLpfHz', {
				...ui.rpmLimitLpfHz, format: v => `${ v } Hz`, onChange, notify: 'rpm',
			} ),
		] ),
	] );

}

/**
 * Reglas del juego: contra qué se choca, qué pasa al chocar y qué se dibuja.
 * Nada de esto es el aparato ni el mando.
 */
export function buildGamePanel( config, onChange, onVoxelSize ) {

	// Lo pedido y lo que sale. El techo de memoria de la rejilla puede engordar el
	// vóxel, y callárselo dejaba el deslizador mintiendo: se movía entero por
	// debajo del suelo de la zona sin que cambiara nada.
	const voxelLabel = v => {

		const real = onVoxelSize?.( v );
		return real && Math.abs( real - v ) > 0.005
			? `${ v.toFixed( 2 ) } m → ${ real.toFixed( 2 ) } m de verdad`
			: `${ v.toFixed( 2 ) } m`;

	};

	return h( 'fieldset', {}, [
		h( 'legend', { text: 'Juego' } ),

		h( 'div', { class: 'row' }, [
			checkbox( 'Colisiones', config, 'collisions', onChange ),
			checkbox( 'Batería', config, 'battery', onChange ),
			checkbox( 'Ver la rejilla', config, 'showGrid', onChange ),
		] ),

		h( 'div', { class: 'grid', style: 'margin-top:10px' }, [
			labelledSlider( 'Resolución de la rejilla', config, 'voxelSize', {
				...ui.voxelSize, format: voxelLabel, onChange,
			} ),
			labelledSlider( 'Alcance de la vista de rejilla', config, 'gridRadius', {
				...ui.gridRadius, format: v => `${ v } m`, onChange,
			} ),
			labelledSlider( 'Refresco de la vista de rejilla', config, 'gridRefresh', {
				...ui.gridRefresh, format: v => v === 0 ? 'al cambiar de celda' : `${ v.toFixed( 1 ) } s`, onChange,
			} ),
		] ),
		h( 'p', { class: 'note', text: 'Alcance y refresco se aplican al momento. La resolución obliga a reconstruir la rejilla entera, así que se rehace al reanudar, con su barra: son segundos de CPU y no cuesta cuota, porque la geometría ya está en memoria.' } ),
		h( 'p', { class: 'note', text: 'La rejilla cubre la zona entera en celdas de tamaño fijo y tiene un techo de 64 MB, así que lo fino que se puede hilar depende del radio: si lo pedido no cabe, el vóxel engorda hasta que quepa y el deslizador enseña el tamaño que sale de verdad. Bajarlo más allá de ahí no cambia nada; para afinar hay que reducir el radio de la zona.' } ),

		h( 'div', { class: 'grid', style: 'margin-top:10px' }, [
			labelledSlider( 'Velocidad que rompe el dron', config, 'crashSpeed', {
				...ui.crashSpeed, format: v => `${ v.toFixed( 1 ) } m/s`, onChange,
			} ),
			labelledSlider( 'Rebote contra la pared', config, 'restitution', {
				...ui.restitution, format: v => v.toFixed( 2 ), onChange,
			} ),
			labelledSlider( 'Rozamiento contra la pared', config, 'friction', {
				...ui.friction, format: v => v.toFixed( 2 ), onChange,
			} ),
			labelledSlider( 'Volteo máximo de un golpe', config, 'maxSpin', {
				...ui.maxSpin, format: v => `${ v } rad/s`, onChange,
			} ),
			labelledSlider( 'Espera antes de reaparecer', config, 'respawnDelay', {
				...ui.respawnDelay, format: v => v === 0 ? 'al instante' : `${ v.toFixed( 1 ) } s`, onChange,
			} ),
		] ),
		h( 'p', { class: 'note', text: 'Se aplica al momento, en el siguiente choque.' } ),
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
			+ `Todo esto se aplica al soltar el deslizador: el aparato se rehace en el sitio, sin tocar la escena.`;
		onChange?.( 'hardware' );

	};

	refresh();

	return h( 'fieldset', {}, [
		h( 'legend', { text: 'Aparato' } ),
		h( 'div', { class: 'grid' }, [
			nestedSlider( 'Masa con batería', f.frame, 'mass', {
				...ui.mass,
				format: v => `${ ( v * 1000 ).toFixed( 0 ) } g`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'KV del motor', f.motor, 'kv', {
				...ui.motorKv, format: v => `${ v } KV`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Límite de corriente', f.motor, 'currentLimit', {
				...ui.motorCurrent, format: v => `${ v } A`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Diámetro de hélice', f.prop, 'diameterIn', {
				...ui.propDiameter, format: v => `${ v.toFixed( 1 ) }"`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Paso de hélice', f.prop, 'pitchIn', {
				...ui.propPitch, format: v => `${ v.toFixed( 1 ) }"`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Celdas de la batería', f.battery, 'cells', {
				...ui.batteryCells, format: v => `${ v }S (${ ( v * f.battery.cellFullV ).toFixed( 1 ) } V)`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Longitud de brazo', f.frame, 'armRadius', {
				...ui.armRadius,
				format: v => `${ ( v * 1000 ).toFixed( 0 ) } mm`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Arrastre frontal', f.frame.dragArea, 'z', {
				...ui.dragFront,
				format: v => `${ ( v * 10000 ).toFixed( 0 ) } cm²`,
				onChange: refresh, notify: 'drag',
			} ),
			nestedSlider( 'Palas por hélice', f.prop, 'blades', {
				...ui.propBlades, format: v => `${ v }`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Capacidad de la batería', f.battery, 'capacityAh', {
				...ui.batteryAh, format: v => `${ ( v * 1000 ).toFixed( 0 ) } mAh`,
				onChange: refresh, notify: 'hardware',
			} ),
			nestedSlider( 'Gravedad', f.frame, 'gravityScale', {
				...ui.gravityScale,
				format: v => v === 1 ? 'normal' : `${ Math.round( v * 100 ) } %`,
				onChange, notify: 'gravedad',
			} ),
		] ),
		note,

		h( 'div', { class: 'row', style: 'margin-top:10px' }, [
			nestedCheckbox( 'Frenado activo del variador', f.esc, 'braking', onChange, 'esc' ),
			nestedCheckbox( 'Anillo de vórtices', f.prop, 'vortexRing', onChange, 'prop' ),
		] ),
		h( 'p', {
			class: 'note',
			text: 'El anillo de vórtices es caer sobre la propia estela y quedarse sin empuje. Es el único fenómeno del modelo que puede dejarte sin salida, y por eso viene apagado.',
		} ),
	] );

}

// ---------------------------------------------------------------------------

/**
 * La pausa monta exactamente las mismas secciones que el menú de arranque.
 *
 * Antes era una selección reducida —«lo que se puede tocar sin recargar»— y eso
 * dejaba la mitad de los ajustes sólo accesibles cerrando el juego y editando el
 * fichero. Ahora está todo en los dos sitios, y lo que necesita recargar lo dice
 * su propia nota. La zona ya cargada no se pierde por abrir la pausa.
 */
export function buildPauseSettings( container, config, onChange, onVoxelSize ) {

	return buildSettings( container, config, { onChange, onVoxelSize } );

}

/** El menú de arranque: las mismas secciones, más la estimación de carga. */
export function buildMenu( container, config, { onChange, onEstimate } = {} ) {

	// Sin `onVoxelSize`: aquí todavía no hay zona cargada, así que no hay caja que
	// medir y no se puede saber qué resolución cabrá. El deslizador enseña lo
	// pedido a secas, que es lo único cierto en ese momento.
	return buildSettings( container, config, { onChange, onEstimate } );

}

export { h };
