/**
 * Emulación del controlador de vuelo Betaflight 4.x.
 *
 * Reimplementado a partir del firmware (GPL: `rc.c`, `pid.c`, `mixer.c`) con sus
 * constantes de escala reales, porque son las que hacen que un P=60 / I=45 /
 * D=35 de la vida real se sienta aquí como se siente en un quad de verdad.
 *
 * Convenio de signos de esta casa (elegido para que sea legible, verificado por
 * los tests): +roll = alabeo a la derecha, +pitch = morro arriba, +yaw = morro a
 * la derecha. Todo lo interno va en grados/s, como en el firmware; la conversión
 * a rad/s ocurre en una única frontera, en `quad.js`.
 */

export const ROLL = 0, PITCH = 1, YAW = 2;

// Escalas internas de Betaflight (pid.c). Convierten los números "de
// configurador" a unidades del mezclador.
const PTERM_SCALE = 0.032029;
const ITERM_SCALE = 0.244381;
const DTERM_SCALE = 0.000529;
const FEEDFORWARD_SCALE = 0.013754;
const PID_MIXER_SCALING = 1000;
const ITERM_LIMIT = 400;
// Velocidad de gas a la que el anti-gravity llega a su tope: barrer el stick
// entero en 100 ms. Por encima no sigue creciendo — un techo es justo lo que le
// faltaba.
const AG_FULL_RATE = 10;

// D-min (pid.c)
const D_MIN_GAIN_FACTOR = 0.00008;
const D_MIN_SETPOINT_GAIN_FACTOR = 0.00008;
const D_MIN_LOWPASS_HZ = 35;
const D_MIN_RANGE_HZ = 85;

const ITERM_RELAX_SETPOINT_THRESHOLD = 40;

// Ralentí dinámico: con qué fuerza persigue las RPM mínimas y cuánto puede
// llegar a subir el suelo de los motores.
const DYN_IDLE_GAIN = 4;
const DYN_IDLE_MAX = 0.25;

const clamp = ( v, lo, hi ) => v < lo ? lo : v > hi ? hi : v;

/** Coeficiente de un PT1 (paso bajo de primer orden) para un dt dado. */
function pt1Alpha( dt, cutoffHz ) {

	if ( cutoffHz <= 0 ) return 1;
	const rc = 1 / ( 2 * Math.PI * cutoffHz );
	return dt / ( rc + dt );

}

export class Betaflight {

	/**
	 * @param {object} cfg  bloque `bf` de la configuración
	 * @param {Array}  mixer geometría del mezclador: [{roll,pitch,yaw}] por motor
	 */
	constructor( cfg, mixer ) {

		this.cfg = cfg;
		this.mixer = mixer;
		this.motorCount = mixer.length;

		this.setpoint = new Float32Array( 3 );
		this.prevSetpoint = new Float32Array( 3 );
		this.gyro = new Float32Array( 3 );          // filtrado, °/s
		this.prevGyro = new Float32Array( 3 );
		this.dtermGyro = new Float32Array( 3 );     // filtrado aparte para la D
		this.prevDtermGyro = new Float32Array( 3 );

		this.P = new Float32Array( 3 );
		this.I = new Float32Array( 3 );
		this.D = new Float32Array( 3 );
		this.F = new Float32Array( 3 );
		this.pidSum = new Float32Array( 3 );

		// Estados de filtro
		this._rcSmooth = new Float32Array( 3 );     // suavizado del enlace de radio
		this._rcSmooth2 = new Float32Array( 3 );
		this._windupLpf = new Float32Array( 3 );    // iterm-relax
		this._dMinRange = new Float32Array( 3 );
		this._dMinLpf = new Float32Array( 3 );
		this._agLpf = 0;                            // anti-gravity
		this._prevThrottle = 0;

		this.dMinFactor = new Float32Array( 3 ).fill( 1 );
		this.tpaFactor = 1;

		this.motor = new Float32Array( this.motorCount );   // 0..1 tras idle
		this.motorMix = new Float32Array( this.motorCount );
		this.motorMixRange = 0;
		this.minRpm = 0;                 // RPM del rotor más lento, las pone quad.js
		this._dynIdle = 0;               // suplemento de ralentí acumulado
		this.throttle = 0;
		this.attitude = { roll: 0, pitch: 0 };      // grados, para modo angle
		this.levelMode = 'off';

		// Limitador de RPM (apagado por defecto, como en el quad de referencia)
		this.rpmLimit = 0;
		this._govI = 0;
		this._govPrevRpm = 0;
		this._govPrevError = 0;

		this.reset();

	}

	reset() {

		this.setpoint.fill( 0 );
		this.prevSetpoint.fill( 0 );
		this.gyro.fill( 0 );
		this.prevGyro.fill( 0 );
		this.dtermGyro.fill( 0 );
		this.prevDtermGyro.fill( 0 );
		this.P.fill( 0 );
		this.I.fill( 0 );
		this.D.fill( 0 );
		this.F.fill( 0 );
		this.pidSum.fill( 0 );
		this._rcSmooth.fill( 0 );
		this._rcSmooth2.fill( 0 );
		this._windupLpf.fill( 0 );
		this._dMinRange.fill( 0 );
		this._dMinLpf.fill( 0 );
		this._agLpf = 0;
		this._prevThrottle = 0;
		this._govI = 0;
		this._govPrevRpm = 0;
		this._govPrevError = 0;
		this._dynIdle = 0;
		this.motor.fill( 0 );
		this.motorMix.fill( 0 );

	}

	// =======================================================================
	//  Sticks → setpoint (°/s)
	// =======================================================================

	/**
	 * Curva de rates de Betaflight. Los dos tipos que usa el 99 % de la gente:
	 *  - `betaflight`: RC_RATE + super rate + expo (el clásico)
	 *  - `actual`:     sensibilidad en el centro + máximo, más intuitivo
	 */
	applyRates( axis, rc ) {

		const cfg = this.cfg;
		const yaw = axis === YAW;

		const rcRate = yaw ? cfg.rcYawRate : cfg.rcRate;
		const superRate = yaw ? cfg.superRateYaw : cfg.superRate;
		const expo = yaw ? cfg.rcYawExpo : cfg.rcExpo;

		const rcAbs = Math.abs( rc );

		if ( cfg.rateType === 'actual' ) {

			// ACTUAL rates: expof usa la quinta potencia y la curva se define
			// por sensibilidad en el centro y velocidad máxima.
			const e = rcAbs * ( Math.pow( rc, 5 ) * expo + rc * ( 1 - expo ) );
			const center = rcRate * 10;
			const movement = Math.max( 0, superRate * 10 - center );
			return rc * center + movement * e;

		}

		// BETAFLIGHT rates.
		let f = rc;
		if ( expo > 0 ) f = rc * ( rcAbs * rcAbs * rcAbs ) * expo + rc * ( 1 - expo );

		let rate = rcRate;
		if ( rate > 2 ) rate += 14.54 * ( rate - 2 );

		let angleRate = 200 * rate * f;

		if ( superRate > 0 ) {

			const superFactor = 1 / clamp( 1 - rcAbs * superRate, 0.01, 1 );
			angleRate *= superFactor;

		}

		return angleRate;

	}

	/** Rate máximo alcanzable por eje, para la interfaz. */
	maxRate( axis ) {

		return Math.abs( this.applyRates( axis, 1 ) );

	}

	// =======================================================================
	//  Modo angle / horizon
	// =======================================================================

	applyLevel( axis, setpointRate ) {

		const cfg = this.cfg;
		const limit = cfg.angleLimit;

		// El stick pide un ángulo, no una velocidad: se reescala desde el rate
		// que ese stick habría pedido en acro.
		const maxRate = this.maxRate( axis ) || 1;
		const target = clamp( setpointRate / maxRate * limit, - limit, limit );

		const current = axis === ROLL ? this.attitude.roll : this.attitude.pitch;
		const errorAngle = target - current;

		// levelGain = P_LEVEL / 10  →  °/s de corrección por grado de error.
		const levelGain = cfg.angleStrength / 10;

		if ( this.levelMode === 'angle' ) return errorAngle * levelGain;

		// Horizon: mezcla progresiva; a stick centrado autonivela, a stick a
		// fondo deja pasar el rate completo.
		const strength = clamp( 1 - Math.abs( setpointRate ) / maxRate, 0, 1 );
		const horizonGain = cfg.horizonStrength / 10;
		return setpointRate + errorAngle * horizonGain * strength;

	}

	// =======================================================================
	//  Bucle PID
	// =======================================================================

	/**
	 * @param {number} dt        paso de tiempo (s)
	 * @param {object} sticks    { roll, pitch, yaw, throttle } normalizados
	 * @param {Float32Array} gyroRaw  giro sin filtrar en °/s, mismo convenio de signos
	 */
	update( dt, sticks, gyroRaw ) {

		const cfg = this.cfg;
		const pidFreq = 1 / dt;

		// --- Filtro del giróscopo (una PT1 hace de toda la cadena real) ---
		const aGyro = pt1Alpha( dt, cfg.gyroLpfHz );
		const aDterm = pt1Alpha( dt, cfg.dtermLpfHz );
		for ( let i = 0; i < 3; i ++ ) {

			this.gyro[ i ] += ( gyroRaw[ i ] - this.gyro[ i ] ) * aGyro;
			this.dtermGyro[ i ] += ( this.gyro[ i ] - this.dtermGyro[ i ] ) * aDterm;

		}

		// --- Gas: curva y límite ---
		let throttle = this.applyThrottleCurve( clamp( sticks.throttle, 0, 1 ) );
		throttle *= cfg.throttleCap;

		// --- TPA: atenúa P y D con el gas alto para matar oscilaciones ---
		this.tpaFactor = 1;
		if ( throttle > cfg.tpaBreakpoint ) {

			const t = clamp( ( throttle - cfg.tpaBreakpoint ) / ( 1 - cfg.tpaBreakpoint ), 0, 1 );
			this.tpaFactor = 1 - t * cfg.tpaRate;

		}

		// --- Anti-gravity: sube la I cuando el gas cambia rápido ---
		// Sin esto el dron cabecea al dar y quitar gas de golpe (punch-out).
		const throttleD = Math.abs( throttle - this._prevThrottle ) * pidFreq;
		this._prevThrottle = throttle;
		this._agLpf += ( throttleD - this._agLpf ) * pt1Alpha( dt, cfg.antiGravityCutoffHz );

		// El acelerador es un MULTIPLICADOR ACOTADO de la ganancia I, no un sumando
		// proporcional a la velocidad del gas.
		//
		// Sumándolo, la I subía ×7,9 barriendo el gas en un segundo, ×70 en 100 ms
		// y ×269 en un golpe seco, sin techo: siempre había un movimiento de gas
		// bastante rápido como para clavar la I en `ITERM_LIMIT`. A partir de ahí
		// cualquier desvío infinitesimal —y en un mando siempre lo hay— se
		// convertía en una revuelta de varios cientos de °/s que dejaba el dron
		// decenas de grados girado. Se veía siempre, y no dependía del tamaño del
		// desvío: la saturación borra esa diferencia.
		//
		// Acotado, la I sube como mucho `antiGravityGain` veces, que es lo que el
		// término significa: ayudar a la I a seguir el peso aparente mientras el
		// gas cambia, no sustituir al controlador.
		const agActivity = Math.min( 1, this._agLpf / AG_FULL_RATE );
		const itermAccelerator = 1 + cfg.antiGravityGain * agActivity;

		// --- Anti-windup por saturación del mezclador ---
		// Cuando la mezcla no cabe en el rango de los motores, el controlador ya no
		// manda: pida lo que pida, los motores están contra el tope o contra el
		// ralentí. Seguir integrando ahí carga la I contra un error que no se puede
		// corregir, y al recuperar autoridad la suelta de golpe. Eso es lo que
		// producía el bailecito de ida y vuelta al cortar el gas subiendo: los
		// rotores caían al ralentí, la mezcla saturaba y la I se cargaba a solas.
		//
		// Betaflight lo resuelve escalando la integración con lo que le quede de
		// margen al mezclador, y a partir de `itermWindup` la congela del todo. El
		// rango es el del ciclo anterior, como en Betaflight: el mezclador corre
		// después del PID.
		const windupInv = 1 / Math.max( 1e-3, 1 - cfg.itermWindup / 100 );
		const dynCi = dt * clamp( ( 1 - this.motorMixRange ) * windupInv, 0, 1 );


		this.levelMode = cfg.mode === 'angle' ? 'angle' : cfg.mode === 'horizon' ? 'horizon' : 'off';

		// --- Suavizado del enlace de radio ---
		// Ni la emisora ni el receptor entregan escalones: el mando llega a 150-500
		// Hz y Betaflight lo interpola. Sin esto, mover el stick de golpe genera un
		// pico de feedforward que no existe en un dron real.
		const aRc = pt1Alpha( dt, cfg.rcSmoothingHz );

		for ( let axis = 0; axis < 3; axis ++ ) {

			const gains = cfg.pid[ axis ];
			const raw = axis === ROLL ? sticks.roll : axis === PITCH ? sticks.pitch : sticks.yaw;

			// Dos PT1 en cascada: la pendiente del stick queda continua, que es lo
			// que necesita la derivada del feedforward.
			this._rcSmooth[ axis ] += ( clamp( raw, - 1, 1 ) - this._rcSmooth[ axis ] ) * aRc;
			this._rcSmooth2[ axis ] += ( this._rcSmooth[ axis ] - this._rcSmooth2[ axis ] ) * aRc;
			const stick = this._rcSmooth2[ axis ];

			// ---- setpoint ----
			let setPt = this.applyRates( axis, clamp( stick, - 1, 1 ) );
			if ( this.levelMode !== 'off' && axis !== YAW ) setPt = this.applyLevel( axis, setPt );
			this.setpoint[ axis ] = setPt;

			const gyroRate = this.gyro[ axis ];
			let errorRate = setPt - gyroRate;

			// ---- iterm relax ----
			// Con el stick moviéndose deprisa la I sólo acumularía retraso; se
			// congela mientras dure el movimiento y vuelve al soltar.
			const aWindup = pt1Alpha( dt, cfg.itermRelaxCutoffHz );
			this._windupLpf[ axis ] += ( setPt - this._windupLpf[ axis ] ) * aWindup;
			let relaxedError = errorRate;

			if ( cfg.itermRelax ) {

				const setpointHpf = Math.abs( setPt - this._windupLpf[ axis ] );
				const factor = Math.max( 0, 1 - setpointHpf / ITERM_RELAX_SETPOINT_THRESHOLD );
				// Variante "increment": sólo frena la I si fuese a crecer.
				const growing = ( errorRate * this.I[ axis ] > 0 ) || this.I[ axis ] === 0;
				if ( growing ) relaxedError = errorRate * factor;

			}

			// ---- P ----
			const Kp = PTERM_SCALE * gains.p;
			this.P[ axis ] = Kp * errorRate * this.tpaFactor;

			// ---- I ----
			const Ki = ITERM_SCALE * gains.i;
			const iTerm = this.I[ axis ] + Ki * itermAccelerator * dynCi * relaxedError;
			this.I[ axis ] = clamp( iTerm, - ITERM_LIMIT, ITERM_LIMIT );

			// ---- D (sobre la medida, no sobre el error: evita el "D-kick") ----
			const setpointDelta = setPt - this.prevSetpoint[ axis ];
			this.prevSetpoint[ axis ] = setPt;

			if ( gains.dMax > 0 ) {

				const Kd = DTERM_SCALE * gains.dMax;
				const delta = - ( this.dtermGyro[ axis ] - this.prevDtermGyro[ axis ] ) * pidFreq;

				// D-min: la D sube sólo cuando algo se mueve rápido, así el
				// vuelo suave queda limpio y el golpe sigue amortiguado.
				let factor = 1;
				const dMinPercent = gains.dMax > 0 ? clamp( gains.dMin / gains.dMax, 0, 1 ) : 1;

				if ( dMinPercent < 1 ) {

					const dMinGyroGain = cfg.dMinGain * D_MIN_GAIN_FACTOR / D_MIN_LOWPASS_HZ;
					const dMinSetpointGain = cfg.dMinGain * D_MIN_SETPOINT_GAIN_FACTOR
						* cfg.dMinAdvance * pidFreq / ( 100 * D_MIN_LOWPASS_HZ );

					const aRange = pt1Alpha( dt, D_MIN_RANGE_HZ );
					this._dMinRange[ axis ] += ( delta - this._dMinRange[ axis ] ) * aRange;

					const gyroFactor = Math.abs( this._dMinRange[ axis ] ) * dMinGyroGain;
					const setpointFactor = Math.abs( setpointDelta ) * dMinSetpointGain;

					factor = Math.max( gyroFactor, setpointFactor );
					factor = dMinPercent + ( 1 - dMinPercent ) * factor;

					const aLpf = pt1Alpha( dt, D_MIN_LOWPASS_HZ );
					this._dMinLpf[ axis ] += ( factor - this._dMinLpf[ axis ] ) * aLpf;
					factor = Math.min( this._dMinLpf[ axis ], 1 );

				}

				this.dMinFactor[ axis ] = factor;
				this.D[ axis ] = Kd * delta * this.tpaFactor * factor;

			} else {

				this.D[ axis ] = 0;
				this.dMinFactor[ axis ] = 1;

			}

			this.prevDtermGyro[ axis ] = this.dtermGyro[ axis ];

			// ---- F (feedforward): adelanta la respuesta al movimiento del stick ----
			// Desactivado en modos autonivelados, igual que en el firmware.
			const Kf = this.levelMode !== 'off' ? 0 : FEEDFORWARD_SCALE * ( gains.f / 100 );
			this.F[ axis ] = Kf > 0 ? Kf * setpointDelta * pidFreq : 0;

			this.pidSum[ axis ] = this.P[ axis ] + this.I[ axis ] + this.D[ axis ] + this.F[ axis ];

		}

		this.throttle = throttle;
		this.mixTable( throttle );

	}

	applyThrottleCurve( t ) {

		const { throttleMid, throttleExpo } = this.cfg;
		if ( throttleExpo <= 0 ) return t;

		// Curva de gas de Betaflight: recta partida suavizada alrededor de mid.
		const tmp = t - throttleMid;
		const y = tmp > 0 ? 1 - throttleMid : throttleMid || 1;
		return throttleMid + tmp * ( 1 - throttleExpo + throttleExpo * ( tmp * tmp ) / ( y * y ) );

	}

	// =======================================================================
	//  Mezclador
	// =======================================================================

	mixTable( throttle ) {

		const cfg = this.cfg;
		const n = this.motorCount;

		const roll = clamp( this.pidSum[ ROLL ], - cfg.pidSumLimit, cfg.pidSumLimit ) / PID_MIXER_SCALING;
		const pitch = clamp( this.pidSum[ PITCH ], - cfg.pidSumLimit, cfg.pidSumLimit ) / PID_MIXER_SCALING;
		const yaw = clamp( this.pidSum[ YAW ], - cfg.pidSumLimitYaw, cfg.pidSumLimitYaw ) / PID_MIXER_SCALING;

		let mixMin = Infinity, mixMax = - Infinity;

		for ( let i = 0; i < n; i ++ ) {

			const g = this.mixer[ i ];
			const m = roll * g.roll + pitch * g.pitch + yaw * g.yaw;
			this.motorMix[ i ] = m;
			if ( m < mixMin ) mixMin = m;
			if ( m > mixMax ) mixMax = m;

		}

		this.motorMixRange = mixMax - mixMin;

		// Airmode (mezclador lineal de BF 4.3): en vez de recortar los motores
		// cuando la mezcla no cabe, se normaliza y se desplaza el gas. Resultado:
		// el dron conserva autoridad de actitud con el gas a cero, que es lo que
		// permite recuperarse en caída.
		let scale = 1;
		let transition = 1;

		if ( ! cfg.airMode && throttle < 0.5 ) {

			transition = 0.1 + ( throttle / 0.5 ) * 0.9;

		}

		scale = this.motorMixRange > 1 ? transition / this.motorMixRange : transition;

		for ( let i = 0; i < n; i ++ ) this.motorMix[ i ] *= scale;

		const normMin = mixMin * scale;
		const normMax = mixMax * scale;
		let t = clamp( throttle, - normMin, 1 - normMax );

		// Ralentí dinámico: sostiene unas RPM mínimas por debajo de las cuales las
		// hélices se calan.
		//
		// Con el gas cortado en pleno ascenso los rotores caían a 550 RPM, y ahí el
		// aparato es inestable de verdad: con empuje negativo, el rotor que baja ve
		// MÁS flujo y en vez de frenar el alabeo lo excita —el amortiguamiento
		// aerodinámico cambia de signo—. El giro crecía solo de 0,1 a 19 °/s sin
		// que el controlador pudiera hacer nada, porque con las palas caladas no
		// hay par que repartir.
		//
		// Es la función `dyn_idle` de Betaflight, y existe por esto mismo: sube el
		// suelo de los motores lo que haga falta para que el rotor más lento no
		// baje de `dynIdleMinRpm`. En vuelo normal no interviene nunca.
		let idle = cfg.motorIdle;

		if ( cfg.dynIdleMinRpm > 0 ) {

			const falta = ( cfg.dynIdleMinRpm - this.minRpm ) / cfg.dynIdleMinRpm;
			this._dynIdle = clamp( this._dynIdle + falta * DYN_IDLE_GAIN * ( 1 / 1000 ), 0, DYN_IDLE_MAX );
			idle += this._dynIdle;

		}

		const range = 1 - idle;

		for ( let i = 0; i < n; i ++ ) {

			this.motor[ i ] = clamp( idle + range * ( t + this.motorMix[ i ] ), idle, 1 );

		}

	}

	/**
	 * Limitador de RPM al estilo del gobernador de Betaflight. Apagado por
	 * defecto: el quad de referencia no lo usa, pero forma parte del modelo.
	 * @param {number} dt
	 * @param {number} averageRpm media de los cuatro rotores
	 */
	applyRpmLimit( dt, averageRpm ) {

		const cfg = this.cfg;
		if ( ! cfg.rpmLimit || cfg.rpmLimitValue <= 0 ) return;

		const a = pt1Alpha( dt, cfg.rpmLimitLpfHz );
		this._govPrevRpm += ( averageRpm - this._govPrevRpm ) * a;

		const error = this._govPrevRpm - cfg.rpmLimitValue;
		this._govI = Math.max( 0, this._govI + error * cfg.rpmLimitI * dt );
		const d = ( error - this._govPrevError ) / dt * cfg.rpmLimitD;
		this._govPrevError = error;

		const cut = ( error * cfg.rpmLimitP + this._govI + d ) / cfg.rpmLimitValue;
		if ( cut <= 0 ) return;

		const idle = cfg.motorIdle;
		for ( let i = 0; i < this.motorCount; i ++ ) {

			this.motor[ i ] = clamp( this.motor[ i ] - cut, idle, 1 );

		}

	}

}

/**
 * Geometría de mezclador de un cuadricóptero en X.
 *
 * Misma estructura que la tabla QUAD_X del firmware (qué motores forman pareja
 * en cada eje), con los signos elegidos para nuestro convenio: +roll a la
 * derecha sube los motores de la izquierda, +pitch morro arriba sube los
 * delanteros, +yaw a la derecha sube los que giran en sentido antihorario.
 */
export const QUAD_X = [
	{ name: 'FR', roll: - 1, pitch: 1, yaw: - 1, dir: - 1 },
	{ name: 'FL', roll: 1, pitch: 1, yaw: 1, dir: 1 },
	{ name: 'RR', roll: - 1, pitch: - 1, yaw: 1, dir: 1 },
	{ name: 'RL', roll: 1, pitch: - 1, yaw: - 1, dir: - 1 },
];
