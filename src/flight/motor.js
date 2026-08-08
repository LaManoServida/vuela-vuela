/**
 * Motor brushless + variador (ESC), modelo eléctrico.
 *
 * El gas no manda sobre las RPM directamente: manda sobre el ciclo de trabajo,
 * que junto con la fuerza contraelectromotriz y las resistencias del circuito
 * decide la corriente, y la corriente da el par. De ahí salen tres cosas que se
 * notan pilotando: el motor tarda en subir de vueltas, pierde punch con la
 * batería baja, y el límite de corriente aplana el acelerón a fondo.
 */

const clamp = ( v, lo, hi ) => v < lo ? lo : v > hi ? hi : v;

/** Interpola una tabla de respuesta del ESC (gas de entrada → mando efectivo). */
function curveLookup( table, x ) {

	if ( ! table || table.length < 2 ) return x;

	const t = clamp( x, 0, 1 ) * ( table.length - 1 );
	const i = Math.min( table.length - 2, Math.floor( t ) );
	const f = t - i;
	return table[ i ] * ( 1 - f ) + table[ i + 1 ] * f;

}

export class Motor {

	constructor( motorCfg, escCfg ) {

		this.cfg = motorCfg;
		this.esc = escCfg;

		// Kt y KV son la misma constante física en unidades distintas:
		// Kt[N·m/A] = 60/(2π·KV[RPM/V]). Un motor de muchas KV gira mucho y
		// empuja poco por amperio, y no hay margen de diseño en eso.
		this.kt = 60 / ( 2 * Math.PI * motorCfg.kv ) * motorCfg.ktEfficiency;

		// El límite efectivo es una mezcla del límite del motor y el del ESC,
		// con más peso para el más restrictivo.
		const im = motorCfg.currentLimit, ie = escCfg.currentLimit;
		this.currentLimit = im > ie ? 0.75 * ie + 0.25 * im : 0.75 * im + 0.25 * ie;

		this.reset();

	}

	reset() {

		this.input = 0;         // mando del mezclador, 0..1
		this.duty = 0;
		this.current = 0;
		this.backEmf = 0;
		this.driveVolts = 0;
		this.torque = 0;
		this.cutoff = false;

	}

	/**
	 * @param {number} throttle   salida del mezclador para este motor, 0..1
	 * @param {number} rpm        RPM actuales del rotor
	 * @param {number} packVolts  tensión de la batería bajo carga
	 * @param {number} packR      resistencia interna del pack
	 * @param {boolean} cutoff    corte por tensión baja
	 */
	update( throttle, rpm, packVolts, packR, cutoff ) {

		const cfg = this.cfg;
		const esc = this.esc;

		// Curva de respuesta del ESC: la relación mando→empuje de un variador
		// real no es una recta.
		const drive = curveLookup( esc.curve, clamp( throttle, 0, 1 ) );
		this.input = drive;

		this.backEmf = rpm / cfg.kv * cfg.emfFactor;

		// Un variador es lazo abierto: aplica el ciclo de trabajo que le pide el
		// mando y punto. No mide las RPM ni las regula. Las vueltas a las que se
		// estabiliza el motor salen solas del equilibrio entre el par que da y el
		// que le pide la hélice.
		this.duty = clamp( drive, 0, 1 );

		// Ecuación del motor con PWM: la tensión media aplicada es duty·V y la
		// fuerza contraelectromotriz se le opone entera.
		//
		// Aquí había `|duty|·(V − backEmf)/R`, que escala la contraelectromotriz
		// con el ciclo de trabajo: no es así, se opone siempre igual. Ese error
		// dejaba al motor embalarse, y se compensaba con un regulador de velocidad
		// que estrangulaba el duty al 16 % —de ahí que las RPM tardaran tanto en
		// cambiar y que el dron rebotara al soltar el stick de alabeo o cabeceo—.
		this.driveVolts = this.duty * packVolts - this.backEmf;

		const resistance = cfg.resistance + esc.resistance + packR;
		let current = this.driveVolts / resistance;

		// Corriente negativa = el motor gira más deprisa de lo que el variador le
		// pide y devuelve energía. Con frenado activo el ESC cortocircuita las
		// fases y ese par retiene; sin él, el motor va libre y sólo lo frena la
		// hélice.
		if ( current < 0 && ! esc.braking ) current = 0;

		current = clamp( current, - this.currentLimit, this.currentLimit );

		this.cutoff = cutoff;
		if ( cutoff ) current = 0;

		this.current = current;

		// τ = Kt·(I − I₀). La corriente en vacío es lo que se come el motor en
		// rozamiento y hierro antes de dar par útil.
		this.torque = this.kt * ( current - cfg.noLoadCurrent );

		return this.torque;

	}

}

export { curveLookup };
