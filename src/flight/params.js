/**
 * Parámetros físicos de los aparatos.
 *
 * Todo son magnitudes con unidades reales: kilos, metros, kg·m², ohmios,
 * amperios. Nada de "factor de empuje" ajustado a ojo. Los números de hardware
 * son los de componentes que existen (motor EMAX MT2204, hélice Gemfan 5146,
 * LiPo 4S 1300 mAh) y los del controlador son los de una tune de Betaflight
 * normal para 5 pulgadas.
 */

/**
 * Curva de respuesta de un variador de 5": mando de entrada → mando efectivo.
 * No es una recta; la zona baja tiene menos resolución de la que parece.
 */
const ESC_CURVE_5INCH = [
	0.000, 0.011, 0.023, 0.034, 0.045, 0.057, 0.068, 0.080, 0.091, 0.103,
	0.115, 0.128, 0.140, 0.153, 0.165, 0.178, 0.191, 0.205, 0.218, 0.232,
	0.246, 0.260, 0.274, 0.288, 0.303, 0.317, 0.331, 0.345, 0.360, 0.374,
	0.388, 0.403, 0.418, 0.433, 0.448, 0.463, 0.479, 0.495, 0.511, 0.527,
	0.543, 0.558, 0.573, 0.589, 0.604, 0.620, 0.636, 0.653, 0.670, 0.687,
	0.705, 0.724, 0.742, 0.761, 0.780, 0.799, 0.819, 0.839, 0.860, 0.882,
	0.905, 0.928, 0.952, 0.976, 1.000,
];

/** Tune de Betaflight típica de 5" freestyle. */
function defaultBetaflight() {

	return {
		mode: 'acro',                  // 'acro' | 'angle' | 'horizon'

		// --- Rates ---
		rateType: 'betaflight',        // 'betaflight' | 'actual'
		rcRate: 0.95,
		superRate: 0.70,
		rcExpo: 0.00,
		rcYawRate: 0.80,
		superRateYaw: 0.70,
		rcYawExpo: 0.00,

		// --- PID (números de configurador, no ganancias crudas) ---
		pid: [
			{ p: 60, i: 45, dMax: 35, dMin: 25, f: 90 },   // roll
			{ p: 60, i: 45, dMax: 35, dMin: 25, f: 90 },   // pitch (igual que roll)
			{ p: 100, i: 45, dMax: 0, dMin: 0, f: 90 },    // yaw (sin D, como manda BF)
		],

		// --- Modos autonivelados ---
		angleStrength: 50,
		horizonStrength: 50,
		angleLimit: 55,                // grados

		// --- Correctores ---
		tpaRate: 0.20,                 // cuánto se atenúan P y D con el gas alto
		tpaBreakpoint: 0.65,
		antiGravityGain: 3.5,
		antiGravityCutoffHz: 15,
		itermRelax: true,
		itermRelaxCutoffHz: 15,
		dMinGain: 37,
		dMinAdvance: 20,

		// --- Filtros ---
		gyroLpfHz: 150,
		dtermLpfHz: 110,
		rcSmoothingHz: 28,             // suavizado del enlace de radio

		// --- Mezclador ---
		pidSumLimit: 500,
		pidSumLimitYaw: 400,
		throttleMid: 0.5,
		throttleExpo: 0.0,
		throttleCap: 1.0,
		airMode: true,
		motorIdle: 0.045,

		// --- Limitador de RPM (el gobernador de BF; normalmente apagado) ---
		rpmLimit: false,
		rpmLimitValue: 20000,
		rpmLimitP: 0.40,
		rpmLimitI: 0.40,
		rpmLimitD: 0.0006,
		rpmLimitLpfHz: 20,
	};

}

export const AIRFRAMES = {

	freestyle5: {
		id: 'freestyle5',
		name: '5" freestyle',
		hint: 'EMAX 2204 · Gemfan 5146 · 4S',

		frame: {
			mass: 0.601,                       // kg con batería
			// Tensor de inercia en ejes de cuerpo (x=cabeceo, y=guiñada, z=alabeo).
			// La guiñada casi dobla a las otras dos: toda la masa cuenta a brazo
			// completo. Es la razón de que el yaw se sienta más pesado.
			inertia: [ 0.0032, 0.0058, 0.0032 ],
			armRadius: 0.110,                  // m del centro al motor
			armAngle: 45,                      // grados desde el morro

			// Área de arrastre efectiva (Cd·A) por eje, m². La vertical es la
			// mayor: de plano el dron es una placa.
			dragArea: { x: 0.020, y: 0.030, z: 0.018 },
			angularDrag: 0.0016,               // N·m·s²/rad², amortiguamiento en giro
			gravityScale: 1.0,
		},

		motor: {
			kv: 2300,                          // RPM por voltio
			resistance: 0.0414,                // Ω por fase
			noLoadCurrent: 0.7,                // A, lo que se come en vacío
			currentLimit: 30,                  // A de pico (un 2204 no da más)
			ktEfficiency: 0.98,                // Kt real frente al ideal 60/(2π·KV)
			inertia: 1.8e-6,                   // kg·m², campana + imanes
			// Ganancia del lazo de velocidad del variador. Es el parámetro que
			// fija a qué RPM se estabiliza el motor con la hélice puesta: sin él
			// un 2300 KV a 4S subiría a 38.000 RPM en vacío teórico.
			msrGain: 0.30,
			rpmOffset: 2000,
			emfFactor: 1.0,
		},

		esc: {
			currentLimit: 30,
			resistance: 0.005,
			braking: true,
			cutoffCellV: 3.1,
			curve: ESC_CURVE_5INCH,
		},

		prop: {
			diameterIn: 5.1,
			pitchIn: 4.6,
			blades: 3,
			chordMm: 15,
			hubFraction: 0.20,
			inertia: 2.8e-6,                   // kg·m²
			// Polar de la pala.
			cd0: 0.035,
			dCdByCl2: 0.020,
			clMax: 0.70,
			clMin: - 0.80,
			dClByAlpha: 2.93,                  // por radián
			inducedPowerFactor: 1.15,          // κ: pérdidas de punta y flujo no uniforme
			// Estela.
			washFactor: 1.0,
			washRate: 20,                      // 1/s del paso bajo del downwash
			translationalRelief: 80,
			// Anillo de vórtices.
			vrsGain: 0.95,                     // recirculación en el pico, en unidades de vi
			vrsBuffet: 0.22,                   // amplitud del temblor
			vrsBuffetHz: 3.5,
			// Deformación de pala a alta carga (velocidad de sección, m/s).
			deformMin: 90,
			deformMax: 130,
			deformPercent: 0.12,
		},

		battery: {
			cells: 4,
			cellR: 0.003,                      // Ω por celda
			capacityAh: 1.3,
			cellFullV: 4.2,
			cellFlatV: 3.0,
			cutoffCellV: 3.1,
		},

		bf: defaultBetaflight(),
	},

};

/** Copia profunda: cada vuelo parte de los valores del preset, no de los tocados. */
export function cloneAirframe( id ) {

	const src = AIRFRAMES[ id ] || AIRFRAMES.freestyle5;
	return structuredClone( src );

}

export { defaultBetaflight, ESC_CURVE_5INCH };
