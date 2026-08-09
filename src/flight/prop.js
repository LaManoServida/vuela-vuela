/**
 * Hélice: elemento de pala + teoría de cantidad de movimiento.
 *
 * En vez de "empuje = k · gas", cada rotor resuelve de verdad su aerodinámica:
 * calcula el ángulo de ataque de la pala a partir del flujo que la atraviesa,
 * saca Cl y Cd de la polar, y de ahí empuje y par resistente. Es lo que hace
 * que el dron pierda sustentación al caer sobre su propia estela, que el empuje
 * baje al volar rápido y que el motor tenga que trabajar más al cargar la pala.
 *
 * Referencias públicas: teoría de cantidad de movimiento clásica y la curva
 * empírica de Johnson para el anillo de vórtices (Helicopter Theory, §3-4).
 */

const RHO = 1.225;              // densidad del aire a nivel del mar, kg/m³
const IN_TO_M = 0.0254;

const clamp = ( v, lo, hi ) => v < lo ? lo : v > hi ? hi : v;

/**
 * Velocidad inducida en el disco por teoría de cantidad de movimiento.
 *
 * @param {number} vh  velocidad inducida en estacionario, √(T/2ρA)
 * @param {number} v   componente axial del aire (>0 = ascenso)
 */
function inducedVelocity( vh, v ) {

	if ( vh <= 1e-6 ) return 0;

	// Ascenso y estacionario: solución exacta.
	if ( v >= 0 ) return - v / 2 + Math.sqrt( v * v / 4 + vh * vh );

	const ratio = v / vh;

	// Descenso rápido (molinete): también exacta.
	if ( ratio <= - 2 ) return - v / 2 - Math.sqrt( v * v / 4 - vh * vh );

	// Entre -2 y 0 la teoría no vale: es la región del anillo de vórtices, donde
	// el rotor cae dentro de su propia estela. Ajuste empírico de Johnson.
	const r = ratio;
	const r2 = r * r;
	return vh * ( 1 - 1.125 * r - 1.372 * r2 - 1.718 * r2 * r - 0.655 * r2 * r2 );

}

export class Prop {

	constructor( cfg ) {

		this.cfg = cfg;

		this.diameter = cfg.diameterIn * IN_TO_M;
		this.radius = this.diameter / 2;
		this.pitch = cfg.pitchIn * IN_TO_M;
		this.chord = cfg.chordMm / 1000;

		// Estación representativa de la pala: 0.4·D = 0.8·R, el radio donde el
		// elemento de pala se aproxima mejor a la integral completa.
		this.stationRadius = 0.4 * this.diameter;
		this.pitchAngle = Math.atan( this.pitch / ( 2 * Math.PI * this.stationRadius ) );

		// Superficie de pala geométrica (se descuenta el buje) y de disco.
		const h = cfg.hubFraction;
		this.bladeArea = cfg.blades * this.chord * this.radius * ( 1 - h );
		this.discArea = Math.PI * this.radius * this.radius;

		// Área equivalente para la formulación de estación representativa.
		//
		// El empuje real es la integral a lo largo de la pala:
		//   T = N·∫ ½ρ(ωr)²·c·Cl dr = ½ρ·c·N·Cl·ω²·R³(1−h³)/3
		// pero aquí se evalúa una sola sección, a 0.8R. Escribir la integral como
		//   T = ½ρ·(0.8Rω)²·Cl·A_eq
		// obliga a que A_eq = c·N·R·(1−h³)/(3·0.64). Usar la superficie geométrica
		// a secas sobrestimaría el empuje un 55 %: la parte interior de la pala se
		// mueve mucho más despacio que la sección de referencia.
		this.liftArea = cfg.blades * this.chord * this.radius * ( 1 - h * h * h ) / ( 3 * 0.64 );

		// Potencia de perfil: ½ρ·c·N·∫(ωr)³dr = ½ρ·c·N·R⁴(1−h⁴)/4 · Cd·ω³
		this.dragPowerFactor = 0.5 * RHO * this.chord * cfg.blades
			* Math.pow( this.radius, 4 ) * ( 1 - Math.pow( h, 4 ) ) / 4;

		this.inertia = cfg.inertia;

		this.reset();

	}

	reset() {

		this.omega = 0;             // rad/s
		this.downwash = 0;          // m/s, velocidad inducida suavizada
		this.thrust = 0;            // N
		this.torque = 0;            // N·m resistente
		this.cl = 0;
		this.cd = 0;
		this.alpha = 0;
		this.vrs = 0;               // 0..1, severidad del anillo de vórtices
		this._vrsWash = 0;
		this._vrsPhase = 0;

	}

	get rpm() {

		return this.omega * 30 / Math.PI;

	}

	/**
	 * Resuelve un paso de la aerodinámica del rotor.
	 *
	 * @param {number} dt
	 * @param {number} axialV     componente del aire a lo largo del eje del rotor (>0 = ascenso)
	 * @param {number} lateralV   módulo de la componente transversal
	 * @param {number} groundGain multiplicador por efecto suelo (1 = sin efecto)
	 */
	update( dt, axialV, lateralV, groundGain ) {

		const cfg = this.cfg;
		const omega = this.omega;

		// Velocidad de la sección representativa.
		const bladeSpeed = this.stationRadius * omega;

		// Ángulo de ataque = paso geométrico − ángulo del flujo entrante.
		// El downwash resta ángulo: por eso un rotor cargado da menos de lo que
		// su paso prometería, y por eso caer sobre la propia estela mata el empuje.
		const inflow = axialV + this.downwash * cfg.washFactor + this._vrsWash;

		let alpha = this.pitchAngle;
		if ( bladeSpeed > 0.05 ) alpha = this.pitchAngle - inflow / bladeSpeed;

		this.alpha = alpha;

		// Polar de la pala.
		const cl = clamp( cfg.dClByAlpha * alpha, cfg.clMin, cfg.clMax );
		// Con Cl negativo el perfil trabaja al revés y arrastra mucho más.
		const clForDrag = cl > 0 ? cl : 1.4 * cl;
		const cd = cfg.cd0 + cfg.dCdByCl2 * clForDrag * clForDrag;

		this.cl = cl;
		this.cd = cd;

		// --- Empuje: T = ½ρW²·Cl·A ---
		// W es la velocidad RESULTANTE que ve la pala, no sólo la tangencial: la
		// pala también avanza contra el flujo axial. En estacionario el flujo axial
		// son 15 m/s contra 115 de punta y esto cambia el empuje un 1,7 %, nada.
		// Pero con el rotor casi parado y el aire cruzando a 12 m/s es al revés, y
		// usar sólo la tangencial subestimaba las fuerzas nueve veces: por eso la
		// hélice no llegaba a arrancar en molinete y se quedaba clavada a 785 RPM
		// cuando debería girar a unas 6.000.
		const relSpeedSq = bladeSpeed * bladeSpeed + inflow * inflow;
		let thrust = 0.5 * RHO * relSpeedSq * cl * this.liftArea;

		// Deformación de pala: a partir de cierta velocidad la pala flexa, pierde
		// paso efectivo y el empuje deja de crecer como debería.
		if ( cfg.deformPercent > 0 && bladeSpeed > cfg.deformMin ) {

			const t = clamp( ( bladeSpeed - cfg.deformMin ) / ( cfg.deformMax - cfg.deformMin ), 0, 1 );
			// Suavizado cúbico para que no haya un codo en la curva de empuje.
			thrust *= 1 - cfg.deformPercent * t * t * ( 3 - 2 * t );

		}

		thrust *= groundGain;
		this.thrust = thrust;

		// --- Velocidad inducida (cantidad de movimiento) ---
		const vh = Math.sqrt( Math.abs( thrust ) / ( 2 * RHO * this.discArea ) );
		let vi = inducedVelocity( vh, axialV );
		if ( thrust < 0 ) vi = - vi;

		// El aire que cruza el disco de lado se lleva la estela: menos downwash
		// en vuelo rápido, que es de donde sale la ganancia de empuje en traslación.
		const trans = lateralV * lateralV / cfg.translationalRelief;
		const washTarget = vi / ( 1 + trans );

		// Paso bajo: la estela tarda en establecerse (constante de tiempo real).
		const k = Math.min( 1, dt * cfg.washRate );
		if ( Number.isFinite( washTarget ) ) this.downwash += ( washTarget - this.downwash ) * k;

		// --- Anillo de vórtices ---
		// La curva de Johnson resuelve el flujo *medio*, y con ella el empuje
		// hasta subiría al descender. Lo que hunde de verdad a un rotor que cae
		// dentro de su estela es la recirculación: aire que ya ha pasado por el
		// disco vuelve a entrar. Eso no lo ve un modelo de flujo medio, así que
		// se añade aparte, con una campana centrada donde el fenómeno es peor
		// (velocidad de caída ≈ 1.1 veces la inducida) y nulo fuera de la banda.
		// Apagable desde el fichero. Es el único fenómeno del modelo que puede
		// dejar al piloto sin salida: entre 5 y 9 m/s de caída el empuje se
		// hunde por debajo del peso aunque metas gas, y hay que caer hasta 12
		// m/s para volver a ganarle. Con `vortexRing: false` la severidad se
		// queda en cero y con ella se van la pérdida de empuje, el temblor y el
		// aviso del OSD, que se enciende con este mismo número.
		let severity = 0;
		if ( cfg.vortexRing && axialV < 0 && vh > 1e-6 ) {

			const r = - axialV / vh;
			if ( r < 2.2 ) {

				const d = ( r - 1.1 ) / 0.55;
				severity = Math.exp( - d * d );

			}

		}

		this.vrs += ( severity - this.vrs ) * Math.min( 1, dt * 6 );

		// Y es un fenómeno inestable: el rotor entra y sale de la recirculación,
		// que es el temblor característico de caer en vertical.
		this._vrsPhase += dt * cfg.vrsBuffetHz * 2 * Math.PI;
		const buffet = 1 + cfg.vrsBuffet * Math.sin( this._vrsPhase );
		this._vrsWash = this.vrs * vh * cfg.vrsGain * buffet;

		// --- Par: τ = P/ω, con P del flujo axial + de perfil ---
		// El factor κ recoge lo que la teoría ideal no ve: reparto no uniforme del
		// flujo y pérdidas de punta. Sin él la hélice saldría más eficiente de lo
		// que puede ser ninguna hélice real.
		//
		// La potencia del flujo va con el flujo axial COMPLETO que atraviesa el
		// disco, no sólo con la velocidad inducida: P = T·(V + vi). Aquí estaba
		// puesto sólo `downwash`, y faltaba el término T·V, que es la potencia de
		// ascenso. En estacionario V = 0 y no cambia nada; subiendo, la hélice pide
		// esa potencia de más; y cayendo o con el gas cortado en pleno ascenso, el
		// término se vuelve negativo y **el aire arrastra la hélice**. Eso es el
		// molinete, y sin él el rotor se paraba en seco aunque le pasara el aire a
		// 12 m/s: el mezclador se quedaba sin autoridad, la I se cargaba contra un
		// error que no podía corregir y la soltaba de golpe al volver las vueltas.
		//
		// Por eso el par ya no se fuerza a ser positivo: una hélice que sólo sabe
		// frenar no es una hélice.
		const flowPower = cfg.inducedPowerFactor * thrust * inflow;
		const profilePower = this.dragPowerFactor * cd * omega * omega * omega;

		this.torque = omega > 0.05 ? ( flowPower + profilePower ) / omega : 0;

		return this.thrust;

	}

	/** Integra la velocidad del rotor con el par neto del motor. */
	spin( dt, motorTorque, totalInertia ) {

		this.omega += dt * ( motorTorque - this.torque ) / totalInertia;
		if ( this.omega < 0 ) this.omega = 0;

	}

}

export { RHO };
