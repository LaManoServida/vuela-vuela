/*
 * Modelo de vuelo: controlador Betaflight → variador → motor de continua →
 * hélice (elemento de pala + cantidad de movimiento) → sólido rígido.
 *
 * Los números que se comprueban aquí no son arbitrarios: son los de un 5" de
 * verdad. Si el empuje por motor, el gas de sustentación o las RPM se salen del
 * rango, el modelo ha dejado de representar un dron aunque siga volando.
 */
import { Quad } from '../src/flight/quad.js';
import { cloneFlight, quadOptions } from '../src/config.js';
import { Betaflight, QUAD_X, ROLL, PITCH, YAW } from '../src/flight/betaflight.js';
import { Battery } from '../src/flight/battery.js';
import { Prop } from '../src/flight/prop.js';

let fails = 0;
const check = ( name, cond, info = '' ) => {
	if ( cond ) console.log( `  ok  ${ name } ${ info }` );
	else { console.log( `FAIL  ${ name } ${ info }` ); fails ++; }
};

const between = ( v, lo, hi ) => v >= lo && v <= hi;

function makeQuad( tweak = () => {}, options = {} ) {

	const p = cloneFlight();
	tweak( p );
	const q = new Quad( p, quadOptions( { collisions: false, battery: false, ...options } ) );
	q.respawn();
	return q;

}

function fly( quad, controls, seconds, dt = 0.001 ) {

	const c = { roll: 0, pitch: 0, yaw: 0, throttle: 0, ...controls };
	const n = Math.round( seconds / dt );
	for ( let i = 0; i < n; i ++ ) quad.step( dt, c );
	return quad;

}

// ---------------------------------------------------------------------------
console.log( '\n== curvas de rates de Betaflight ==' );
{
	const q = makeQuad();

	// Con RC_RATE 0.95 y super 0.70: 200·0.95/(1−0.70) = 633 °/s.
	check( 'rate máximo roll/pitch', Math.abs( q.bf.maxRate( ROLL ) - 633.3 ) < 1,
		`${ q.bf.maxRate( ROLL ).toFixed( 1 ) } °/s` );
	check( 'rate máximo yaw', Math.abs( q.bf.maxRate( YAW ) - 533.3 ) < 1,
		`${ q.bf.maxRate( YAW ).toFixed( 1 ) } °/s` );
	check( 'stick centrado no pide nada', q.bf.applyRates( ROLL, 0 ) === 0 );

	// La curva es monótona y simétrica.
	let monotonic = true;
	for ( let x = 0; x < 1; x += 0.02 ) {
		if ( q.bf.applyRates( ROLL, x + 0.02 ) <= q.bf.applyRates( ROLL, x ) ) monotonic = false;
	}
	check( 'la curva es monótona', monotonic );
	check( 'la curva es simétrica',
		Math.abs( q.bf.applyRates( ROLL, 0.4 ) + q.bf.applyRates( ROLL, - 0.4 ) ) < 1e-6 );

	// Rates ACTUAL: la sensibilidad en el centro es exactamente rcRate·10.
	const qa = makeQuad( p => {
		p.bf.rateType = 'actual';
		p.bf.rcRate = 20; p.bf.superRate = 80; p.bf.rcExpo = 0;
	} );
	check( 'rates ACTUAL: máximo = superRate·10', Math.abs( qa.bf.maxRate( ROLL ) - 800 ) < 1,
		`${ qa.bf.maxRate( ROLL ).toFixed( 0 ) } °/s` );
}

// ---------------------------------------------------------------------------
console.log( '\n== sentido de cada eje ==' );
{
	// Convenio: −Z es el morro, +X la derecha, +Y arriba.
	const short = ( stick ) => {
		const q = makeQuad();
		fly( q, { ...stick, throttle: q.hoverThrottle }, 0.25 );
		return q;
	};

	const r = short( { roll: 1 } );
	check( 'roll a la derecha gira sobre el eje del morro', r.body.omega.z < - 1,
		`ωz=${ r.body.omega.z.toFixed( 2 ) } rad/s` );
	check( 'roll a la derecha da alabeo positivo', r.attitude().roll > 1,
		`${ r.attitude().roll.toFixed( 1 ) }°` );

	const p = short( { pitch: 1 } );
	check( 'pitch arriba levanta el morro', p.body.omega.x > 1,
		`ωx=${ p.body.omega.x.toFixed( 2 ) } rad/s` );
	check( 'pitch arriba da cabeceo positivo', p.attitude().pitch > 1,
		`${ p.attitude().pitch.toFixed( 1 ) }°` );

	const y = short( { yaw: 1 } );
	check( 'yaw a la derecha gira sobre la vertical', y.body.omega.y < - 0.5,
		`ωy=${ y.body.omega.y.toFixed( 2 ) } rad/s` );
	check( 'yaw a la derecha da rumbo positivo', y.attitude().yaw > 1,
		`${ y.attitude().yaw.toFixed( 1 ) }°` );

	// Y lo que de verdad importa: hacia dónde se mueve.
	const move = stick => {
		const q = makeQuad( pp => { pp.bf.mode = 'angle'; } );
		fly( q, { ...stick, throttle: 0.6 }, 4 );
		return q.velocity;
	};
	check( 'inclinado a la derecha vuela a la derecha', move( { roll: 1 } ).x > 10,
		`vx=${ move( { roll: 1 } ).x.toFixed( 1 ) } m/s` );
	check( 'morro abajo vuela hacia adelante', move( { pitch: - 1 } ).z < - 10,
		`vz=${ move( { pitch: - 1 } ).z.toFixed( 1 ) } m/s` );
}

// ---------------------------------------------------------------------------
console.log( '\n== prestaciones frente a un 5" real ==' );
{
	const q = makeQuad();
	const gramsPerMotor = q.maxThrust / 4 / 9.81 * 1000;

	check( 'empuje estático por motor entre 550 y 850 g', between( gramsPerMotor, 550, 850 ),
		`${ gramsPerMotor.toFixed( 0 ) } g` );
	check( 'relación empuje/peso entre 3.5 y 6', between( q.thrustToWeight, 3.5, 6 ),
		`${ q.thrustToWeight.toFixed( 2 ) }:1` );
	check( 'gas de sustentación entre 25 y 40 %', between( q.hoverThrottle, 0.25, 0.40 ),
		`${ ( q.hoverThrottle * 100 ).toFixed( 1 ) } %` );
	check( 'RPM de sustentación entre 7000 y 12000', between( q.hoverRpm, 7000, 12000 ),
		`${ q.hoverRpm.toFixed( 0 ) } RPM` );
	check( 'consumo en sustentación entre 10 y 30 A', between( q.hoverCurrent, 10, 30 ),
		`${ q.hoverCurrent.toFixed( 1 ) } A` );

	// RPM y corriente a fondo, en estático.
	const s = makeQuad();
	fly( s, { throttle: 1 }, 1.5 );
	check( 'RPM a gas pleno entre 18000 y 28000', between( s.averageRpm, 18000, 28000 ),
		`${ s.averageRpm.toFixed( 0 ) } RPM` );
}

// ---------------------------------------------------------------------------
console.log( '\n== sustentación y respuesta ==' );
{
	const q = makeQuad();
	fly( q, { throttle: q.hoverThrottle }, 6 );
	check( 'el gas de sustentación mantiene la altura', Math.abs( q.position.y ) < 0.5,
		`deriva ${ q.position.y.toFixed( 3 ) } m en 6 s` );
	check( 'y no acumula giro por su cuenta', q.body.omega.length() < 0.01,
		`|ω|=${ q.body.omega.length().toFixed( 4 ) } rad/s` );

	// Escalón de roll: debe llegar al rate pedido, deprisa y sin rebotar mucho.
	const s = makeQuad();
	const c = { roll: 1, pitch: 0, yaw: 0, throttle: s.hoverThrottle };
	let peak = 0, t90 = - 1;
	const target = s.bf.maxRate( ROLL );
	for ( let i = 0; i < 1500; i ++ ) {
		s.step( 0.001, c );
		const rate = - s.body.omega.z * 180 / Math.PI;
		if ( rate > peak ) peak = rate;
		if ( t90 < 0 && rate >= target * 0.9 ) t90 = i;
	}
	check( 'el escalón de roll llega al rate pedido', between( peak / target, 0.98, 1.15 ),
		`pico ${ peak.toFixed( 0 ) } de ${ target.toFixed( 0 ) } °/s` );
	check( 'y llega en menos de 100 ms', t90 > 0 && t90 < 100, `${ t90 } ms al 90 %` );

	// Los motores tardan en subir: es lo que da el "peso" al gas.
	const u = makeQuad();
	u.reset();
	let ms = 0;
	const rpm = () => u.props.reduce( ( a, p ) => a + p.rpm, 0 ) / 4;
	while ( rpm() < u.hoverRpm * 0.95 && ms < 500 ) {
		u.step( 0.001, { roll: 0, pitch: 0, yaw: 0, throttle: u.hoverThrottle } );
		ms ++;
	}
	check( 'los rotores tardan entre 40 y 250 ms en subir', between( ms, 40, 250 ), `${ ms } ms` );
}

// ---------------------------------------------------------------------------
console.log( '\n== la actitud emerge del reparto de empuje ==' );
{
	// Ningún par de alabeo se aplica directamente: se comprueba que un roll
	// pedido produce de verdad empujes distintos a izquierda y derecha.
	const q = makeQuad();
	fly( q, { roll: 1, throttle: q.hoverThrottle }, 0.15 );

	const right = q.props[ 0 ].thrust + q.props[ 2 ].thrust;   // FR + RR
	const left = q.props[ 1 ].thrust + q.props[ 3 ].thrust;    // FL + RL
	check( 'alabear a la derecha carga los motores de la izquierda', left > right * 1.1,
		`izq ${ left.toFixed( 2 ) } N vs dcha ${ right.toFixed( 2 ) } N` );

	const p = makeQuad();
	fly( p, { pitch: 1, throttle: p.hoverThrottle }, 0.15 );
	const front = p.props[ 0 ].thrust + p.props[ 1 ].thrust;
	const rear = p.props[ 2 ].thrust + p.props[ 3 ].thrust;
	check( 'levantar el morro carga los motores delanteros', front > rear * 1.1,
		`del ${ front.toFixed( 2 ) } N vs tras ${ rear.toFixed( 2 ) } N` );

	// El mezclador tiene que estar equilibrado: sin mando, ni guiñada ni deriva.
	let sum = { roll: 0, pitch: 0, yaw: 0 };
	for ( const m of QUAD_X ) { sum.roll += m.roll; sum.pitch += m.pitch; sum.yaw += m.yaw; }
	check( 'el mezclador está equilibrado en los tres ejes',
		sum.roll === 0 && sum.pitch === 0 && sum.yaw === 0 );
	check( 'los sentidos de giro se compensan',
		QUAD_X.reduce( ( a, m ) => a + m.dir, 0 ) === 0 );
}

// ---------------------------------------------------------------------------
console.log( '\n== modo angle ==' );
{
	const q = makeQuad( p => { p.bf.mode = 'angle'; } );
	fly( q, { pitch: - 1, throttle: 0.5 }, 3 );
	const att = q.attitude();
	check( 'se queda en el límite de inclinación', Math.abs( att.pitch + 55 ) < 4,
		`${ att.pitch.toFixed( 1 ) }° de ${ - q.params.bf.angleLimit }°` );

	// Y se autonivela al soltar.
	fly( q, { throttle: 0.5 }, 4 );
	const level = q.attitude();
	check( 'se autonivela al soltar el stick',
		Math.abs( level.pitch ) < 3 && Math.abs( level.roll ) < 3,
		`roll ${ level.roll.toFixed( 1 ) }° pitch ${ level.pitch.toFixed( 1 ) }°` );

	// En acro NO se autonivela: al centrar el stick el giro se para, pero el
	// dron se queda con la inclinación que tuviera. Eso es acro.
	// 0.6 s de margen y no 0.4: frenar 690 °/s son dos ciclos largos del lazo, y
	// a los 0.4 s todavía se está en el segundo. Medir ahí no comprueba que el
	// giro pare, comprueba en qué punto del transitorio cae el corte.
	const a = makeQuad();
	fly( a, { roll: 1, throttle: a.hoverThrottle }, 0.12 );
	fly( a, { throttle: a.hoverThrottle }, 0.6 );
	const held = a.attitude().roll;
	check( 'centrar el stick para el giro', Math.abs( a.body.omega.z ) < 0.05,
		`ωz=${ a.body.omega.z.toFixed( 3 ) } rad/s` );

	fly( a, { throttle: a.hoverThrottle }, 2 );
	check( 'y en acro no vuelve solo a horizontal',
		Math.abs( a.attitude().roll ) > 20 && Math.abs( a.attitude().roll - held ) < 2,
		`se queda a ${ a.attitude().roll.toFixed( 1 ) }°` );
}

// ---------------------------------------------------------------------------
console.log( '\n== airmode ==' );
{
	// Con el gas a cero y airmode activo el dron sigue teniendo autoridad: es lo
	// que permite enderezar en caída. Sin airmode, no.
	const on = makeQuad( p => { p.bf.airMode = true; } );
	fly( on, { roll: 1, throttle: 0 }, 0.4 );

	const off = makeQuad( p => { p.bf.airMode = false; } );
	fly( off, { roll: 1, throttle: 0 }, 0.4 );

	const rateOn = Math.abs( on.body.omega.z );
	const rateOff = Math.abs( off.body.omega.z );
	check( 'con airmode hay autoridad a gas cero', rateOn > 3,
		`${ rateOn.toFixed( 1 ) } rad/s` );
	check( 'sin airmode hay menos', rateOff < rateOn * 0.75,
		`${ rateOff.toFixed( 1 ) } vs ${ rateOn.toFixed( 1 ) } rad/s` );
}

// ---------------------------------------------------------------------------
console.log( '\n== hélice: elemento de pala + cantidad de movimiento ==' );
{
	const p = cloneFlight();
	const prop = new Prop( p.prop );
	const settle = ( rpm, axial = 0, lateral = 0 ) => {
		prop.reset();
		const w = rpm * Math.PI / 30;
		for ( let i = 0; i < 4000; i ++ ) { prop.omega = w; prop.update( 0.0005, axial, lateral, 1, 1 ); }
		return prop.thrust;
	};

	const t10 = settle( 10000 );
	const t20 = settle( 20000 );
	check( 'el empuje crece con el cuadrado de las vueltas', between( t20 / t10, 3.4, 4.6 ),
		`×${ ( t20 / t10 ).toFixed( 2 ) } al doblar RPM` );

	// Subiendo, la pala ve más flujo axial y su ángulo de ataque baja: a RPM
	// constantes se sube con MENOS empuje, no con más. Es la razón de que haya
	// que meter gas para trepar, no sólo para sostenerse.
	check( 'ascender reduce el empuje a vueltas constantes',
		settle( 15000, 6 ) < settle( 15000, 0 ) * 0.95,
		`${ settle( 15000, 0 ).toFixed( 2 ) } → ${ settle( 15000, 6 ).toFixed( 2 ) } N a +6 m/s` );

	// En descenso la curva de empuje NO es monótona, y ahí está toda la gracia:
	// baja hasta un mínimo cuando el rotor cae dentro de su propia estela
	// (anillo de vórtices) y vuelve a subir cuando cae tan rápido que el aire lo
	// atraviesa al revés y entra en autorrotación.
	const hover = settle( 15000, 0 );
	const vh = Math.sqrt( hover / ( 2 * 1.225 * prop.discArea ) );

	const inVrs = settle( 15000, - vh * 1.1 );
	check( 'caer dentro de la propia estela hunde el empuje', inVrs < hover * 0.85,
		`${ hover.toFixed( 2 ) } → ${ inVrs.toFixed( 2 ) } N a ${ ( - vh * 1.1 ).toFixed( 1 ) } m/s` );
	check( 'y el modelo lo señala como anillo de vórtices', prop.vrs > 0.7,
		`severidad ${ prop.vrs.toFixed( 2 ) }` );

	const windmill = settle( 15000, - vh * 3 );
	check( 'cayendo muy rápido recupera (autorrotación)', windmill > inVrs * 1.2,
		`${ inVrs.toFixed( 2 ) } → ${ windmill.toFixed( 2 ) } N a ${ ( - vh * 3 ).toFixed( 1 ) } m/s` );

	// Un descenso lento apenas cambia nada: es el régimen donde la teoría de
	// cantidad de movimiento sigue valiendo.
	check( 'un descenso lento casi no altera el empuje',
		Math.abs( settle( 15000, - vh * 0.15 ) / hover - 1 ) < 0.06,
		`${ ( settle( 15000, - vh * 0.15 ) / hover * 100 ).toFixed( 1 ) } % del estacionario` );

	// Y en traslación recupera, porque la estela se la lleva el aire.
	check( 'el vuelo de traslación recupera empuje',
		settle( 15000, 0, 18 ) > settle( 15000, 0 ) * 1.03,
		`${ settle( 15000, 0 ).toFixed( 2 ) } → ${ settle( 15000, 0, 18 ).toFixed( 2 ) } N` );

	// Rendimiento del rotor: un valor fuera de 0.4–0.8 no es una hélice.
	prop.reset();
	const w = 20000 * Math.PI / 30;
	for ( let i = 0; i < 4000; i ++ ) { prop.omega = w; prop.update( 0.0005, 0, 0, 1, 1 ); }
	const ideal = prop.thrust * Math.sqrt( prop.thrust / ( 2 * 1.225 * prop.discArea ) );
	const merit = ideal / ( prop.torque * w );
	check( 'la figura de mérito es la de una hélice real', between( merit, 0.40, 0.80 ),
		`FM=${ merit.toFixed( 2 ) }` );
}

// ---------------------------------------------------------------------------
console.log( '\n== batería ==' );
{
	const b = new Battery( { cells: 4, cellR: 0.003, capacityAh: 1.3, cellFullV: 4.2, cellFlatV: 3.0, cutoffCellV: 3.1 } );
	check( 'un 4S lleno da 16.8 V', Math.abs( b.restingVoltage( 1 ) - 16.8 ) < 0.01,
		`${ b.restingVoltage( 1 ).toFixed( 2 ) } V` );
	check( 'y vacío 12 V', Math.abs( b.restingVoltage( 0 ) - 12 ) < 0.01,
		`${ b.restingVoltage( 0 ).toFixed( 2 ) } V` );

	// Caída bajo carga: 60 A sobre 0.012 Ω son 0.72 V.
	b.update( 0.001, 60 );
	check( 'la tensión cae bajo consumo', Math.abs( b.voltage - ( 16.8 - 0.72 ) ) < 0.02,
		`${ b.voltage.toFixed( 2 ) } V a 60 A` );

	// Y el quad pierde empuje según se descarga.
	const fresh = makeQuad( () => {}, { battery: true } );
	fly( fresh, { throttle: 1 }, 1 );
	const thrustFull = fresh.totalThrust;
	fresh.battery.charge = 0.15;
	fly( fresh, { throttle: 1 }, 1 );
	check( 'con la batería baja hay menos empuje', fresh.totalThrust < thrustFull * 0.95,
		`${ thrustFull.toFixed( 1 ) } → ${ fresh.totalThrust.toFixed( 1 ) } N` );
}

// ---------------------------------------------------------------------------
console.log( '\n== el hardware manda de verdad ==' );
{
	// Los deslizadores del menú son magnitudes físicas, no factores de ajuste:
	// cada uno tiene que llegar al vuelo por el camino correcto.
	const base = makeQuad();

	const heavy = makeQuad( p => { p.frame.mass *= 1.5; } );
	check( 'más masa baja el empuje/peso', heavy.thrustToWeight < base.thrustToWeight * 0.75,
		`${ base.thrustToWeight.toFixed( 2 ) } → ${ heavy.thrustToWeight.toFixed( 2 ) }` );
	check( 'y sube el gas de sustentación', heavy.hoverThrottle > base.hoverThrottle,
		`${ ( base.hoverThrottle * 100 ).toFixed( 0 ) } → ${ ( heavy.hoverThrottle * 100 ).toFixed( 0 ) } %` );

	const bigProp = makeQuad( p => { p.prop.diameterIn = 6.5; } );
	check( 'una hélice mayor da más empuje', bigProp.maxThrust > base.maxThrust * 1.15,
		`${ base.maxThrust.toFixed( 1 ) } → ${ bigProp.maxThrust.toFixed( 1 ) } N` );
	check( 'y gira más despacio', bigProp.hoverRpm < base.hoverRpm,
		`${ base.hoverRpm.toFixed( 0 ) } → ${ bigProp.hoverRpm.toFixed( 0 ) } RPM` );

	// El régimen de sustentación sólo depende del peso y de la hélice, así que
	// pasar a 6S no lo cambia: lo que cambia es que hace falta menos gas para
	// llegar y sobra más margen arriba. Eso es exactamente lo que se busca al
	// montar 6S en la vida real.
	const sixS = makeQuad( p => { p.battery.cells = 6; p.motor.kv = 1550; } );
	check( 'el régimen de sustentación no depende de la batería',
		Math.abs( sixS.hoverRpm - base.hoverRpm ) < 1,
		`${ sixS.hoverRpm.toFixed( 0 ) } vs ${ base.hoverRpm.toFixed( 0 ) } RPM` );
	check( 'pero un 6S llega con menos gas', sixS.hoverThrottle < base.hoverThrottle,
		`${ ( base.hoverThrottle * 100 ).toFixed( 0 ) } → ${ ( sixS.hoverThrottle * 100 ).toFixed( 0 ) } %` );

	const longArm = makeQuad( p => { p.frame.armRadius *= 1.6; } );
	const rollRate = q => {
		fly( q, { roll: 1, throttle: q.hoverThrottle }, 0.06 );
		return Math.abs( q.body.omega.z );
	};
	check( 'brazos más largos dan más par de alabeo',
		rollRate( makeQuad( p => { p.frame.armRadius *= 1.6; } ) ) > rollRate( makeQuad() ),
		`${ rollRate( makeQuad() ).toFixed( 2 ) } → ${ rollRate( longArm ).toFixed( 2 ) } rad/s` );

	// El límite de corriente del variador tiene que notarse en el acelerón.
	const limited = makeQuad( p => { p.motor.currentLimit = 12; p.esc.currentLimit = 12; } );
	const spool = q => {
		q.reset();
		let ms = 0;
		const rpm = () => q.props.reduce( ( a, pr ) => a + pr.rpm, 0 ) / 4;
		while ( rpm() < q.hoverRpm * 0.9 && ms < 900 ) {
			q.step( 0.001, { roll: 0, pitch: 0, yaw: 0, throttle: 1 } );
			ms ++;
		}
		return ms;
	};
	check( 'con menos amperios el acelerón es más lento', spool( limited ) > spool( makeQuad() ) * 1.3,
		`${ spool( makeQuad() ) } → ${ spool( limited ) } ms` );
}

// ---------------------------------------------------------------------------
console.log( '\n== el reloj del choque ==' );
{
	// `main.js` no lleva cronómetro propio: mira `crashTime` para saber cuándo
	// reaparecer. El contrato es que sólo corra con el dron roto, que vaya en
	// tiempo de simulación —no de reloj de pared, así el retardo es el mismo
	// aunque se hundan los fps— y que reaparecer lo devuelva a cero.
	const q = makeQuad();
	fly( q, { throttle: q.hoverThrottle }, 1 );

	check( 'volando no corre', q.crashTime === 0 );
	const volado = q.flightTime;

	q.crash( 9 );
	fly( q, { throttle: 1 }, 1.5 );

	check( 'roto cuenta el tiempo simulado', Math.abs( q.crashTime - 1.5 ) < 1e-6,
		`${ q.crashTime.toFixed( 3 ) } s` );
	check( 'y el cronómetro de vuelo se para', Math.abs( q.flightTime - volado ) < 1e-9,
		`${ q.flightTime.toFixed( 3 ) } s` );

	q.respawn();
	check( 'reaparecer lo devuelve a cero', q.crashTime === 0 && q.crashed === false );
}

// ---------------------------------------------------------------------------
console.log( '\n== estabilidad numérica ==' );
{
	// Un minuto de pilotaje agresivo con paso de render variable.
	const q = makeQuad();
	let seed = 7;
	const rnd = () => ( seed = ( seed * 1103515245 + 12345 ) % 2147483648 ) / 2147483648;

	for ( let i = 0; i < 3600; i ++ ) {
		q.update( 0.008 + rnd() * 0.02, {
			roll: rnd() * 2 - 1,
			pitch: rnd() * 2 - 1,
			yaw: rnd() * 2 - 1,
			throttle: rnd(),
		} );
	}

	const finite = Number.isFinite( q.position.x ) && Number.isFinite( q.position.y )
		&& Number.isFinite( q.velocity.length() ) && Number.isFinite( q.body.omega.length() )
		&& q.props.every( p => Number.isFinite( p.omega ) && p.omega >= 0 );

	check( 'nada se va a infinito ni a NaN', finite );
	check( 'el cuaternión sigue normalizado', Math.abs( q.quaternion.length() - 1 ) < 1e-6,
		`|q|=${ q.quaternion.length().toFixed( 9 ) }` );
	check( 'las RPM se mantienen en rango físico', q.averageRpm < 40000,
		`${ q.averageRpm.toFixed( 0 ) } RPM` );
	check( 'la velocidad se mantiene en rango físico', q.speed < 100,
		`${ ( q.speed * 3.6 ).toFixed( 0 ) } km/h` );

	// Un frame larguísimo no debe disparar el trabajo del siguiente.
	const before = q.position.clone();
	q.update( 5, { roll: 0, pitch: 0, yaw: 0, throttle: 0.5 } );
	check( 'un frame de 5 s se recorta', q.position.distanceTo( before ) < 60,
		`${ q.position.distanceTo( before ).toFixed( 1 ) } m` );
}

// ---------------------------------------------------------------------------
console.log( '\n== coste ==' );
{
	const q = makeQuad();
	const c = { roll: 0.3, pitch: 0.2, yaw: 0.1, throttle: 0.6 };
	for ( let i = 0; i < 5000; i ++ ) q.step( 0.001, c );   // calentar el JIT

	const n = 60000;
	const t0 = performance.now();
	for ( let i = 0; i < n; i ++ ) q.step( 0.001, c );
	const perStep = ( performance.now() - t0 ) * 1000 / n;
	const perSecond = perStep;   // 1000 pasos/s × µs = ms por segundo simulado

	check( 'el modelo completo cuesta menos de 15 ms por segundo simulado',
		perSecond < 15, `${ perSecond.toFixed( 2 ) } ms/s (${ perStep.toFixed( 2 ) } µs por paso a 1 kHz)` );
}

console.log( fails === 0 ? '\nTODO OK\n' : `\n${ fails } FALLOS\n` );
process.exit( fails === 0 ? 0 : 1 );
