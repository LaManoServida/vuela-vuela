import { Vector3, Quaternion, Euler, MathUtils } from 'three';

import { RigidBody } from './rigidbody.js';
import { Betaflight, QUAD_X, ROLL, PITCH, YAW } from './betaflight.js';
import { Prop, RHO } from './prop.js';
import { Motor } from './motor.js';
import { Battery } from './battery.js';

const GRAVITY = 9.81;
const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

// El bucle de física corre a 1 kHz y el rotor se subdivide otras dos veces:
// la dinámica del rotor es rígida (inercias de microgramos·m² frente a pares de
// centinewton·metro) y con pasos largos se dispara.
const PHYSICS_HZ = 1000;
const PHYSICS_DT = 1 / PHYSICS_HZ;
const ROTOR_SUBSTEPS = 2;
// 120 subpasos = 120 ms de simulación por frame: la física sigue en tiempo real
// hasta ~8 fps, y por debajo entra en cámara lenta en vez de arrastrar el frame
// siguiente.
const MAX_SUBSTEPS = 120;

// Temporales de módulo: el bucle de vuelo no asigna memoria, así que no hay GC.
const _v1 = new Vector3();
const _v2 = new Vector3();
const _up = new Vector3();
const _force = new Vector3();
const _torque = new Vector3();
const _n = new Vector3();
const _nBody = new Vector3();
const _rel = new Vector3();
const _imp = new Vector3();
const _tan = new Vector3();
const _cross = new Vector3();
const _angImp = new Vector3();
const _q = new Quaternion();
const _qi = new Quaternion();
const _euler = new Euler( 0, 0, 0, 'YXZ' );
const _probe = new Vector3();
const _down = new Vector3();
const _downSmooth = new Vector3();
const _gyro = new Float32Array( 3 );
const _sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };

const clamp = ( v, lo, hi ) => v < lo ? lo : v > hi ? hi : v;

/**
 * El aparato completo: célula, controlador, cuatro cadenas variador→motor→hélice
 * y batería.
 *
 * Lo que distingue este modelo de uno arcade es que nadie aplica un par de
 * alabeo. El controlador reparte gas entre cuatro motores, cada motor lleva su
 * hélice a unas vueltas, cada hélice da un empuje en la punta de su brazo, y el
 * alabeo aparece solo. Todo lo que se siente raro en un simulador barato —el
 * dron que gira sin inercia, el gas que responde instantáneo, el empuje que no
 * cae al caer— aquí sale gratis por estar modelado el camino completo.
 */
export class Quad {

	constructor( params, options = {} ) {

		this.params = params;
		this.options = {
			collisions: true,
			crashSpeed: 4.5,
			restitution: 0.18,
			friction: 0.45,
			maxSpin: 30,               // rad/s de volteo tras un impacto
			battery: true,
			...options,
		};

		this.body = new RigidBody( {
			mass: params.frame.mass,
			inertia: params.frame.inertia,
		} );

		this.bf = new Betaflight( params.bf, QUAD_X );
		this.battery = new Battery( { ...params.battery, cutoffCellV: params.esc.cutoffCellV } );

		this.props = [];
		this.motors = [];
		this.arms = [];

		const { armRadius, armAngle } = params.frame;
		const s = Math.sin( armAngle * DEG2RAD ) * armRadius;
		const c = Math.cos( armAngle * DEG2RAD ) * armRadius;

		// Mismo orden que QUAD_X: delantero-derecha, delantero-izquierda,
		// trasero-derecha, trasero-izquierda. El morro mira a −Z.
		const layout = [
			[ s, 0, - c ], [ - s, 0, - c ], [ s, 0, c ], [ - s, 0, c ],
		];

		for ( let i = 0; i < 4; i ++ ) {

			this.props.push( new Prop( params.prop ) );
			this.motors.push( new Motor( params.motor, params.esc ) );
			this.arms.push( new Vector3().fromArray( layout[ i ] ) );

		}

		this.rotorInertia = params.prop.inertia + params.motor.inertia;

		// Puntos de contacto: las cuatro puntas de brazo y el centro.
		this.contacts = [ ...this.arms.map( a => a.clone() ), new Vector3() ];

		this.spawn = new Vector3();
		this.spawnYaw = 0;

		this.grid = null;
		this.groundHeight = null;      // m sobre el suelo, o null si no se conoce

		this._smoothed = new Quaternion();
		this._accumulator = 0;
		this._attitude = { roll: 0, pitch: 0, yaw: 0, inverted: false };

		this.hoverMotor = 0.35;        // mando de motor que sostiene el peso
		this.hoverThrottle = 0.35;     // posición de stick equivalente

		this.reset();
		this.solveHover();

	}

	// =======================================================================
	//  Estado
	// =======================================================================

	reset() {

		this.body.position.set( 0, 0, 0 );
		this.body.velocity.set( 0, 0, 0 );
		this.body.omega.set( 0, 0, 0 );
		this.body.quaternion.identity();
		this.body.clearAccumulators();

		this.bf.reset();
		this.battery.reset();
		for ( const p of this.props ) p.reset();
		for ( const m of this.motors ) m.reset();

		this._smoothed.identity();
		this._accumulator = 0;

		this.crashed = false;
		this.crashSpeed = 0;
		this.flightTime = 0;
		this.distanceFlown = 0;
		this.topSpeed = 0;
		this.totalThrust = 0;
		this.totalCurrent = 0;
		this.averageRpm = 0;
		this.groundHeight = null;

	}

	/**
	 * Reconstruye lo que se derivó de los parámetros al arrancar. Necesario tras
	 * tocar masa, hélice, motor o batería en caliente; los ajustes del
	 * controlador (PID, rates, modo) no lo necesitan porque se leen en cada paso.
	 */
	refresh() {

		const p = this.params;

		this.body.setMass( p.frame.mass );
		this.body.setInertia( p.frame.inertia );

		const { armRadius, armAngle } = p.frame;
		const s = Math.sin( armAngle * DEG2RAD ) * armRadius;
		const c = Math.cos( armAngle * DEG2RAD ) * armRadius;
		const layout = [ [ s, 0, - c ], [ - s, 0, - c ], [ s, 0, c ], [ - s, 0, c ] ];

		for ( let i = 0; i < 4; i ++ ) {

			const omega = this.props[ i ].omega;
			this.props[ i ] = new Prop( p.prop );
			this.props[ i ].omega = omega;
			this.motors[ i ] = new Motor( p.motor, p.esc );
			this.arms[ i ].fromArray( layout[ i ] );
			this.contacts[ i ].fromArray( layout[ i ] );

		}

		this.rotorInertia = p.prop.inertia + p.motor.inertia;
		this.battery.cfg = { ...p.battery, cutoffCellV: p.esc.cutoffCellV };

		this.solveHover();

	}

	setSpawn( x, y, z, yaw = 0 ) {

		this.spawn.set( x, y, z );
		this.spawnYaw = yaw;
		this.respawn();

	}

	respawn() {

		this.reset();

		this.body.position.copy( this.spawn );
		_euler.set( 0, this.spawnYaw, 0 );
		this.body.quaternion.setFromEuler( _euler );
		this._smoothed.copy( this.body.quaternion );

		// Rotores ya girando a la velocidad de sustentación: aparecer en el aire
		// y esperar 200 ms a que los motores suban no es jugable.
		this.primeRotors( this.hoverMotor );

	}

	/** Lleva los cuatro rotores al régimen estacionario de un gas dado. */
	primeRotors( throttle ) {

		const dt = 0.0005;
		const volts = this.battery.restingVoltage();
		const packR = this.battery.packResistance;

		for ( let i = 0; i < 4; i ++ ) {

			const prop = this.props[ i ];
			const motor = this.motors[ i ];

			for ( let n = 0; n < 1500; n ++ ) {

				const torque = motor.update( throttle, prop.rpm, volts, packR, false );
				prop.update( dt, 0, 0, 1, 1 );
				prop.spin( dt, torque, this.rotorInertia );

			}

		}

	}

	/**
	 * Busca por bisección el gas que sostiene el peso. Sirve para tres cosas:
	 * cebar los rotores al aparecer, colocar el stick de gas al reaparecer, y
	 * enseñar en el menú si el aparato tiene margen de empuje.
	 */
	solveHover() {

		const weight = this.params.frame.mass * GRAVITY * this.params.frame.gravityScale;
		const target = weight / 4;

		const probe = new Prop( this.params.prop );
		const motor = new Motor( this.params.motor, this.params.esc );
		const volts = this.battery.restingVoltage( 1 );
		const packR = this.battery.packResistance;
		const dt = 0.0005;

		const thrustAt = throttle => {

			probe.reset();
			motor.reset();
			for ( let n = 0; n < 1500; n ++ ) {

				const t = motor.update( throttle, probe.rpm, volts, packR, false );
				probe.update( dt, 0, 0, 1, 1 );
				probe.spin( dt, t, this.rotorInertia );

			}

			return { thrust: probe.thrust, rpm: probe.rpm, current: motor.current };

		};

		this.maxThrust = thrustAt( 1 ).thrust * 4;
		this.thrustToWeight = this.maxThrust / weight;

		let lo = 0, hi = 1;
		for ( let i = 0; i < 22; i ++ ) {

			const mid = ( lo + hi ) / 2;
			if ( thrustAt( mid ).thrust < target ) lo = mid; else hi = mid;

		}

		this.hoverMotor = clamp( ( lo + hi ) / 2, 0, 1 );

		// El stick no llega crudo al motor: el mezclador lo remapea al rango que
		// queda por encima del ralentí. Sin deshacer ese tramo, "gas de
		// sustentación" se quedaría corto y el dron aparecería cayendo.
		const idle = this.params.bf.motorIdle;
		const cap = this.params.bf.throttleCap || 1;
		this.hoverThrottle = clamp( ( this.hoverMotor - idle ) / ( ( 1 - idle ) * cap ), 0, 1 );

		const at = thrustAt( this.hoverMotor );
		this.hoverRpm = at.rpm;
		this.hoverCurrent = at.current * 4;

		return this.hoverThrottle;

	}

	// =======================================================================
	//  Bucle
	// =======================================================================

	/** Avanza la simulación con paso fijo, desacoplada del render. */
	update( dt, controls ) {

		// El efecto suelo se muestrea una vez por frame: sondear la rejilla a
		// 1 kHz no aportaría nada y sí costaría.
		this.groundHeight = this.sampleGroundHeight();

		this._accumulator += Math.min( dt, 0.25 );

		let steps = 0;
		while ( this._accumulator >= PHYSICS_DT && steps < MAX_SUBSTEPS ) {

			this.step( PHYSICS_DT, controls );
			this._accumulator -= PHYSICS_DT;
			steps ++;

		}

		if ( steps === MAX_SUBSTEPS ) this._accumulator = 0;

	}

	step( dt, controls ) {

		const body = this.body;
		const frame = this.params.frame;

		body.clearAccumulators();

		if ( ! this.crashed ) this.flightTime += dt;

		// --- Giróscopo: velocidad angular del cuerpo en el convenio del FC ---
		_gyro[ ROLL ] = - body.omega.z * RAD2DEG;
		_gyro[ PITCH ] = body.omega.x * RAD2DEG;
		_gyro[ YAW ] = - body.omega.y * RAD2DEG;

		// --- Actitud, para los modos autonivelados ---
		// El vector "arriba del mundo" visto desde el cuerpo delata la inclinación.
		_up.set( 0, 1, 0 ).applyQuaternion( _qi.copy( body.quaternion ).invert() );
		const ay = Math.abs( _up.y ) < 1e-4 ? 1e-4 : Math.abs( _up.y );
		this.bf.attitude.roll = Math.atan2( - _up.x, ay ) * RAD2DEG;
		this.bf.attitude.pitch = Math.atan2( - _up.z, ay ) * RAD2DEG;

		// --- Controlador ---
		if ( this.crashed ) {

			// Desarmado: el mezclador manda ralentí y los rotores frenan solos.
			_sticks.roll = _sticks.pitch = _sticks.yaw = _sticks.throttle = 0;

		} else {

			_sticks.roll = controls.roll;
			_sticks.pitch = controls.pitch;
			_sticks.yaw = controls.yaw;
			_sticks.throttle = controls.throttle;

		}

		this.bf.update( dt, _sticks, _gyro );

		if ( this.crashed ) this.bf.motor.fill( 0 );

		// --- Estela retrasada: al girar rápido la estela no sigue al rotor ---
		this._smoothed.slerp( body.quaternion, Math.min( 1, dt * 35 ) );
		_down.set( 0, - 1, 0 ).applyQuaternion( body.quaternion );
		_downSmooth.set( 0, - 1, 0 ).applyQuaternion( this._smoothed );
		const tiltFactor = clamp( _down.dot( _downSmooth ), 0, 1 );

		const groundGain = this.groundEffect();

		// --- Cadena de propulsión, rotor a rotor ---
		const volts = this.battery.voltage;
		const packR = this.battery.packResistance;
		const cutoff = this.options.battery && this.battery.cutoff;

		let totalThrust = 0;
		let totalCurrent = 0;
		let yawTorque = 0;
		let rotorMomentum = 0;
		let rpmSum = 0;

		const rotorDt = dt / ROTOR_SUBSTEPS;

		for ( let i = 0; i < 4; i ++ ) {

			const prop = this.props[ i ];
			const motor = this.motors[ i ];
			const arm = this.arms[ i ];
			const dir = QUAD_X[ i ].dir;

			// Aire que ve este rotor: la velocidad del punto, que incluye la
			// rotación del aparato. Por eso alabear amortigua: el rotor que baja
			// ve más flujo y pierde empuje.
			body.bodyPointVelocity( arm, _v1 );
			const axialV = _v1.y;
			const lateralV = Math.hypot( _v1.x, _v1.z );

			for ( let s = 0; s < ROTOR_SUBSTEPS; s ++ ) {

				const torque = motor.update( this.bf.motor[ i ], prop.rpm, volts, packR, cutoff );
				prop.update( rotorDt, axialV, lateralV, tiltFactor, groundGain );
				prop.spin( rotorDt, torque, this.rotorInertia );

			}

			const thrust = prop.thrust;
			totalThrust += thrust;
			totalCurrent += Math.max( 0, motor.current );
			rpmSum += prop.rpm;

			// Empuje a lo largo del eje del rotor, aplicado en la punta del brazo.
			// De aquí —y sólo de aquí— salen el alabeo y el cabeceo.
			_force.set( 0, thrust, 0 );
			body.addBodyForceAtPoint( _force, arm );

			// Reacción de guiñada: el par que el motor mete al rotor sale del
			// chasis. Durante el acelerón τ_motor > τ_hélice, y de ahí el tirón
			// de morro característico al dar gas de golpe.
			yawTorque -= dir * motor.torque;
			rotorMomentum += dir * this.rotorInertia * prop.omega;

		}

		this.totalThrust = totalThrust;
		this.totalCurrent = totalCurrent;
		this.averageRpm = rpmSum / 4;

		_torque.set( 0, yawTorque, 0 );
		body.addBodyTorque( _torque );

		// Precesión giroscópica de los rotores: −ω × L. Es lo que hace que un
		// quad al alabear fuerte se vaya un poco de morro.
		_v1.set( 0, rotorMomentum, 0 );
		_cross.crossVectors( body.omega, _v1 ).multiplyScalar( - 1 );
		body.addBodyTorque( _cross );

		if ( this.params.bf.rpmLimit ) this.bf.applyRpmLimit( dt, this.averageRpm );

		// --- Batería ---
		if ( this.options.battery ) this.battery.update( dt, totalCurrent );
		else this.battery.voltage = this.battery.restingVoltage( 1 );

		// --- Arrastre del chasis, eje a eje en el marco del cuerpo ---
		_v1.copy( body.velocity ).applyQuaternion( _qi.copy( body.quaternion ).invert() );
		const da = frame.dragArea;
		_force.set(
			- 0.5 * RHO * da.x * Math.abs( _v1.x ) * _v1.x,
			- 0.5 * RHO * da.y * Math.abs( _v1.y ) * _v1.y,
			- 0.5 * RHO * da.z * Math.abs( _v1.z ) * _v1.z,
		);
		body.addBodyForceAtPoint( _force, _v2.set( 0, 0, 0 ) );

		// --- Amortiguamiento aerodinámico en giro ---
		const w = body.omega;
		_torque.set(
			- frame.angularDrag * Math.abs( w.x ) * w.x,
			- frame.angularDrag * Math.abs( w.y ) * w.y,
			- frame.angularDrag * Math.abs( w.z ) * w.z,
		);
		body.addBodyTorque( _torque );

		// --- Gravedad ---
		_force.set( 0, - GRAVITY * frame.gravityScale * body.mass, 0 );
		body.addWorldForce( _force );

		// --- Integración ---
		const prevVel = _v2.copy( body.velocity );
		body.integrate( dt );

		this.distanceFlown += body.velocity.length() * dt;
		this.topSpeed = Math.max( this.topSpeed, body.velocity.length() );

		if ( this.grid && this.options.collisions ) this.resolveCollisions();

		void prevVel;

	}

	// =======================================================================
	//  Suelo y colisión
	// =======================================================================

	/** Distancia al primer vóxel sólido bajo el dron, o null si no hay rejilla. */
	sampleGroundHeight() {

		const grid = this.grid;
		if ( ! grid || ! this.options.collisions ) return null;

		const p = this.body.position;
		const step = grid.voxelSize * 0.5;
		const maxDepth = this.props[ 0 ].diameter * 3;

		for ( let d = 0; d < maxDepth; d += step ) {

			if ( grid.isSolid( p.x, p.y - d, p.z ) ) return d;

		}

		return null;

	}

	/**
	 * Efecto suelo: cerca del suelo la estela no puede expandirse, la velocidad
	 * inducida baja y la misma hélice da más empuje. Es el "flota" del último
	 * palmo al aterrizar. Modelo clásico de Cheeseman-Bennett.
	 */
	groundEffect() {

		const h = this.groundHeight;
		if ( h === null ) return 1;

		const r = this.props[ 0 ].radius;
		const ratio = r / ( 4 * Math.max( h, r * 0.25 ) );
		return clamp( 1 / ( 1 - ratio * ratio ), 1, 1.35 );

	}

	resolveCollisions() {

		const grid = this.grid;
		const body = this.body;

		for ( let i = 0; i < this.contacts.length; i ++ ) {

			const offset = this.contacts[ i ];

			// Punto de contacto en el mundo.
			_v1.copy( offset ).applyQuaternion( body.quaternion ).add( body.position );
			if ( ! grid.isSolid( _v1.x, _v1.y, _v1.z ) ) continue;

			grid.normalAt( _v1.x, _v1.y, _v1.z, _n );
			if ( _n.lengthSq() < 1e-8 ) _n.set( 0, 1, 0 );

			// Todo se resuelve en ejes de cuerpo: ahí el tensor de inercia es
			// diagonal y el impulso angular sale de una multiplicación.
			_qi.copy( body.quaternion ).invert();
			_nBody.copy( _n ).applyQuaternion( _qi );

			body.bodyPointVelocity( offset, _rel );
			const vn = _rel.dot( _nBody );

			if ( vn < 0 ) {

				const impact = - vn;
				if ( impact > this.crashSpeed ) this.crashSpeed = impact;

				// j = −(1+e)·v_n / (1/m + n·((I⁻¹(r×n))×r))
				_cross.crossVectors( offset, _nBody );
				_angImp.set(
					_cross.x * body.invInertia.x,
					_cross.y * body.invInertia.y,
					_cross.z * body.invInertia.z,
				);
				_cross.crossVectors( _angImp, offset );

				const denom = body.invMass + _nBody.dot( _cross );
				const restitution = this.crashed ? this.options.restitution * 0.6 : this.options.restitution;
				const j = - ( 1 + restitution ) * vn / Math.max( denom, 1e-6 );

				this.applyImpulse( _imp.copy( _nBody ).multiplyScalar( j ), offset );

				// Rozamiento: impulso tangencial acotado por Coulomb.
				body.bodyPointVelocity( offset, _rel );
				_tan.copy( _rel ).addScaledVector( _nBody, - _rel.dot( _nBody ) );
				const tanSpeed = _tan.length();

				if ( tanSpeed > 1e-4 ) {

					_tan.multiplyScalar( 1 / tanSpeed );
					_cross.crossVectors( offset, _tan );
					_angImp.set(
						_cross.x * body.invInertia.x,
						_cross.y * body.invInertia.y,
						_cross.z * body.invInertia.z,
					);
					_cross.crossVectors( _angImp, offset );

					const tDenom = body.invMass + _tan.dot( _cross );
					const jt = clamp( - tanSpeed / Math.max( tDenom, 1e-6 ),
						- this.options.friction * j, this.options.friction * j );

					this.applyImpulse( _imp.copy( _tan ).multiplyScalar( jt ), offset );

				}

				if ( impact > this.options.crashSpeed && ! this.crashed ) this.crash( impact );

			}

			this.pushOut( offset, _n );

		}

		// Un impulso puntual sobre un sólido rígido de 3 g·m² de inercia da un
		// giro enorme: un golpe de frente contra una pared saldría a más de mil
		// vueltas por minuto. Un dron real se deforma, desliza y rompe hélices,
		// y nada de eso está aquí, así que se acota a un volteo violento pero
		// creíble.
		const spin = this.body.omega.length();
		if ( spin > this.options.maxSpin ) {

			this.body.omega.multiplyScalar( this.options.maxSpin / spin );

		}

	}

	/**
	 * Saca un punto de contacto de la geometría por el camino más corto.
	 *
	 * La rejilla sólo sabe decir "dentro" o "fuera", así que la distancia real a
	 * la superficie se busca por bisección. Empujar a pasos fijos dejaría al
	 * dron flotando hasta medio vóxel por encima del tejado, y desde ahí vuelve
	 * a caer: ese ciclo es exactamente el temblor de un dron posado.
	 */
	pushOut( offset, normal ) {

		const grid = this.grid;
		const body = this.body;
		const limit = grid.voxelSize * 2.5;

		const solidAt = d => {

			_probe.copy( offset ).applyQuaternion( body.quaternion )
				.add( body.position ).addScaledVector( normal, d );
			return grid.isSolid( _probe.x, _probe.y, _probe.z );

		};

		// Se dobla la distancia hasta salir…
		let hi = grid.voxelSize * 0.1;
		while ( hi < limit && solidAt( hi ) ) hi *= 2;
		if ( solidAt( hi ) ) return;   // enterrado de más: mejor no teletransportar

		// …y se vuelve por bisección hasta rozar la superficie.
		let lo = 0;
		for ( let k = 0; k < 9; k ++ ) {

			const mid = ( lo + hi ) / 2;
			if ( solidAt( mid ) ) lo = mid; else hi = mid;

		}

		body.position.addScaledVector( normal, hi );

	}

	applyImpulse( bodyImpulse, offset ) {

		const body = this.body;

		_v1.copy( bodyImpulse ).applyQuaternion( body.quaternion );
		body.velocity.addScaledVector( _v1, body.invMass );

		_cross.crossVectors( offset, bodyImpulse );
		body.omega.x += _cross.x * body.invInertia.x;
		body.omega.y += _cross.y * body.invInertia.y;
		body.omega.z += _cross.z * body.invInertia.z;

	}

	crash( impact ) {

		this.crashed = true;
		this.crashSpeed = impact;

	}

	// =======================================================================
	//  Salidas
	// =======================================================================

	applyToCamera( camera, tiltDeg ) {

		camera.position.copy( this.body.position );
		_q.setFromAxisAngle( _v1.set( 1, 0, 0 ), tiltDeg * DEG2RAD );
		camera.quaternion.copy( this.body.quaternion ).multiply( _q );

	}

	get position() {

		return this.body.position;

	}

	get velocity() {

		return this.body.velocity;

	}

	get quaternion() {

		return this.body.quaternion;

	}

	get speed() {

		return this.body.velocity.length();

	}

	get altitude() {

		return this.body.position.y - this.spawn.y;

	}

	get charge() {

		return this.battery.charge;

	}

	get voltage() {

		return this.battery.voltage;

	}

	/** Gas al que está el mezclador, promediado sobre los cuatro motores. */
	get motorAverage() {

		const m = this.bf.motor;
		return ( m[ 0 ] + m[ 1 ] + m[ 2 ] + m[ 3 ] ) / 4;

	}

	distanceToHome() {

		return _v1.copy( this.body.position ).sub( this.spawn ).length();

	}

	/**
	 * Ángulos de actitud en grados, para el horizonte del OSD.
	 *
	 * Se sacan del vector "arriba" y del morro, no de ángulos de Euler: en acro
	 * el dron pasa de los 90° constantemente y una descomposición YXZ se vuelve
	 * degenerada justo ahí, que es donde más falta hace el horizonte.
	 */
	attitude( target = this._attitude ) {

		_qi.copy( this.body.quaternion ).invert();
		_up.set( 0, 1, 0 ).applyQuaternion( _qi );
		const ay = Math.max( Math.abs( _up.y ), 1e-4 );

		target.roll = Math.atan2( - _up.x, ay ) * RAD2DEG;
		target.pitch = Math.atan2( - _up.z, ay ) * RAD2DEG;
		target.inverted = _up.y < 0;

		_v1.set( 0, 0, - 1 ).applyQuaternion( this.body.quaternion );
		target.yaw = Math.atan2( _v1.x, - _v1.z ) * RAD2DEG;

		return target;

	}

}

export { PHYSICS_HZ, GRAVITY, MathUtils };
