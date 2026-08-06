# El modelo de vuelo

No hay ningún par de alabeo aplicado a mano. La cadena es la de un dron de verdad, y la
actitud **emerge** de que cuatro empujes distintos actúan en la punta de cuatro brazos:

```
sticks ─► Betaflight ─► mezclador ─► 4 × (variador → motor → hélice) ─► sólido rígido
          rates/expo     por motor      Ohm + BEMT      empuje         F=ma, τ=Iα
          PID (P·error + I·∫ + D·Δgiro + F·Δstick)      en el brazo
```

Cada bloque, en `src/flight/`:

- **`betaflight.js`** — rates (curvas *Betaflight* y *ACTUAL*), PID sobre la medida con
  I-term relax, anti-gravity, TPA, D-min y feedforward; mezclador lineal con airmode;
  suavizado del enlace de radio; limitador de RPM. Escalas internas del firmware
  (`PTERM_SCALE`, `ITERM_SCALE`, …) para que los números sean los de verdad.
- **`prop.js`** — elemento de pala + teoría de cantidad de movimiento. Saca el ángulo de
  ataque del flujo que atraviesa el disco, de ahí `Cl`/`Cd` y de ahí empuje y par
  resistente. Incluye velocidad inducida exacta en ascenso, la curva empírica de Johnson
  para el anillo de vórtices, alivio por traslación, deformación de pala y efecto suelo.
- **`motor.js`** — motor brushless de continua: fuerza contraelectromotriz, ley de Ohm
  sobre motor + variador + batería, límite de corriente, frenado activo, `τ = Kt·(I − I₀)`
  con `Kt = 60/(2π·KV)`.
- **`battery.js`** — curva de descarga de litio y caída bajo consumo por resistencia interna.
- **`rigidbody.js`** — 6 grados de libertad con tensor de inercia diagonal, `α = I⁻¹(τ − ω×Iω)`.
- **`quad.js`** — lo ensambla: cuatro rotores en sus brazos, reacción de guiñada, precesión
  giroscópica de los rotores, arrastre del chasis eje a eje, colisión por impulsos.

Todo corre a **1 kHz** con el rotor subdividido a 2 kHz (la dinámica del rotor es rígida:
inercias de microgramos·m² contra pares de centinewton·metro), desacoplado del render y sin
asignar memoria. Coste medido en el navegador: **0,09 ms por frame a 60 fps**.

Cosas que salen gratis por estar modelado el camino completo, y que un modelo de rates no
puede dar:

- El gas tiene peso, porque los rotores tardan ~120 ms en subir de vueltas.
- Dar gas de golpe mete un tirón de guiñada, porque durante el acelerón el par del motor
  supera al de la hélice y esa diferencia sale del chasis.
- Caer en vertical hunde el dron en su propia estela y el gas deja de servir: hay que salir
  hacia adelante. El OSD avisa, porque el reflejo correcto es el contrario del instintivo.
- Con la batería baja hay menos punch, porque la tensión cae bajo carga.
- Alabear amortigua solo: el rotor que baja ve más flujo axial y pierde empuje.
- Al posarse el dron flota el último palmo por efecto suelo.

## Trastear desde la consola

Con el vuelo en marcha tienes `window.vv` para afinar en caliente:

```js
// Controlador: se lee en cada paso, así que el cambio es inmediato.
// Nada de esto persiste: al recargar vuelve a mandar vuela.config.js.
vv.config.flight.bf.pid[0].p = 80      // más P en roll
vv.config.flight.bf.superRate = 0.85   // rates más agresivos
vv.config.flight.bf.mode = 'angle'     // autonivelado

// Hardware: hay que rehacer lo que se derivó de los parámetros.
// `vv.config.flight` y `vv.drone.params` son el mismo objeto durante el vuelo.
vv.config.flight.frame.mass = 0.45
vv.drone.refresh()
vv.drone.hoverThrottle                 // recalculado

// Telemetría cruda de un rotor.
vv.drone.props[0].rpm
vv.drone.props[0].thrust               // N
vv.drone.props[0].vrs                  // 0..1, anillo de vórtices
vv.drone.motors[0].current             // A
vv.drone.bf.motor                      // los 4 mandos del mezclador, 0..1

vv.drone.position.y += 200             // teletransporte
vv.world.grid.voxelSize                // resolución de la rejilla de colisión
```
