const SAMPLES = 180;

/**
 * OSD estilo Betaflight + medidor de fluidez.
 *
 * El gráfico de frametime no es decoración: es la forma de comprobar de un
 * vistazo que la precarga ha hecho su trabajo. Si aparece un pico, algo se
 * quedó sin precargar.
 */
export class Hud {

	constructor() {

		this.root = document.getElementById( 'hud' );
		this.el = {
			timer: document.getElementById( 'osd-timer' ),
			battery: document.getElementById( 'osd-battery' ),
			power: document.getElementById( 'osd-power' ),
			fps: document.getElementById( 'osd-fps' ),
			stutters: document.getElementById( 'osd-stutters' ),
			stream: document.getElementById( 'osd-stream' ),
			throttle: document.getElementById( 'osd-throttle' ),
			mode: document.getElementById( 'osd-mode' ),
			speed: document.getElementById( 'osd-speed' ),
			alt: document.getElementById( 'osd-alt' ),
			home: document.getElementById( 'osd-home' ),
			crash: document.getElementById( 'crash-banner' ),
			vrs: document.getElementById( 'vrs-warning' ),
		};

		// Las barras se pintan en el orden del mezclador (FR, FL, RR, RL) pero se
		// colocan en la rejilla como se ven desde arriba (FL, FR, RL, RR).
		this.motorBars = [ ...document.getElementById( 'osd-motors' ).children ];
		this.motorOrder = [ 1, 0, 3, 2 ];

		this.canvas = document.getElementById( 'frametime' );
		this.ctx = this.canvas.getContext( '2d', { alpha: true } );

		this.samples = new Float32Array( SAMPLES );
		this.cursor = 0;
		this.count = 0;
		this.stutters = 0;
		this.worst = 0;

		this._skip = 12;
		this._textAccum = 0;
		this._graphFrames = 0;
		this._fpsAccum = 0;
		this._fpsFrames = 0;
		this._fps = 0;

	}

	show() {

		this.root.hidden = false;

	}

	hide() {

		this.root.hidden = true;

	}

	/** Ignora los siguientes N frames al contar tirones (arranque, reanudar…). */
	skipFrames( n ) {

		this._skip = Math.max( this._skip, n );

	}

	reset() {

		this.samples.fill( 0 );
		this.cursor = 0;
		this.count = 0;
		this.stutters = 0;
		this.worst = 0;

	}

	/** @param {number} frameMs tiempo del frame anterior en ms */
	update( frameMs, drone, controls, config, stream = null ) {

		this.samples[ this.cursor ] = frameMs;
		this.cursor = ( this.cursor + 1 ) % SAMPLES;
		this.count = Math.min( this.count + 1, SAMPLES );

		// Se ignoran los primeros frames tras arrancar/reanudar: el primero
		// siempre es largo y no representa el vuelo.
		if ( this._skip > 0 ) {

			this._skip --;

		} else {

			if ( frameMs > 24 ) this.stutters ++;
			this.worst = Math.max( this.worst, frameMs );

		}

		this._fpsAccum += frameMs;
		this._fpsFrames ++;
		this._textAccum += frameMs;

		if ( this._textAccum >= 100 ) {

			this._fps = this._fpsFrames / ( this._fpsAccum / 1000 );
			this._fpsAccum = 0;
			this._fpsFrames = 0;
			this._textAccum = 0;
			this.updateText( drone, controls, config, stream );

		}

		if ( ( this._graphFrames ++ % 3 ) === 0 ) this.drawGraph();

	}

	updateText( drone, controls, config, stream ) {

		const el = this.el;
		const t = drone.flightTime;
		const mm = String( Math.floor( t / 60 ) ).padStart( 2, '0' );
		const ss = String( Math.floor( t % 60 ) ).padStart( 2, '0' );

		el.timer.textContent = `${ mm }:${ ss }`;

		if ( config.battery ) {

			const pct = Math.round( drone.charge * 100 );
			el.battery.textContent = `${ drone.voltage.toFixed( 1 ) }V  ${ pct }%`;
			el.battery.style.color = drone.charge < 0.15 ? '#ef4444' : drone.charge < 0.3 ? '#f59e0b' : '';

		} else {

			el.battery.textContent = `${ drone.voltage.toFixed( 1 ) }V`;
			el.battery.style.color = '';

		}

		// Amperios y vueltas: el estado real de la propulsión, que es lo que
		// explica por qué el dron responde como responde en cada momento.
		el.power.textContent = `${ drone.totalCurrent.toFixed( 0 ) } A · ${ Math.round( drone.averageRpm / 100 ) * 100 } RPM`;

		el.fps.textContent = `${ this._fps.toFixed( 0 ) } fps · ${ ( 1000 / Math.max( this._fps, 1 ) ).toFixed( 1 ) } ms`;
		el.stutters.textContent = this.stutters === 0
			? `sin tirones · peor ${ this.worst.toFixed( 1 ) } ms`
			: `${ this.stutters } tirones · peor ${ this.worst.toFixed( 1 ) } ms`;
		el.stutters.style.color = this.stutters === 0 ? '#4ade80' : '#f59e0b';

		el.throttle.textContent = `THR ${ Math.round( controls.throttle * 100 ) }%`;

		const mode = config.flight.bf.mode;
		el.mode.textContent = mode === 'angle' ? 'ANGLE' : mode === 'horizon' ? 'HORIZON' : 'ACRO';

		// Saturación del mezclador: cuando la mezcla no cabe en el rango, el
		// controlador está pidiendo más de lo que los motores pueden dar.
		const saturated = drone.bf.motorMixRange > 1;
		for ( let i = 0; i < this.motorBars.length; i ++ ) {

			const bar = this.motorBars[ i ];
			const value = drone.bf.motor[ this.motorOrder[ i ] ];
			bar.style.setProperty( '--v', `${ Math.round( value * 100 ) }%` );
			bar.classList.toggle( 'hot', saturated || value > 0.95 );

		}

		el.speed.textContent = `${ ( drone.speed * 3.6 ).toFixed( 0 ) } km/h`;
		el.alt.textContent = `${ drone.altitude.toFixed( 0 ) } m`;
		el.home.textContent = `${ drone.distanceToHome().toFixed( 0 ) } m`;

		// Anillo de vórtices: cayendo en vertical el dron se hunde en su propia
		// estela y el gas deja de servir. Avisar es lo justo, porque el reflejo
		// correcto (salir hacia adelante) es el contrario del instintivo.
		const vrs = drone.props.reduce( ( a, p ) => a + p.vrs, 0 ) / 4;
		el.vrs.hidden = ! ( vrs > 0.45 && drone.velocity.y < - 3 && ! drone.crashed );

		// Carga continua. Estos dos números son con los que se ajusta el modo de
		// exploración, y a ojo no se aciertan: el coste del recorrido del árbol
		// —la única parte que no se puede trocear, así que si se dispara sale
		// como un tirón por turno— y cuánta memoria ocupan los tiles vivos, que
		// es lo que separa un vuelo largo de una pestaña muerta.
		el.stream.hidden = ! stream;

		if ( stream ) {

			el.stream.textContent =
				`${ stream.traversalMs.toFixed( 1 ) } ms · ${ ( stream.bytes / 1048576 ).toFixed( 0 ) } MB`
				+ ( stream.textures ? ` · ${ stream.textures } tex` : '' )
				+ ( stream.errors ? ` · ${ stream.errors } fallos` : '' );
			el.stream.style.color = stream.traversalMs > 8 ? '#f59e0b' : '';

		}

		el.crash.hidden = ! drone.crashed;

	}

	drawGraph() {

		const ctx = this.ctx;
		const w = this.canvas.width;
		const h = this.canvas.height;
		const scale = h / 33.3; // fondo de escala: 33 ms (30 fps)

		ctx.clearRect( 0, 0, w, h );

		// Referencias de 16.7 ms (60 fps) y 8.3 ms (120 fps).
		ctx.strokeStyle = 'rgba(255,255,255,0.22)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for ( const ms of [ 8.33, 16.67 ] ) {

			const y = h - ms * scale;
			ctx.moveTo( 0, y + 0.5 );
			ctx.lineTo( w, y + 0.5 );

		}

		ctx.stroke();

		ctx.beginPath();
		for ( let i = 0; i < this.count; i ++ ) {

			const idx = ( this.cursor - this.count + i + SAMPLES * 2 ) % SAMPLES;
			const x = ( i / SAMPLES ) * w;
			const y = h - Math.min( h, this.samples[ idx ] * scale );
			if ( i === 0 ) ctx.moveTo( x, y );
			else ctx.lineTo( x, y );

		}

		ctx.strokeStyle = this.worst > 24 ? '#f59e0b' : '#4ade80';
		ctx.lineWidth = 1.5;
		ctx.stroke();

	}

}
