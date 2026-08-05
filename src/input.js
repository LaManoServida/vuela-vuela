import { MathUtils } from 'three';

export const AXES = [
	{ id: 'roll', label: 'Alerones (roll)' },
	{ id: 'pitch', label: 'Elevador (pitch)' },
	{ id: 'yaw', label: 'Timón (yaw)' },
	{ id: 'throttle', label: 'Gas (throttle)' },
];

/**
 * Entrada del piloto: mando, y sólo mando.
 *
 * Hubo un camino de ratón y teclado con un stick virtual que no se autocentraba;
 * se quitó a propósito. Un 5" en acro se pilota con dos sticks analógicos, y
 * mantener el repuesto obligaba a duplicarlo todo —modo de entrada, sensibilidad
 * del ratón, captura del puntero— para una forma de volar que no es la de verdad.
 *
 * Las teclas que quedan (`Esc`, `R`) son órdenes de juego, no mandos de vuelo.
 */
export class InputManager {

	constructor( config ) {

		this.config = config;

		this.controls = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
		this.source = 'none';
		this.gamepadIndex = null;

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

		this._onGamepad = e => {

			if ( this.gamepadIndex === null ) this.gamepadIndex = e.gamepad.index;

		};

	}

	attach() {

		// Ya no se guarda el elemento: sólo lo usaba el pointer lock.
		window.addEventListener( 'keydown', this._onKeyDown );
		window.addEventListener( 'keyup', this._onKeyUp );
		window.addEventListener( 'gamepadconnected', this._onGamepad );

		const pads = navigator.getGamepads?.() || [];
		for ( const pad of pads ) if ( pad ) this.gamepadIndex = pad.index;

	}

	detach() {

		window.removeEventListener( 'keydown', this._onKeyDown );
		window.removeEventListener( 'keyup', this._onKeyUp );
		window.removeEventListener( 'gamepadconnected', this._onGamepad );

	}

	/** Hay con qué volar: mando conectado y ejes mapeados. */
	get hasControl() {

		return this.getGamepad() !== null && !! this.config.gamepadMap;

	}

	getGamepad() {

		const pads = navigator.getGamepads?.() || [];
		if ( this.gamepadIndex !== null && pads[ this.gamepadIndex ] ) return pads[ this.gamepadIndex ];
		for ( const pad of pads ) if ( pad && pad.connected ) {

			this.gamepadIndex = pad.index;
			return pad;

		}

		return null;

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

			this.source = 'gamepad';
			this.readGamepad( pad, this.config.gamepadMap );

		} else {

			// Sin mando no se inventa nada: ejes al centro y gas cortado. Quien
			// decide qué hacer con eso es `main.js`, que pausa el vuelo.
			this.source = 'none';
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
