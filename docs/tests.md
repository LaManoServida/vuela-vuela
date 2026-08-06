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

`tests/input.test.mjs` cubre la regla de entrada entera: sin mando —o con mando sin
mapear— los ejes llegan a cero y `hasControl` es falso, y con mapeo los ejes pasan por su
inversión y su banda muerta, con el gas remapeado de −1..1 a 0..1. Comprueba también que las
teclas pulsadas fuera del vuelo no se disparan en el primer frame, y que no ha vuelto la API
del ratón.

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
