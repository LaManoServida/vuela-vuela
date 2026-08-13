# Tests

```bash
npm test
```

Todo en Node, sin navegador.

`tests/config.test.mjs` es la primera en correr, antes de tocar el modelo de vuelo: valida
el fichero en sí. Recorre `vuela.config.js` entero buscando cualquier número que no sea
finito — un NaN se propaga en silencio hasta que el dron aparece cayendo o girando a mil
rpm sin que nada avise — comprueba que estén los bloques que el modelo da por hechos
(`frame`, `motor`, `esc`, `prop`, `battery`, `bf`), y que la curva del variador tenga sus 65
puntos, monótona y entre 0 y 1. Del bloque `ui` comprueba las dos direcciones: que cada
rango sea coherente (`min < max`, `step > 0`) y que el valor de partida caiga dentro del
suyo, y también que ningún `min`, `max` o `step` se haya colado como literal en `menu.js`
—un número de configuración escondido en código es justo lo que el refactor de configuración
vino a eliminar— ni quede un rango declarado en `ui` que nadie use en el menú. Por último
comprueba el cargador: que `cloneFlight()` devuelva una copia independiente en cada
llamada, que tocar una copia no contamine `config.flight` (el objeto que de verdad vuela),
y que la `apiKey` no aparezca en el fichero, porque es la única credencial y por eso vive
fuera, en `.env.local`.

Además comprueba el contrato **por el otro lado**: coge copias del fichero, las sabotea
como lo haría alguien editándolo a mano (borrar `radius`, escribir `mass` como `masa`,
poner un número entre comillas, dejar la inercia en dos componentes, quitar el bloque
`flight.motor`, poner `voxelSize: 0`, borrar `deadzone`, apuntar un `ui.*.path` a una clave
que ya no existe) y exige que la validación devuelva un error **que nombre esa ruta**. Esto
es lo que evita que el fichero se rompa en silencio: el flujo documentado es «edítalo y
recarga», no «edítalo y `npm test`», así que el arranque tiene que quejarse solo.

El bloque `gamepads` lleva sus propios sabotajes, porque es el que más se edita a mano —el
panel da el trozo y se pega— y el que copia `input.js` tal cual: quitarlo entero, un mando
con sólo tres ejes (sin el del gas, `readGamepad` lo remapea a 0,5 y se despega con medio
gas), un `axis` fuera del rango del mando, un `inv` escrito como cadena y —la que no ve el
esquema, porque cada eje es válido por separado— **dos ejes del mismo mando apuntando al
mismo índice**, que es exactamente el síntoma original: timón y gas leyendo el mismo stick.
Un fichero sin ningún mando guardado, en cambio, tiene que seguir siendo válido: se calibra
en el panel y se pega después.

`tests/flight.test.mjs` no comprueba sólo que el modelo no explote: comprueba que sigue
representando un dron. Empuje por motor, empuje/peso, gas de sustentación, régimen y consumo
tienen que caer en el rango de un 5" real, y la figura de mérito de la hélice en el de una
hélice real (0,4–0,8). Si una de esas cifras se sale, el modelo ha dejado de ser físico
aunque siga volando bien.

Además cubre: las curvas de rates contra sus valores exactos, el sentido de los tres ejes
(y hacia dónde se mueve el dron, no sólo cómo gira), que la actitud emerge de empujes
distintos en cada brazo, modo angle y horizon, airmode, los regímenes de la hélice
(ascenso, anillo de vórtices, autorrotación, traslación), la batería, el acoplamiento del
hardware con el vuelo, y estabilidad numérica tras un minuto de pilotaje aleatorio con paso
de render variable.

`tests/input.test.mjs` cubre la regla de entrada entera: sin mando —o con mando desconocido— los
ejes llegan a cero y `hasControl` es falso; un mando cuyo `id` está en `gamepads` queda mapeado
solo, con los ejes pasando por su inversión y su banda muerta y el gas remapeado de −1..1 a
0..1, y por los dos caminos por los que puede aparecer: el barrido de `attach()` si ya estaba
visible al arrancar, y el evento `gamepadconnected` si aparece después. Cambiar de mando cambia
de mapeo, y volver a enchufar el mismo —con el frame sin ningún mando por medio, que es lo que
produce un tirón del cable— respeta lo calibrado. `sameMap` decide si lo que hay puesto es lo
que guarda el fichero, y de eso dependen el estado que anuncia el panel y que aparezca el cuadro
de pegar. Un mapeo al que le falte un eje no da control: es el fallo del medio gas, que
`hasControl` tapaba mirando sólo si había mapa. Cubre además la calibración entera sin
navegador —umbral de aceptación, exclusión de los ejes ya asignados, el signo que decide la
inversión, la espera a que el stick vuelva y su tope de dos segundos, y el fallo por no mover
nada—, y la misma exclusión vista desde `usedAxes`: qué ejes ocupan ya las demás filas, para que
redetectar una sola no acabe apuntando al eje de otra. Comprueba también que el trozo que se
pega en `vuela.config.js` vuelve a leerse como el mismo mapeo pese a comillas y barras
invertidas en el `id`, que las teclas pulsadas fuera del vuelo no se disparan en el primer
frame, y que no ha vuelto la API del ratón.

`tests/schedule.test.mjs` cubre los turnos con los que avanza la carga, que es lo que la
mantiene viva con la pestaña en segundo plano. Falsea las tres piezas —los frames, que aquí
no llegan nunca solos; el estado de la pestaña; y el worker que hace de reloj— y comprueba
las dos mitades del problema: que el turno llegue sin un solo frame (oculta o sin foco) y
que además despierte las colas del tileset, que difieren su siguiente descarga a un frame
por su cuenta. Cubre también el plan B: si un navegador estrangulase también los
temporizadores del worker se nota, porque el turno tarda de más, y se cambia a un mecanismo
que nadie puede estrangular.

`tests/stream.test.mjs` cubre las piezas del modo de exploración, donde la zona cargada sigue
al dron. Nada de esto necesita navegador: son aritmética de tiempo, de distancia y de
matrices. El reloj de refresco tiene que exigir las dos condiciones —intervalo cumplido *y*
distancia recorrida—, no gastar un solo turno con el dron quieto en el aire, y responder en el
acto al volver a moverse, que es lo que se pierde si los turnos saltados se apuntan como
gastados. El recentrado tiene que dejar las esferas sobre el dron deshaciendo la
transformación con la que el tileset pone la zona en el origen, sin tocarles el radio, y se
prueba con una matriz que además rota, no sólo traslada: con sólo traslación, una
implementación que se limitase a restar el origen del tileset pasaría la prueba igual que la
que deshace la rotación de verdad, así que hace falta esa vuelta de más para distinguirlas. El
goteo de texturas se prueba con un reloj falso que mueve el propio trabajo, así que el
presupuesto se comprueba contando en vez de cronometrando: parar al agotarlo, retomar
exactamente donde iba sin repetir ni saltarse ninguna, que mallas que comparten textura —el
caso normal de un tile fotogramétrico— no la dupliquen en la cola, y que una textura rota no
deje el vuelo sin cargar nada más. La compactación del array interno —se recorta cuando lo ya
subido pesa más que lo que queda— se prueba con la cola todavía viva, no vacía: se agota el
presupuesto a media tanda grande para que el recorte tenga que arrastrar lo pendiente sin
perderlo, que es el caso que de verdad arriesga algo. Y el montaje sobre un tileset falso
comprueba lo que ata las tres piezas: que un modelo que llega en vuelo apunte sus texturas
solo, que el presupuesto de memoria llegue a la caché con margen entre mínimo y máximo, que un
tile que falla se cuente en vez de tumbar el vuelo, y que soltar el modo desenganche los
oyentes —si no, el tileset viejo seguiría alimentando la cola de un modo ya muerto.

`tests/world.test.mjs` cubre la voxelización de geometría real, la caída libre, el choque
contra fachada y posarse sin temblar. Cubre también las dos formas que tiene la rejilla de
irse de las manos: que un tile cargado pero **no dibujado** —un ancestro de miles de
kilómetros— no dicte la altura de la rejilla, y que el tope de 64 MB se respete pase lo que
pase con la extensión, porque pasarse no da una rejilla grande, da un `RangeError` y una
pestaña muerta.

## Fallos reales que salieron de estos tests

- La formulación de "estación representativa" del elemento de pala sobrestimaba el empuje un
  55 %: evaluar una sección a 0,8R y multiplicar por el área geométrica ignora que la parte
  interior de la pala va mucho más despacio. Hay que usar el área equivalente
  `c·N·R·(1−h³)/(3·0,64)`, que sale de igualar la integral.
- La curva de Johnson por sí sola **nunca** produce pérdida de empuje al descender: el flujo
  medio da más empuje, no menos. Lo que hunde a un rotor que cae en su estela es la
  recirculación, y eso hay que modelarlo aparte.
- Un impulso puntual sobre un sólido de 3 g·m² de inercia daba 108 rad/s de volteo al chocar
  contra una pared (más de mil vueltas por minuto).
- El empuje de sustentación se calculaba en unidades de motor, pero el stick pasa por el
  remapeo del ralentí: el dron aparecía cayendo.
- Sacar el dron del vóxel a pasos fijos lo dejaba flotando hasta medio vóxel por encima del
  tejado, y desde ahí volvía a caer: el temblor clásico de un dron posado. Ahora la
  distancia a la superficie se busca por bisección.
- Con `reversedDepthBuffer`, three **invierte la lista opaca completa**, así que un
  `renderOrder: -1000` acaba dibujándose el último. La cúpula del cielo tapaba el mundo
  entero. Ahora se resuelve por profundidad y no depende del orden.
- La rejilla de colisión se construía con **todos** los tiles cargados, no con los que se
  dibujan. Los ancestros del tileset —el globo entero con un par de cientos de triángulos,
  cajas de 8.000 km— contienen la zona, así que ningún filtro lateral los descartaba, y
  llevaban la rejilla a pedir 12 GB: `RangeError` y pestaña muerta.
- Las teclas pulsadas fuera del vuelo se encolaban y se disparaban en el primer frame:
  pulsar `Esc` en la pausa y darle a «Reanudar» devolvía a la pausa al instante.
