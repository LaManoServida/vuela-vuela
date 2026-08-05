import { MathUtils } from 'three';

export const AXES = [
	{ id: 'roll', label: 'Alerones (roll)' },
	{ id: 'pitch', label: 'Elevador (pitch)' },
	{ id: 'yaw', label: 'Timón (yaw)' },
	{ id: 'throttle', label: 'Gas (throttle)' },
];

/**
 * Entrada del piloto. Dos caminos:
 *  - Gamepad: cualquier emisora USB o mando aparece como joystick estándar.
 *  - Ratón + teclado: el ratón mueve un stick virtual *que no se autocentra*,
 *    igual que unos gimbals reales. Es lo único que hace acro jugable sin mando.
 */
export class InputManager {

	constructor( config ) {

		this.config = config;

		this.controls = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
		this.source = 'none';
		this.gamepadIndex = null;
		this.captured = false;

		this._mouseStick = { x: 0, y: 0 };
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

		this._onMouseMove = e => {

			if ( ! this.captured ) return;
			const s = this.config.mouseSens;
			this._mouseStick.x = MathUtils.clamp( this._mouseStick.x + e.movementX * s, - 1, 1 );
			this._mouseStick.y = MathUtils.clamp( this._mouseStick.y + e.movementY * s, - 1, 1 );

		};

		this._onPointerLockChange = () => {

			this.captured = document.pointerLockElement === this.element;

		};

		this._onGamepad = e => {

			if ( this.gamepadIndex === null ) this.gamepadIndex = e.gamepad.index;

		};

	}

	attach( element ) {

		this.element = element;
		window.addEventListener( 'keydown', this._onKeyDown );
		window.addEventListener( 'keyup', this._onKeyUp );
		window.addEventListener( 'mousemove', this._onMouseMove );
		document.addEventListener( 'pointerlockchange', this._onPointerLockChange );
		window.addEventListener( 'gamepadconnected', this._onGamepad );

		const pads = navigator.getGamepads?.() || [];
		for ( const pad of pads ) if ( pad ) this.gamepadIndex = pad.index;

	}

	detach() {

		window.removeEventListener( 'keydown', this._onKeyDown );
		window.removeEventListener( 'keyup', this._onKeyUp );
		window.removeEventListener( 'mousemove', this._onMouseMove );
		document.removeEventListener( 'pointerlockchange', this._onPointerLockChange );
		window.removeEventListener( 'gamepadconnected', this._onGamepad );

	}

	requestCapture() {

		// Que el navegador diga que no es lo NORMAL, no una excepción: sólo
		// concede el pointer lock si hay un gesto del usuario reciente, y además
		// lo veta durante un segundo largo justo después de que se salga con
		// Esc. Las dos cosas nos pasan a diario: al terminar la carga han pasado
		// minutos desde el clic en «volar», y quien pulsa Esc y Reanudar seguido
		// cae dentro del veto.
		//
		// No hay nada que recuperar —el clic sobre el vuelo vuelve a pedirlo—,
		// pero la petición devuelve una promesa: sin recogerla, cada negativa
		// aparece en consola como `NotAllowedError` sin capturar.
		const request = this.element?.requestPointerLock?.();
		if ( request && typeof request.catch === 'function' ) request.catch( () => {} );

	}

	releaseCapture() {

		if ( document.pointerLockElement ) document.exitPointerLock();

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

		const config = this.config;
		const wantGamepad = config.inputMode === 'gamepad' || config.inputMode === 'auto';
		const pad = wantGamepad ? this.getGamepad() : null;

		if ( pad && config.gamepadMap ) {

			this.source = 'gamepad';
			this.readGamepad( pad, config.gamepadMap );

		} else {

			this.source = 'mouse';
			this.readMouseKeyboard();

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

	readMouseKeyboard() {

		const c = this.controls;
		const keys = this._keys;

		c.roll = this.deadzone( this._mouseStick.x );
		c.pitch = this.deadzone( - this._mouseStick.y );

		let yaw = 0;
		if ( keys.has( 'KeyA' ) || keys.has( 'ArrowLeft' ) ) yaw -= 1;
		if ( keys.has( 'KeyD' ) || keys.has( 'ArrowRight' ) ) yaw += 1;
		c.yaw = yaw;

		// Gas: W/S lo suben y bajan progresivamente y se queda donde lo dejas,
		// como una palanca real. Shift = gas máximo momentáneo.
		const rate = 1.1 / 60;
		if ( keys.has( 'KeyW' ) || keys.has( 'ArrowUp' ) ) c.throttle += rate;
		if ( keys.has( 'KeyS' ) || keys.has( 'ArrowDown' ) ) c.throttle -= rate;
		if ( keys.has( 'ShiftLeft' ) ) c.throttle = 1;
		if ( keys.has( 'Space' ) ) c.throttle = 0;
		c.throttle = MathUtils.clamp( c.throttle, 0, 1 );

	}

	/**
	 * Recentra el stick virtual del ratón y deja el gas donde se le pida.
	 * Al reaparecer en el aire interesa arrancar en gas de sustentación: si no,
	 * el dron empieza a caer antes de que te dé tiempo a tocar nada.
	 */
	resetStick( throttle = 0 ) {

		this._mouseStick.x = 0;
		this._mouseStick.y = 0;
		this.controls.roll = 0;
		this.controls.pitch = 0;
		this.controls.yaw = 0;
		this.controls.throttle = MathUtils.clamp( throttle, 0, 1 );

	}

	/** True una sola vez por pulsación, aunque haya durado menos de un frame. */
	consumeKey( code ) {

		if ( ! this._edges.has( code ) ) return false;
		this._edges.delete( code );
		this._keys.delete( code );
		return true;

	}

}
