import { MathUtils } from 'three';

export const AXES = [
	{ id: 'roll', label: 'Alerones (roll)' },
	{ id: 'pitch', label: 'Elevador (pitch)' },
	{ id: 'yaw', label: 'Timón (yaw)' },
	{ id: 'throttle', label: 'Gas (throttle)' },
];

/**
 * Un mapeo sirve para volar sólo si trae los cuatro ejes. Uno a medias es peor
 * que ninguno: `readGamepad` devuelve 0 para el eje que falta, y el gas —que se
 * remapea de −1..1 a 0..1— sale como 0.5. Medio gas al despegar, sin stick.
 */
export function isCompleteMap( map ) {

	return !! map && AXES.every( ( { id } ) => typeof map[ id ]?.axis === 'number' );

}

/**
 * Entrada del piloto: mando, y sólo mando.
 *
 * Hubo un camino de ratón y teclado con un stick virtual que no se autocentraba;
 * se quitó a propósito. Un 5" en acro se pilota con dos sticks analógicos, y
 * mantener el repuesto obligaba a duplicarlo todo —modo de entrada, sensibilidad
 * del ratón, captura del puntero— para una forma de volar que no es la de verdad.
 *
 * La única tecla que queda (`Esc`) es una orden de juego, no un mando de vuelo.
 */
export class InputManager {

	constructor( config ) {

		this.config = config;

		this.controls = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
		this.gamepadIndex = null;
		// De qué mando es el mapa que hay activo. Se compara por `id` y no por
		// índice porque el índice lo reparte el navegador y cambia solo.
		this.mappedId = null;

		this._keys = new Set();
		// Pulsaciones sueltas: una tecla tocada y soltada entre dos frames se
		// perdería si sólo mirásemos el estado mantenido.
		this._pending = new Set();
		this._edges = new Set();
		this._raw = new Float32Array( 16 );
		this._rawCount = 0;

		this._onKeyDown = e => {

			if ( e.repeat ) return;
			this._keys.add( e.code );
			this._pending.add( e.code );

		};

		this._onKeyUp = e => this._keys.delete( e.code );

		this._onGamepad = () => {

			// Adoptar —y con ello aplicar el mapeo guardado— es cosa de
			// `getGamepad()`. Aquí sólo se le hace mirar ya, sin esperar al
			// siguiente frame: en el menú y en la pausa no hay bucle de vuelo.
			this.getGamepad();

		};

	}

	attach() {

		// Ya no se guarda el elemento: sólo lo usaba el pointer lock.
		window.addEventListener( 'keydown', this._onKeyDown );
		window.addEventListener( 'keyup', this._onKeyUp );
		window.addEventListener( 'gamepadconnected', this._onGamepad );

		// Un mando que ya estuviera visible al arrancar se adopta aquí mismo. Si
		// el navegador aún no lo enseña —no lo hace hasta que lo tocas: es una
		// defensa antihuella, no un fallo— lo hará `gamepadconnected`.
		this.getGamepad();

	}

	detach() {

		window.removeEventListener( 'keydown', this._onKeyDown );
		window.removeEventListener( 'keyup', this._onKeyUp );
		window.removeEventListener( 'gamepadconnected', this._onGamepad );

	}

	/**
	 * Vacía las teclas mantenidas, las sueltas y los flancos pendientes.
	 * `_pending` sólo se vacía dentro de `update()`, y `update()` sólo corre
	 * dentro del bucle de vuelo: sin esto, un `Esc` tocado en el menú o en la
	 * pausa —antes de que el bucle arranque— se dispara solo en cuanto corre
	 * el primer `update()` del vuelo.
	 */
	resetKeys() {

		this._keys.clear();
		this._pending.clear();
		this._edges.clear();

	}

	/**
	 * Hay con qué volar: mando conectado y los cuatro ejes mapeados. Los cuatro,
	 * no «algún mapeo»: ver `isCompleteMap`.
	 */
	get hasControl() {

		return this.getGamepad() !== null && isCompleteMap( this.config.gamepadMap );

	}

	getGamepad() {

		const pads = navigator.getGamepads?.() || [];
		const known = this.gamepadIndex !== null ? pads[ this.gamepadIndex ] : null;

		if ( known ) return this._adopt( known );

		for ( const pad of pads ) if ( pad && pad.connected ) return this._adopt( pad );

		return null;

	}

	/**
	 * Toma este mando como el que se está usando y, si ha cambiado de aparato,
	 * pone el mapeo que le toca.
	 *
	 * El mapa activo pertenece siempre al mando que hay en la mano: si el fichero
	 * conoce su `id` se aplica su mapeo —enchufar y mover un stick es todo el
	 * trámite—, y si no lo conoce, el mapa anterior deja de valer, porque los
	 * ejes de otra emisora en ésta no son los mismos ejes.
	 *
	 * Por `id` y no por índice: desenchufar y volver a enchufar el mismo mando no
	 * puede tirar una calibración recién hecha y todavía sin pegar en el fichero.
	 */
	_adopt( pad ) {

		this.gamepadIndex = pad.index;

		if ( pad.id !== this.mappedId ) {

			this.mappedId = pad.id;
			const saved = this.config.gamepads?.[ pad.id ];
			// Copia: recalibrar no puede editar la biblioteca del fichero.
			this.config.gamepadMap = saved ? structuredClone( saved ) : null;

		}

		return pad;

	}

	/** Ejes crudos del mando, para la pantalla de mapeo. */
	pollRaw() {

		const pad = this.getGamepad();
		this._rawCount = 0;
		if ( ! pad ) return this._raw;

		const n = Math.min( pad.axes.length, this._raw.length );
		for ( let i = 0; i < n; i ++ ) this._raw[ i ] = pad.axes[ i ];
		this._rawCount = n;
		return this._raw;

	}

	get rawCount() {

		return this._rawCount;

	}

	deadzone( v ) {

		const dz = this.config.deadzone;
		if ( Math.abs( v ) < dz ) return 0;
		return Math.sign( v ) * ( Math.abs( v ) - dz ) / ( 1 - dz );

	}

	update() {

		this._edges.clear();
		for ( const code of this._pending ) this._edges.add( code );
		this._pending.clear();

		const pad = this.getGamepad();

		if ( pad && this.config.gamepadMap ) {

			this.readGamepad( pad, this.config.gamepadMap );

		} else {

			// Sin mando no se inventa nada: ejes al centro y gas cortado. Quien
			// decide qué hacer con eso es `main.js`, que pausa el vuelo.
			this.controls.roll = 0;
			this.controls.pitch = 0;
			this.controls.yaw = 0;
			this.controls.throttle = 0;

		}

		return this.controls;

	}

	readGamepad( pad, map ) {

		const c = this.controls;
		const get = key => {

			const m = map[ key ];
			if ( ! m || pad.axes[ m.axis ] === undefined ) return 0;
			const v = pad.axes[ m.axis ] * ( m.inv ? - 1 : 1 );
			return MathUtils.clamp( v, - 1, 1 );

		};

		c.roll = this.deadzone( get( 'roll' ) );
		c.pitch = this.deadzone( get( 'pitch' ) );
		c.yaw = this.deadzone( get( 'yaw' ) );
		// El gas físico va de -1 (abajo) a +1 (arriba); aquí se quiere 0..1.
		c.throttle = MathUtils.clamp( ( get( 'throttle' ) + 1 ) * 0.5, 0, 1 );

	}

	/** True una sola vez por pulsación, aunque haya durado menos de un frame. */
	consumeKey( code ) {

		if ( ! this._edges.has( code ) ) return false;
		this._edges.delete( code );
		this._keys.delete( code );
		return true;

	}

}
