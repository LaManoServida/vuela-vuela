import { AXES, AxisPicker, Calibration, RangeRecorder, calibrateAxis, hasRange, isCompleteMap, mapSnippet, sameMap, usedAxes } from './input.js';
import { h } from './dom.js';

/*
 * El panel de mando: qué mando hay, cómo se mueven sus cuatro ejes y qué hacer
 * si no está calibrado.
 *
 * Lo que aquí NO hay es lógica de calibración: encontrar el eje que se mueve y
 * encadenar los cuatro pasos son piezas de `input.js`, probadas en Node. Este
 * fichero las alimenta con las muestras del mando y pinta lo que digan.
 */

/*
 * Hacia dónde hay que mover cada stick para que se le vea.
 *
 * El sentido que se pide aquí es el que el modelo llama positivo —`+pitch` es
 * morro arriba, ver `flight/betaflight.js`—, porque la calibración deduce la
 * inversión del signo del valor en ese momento: lo que muevas ahora es lo que
 * luego hará eso. Por eso el elevador se pide **hacia atrás** y no hacia
 * arriba: en un stick, morro arriba es tirar. Decir «arriba» aquí era
 * contradecirse, y dejaba el eje invertido a quien hiciera caso al literal.
 */
/**
 * Siempre con signo, para que el número no cambie de ancho al cruzar el cero.
 * Un stick en reposo oscila entre −0.01 y +0.01 muchas veces por segundo, y sin
 * el `+` eso es un carácter que aparece y desaparece en cada frame.
 */
const signed = v => `${ v < 0 ? '' : '+' }${ v.toFixed( 2 ) }`;

const DIRS = {
	roll: 'a la DERECHA',
	pitch: 'hacia ATRÁS, tirando (morro arriba)',
	yaw: 'a la DERECHA',
	throttle: 'a TOPE',
};

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

	// La medida de los topes ({ rec, padId }): qué recorrido tiene de verdad
	// cada stick. Va después de saber qué eje es cada cual, así que es una fase
	// aparte y no un paso más de la guiada.
	let sweep = null;

	for ( const axis of AXES ) {

		// La banda va antes que la marca para que la marca quede encima cuando
		// entre en ella: las dos están absolutamente posicionadas y manda el orden.
		const dead = h( 'i', { class: 'dead', hidden: true } );
		const marker = h( 'i' );
		const bar = h( 'div', { class: 'axis-bar' }, [ dead, marker ] );
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

		rows.push( { axis, bar: marker, dead, tag, invert: invert.firstChild } );
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

	/*
	 * La salida de emergencia de un mando que SÍ está en el fichero.
	 *
	 * Calibrar borra el mapa activo antes del primer paso, y abandonar a medias
	 * —o pulsar «Borrar mapeo» sin querer— deja al piloto sin nada con que
	 * volar: desenchufar y volver a enchufar no lo arregla, porque el mando es
	 * el mismo y `input.js` sólo reaplica el mapeo del fichero cuando cambia de
	 * aparato. Sin este botón la única salida sería recargar la página, que
	 * desde la pausa cuesta la descarga entera de la zona.
	 */
	const restore = h( 'button', {
		text: 'Volver al mapeo del fichero',
		// Apagado hasta que el primer `tick` diga si hay a qué volver: nace
		// antes de que se haya mirado un solo mando.
		disabled: true,
		onclick: () => {

			const pad = input.getGamepad();
			const guardado = pad && config.gamepads?.[ pad.id ];
			if ( ! guardado ) return;

			single = guided = null;
			// Copia, nunca el objeto de la biblioteca: las casillas «inv» del
			// panel editan el mapa activo en caliente.
			config.gamepadMap = structuredClone( guardado );
			hint.textContent = 'Puesto el mapeo que guarda el fichero para este mando.';
			changed();

		},
	} );

	// Nace apagado y con la etiqueta de la primera fase: hasta el primer `tick`
	// no se sabe si hay mando ni si su mapeo está completo.
	const sweepBtn = h( 'button', {
		text: 'Medir topes',
		disabled: true,
		onclick: () => ( sweep ? saveSweep() : startSweep() ),
	} );

	function changed() {

		refreshSnippet();
		onChange?.();

	}

	/*
	 * `pad` viene de fuera porque `tick` ya lo tiene: pedirlo otra vez es un
	 * segundo `navigator.getGamepads()` en el mismo frame, y este panel se
	 * construye una vez y no se destruye nunca —su `tick` sigue corriendo a 60
	 * Hz mientras se vuela—.
	 */
	function refreshSnippet( pad = input.getGamepad() ) {

		const guardado = pad && config.gamepads?.[ pad.id ];

		// El cuadro se enseña exactamente cuando hay algo que pegar: el mapeo
		// activo está completo y además es distinto del que el fichero ya
		// guarda para este mando. Con un mando desconocido `guardado` es
		// undefined y cualquier mapeo completo cuenta como «distinto»; con uno
		// conocido, sólo cuenta si se ha recalibrado a otra cosa — recalibrar
		// un mando que SÍ está en el fichero también debe volver a enseñarlo.
		const hayAlgoQuePegar = !! pad && isCompleteMap( config.gamepadMap ) && ! sameMap( config.gamepadMap, guardado );

		snippetBox.hidden = ! hayAlgoQuePegar;
		if ( ! hayAlgoQuePegar ) return;

		// Sólo se escribe si el texto cambia. Reasignar `.value` deshace la
		// selección del piloto, y ahí está el respaldo cuando no hay
		// portapapeles: «ya está seleccionado, Ctrl+C». Que hasta ahora
		// sobreviviera era pura suerte —el texto salía idéntico cada vez—.
		const texto = mapSnippet( pad.id, config.gamepadMap );
		if ( snippet.value !== texto ) snippet.value = texto;

	}

	function startSingle( axis ) {

		const pad = input.getGamepad();
		if ( ! pad ) return;

		guided = sweep = null;

		// Los ejes de las otras filas quedan fuera: dos filas no pueden leer el
		// mismo eje físico. `usedAxes` vive en input.js y está probada allí.
		const exclude = usedAxes( config.gamepadMap, axis.id );

		single = { axis, picker: new AxisPicker( pad.axes, { exclude } ), t0: performance.now() / 1000, padId: pad.id };
		hint.textContent = `${ axis.label }: mueve ${ DIRS[ axis.id ] }…`;

	}

	function startGuided() {

		const pad = input.getGamepad();
		if ( ! pad ) return;

		single = sweep = null;
		guided = new Calibration();
		guided.begin( pad.axes, performance.now() / 1000 );
		guided.padId = pad.id;

		// Se calibra desde cero: nada heredado que luego no sepas de dónde salió.
		config.gamepadMap = null;
		changed();

	}

	/**
	 * Empieza a medir los topes.
	 *
	 * El navegador entrega cada eje normalizado contra el rango que el aparato
	 * DECLARA, que no es el que sus sticks recorren: el R7 declara −1..1 y da
	 * −0.9686..0.9608 reposando en −0.0196. Sin medirlo se pierde mando por los
	 * dos extremos —un 4 % de rate a tope, y el gas que nunca llega al 100 %— y
	 * el centro queda descolocado. La única forma de saberlo es que alguien
	 * mueva los sticks hasta el final, que es justo lo que hace Velocidrone.
	 *
	 * La foto de ahora es el reposo, de donde sale el centro de los tres sticks
	 * que se autocentran; por eso se pide soltarlos antes.
	 */
	function startSweep() {

		const pad = input.getGamepad();
		if ( ! pad || ! isCompleteMap( config.gamepadMap ) ) return;

		single = guided = null;
		sweep = { rec: new RangeRecorder( config.gamepadMap, pad.axes ), padId: pad.id };

	}

	function saveSweep() {

		const medido = sweep?.rec.result();
		if ( ! medido ) return;

		config.gamepadMap = medido;
		sweep = null;
		hint.textContent = 'Topes medidos: los sticks ya dan todo su recorrido.';
		changed();

	}

	function tick( now ) {

		raf = requestAnimationFrame( tick );

		const t = now / 1000;
		const pad = input.getGamepad();

		if ( ! pad ) {

			status.textContent = 'Mueve un stick para detectar el mando.';
			hint.textContent = '';
			single = guided = sweep = null;
			snippetBox.hidden = true;
			restore.disabled = true;
			sweepBtn.textContent = 'Medir topes';
			sweepBtn.disabled = true;

			for ( const row of rows ) {

				row.tag.textContent = '—';
				row.bar.style.left = '50%';
				row.bar.classList.remove( 'muerto' );
				row.dead.hidden = true;
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

		// Los topes de otro mando no son estos topes: medir a medias entre dos
		// aparatos daría un recorrido inventado, y un recorrido corto no deja el
		// eje corto, lo deja hipersensible.
		if ( sweep && sweep.padId !== pad.id ) {

			sweep = null;
			hint.textContent = 'El mando cambió a mitad de la medida: pulsa Medir topes otra vez.';

		}

		const guardado = config.gamepads?.[ pad.id ];

		// Sólo se ofrece volver si hay a qué volver y no es ya lo que hay
		// puesto: un botón que no cambia nada es un botón que engaña.
		restore.disabled = guardado === undefined || sameMap( config.gamepadMap, guardado );

		// Lo que se anuncia es el mapa que se está usando, no lo que el fichero
		// sepa de este mando: decir «mapeo del fichero» con las cuatro filas a
		// «—» —o después de recalibrar en caliente— es mentir sobre lo único
		// que el piloto necesita saber antes de despegar.
		const estado = ! isCompleteMap( config.gamepadMap ) ? 'sin calibrar'
			: sameMap( config.gamepadMap, guardado ) ? 'mapeo del fichero'
				: 'calibrado en esta sesión';

		status.textContent = `Mando: ${ pad.id } · ${ pad.axes.length } ejes · ${ estado }`;

		for ( const row of rows ) {

			const m = config.gamepadMap?.[ row.axis.id ];

			// El valor que se enseña es el que vuela: ya con los topes aplicados.
			// Enseñar el crudo escondería justo lo que esta calibración arregla.
			const v = m && pad.axes[ m.axis ] !== undefined
				? calibrateAxis( pad.axes[ m.axis ], m ) * ( m.inv ? - 1 : 1 )
				: 0;

			row.bar.style.left = `${ ( v * 0.5 + 0.5 ) * 100 }%`;
			row.invert.checked = !! m?.inv;

			// La banda de zona muerta, para ver de un vistazo cuánto stick se
			// está comiendo y si el temblor en reposo cabe dentro. El gas no pasa
			// por ella —se remapea a 0..1 y ya—, así que pintársela sería mentir.
			//
			// Se lee `config.deadzone` cada frame a propósito: su deslizador está
			// en esta misma pestaña, y así la banda crece y encoge mientras se
			// mueve, con el stick a la vista.
			const dz = row.axis.id === 'throttle' ? 0 : config.deadzone;

			row.dead.hidden = ! ( dz > 0 );
			if ( dz > 0 ) {

				row.dead.style.left = `${ ( 0.5 - dz * 0.5 ) * 100 }%`;
				row.dead.style.width = `${ dz * 100 }%`;

			}

			// Dentro de la banda el eje entrega cero: la marca lo dice apagándose.
			row.bar.classList.toggle( 'muerto', dz > 0 && Math.abs( v ) < dz );

			if ( ! m ) row.tag.textContent = '—';
			else if ( sweep ) row.tag.textContent = `eje ${ m.axis } · barrido ${ sweep.rec.span( row.axis.id ).toFixed( 2 ) }`;
			else row.tag.textContent = `eje ${ m.axis } · ${ signed( v ) }${ hasRange( m ) ? ' · topes ✓' : '' }`;

		}

		// Cada frame, no sólo cuando algo cambia: así una caída de un solo frame
		// del mando —o cualquier otra cosa que deje el cuadro oculto— se
		// corrige sola en cuanto vuelve a haber mando, sin esperar a la próxima
		// acción del piloto. Con el mando que ya se ha pedido arriba.
		refreshSnippet( pad );

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
			else if ( paso === 'hecho' ) {

				// No se encadena solo con la medida de topes: el gas acaba de
				// quedarse en su tope y la foto de reposo saldría con él ahí.
				hint.textContent = 'Los cuatro ejes calibrados. Suelta los sticks y pulsa «Medir topes».';
				guided = null;

			}
			else {

				const fallado = AXES.find( a => a.id === guided.failed );
				hint.textContent = `No se detectó movimiento en ${ fallado.label.toLowerCase() }. Vuelve a empezar.`;
				guided = null;

			}

		}

		if ( sweep ) {

			sweep.rec.sample( pad.axes );

			const faltan = sweep.rec.missing
				.map( id => AXES.find( a => a.id === id ).label.toLowerCase() );

			hint.textContent = faltan.length
				? `Lleva cada stick a sus dos topes. Falta: ${ faltan.join( ', ' ) }.`
				: 'Recorrido completo. Pulsa «Guardar topes».';

		}

		// El botón dice en qué fase está y sólo deja seguir cuando se puede: sin
		// los cuatro ejes no hay nada que medir, y sin barrerlos del todo no hay
		// nada que guardar.
		sweepBtn.textContent = sweep ? 'Guardar topes' : 'Medir topes';
		sweepBtn.disabled = sweep
			? ! sweep.rec.complete
			: ! isCompleteMap( config.gamepadMap );

	}

	let raf = requestAnimationFrame( tick );

	container.replaceChildren( h( 'fieldset', {}, [
		h( 'legend', { text: 'Mando' } ),
		status,
		list,
		hint,
		h( 'div', { class: 'row', style: 'margin-top:10px' }, [
			h( 'button', { class: 'primary', text: 'Calibrar los cuatro ejes', onclick: startGuided } ),
			sweepBtn,
			h( 'button', {
				text: 'Borrar mapeo',
				onclick: () => {

					single = guided = sweep = null;
					config.gamepadMap = null;
					hint.textContent = '';
					changed();

				},
			} ),
			restore,
		] ),
		snippetBox,
		h( 'p', {
			class: 'note',
			html: 'Se vuela con mando y los cuatro ejes tienen que estar mapeados. Un mando '
				+ 'guardado en <code>gamepads</code> no hay que calibrarlo nunca más.<br>'
				+ '<b>Medir topes</b> es aparte y merece la pena: el navegador entrega cada eje '
				+ 'contra el rango que la emisora <i>declara</i>, no contra el que sus sticks '
				+ 'recorren. Sin medirlo se pierde mando en los extremos y el centro queda '
				+ 'descolocado.',
		} ),
	] ) );

	refreshSnippet();

	return {
		dispose() {

			cancelAnimationFrame( raf );

		},
	};

}
