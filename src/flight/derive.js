/*
 * Lo que se deduce del aparato, en vez de teclearse.
 *
 * Los números de `vuela.config.js` se copiaron uno a uno de la base de datos de
 * componentes de Velocidrone: cada uno es una medida de UN aparato, el TBS
 * Oblivion, no una fórmula. Eso reproduce ese aparato clavado y miente en cuanto
 * mueves un deslizador —la masa no llegaba a la inercia, el KV no llegaba a la
 * resistencia, el brazo no llegaba a ninguno de los dos—.
 *
 * Aquí cada magnitud acoplada se calcula de la que manda sobre ella, con la
 * forma «valor medido × ley de escala». Anclarlo en la medida y no en la física
 * de primeros principios tiene una ventaja concreta: en el punto de referencia
 * la ley vale 1 y sale EXACTAMENTE el número medido, sin redondeos. Lo que
 * cambia no es cómo vuela el Oblivion, es qué pasa al salirse de él.
 *
 * El principio que ordena todo esto: mover el brazo escala el aparato entero.
 * No es el mismo dron con brazos más largos, es un dron más grande. De ahí que
 * el brazo mande a la vez sobre la inercia y sobre el área de arrastre.
 */

/**
 * El punto de referencia: el TBS Oblivion tal y como lo publica Velocidrone.
 * Cambiar cualquiera de estos números re-ancla TODAS las fórmulas, así que no
 * se tocan para afinar el vuelo —para eso están los deslizadores—.
 */
const REF = {
	mass: 0.529,          // kg con batería
	armRadius: 0.110,     // m
	inertia: 0.00175,     // kg·m², los tres ejes
	kv: 1428,
	resistance: 0.1270,   // Ω por fase
	diameterIn: 5.1,
	blades: 3,
	chordMm: 15,
	propInertia: 2.8e-6,  // kg·m²
	cells: 4,
	capacityAh: 1.3,
	packMass: 0.176,      // kg del 4S 1300
};

/**
 * Rellena las magnitudes que se deducen de otras. Modifica `flight` en el sitio
 * y lo devuelve.
 *
 * Es idempotente a propósito —corre en cada `refresh()`, o sea cada vez que se
 * suelta un deslizador—: ninguna magnitud derivada se calcula a partir de sí
 * misma. El arrastre es el caso a vigilar, y por eso lo declarado y lo derivado
 * tienen nombres distintos: `dragAreaRef` entra, `dragArea` sale.
 */
export function deriveAircraft( flight ) {

	const { frame, motor, prop, battery } = flight;

	// La masa primero: la inercia depende de ella, así que tiene que estar puesta
	// antes. La energía de un pack va con celdas × amperios-hora, y la energía
	// por kilo de un LiPo es casi la misma en todos: de ahí que su peso escale
	// con el producto.
	const packMass = REF.packMass
		* ( battery.cells / REF.cells )
		* ( battery.capacityAh / REF.capacityAh );

	frame.mass = frame.dryMass + packMass;

	// Radio de giro proporcional al brazo, e inercia = masa × radio². Con los
	// valores de referencia el radio de giro sale en 57,5 mm, entre los 110 de
	// los motores en la punta y los ~47 de la masa central. Doblar el brazo
	// cuadruplica la inercia; doblar la masa la dobla.
	const armScale = frame.armRadius / REF.armRadius;
	const inertia = REF.inertia * ( frame.mass / REF.mass ) * armScale * armScale;
	frame.inertia = [ inertia, inertia, inertia ];

	// Un área escala con el cuadrado de la longitud, y los tres ejes con el mismo
	// factor: el aparato crece entero, no se estira por un lado.
	frame.dragArea = {
		x: frame.dragAreaRef.x * armScale * armScale,
		y: frame.dragAreaRef.y * armScale * armScale,
		z: frame.dragAreaRef.z * armScale * armScale,
	};

	// Para un motor del mismo tamaño, menos vueltas por voltio es más espiras, y
	// más espiras es más cobre en serie: la resistencia va con 1/KV².
	const kvRatio = REF.kv / motor.kv;
	motor.resistance = REF.resistance * kvRatio * kvRatio;

	// Semejanza geométrica: una hélice mayor es la misma hélice más grande, así
	// que la cuerda va con el diámetro.
	const propScale = prop.diameterIn / REF.diameterIn;
	prop.chordMm = REF.chordMm * propScale;

	// Y su inercia con la quinta potencia: la masa de una pala va con el cubo del
	// diámetro y su brazo con el diámetro, y la inercia es masa × brazo².
	prop.inertia = REF.propInertia
		* Math.pow( propScale, 5 )
		* ( prop.blades / REF.blades );

	return flight;

}
