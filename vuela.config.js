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
	//  Modo de exploración
	// =====================================================================
	//  El modo normal precarga la zona entera y congela el recorrido del árbol
	//  de tiles: cero tirones garantizados, a cambio de que el mundo se acabe a
	//  22 km del despegue. En exploración las esferas de carga siguen al dron y
	//  el mundo no tiene borde, a cambio de que el detalle aparezca según llega.
	//
	//  Aquí no hay colisiones: la rejilla de vóxeles se construye de una vez
	//  sobre una zona finita, y en este modo no la hay. El dron atraviesa
	//  edificios y terreno.

	stream: {
		enabled: false,
		interval: 1.0,             // s entre recorridos del árbol de tiles
		budgetMs: 3,               // techo de trabajo por frame subiendo texturas
		memoryMb: 1500,            // presupuesto de la caché de tiles
	},

	// =====================================================================
	//  Imagen
	// =====================================================================

	renderScale: 1.0,          // multiplicador de resolución; bájalo antes que la calidad
	fov: 90,                   // grados, cámara FPV
	camTilt: 20,               // grados de inclinación de la cámara
	unlit: true,               // materiales planos: la textura fotogramétrica ya trae la luz horneada
	antialias: true,
	fogDensity: 0.9,           // multiplicador sobre la niebla automática

	// =====================================================================
	//  Juego
	// =====================================================================

	collisions: false,
	voxelSize: 2.0,            // m, resolución de la rejilla de colisión
	crashSpeed: 4.5,           // m/s de impacto que rompe el dron

	// Dibuja en rojo las celdas de colisión que rodean al dron. Es una ayuda de
	// depuración: sirve para ver si la rejilla se pega a las fachadas y contra qué
	// se está chocando de verdad. Se enciende y se apaga en la pausa, sin aterrizar.
	showGrid: false,
	gridRadius: 50,            // m, hasta dónde llega la vista de la rejilla
	gridRefresh: 1.0,          // s entre reconstrucciones de la ventana (0 = al cambiar de celda)

	// Qué pasa al chocar. Ninguno de los cinco tiene deslizador en el menú: se
	// tocan aquí, con el juego cerrado.
	restitution: 0.18,         // 0 = se queda pegado a la pared, 1 = rebota como una pelota
	friction: 0.45,            // rozamiento contra la superficie: 0 = patina, 1 = se clava
	maxSpin: 30,               // rad/s, tope del volteo que mete un impacto descentrado
	respawnDelay: 1.5,         // s desde el impacto hasta que reaparece solo (0 = al instante)

	battery: false,

	// =====================================================================
	//  Entrada
	// =====================================================================

	deadzone: 0.04,

	// Un mapeo por mando, con la clave que reporta el navegador (aparece en el
	// panel de mando, y es distinta en Chrome y en Firefox). El que esté aquí se
	// aplica solo al enchufarlo: mover un stick es todo el trámite. Los que no
	// estén se calibran en el panel, que te da este mismo trozo listo para pegar.
	gamepads: {

		'FeiYing Simulator - RealFlight R7 Controller (Vendor: 1781 Product: 0e56)': {
			roll:     { axis: 0, inv: false, zero: - 0.0196, min: - 0.9686, max: 0.9608 },
			pitch:    { axis: 1, inv: true,  zero: - 0.0196, min: - 0.9686, max: 0.9529 },
			yaw:      { axis: 4, inv: false, zero: - 0.0196, min: - 0.9686, max: 0.9294 },
			throttle: { axis: 2, inv: false, zero: - 0.0039, min: - 0.9686, max: 0.9608 },
		},

	},

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

		//  Calcado del TBS Oblivion de Velocidrone: los números salen de su
		//  `settings.db` (chasis 501, motor 301, variador 201, hélice 407,
		//  batería 104), no de un ajuste a ojo. Cada uno lleva al lado de dónde
		//  viene. Los tres que NO se copiaron están marcados con «no copiado» y
		//  explicados donde toca.
		name: 'TBS Oblivion',
		hint: 'Gemfan 5146 · 4S 1300',

		frame: {
			// 353 g de aparato, la ficha del Oblivion. La batería es un componente
			// aparte en la base de datos de Velocidrone, con su peso propio (176 g
			// el 4S 1300), y ahora se suma aparte también aquí: `frame.mass` sale
			// de esto más lo que pese el pack que lleves.
			//
			// Que el total son 529 y no 353 lo confirma la inercia que declara el
			// propio Velocidrone: con moi = 0.004 kg·m², un aparato de 353 g
			// exigiría que su masa central tuviera un radio de giro de 119 mm —más
			// largo que el brazo entero, 110— y eso no lo cumple ningún cuerpo
			// compacto. Con 529 g salen 89 mm, que sí.
			dryMass: 0.353,                    // kg sin batería

			// La inercia ya no se declara: sale de la masa y del brazo, en
			// `src/flight/derive.js`. Está calibrada con el 0.00175 que Velocidrone
			// declara para este chasis, que es la única de sus tres cifras (`moi`
			// 0.00175, `bf_model_moi` 0.003, `vd_model_moi` 0.004) que describe un
			// cuerpo que puede existir —descontados los cuatro motores a punta de
			// brazo, deja la masa central con 50 mm de radio de giro, un pack de 4S
			// y el stack, mientras que 0.004 exigía 89— y la que pone la respuesta
			// donde está la de un 5" de verdad: 24 ms al 63 % del rate en alabeo,
			// cuando con 0.004 eran 39.
			//
			// Simétrica en los tres ejes, como la declara Velocidrone. Un quad de
			// verdad no lo es —en guiñada toda la masa cuenta a brazo completo, así
			// que Izz ≈ Ixx+Iyy— y de ahí salen 14 ms de guiñada, más de lo que gira
			// ningún quad.

			armRadius: 0.110,                  // m del centro al motor
			armAngle: 45,                      // grados desde el morro

			// Área de arrastre efectiva (Cd·A) por eje, m², de `dragCoef` (0.014)
			// por las áreas del chasis: Xarea 0.53, Yarea 1.0, Zarea 0.285.
			//
			// Es EL número que separaba a los dos aparatos. El de antes (0.018 de
			// frente) era 4,5 veces éste y dejaba la punta en 118 km/h: por eso
			// se inclinaba y no iba.
			//
			// Es la del aparato de referencia: la de verdad escala con el brazo.
			dragAreaRef: { x: 0.00742, y: 0.014, z: 0.00399 },

			angularDrag: 0.001,                // angular_drag_coeff
			gravityScale: 1.0,
		},

		// Velocidrone etiqueta este motor «EMAX MT2204-2300», pero los números que
		// le da —2500 KV y 50 A de pico— no son los de un 2204, que se queda en
		// unos 30 A. Son de un 2207. Manda la ficha, no la etiqueta: con ella
		// salen 779 g por motor y 5,89 de empuje/peso, que es un 5" moderno.
		motor: {
			// No copiado. Velocidrone declara `FlEqMotorKV` 2500 y `FlEqMotorR`
			// 0.04142, y ese par no puede dar el aparato que describe el resto de
			// su ficha: con un variador aplicando el ciclo de trabajo entero, un
			// 2500 KV a 4S con esta hélice se va a 33.800 RPM y 1.731 g por motor
			// —un empuje/peso de 13, que no es un 5"—. Antes se cuadraba
			// estrangulando el variador al 16 % de ciclo, y el precio era que las
			// RPM tardaban un mundo en cambiar: de ahí el rebote al soltar el
			// stick de alabeo o cabeceo.
			//
			// Estos dos son la única pareja que da el punto de funcionamiento del
			// Oblivion —21.250 RPM y 775 g por motor— con el variador a fondo Y
			// con una resistencia coherente con su propio KV (escala con 1/KV²).
			// El aparato vuela igual en régimen; lo que cambia es que ahora tiene
			// todo el margen de tensión disponible para los transitorios.
			kv: 1428,

			// La resistencia ya no se declara: sale del KV con 1/KV², calibrada en
			// los 0.1270 Ω que hacen pareja con estos 1428.

			noLoadCurrent: 0.7,                // FlEqMotorNoLoadCurrent
			currentLimit: 50,                  // FlEqMotorILimit

			// No copiado: Velocidrone pone 0.85 en `FlEqMotorEfficiency`, pero eso
			// es un rendimiento global de su modelo, no el Kt real frente al ideal
			// 60/(2π·KV) que se pide aquí. A 0.85 el empuje/peso baja de 5,89 a
			// 5,48 y el alabeo se va de 39 a 42 ms.
			ktEfficiency: 0.98,

			// Copiado a sabiendas de que no es física: `FlEqMotorMoI` vale 1e-8, y
			// la campana de un motor de este tamaño son microgramos·m² —unos
			// 1.8e-6, diez gramos girando a 13 mm—, no nanogramos. Es el apaño con
			// el que el modelo de Velocidrone compensa no integrar el rotor.
			//
			// Va porque es lo que le da al Oblivion su respuesta en alabeo: 39 → 31
			// ms y el sobrepico del 20 % al 10 %.
			//
			// No sale gratis. La guiñada de un quad no viene del empuje sino de la
			// reacción al par con que el motor acelera su propio rotor, y un rotor
			// que no pesa no reacciona: 42 → 49 ms. Por la misma vía se apaga la
			// precesión giroscópica, aunque ahí el controlador la corrige tan
			// deprisa que no se lee en la actitud.
			//
			// O sea: 8 ms de alabeo a cambio de 7 de guiñada. Devolver 1.8e-6 es
			// deshacer el cambio entero.
			inertia: 1.8e-6,                   // kg·m², campana + imanes

			emfFactor: 1.0,
		},

		esc: {
			currentLimit: 50,                  // FlEqESCILimit
			resistance: 0.005,                 // Ω
			braking: true,                     // FlEqESCBraking
			cutoffCellV: 3.1,                  // FlEqESCCutoffV

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
			hubFraction: 0.20,

			// Cuerda e inercia ya no se declaran: salen del diámetro y del número
			// de palas por semejanza geométrica, calibradas en los 15 mm y los
			// 2.8e-6 kg·m² de esta hélice.

			// Polar de la pala (hélice 407, la Gemfan 5146).
			cd0: 0.03,                         // FlEqPropCd0
			dCdByCl2: 0.020,
			clMax: 0.70,
			clMin: - 0.80,
			dClByAlpha: 2.93,                  // por radián
			inducedPowerFactor: 1.15,          // κ: pérdidas de punta y flujo no uniforme

			// Estela.
			washFactor: 1.0,
			washRate: 20,                      // 1/s del paso bajo del downwash
			translationalRelief: 80,

			// Anillo de vórtices: caer sobre la propia estela y quedarse sin
			// empuje. Apagado a propósito.
			//
			// Es el único fenómeno del modelo que deja al piloto sin salida. Con
			// él, cayendo entre 5 y 9 m/s el empuje se queda por debajo del peso
			// aunque metas el 35 % de gas —0.88 del peso en lo peor— y no lo
			// recuperas hasta los 12 m/s de caída. Sumado a que el punto de
			// sustentación es inestable hacia abajo, el dron se cuela solo en esa
			// banda y desde dentro el gas parece no hacer nada, con el temblor de
			// 3,5 Hz encima. Sin él el empuje pasa de 0.88 a 1.13 del peso en el
			// mismo punto: siempre hay salida.
			//
			// A true vuelve todo, incluido el aviso del OSD.
			vortexRing: false,
			vrsGain: 0.95,                     // recirculación en el pico, en unidades de vi
			vrsBuffet: 0.22,                   // amplitud del temblor
			vrsBuffetHz: 3.5,

			// Deformación de pala a alta carga (velocidad de sección, m/s). La
			// 5146 de Velocidrone no empieza a flexar hasta 140 m/s; la de antes
			// lo hacía desde 90, o sea desde 16.600 RPM, y se comía hasta un 12 %
			// del empuje justo en la parte alta del gas.
			deformMin: 140,
			deformMax: 180,
			deformPercent: 0.15,
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
			// A partir de este % de saturación del mezclador la I deja de integrar.
			// Cuando la mezcla no cabe en el rango de los motores el controlador ya
			// no manda, y seguir integrando allí carga la I contra un error que no
			// puede corregir: al recuperar autoridad la suelta de golpe. Bajarlo
			// congela antes y es la palanca si algún transitorio se resiste.
			itermWindup: 85,                   // el de Betaflight

			itermRelax: true,
			itermRelaxCutoffHz: 15,
			dMinGain: 37,
			dMinAdvance: 20,

			// --- Filtros ---
			gyroLpfHz: 150,
			dtermLpfHz: 110,

			// Suavizado del enlace de radio. Betaflight no lo fija a mano: lo
			// calcula desde la cadencia del receptor, con
			//   corte = Hz_enlace · 1.5 / (1 + rc_smoothing_auto_factor / 10)
			// y el factor por defecto (30) deja eso en Hz_enlace · 0.375. Un ELRS
			// a 250 Hz sale a 94; un Crossfire a 150 Hz, a 56. El 28 de antes
			// equivalía a un enlace de 75 Hz —más lento que cualquier emisora
			// moderna— y metía 16 ms de retraso puro entre el stick y el setpoint,
			// que es la mitad de lo que se tardaba en empezar a girar.
			rcSmoothingHz: 94,

			// --- Mezclador ---
			pidSumLimit: 500,
			pidSumLimitYaw: 400,
			throttleMid: 0.5,
			throttleExpo: 0.0,
			throttleCap: 1.0,
			airMode: true,
			// RPM por debajo de las cuales el ralentí sube solo para que las
			// hélices no se calen. Cortar el gas del todo en pleno ascenso las
			// dejaba a 550 RPM, y ahí el dron se desestabiliza solo. 0 lo apaga.
			dynIdleMinRpm: 3500,               // `dyn_idle_min_rpm` de Betaflight

			motorIdle: 0.04,               // minthrottle 1040 de tu loadout

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
	//  Esto es el recorrido de los DESLIZADORES, no el rango válido de cada
	//  valor: son cosas distintas y conviene no confundirlas. `ui.radius` llega
	//  a 3000 porque es lo cómodo de ofrecer con el ratón, no porque 3500 sea
	//  imposible; lo que de verdad admite el código (que el radio sea un número
	//  positivo, que la banda muerta no llegue a 1, que el tamaño de vóxel no
	//  sea 0) es el contrato de `src/config.js`, y ése es el que hace fallar el
	//  arranque. Aquí sólo se decide qué ofrece el menú.
	//
	//  Cada entrada tiene que tener un control en `menu.js` que la use: un rango
	//  que no gobierna ningún deslizador es peso muerto y el test lo caza. Por
	//  eso los valores sin control —`voxelSize`, `crashSpeed`, `deadzone`,
	//  `restitution`, `friction`, `maxSpin`— NO aparecen aquí.
	//
	//  `path` es la ruta al valor que ese control gobierna: sirve para
	//  comprobar al arrancar que el valor de arriba existe y cae dentro de su
	//  propio rango. Las entradas sin `path` son rangos compartidos por varios
	//  controles.

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

		mass:          { path: 'flight.frame.dryMass', min: 0.05, max: 0.8, step: 0.005 },
		armRadius:     { path: 'flight.frame.armRadius', min: 0.05, max: 0.30, step: 0.005 },
		// Baja hasta 0.002 y con paso fino porque aquí abajo es donde vive un
		// chasis limpio: el Oblivion son 0.00399 m² de frente, y con el mínimo en
		// 0.004 el deslizador no llegaba ni a su propio valor.
		dragFront:     { path: 'flight.frame.dragAreaRef.z', min: 0.002, max: 0.06, step: 0.0005 },
		motorKv:       { path: 'flight.motor.kv', min: 1200, max: 4000, step: 10 },
		motorCurrent:  { path: 'flight.motor.currentLimit', min: 10, max: 60, step: 1 },
		propDiameter:  { path: 'flight.prop.diameterIn', min: 2, max: 7, step: 0.1 },
		propPitch:     { path: 'flight.prop.pitchIn', min: 2, max: 7, step: 0.1 },
		batteryCells:  { path: 'flight.battery.cells', min: 2, max: 8, step: 1 },
		batteryAh:     { path: 'flight.battery.capacityAh', min: 0.3, max: 3, step: 0.05 },
		propBlades:    { path: 'flight.prop.blades', min: 2, max: 5, step: 1 },
		gravityScale:  { path: 'flight.frame.gravityScale', min: 0, max: 2, step: 0.05 },

		// --- Juego ---
		voxelSize:     { path: 'voxelSize', min: 0.5, max: 8, step: 0.25 },
		crashSpeed:    { path: 'crashSpeed', min: 1, max: 20, step: 0.5 },
		gridRadius:    { path: 'gridRadius', min: 10, max: 150, step: 5 },
		gridRefresh:   { path: 'gridRefresh', min: 0, max: 5, step: 0.1 },
		restitution:   { path: 'restitution', min: 0, max: 1, step: 0.02 },
		friction:      { path: 'friction', min: 0, max: 1.5, step: 0.05 },
		maxSpin:       { path: 'maxSpin', min: 0, max: 60, step: 1 },
		respawnDelay:  { path: 'respawnDelay', min: 0, max: 10, step: 0.1 },
		deadzone:      { path: 'deadzone', min: 0, max: 0.3, step: 0.01 },

		// --- Controlador: lo que en Betaflight no está en la pantalla principal ---
		rcYawExpo:     { path: 'flight.bf.rcYawExpo', min: 0, max: 0.9, step: 0.01 },
		angleStrength: { path: 'flight.bf.angleStrength', min: 0, max: 100, step: 1 },
		horizonStrength: { path: 'flight.bf.horizonStrength', min: 0, max: 100, step: 1 },
		tpaBreakpoint: { path: 'flight.bf.tpaBreakpoint', min: 0, max: 0.95, step: 0.01 },
		antiGravityHz: { path: 'flight.bf.antiGravityCutoffHz', min: 1, max: 50, step: 1 },
		itermWindup:   { path: 'flight.bf.itermWindup', min: 30, max: 99, step: 1 },
		itermRelaxHz:  { path: 'flight.bf.itermRelaxCutoffHz', min: 1, max: 50, step: 1 },
		dMinGain:      { path: 'flight.bf.dMinGain', min: 0, max: 60, step: 1 },
		dMinAdvance:   { path: 'flight.bf.dMinAdvance', min: 0, max: 200, step: 5 },
		gyroLpfHz:     { path: 'flight.bf.gyroLpfHz', min: 50, max: 500, step: 5 },
		dtermLpfHz:    { path: 'flight.bf.dtermLpfHz', min: 30, max: 300, step: 5 },
		rcSmoothingHz: { path: 'flight.bf.rcSmoothingHz', min: 10, max: 200, step: 1 },
		pidSumLimit:   { path: 'flight.bf.pidSumLimit', min: 200, max: 1000, step: 10 },
		pidSumLimitYaw:{ path: 'flight.bf.pidSumLimitYaw', min: 200, max: 1000, step: 10 },
		throttleMid:   { path: 'flight.bf.throttleMid', min: 0, max: 1, step: 0.01 },
		throttleExpo:  { path: 'flight.bf.throttleExpo', min: 0, max: 1, step: 0.01 },
		throttleCap:   { path: 'flight.bf.throttleCap', min: 0.2, max: 1, step: 0.01 },
		dynIdleMinRpm: { path: 'flight.bf.dynIdleMinRpm', min: 0, max: 8000, step: 100 },
		motorIdle:     { path: 'flight.bf.motorIdle', min: 0, max: 0.2, step: 0.005 },
		rpmLimitValue: { path: 'flight.bf.rpmLimitValue', min: 5000, max: 40000, step: 500 },
		rpmLimitLpfHz: { path: 'flight.bf.rpmLimitLpfHz', min: 1, max: 100, step: 1 },

		// Compartido por las tres ganancias del limitador de RPM.
		rpmLimitGain:  { min: 0, max: 100, step: 1 },
	},

};
