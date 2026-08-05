/**
 * Pack de LiPo: tensión en reposo según la carga restante, más la caída bajo
 * consumo por resistencia interna.
 *
 * Importa para el pilotaje: la misma posición de gas da menos vueltas con el
 * pack a media descarga, y un acelerón fuerte hunde la tensión de golpe (sag),
 * que es el "se queda sin punch" del final de la batería.
 */

// Curva de descarga típica de una celda de litio-polímero (V en reposo por SoC).
const SOC = [ 0.00, 0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00 ];
const CELL_V = [ 3.27, 3.50, 3.61, 3.70, 3.75, 3.79, 3.85, 3.91, 3.98, 4.02, 4.11, 4.20 ];

const clamp = ( v, lo, hi ) => v < lo ? lo : v > hi ? hi : v;

export class Battery {

	constructor( cfg ) {

		this.cfg = cfg;
		this.reset();

	}

	reset() {

		this.charge = 1;              // 0..1
		this.current = 0;             // A totales
		this.voltage = this.restingVoltage();
		this.consumedMah = 0;

	}

	get packResistance() {

		return this.cfg.cells * this.cfg.cellR;
	}

	/** Tensión por celda en reposo, interpolada de la curva de descarga. */
	cellVoltage( soc = this.charge ) {

		const s = clamp( soc, 0, 1 );
		let i = 0;
		while ( i < SOC.length - 2 && SOC[ i + 1 ] < s ) i ++;

		const span = SOC[ i + 1 ] - SOC[ i ];
		const f = span > 0 ? ( s - SOC[ i ] ) / span : 0;
		const v = CELL_V[ i ] * ( 1 - f ) + CELL_V[ i + 1 ] * f;

		// Reescala si el pack declara otros extremos que los de la curva.
		const { cellFullV, cellFlatV } = this.cfg;
		return cellFlatV + ( v - CELL_V[ 0 ] ) / ( CELL_V[ CELL_V.length - 1 ] - CELL_V[ 0 ] )
			* ( cellFullV - cellFlatV );

	}

	restingVoltage( soc = this.charge ) {

		return this.cfg.cells * this.cellVoltage( soc );

	}

	/**
	 * @param {number} dt
	 * @param {number} totalCurrent suma de la corriente de los cuatro motores (A)
	 */
	update( dt, totalCurrent ) {

		this.current = totalCurrent;

		// Caída bajo carga: es la parte que se recupera al soltar gas.
		this.voltage = Math.max( 0, this.restingVoltage() - totalCurrent * this.packResistance );

		const mah = totalCurrent * dt / 3.6;   // A·s → mAh
		this.consumedMah += mah;

		if ( this.cfg.capacityAh > 0 ) {

			this.charge = clamp( this.charge - mah / ( this.cfg.capacityAh * 1000 ), 0, 1 );

		}

		return this.voltage;

	}

	/** Corte por tensión baja: el ESC deja de dar corriente. */
	get cutoff() {

		return this.voltage > 0 && this.voltage / this.cfg.cells < this.cfg.cutoffCellV;

	}

}
