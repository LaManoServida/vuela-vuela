import { Vector3, Quaternion } from 'three';

/**
 * Sólido rígido de 6 grados de libertad con tensor de inercia diagonal.
 *
 * El punto de todo el modelo de vuelo es que el dron *no* recibe pares de
 * cabeceo o alabeo directamente: recibe cuatro empujes aplicados en la punta de
 * cada brazo, y la actitud sale de la geometría. Esto es lo que hace que el
 * dron se sienta como un dron y no como una cámara con rates.
 *
 * La velocidad angular se guarda en **ejes de cuerpo**, que es donde el término
 * giroscópico ω×Iω tiene forma sencilla y donde vive el giróscopo real.
 */

const _f = new Vector3();
const _t = new Vector3();
const _r = new Vector3();
const _iw = new Vector3();
const _dq = new Quaternion();
const _inv = new Quaternion();

export class RigidBody {

	constructor( { mass, inertia } ) {

		this.mass = mass;
		this.invMass = 1 / mass;

		this.inertia = new Vector3().fromArray( inertia );
		this.invInertia = new Vector3(
			1 / this.inertia.x,
			1 / this.inertia.y,
			1 / this.inertia.z,
		);

		this.position = new Vector3();
		this.velocity = new Vector3();          // mundo, m/s
		this.quaternion = new Quaternion();
		this.omega = new Vector3();             // cuerpo, rad/s

		this.force = new Vector3();             // acumulador, mundo, N
		this.torque = new Vector3();            // acumulador, cuerpo, N·m

	}

	setMass( mass ) {

		this.mass = mass;
		this.invMass = 1 / mass;

	}

	setInertia( inertia ) {

		this.inertia.fromArray( inertia );
		this.invInertia.set( 1 / inertia[ 0 ], 1 / inertia[ 1 ], 1 / inertia[ 2 ] );

	}

	clearAccumulators() {

		this.force.set( 0, 0, 0 );
		this.torque.set( 0, 0, 0 );

	}

	/** Fuerza en ejes de cuerpo aplicada en un punto en ejes de cuerpo. */
	addBodyForceAtPoint( bodyForce, bodyOffset ) {

		// Par = r × F, ya en ejes de cuerpo: no hay que rotar nada.
		_t.crossVectors( bodyOffset, bodyForce );
		this.torque.add( _t );

		_f.copy( bodyForce ).applyQuaternion( this.quaternion );
		this.force.add( _f );

	}

	/** Fuerza en ejes de mundo aplicada en el centro de masas. */
	addWorldForce( worldForce ) {

		this.force.add( worldForce );

	}

	/** Fuerza en ejes de mundo aplicada en un punto en ejes de cuerpo. */
	addWorldForceAtPoint( worldForce, bodyOffset ) {

		this.force.add( worldForce );

		_f.copy( worldForce ).applyQuaternion( _inv.copy( this.quaternion ).invert() );
		_t.crossVectors( bodyOffset, _f );
		this.torque.add( _t );

	}

	addBodyTorque( bodyTorque ) {

		this.torque.add( bodyTorque );

	}

	/** Velocidad del mundo en un punto del cuerpo, expresada en ejes de cuerpo. */
	bodyPointVelocity( bodyOffset, target ) {

		// v_local = R⁻¹·v_cm + ω × r
		target.copy( this.velocity ).applyQuaternion( _inv.copy( this.quaternion ).invert() );
		_r.crossVectors( this.omega, bodyOffset );
		return target.add( _r );

	}

	/**
	 * Euler semi-implícito. Con dt de 1 ms y el tensor de un quad de 5" es de
	 * sobra estable, y a diferencia de un RK4 no cuesta cuatro evaluaciones del
	 * modelo aerodinámico por paso.
	 */
	integrate( dt ) {

		// --- Lineal ---
		this.velocity.addScaledVector( this.force, this.invMass * dt );
		this.position.addScaledVector( this.velocity, dt );

		// --- Angular: α = I⁻¹·(τ − ω×Iω) ---
		_iw.set(
			this.omega.x * this.inertia.x,
			this.omega.y * this.inertia.y,
			this.omega.z * this.inertia.z,
		);
		_t.crossVectors( this.omega, _iw );

		this.omega.x += ( this.torque.x - _t.x ) * this.invInertia.x * dt;
		this.omega.y += ( this.torque.y - _t.y ) * this.invInertia.y * dt;
		this.omega.z += ( this.torque.z - _t.z ) * this.invInertia.z * dt;

		// --- Actitud: q ← q · Δq, con Δq de ángulo pequeño ---
		_dq.set(
			this.omega.x * dt * 0.5,
			this.omega.y * dt * 0.5,
			this.omega.z * dt * 0.5,
			1,
		).normalize();
		this.quaternion.multiply( _dq ).normalize();

	}

}
