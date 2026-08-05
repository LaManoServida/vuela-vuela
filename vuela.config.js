/*
 * Configuración de vuela-vuela.
 *
 * Este es el único sitio donde hay números ajustables. Se lee al arrancar y no
 * se reescribe nunca: edítalo a mano con el juego cerrado y recarga.
 *
 * Lo que toques desde el menú del juego se aplica al instante pero vive sólo en
 * memoria; al recargar vuelve a mandar lo que ponga aquí.
 *
 * La API key NO está en este fichero: es una credencial, va en `.env.local`
 * como VITE_GOOGLE_API_KEY. Así este fichero se puede versionar sin filtrarla.
 *
 * Todas las magnitudes están en unidades reales: kilos, metros, kg·m², ohmios,
 * amperios, grados. Los números de hardware son de componentes que existen
 * (motor EMAX MT2204, hélice Gemfan 5146, LiPo 4S 1300 mAh) y los del
 * controlador son los de una tune de Betaflight normal para 5 pulgadas.
 */

export default {

	// =====================================================================
	//  Zona de vuelo
	// =====================================================================

	placeId: 'nyc',            // id de `places`, o 'custom' si escribes lat/lon a mano
	lat: 40.7580,
	lon: - 73.9855,

	// Cuánto mapa se carga entero antes de despegar. Es EL parámetro que decide
	// el tiempo de carga y la memoria: el coste crece con el CUADRADO del radio.
	radius: 1100,              // m

	// Error geométrico objetivo dentro del radio. Menor = más detalle y más
	// descarga, también al cuadrado. 12 es alto; Google recomienda 20 para
	// navegación normal.
	quality: 12,

	spawnHeight: 45,           // m sobre el suelo

	// =====================================================================
	//  Imagen
	// =====================================================================

	renderScale: 1.0,          // multiplicador de resolución; bájalo antes que la calidad
	fov: 120,                  // grados, cámara FPV
	camTilt: 25,               // grados de inclinación de la cámara
	unlit: true,               // materiales planos: la textura fotogramétrica ya trae la luz horneada
	antialias: true,
	fogDensity: 0.9,           // multiplicador sobre la niebla automática

	// =====================================================================
	//  Juego
	// =====================================================================

	collisions: true,
	voxelSize: 2.0,            // m, resolución de la rejilla de colisión
	crashSpeed: 4.5,           // m/s de impacto que rompe el dron
	battery: true,

	// =====================================================================
	//  Entrada
	// =====================================================================

	inputMode: 'auto',         // 'auto' | 'gamepad' | 'mouse'
	deadzone: 0.04,
	mouseSens: 0.0028,

	// null = mapeo por defecto. Para fijar el tuyo a mano:
	//   { roll: { axis: 0, inv: false }, pitch: { axis: 1, inv: true },
	//     yaw:  { axis: 2, inv: false }, throttle: { axis: 3, inv: true } }
	gamepadMap: null,

	// =====================================================================
	//  Sitios
	// =====================================================================
	//  Buena cobertura fotogramétrica y volumen vertical interesante para FPV:
	//  cañones urbanos, puentes, costa.

	places: [
		{ id: 'nyc', name: 'Manhattan', hint: 'Midtown, Nueva York', lat: 40.7580, lon: - 73.9855 },
		{ id: 'gg', name: 'Golden Gate', hint: 'San Francisco', lat: 37.8199, lon: - 122.4783 },
		{ id: 'bcn', name: 'Sagrada Família', hint: 'Barcelona', lat: 41.4036, lon: 2.1744 },
		{ id: 'eiffel', name: 'Torre Eiffel', hint: 'París', lat: 48.8584, lon: 2.2945 },
		{ id: 'dubai', name: 'Dubai Marina', hint: 'Rascacielos + agua', lat: 25.0805, lon: 55.1403 },
		{ id: 'hk', name: 'Kowloon', hint: 'Hong Kong', lat: 22.3080, lon: 114.1700 },
		{ id: 'chi', name: 'Chicago River', hint: 'Cañón urbano', lat: 41.8885, lon: - 87.6250 },
		{ id: 'venice', name: 'Venecia', hint: 'Canales y campanile', lat: 45.4341, lon: 12.3388 },
		{ id: 'madrid', name: 'Gran Vía', hint: 'Madrid', lat: 40.4200, lon: - 3.7050 },
		{ id: 'rio', name: 'Cristo Redentor', hint: 'Río de Janeiro', lat: - 22.9519, lon: - 43.2105 },
		{ id: 'sydney', name: 'Ópera de Sídney', hint: 'Bahía', lat: - 33.8568, lon: 151.2153 },
		{ id: 'monaco', name: 'Mónaco', hint: 'Puerto y desnivel', lat: 43.7384, lon: 7.4246 },
	],

	// =====================================================================
	//  El aparato
	// =====================================================================

	flight: {

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
			currentLimit: 30,                  // A
			resistance: 0.005,                 // Ω
			braking: true,                     // frenado activo
			cutoffCellV: 3.1,                  // V por celda a la que corta

			// Curva de respuesta de un variador de 5": mando de entrada → mando
			// efectivo. No es una recta; la zona baja tiene menos resolución de
			// la que parece. 65 puntos equiespaciados de 0 a 1.
			curve: [
				0.000, 0.011, 0.023, 0.034, 0.045, 0.057, 0.068, 0.080, 0.091, 0.103,
				0.115, 0.128, 0.140, 0.153, 0.165, 0.178, 0.191, 0.205, 0.218, 0.232,
				0.246, 0.260, 0.274, 0.288, 0.303, 0.317, 0.331, 0.345, 0.360, 0.374,
				0.388, 0.403, 0.418, 0.433, 0.448, 0.463, 0.479, 0.495, 0.511, 0.527,
				0.543, 0.558, 0.573, 0.589, 0.604, 0.620, 0.636, 0.653, 0.670, 0.687,
				0.705, 0.724, 0.742, 0.761, 0.780, 0.799, 0.819, 0.839, 0.860, 0.882,
				0.905, 0.928, 0.952, 0.976, 1.000,
			],
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

		// -----------------------------------------------------------------
		//  Tune de Betaflight
		// -----------------------------------------------------------------
		//  Mismos nombres, unidades y escalas internas que el configurador de
		//  Betaflight: una tune que funcione aquí funciona en un dron real, y
		//  al revés. Puedes copiar los números de tu configurador tal cual.

		bf: {
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
				{ p: 60, i: 45, dMax: 35, dMin: 25, f: 90 },   // pitch
				{ p: 100, i: 45, dMax: 0, dMin: 0, f: 90 },    // yaw (sin D, como manda BF)
			],

			// --- Modos autonivelados ---
			angleStrength: 50,
			horizonStrength: 50,
			angleLimit: 55,                // grados

			// --- Correctores ---
			tpaRate: 0.20,                 // cuánto se atenúan P y D con el gas alto
			tpaBreakpoint: 0.65,           // fracción de gas; en BF es 1650 µs
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
		},

	},

	// =====================================================================
	//  Rangos de los controles del menú
	// =====================================================================
	//  `path` es la ruta al valor que ese control gobierna; sirve para que el
	//  test compruebe que el valor de arriba cae dentro de su propio rango.
	//  Las entradas sin `path` son rangos compartidos por varios controles.

	ui: {
		// Los campos de coordenadas son de escritura libre, pero declarar su
		// rango sirve para dos cosas: da el `step` del control y hace que una
		// latitud imposible se detecte al arrancar en vez de al pedir tiles.
		lat:           { path: 'lat', min: - 90, max: 90, step: 0.0001 },
		lon:           { path: 'lon', min: - 180, max: 180, step: 0.0001 },

		radius:        { path: 'radius', min: 300, max: 3000, step: 50 },
		quality:       { path: 'quality', min: 6, max: 40, step: 1 },
		spawnHeight:   { path: 'spawnHeight', min: 2, max: 300, step: 1 },

		fov:           { path: 'fov', min: 70, max: 160, step: 1 },
		camTilt:       { path: 'camTilt', min: 0, max: 55, step: 1 },
		renderScale:   { path: 'renderScale', min: 0.5, max: 1.5, step: 0.05 },
		fogDensity:    { path: 'fogDensity', min: 0, max: 2.5, step: 0.1 },

		rcRate:        { path: 'flight.bf.rcRate', min: 0.2, max: 2.5, step: 0.01 },
		superRate:     { path: 'flight.bf.superRate', min: 0, max: 0.95, step: 0.01 },
		rcExpo:        { path: 'flight.bf.rcExpo', min: 0, max: 0.9, step: 0.01 },
		rcYawRate:     { path: 'flight.bf.rcYawRate', min: 0.2, max: 2.5, step: 0.01 },
		superRateYaw:  { path: 'flight.bf.superRateYaw', min: 0, max: 0.95, step: 0.01 },
		angleLimit:    { path: 'flight.bf.angleLimit', min: 20, max: 80, step: 1 },
		antiGravity:   { path: 'flight.bf.antiGravityGain', min: 0, max: 10, step: 0.1 },
		tpaRate:       { path: 'flight.bf.tpaRate', min: 0, max: 0.8, step: 0.01 },

		// Compartido por las 12 casillas de la rejilla P/I/D/F.
		pidGain:       { min: 0, max: 250, step: 1 },

		mass:          { path: 'flight.frame.mass', min: 0.25, max: 1.4, step: 0.005 },
		armRadius:     { path: 'flight.frame.armRadius', min: 0.05, max: 0.30, step: 0.005 },
		dragFront:     { path: 'flight.frame.dragArea.z', min: 0.004, max: 0.06, step: 0.001 },
		motorKv:       { path: 'flight.motor.kv', min: 1200, max: 4000, step: 10 },
		motorCurrent:  { path: 'flight.motor.currentLimit', min: 10, max: 60, step: 1 },
		propDiameter:  { path: 'flight.prop.diameterIn', min: 2, max: 7, step: 0.1 },
		propPitch:     { path: 'flight.prop.pitchIn', min: 2, max: 7, step: 0.1 },
		batteryCells:  { path: 'flight.battery.cells', min: 2, max: 8, step: 1 },
	},

};
