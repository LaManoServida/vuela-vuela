# La zona cargada sigue al dron

## El problema

Hoy el mundo tiene un borde. La esfera de máscara del telón de fondo mide 22 km y está
clavada en el punto de despegue: fuera de ella no se carga nada, nunca, por diseño. Vueles
lo que vueles, acabas en el mismo sitio.

Ese borde no es un descuido, es el precio de la garantía que define el simulador: se paga
*todo* el coste —red, parseo, subida a GPU, compilación de shaders— antes de que el dron se
mueva, y a partir de ahí se congela el recorrido del árbol. Cero descargas, cero descartes,
cero reevaluación de LOD durante el vuelo. Para que eso sea posible la zona tiene que ser
finita y conocida de antemano.

Queremos poder alejarnos indefinidamente sin renunciar a la fluidez. No se puede tener la
garantía estructural —«es imposible que haya un tirón porque no queda trabajo pendiente»— y
un mundo infinito a la vez. Hay que elegir qué se rompe.

## El principio

**Se rompe la nitidez, nunca la fluidez.**

Todo el trabajo que hoy se hace en la pantalla de carga se sigue haciendo, pero repartido en
porciones diminutas con un techo fijo de milisegundos por frame que no se rebasa jamás. Si
el dron avanza más rápido de lo que la red y la GPU pueden alimentar, la consecuencia es que
por delante se ve basto y va afinando conforme te acercas. Nunca que se entrecorte.

La garantía deja de ser estructural y pasa a ser un presupuesto que hay que respetar. Es un
grado de seguridad menos, y por eso el coste real tiene que ser visible en el OSD desde el
primer día en vez de darlo por bueno.

## Convive con el modo actual, no lo sustituye

El modo de precarga —radio finito, congelar, cero tirones garantizados, colisiones— **no se
toca en absoluto**. El de exploración es otro, se elige al empezar el vuelo, y quien quiera
volar de precisión entre edificios sigue teniendo exactamente lo de ahora.

En modo exploración el arranque es el mismo: se precarga la zona del despegue entera y se
pagan todos los costes antes de moverse. Lo único que cambia es que al terminar **no se
congela**, sino que se entra en régimen continuo.

## Los dos relojes

Es la distinción que sostiene el diseño, y confundirlos lo tira abajo.

**El recorrido del árbol** —mover las esferas y reevaluar qué tiles hacen falta— es una
llamada indivisible y relativamente cara. Va cada segundo, configurable. A 40 m/s eso son 40
metros de avance entre pasada y pasada, nada frente a un radio de detalle de 1.100 m.

**El goteo de trabajo pendiente** —parsear lo descargado, subir texturas a la GPU— va **cada
frame**, en porciones diminutas. Es justo lo que reparte el coste: agruparlo una vez por
segundo produciría un tirón por segundo. Aquí el ajuste no es la frecuencia sino el techo de
milisegundos.

## Las piezas

**Las esferas móviles.** Las tres regiones que ya existen —detalle, media y telón de fondo—
dejan de estar clavadas en el despegue y recentran en la posición del dron, la de máscara
incluida. Ahí es donde desaparece el borde. Las regiones son objetos mutables y el plugin
las relee en cada pasada, así que «moverlas» es cambiarles el centro y nada más. Requiere
convertir la posición del dron al marco del tileset, que es donde viven las esferas.

`radius` y `quality` conservan su significado exacto: el radio de la esfera de detalle y su
error geométrico objetivo. Lo único que cambia es que ahora te acompañan.

**El reloj de refresco.** Cada N segundos se recentran las esferas y se recorre el árbol. Si
el dron no se ha movido lo suficiente desde el último turno, el turno se salta entero:
quedarse quieto en el aire no debe costar nada.

**El goteo con presupuesto.** Cada frame se drena una porción de la cola de parseo y de las
texturas pendientes de subir, con un techo en milisegundos. Reutiliza la maquinaria que ya
tiene el precargador —el troceado, el ceder el control entre porción y porción, y el
temporizador de worker que mantiene la carga viva con la pestaña en segundo plano—, sólo que
corriendo indefinidamente en vez de corriendo para acabar cuanto antes.

Hay un golpe de suerte que abarata esto mucho: como los materiales son planos, todos los
tiles comparten una sola variante de shader. El primero compila y los demás reutilizan el
programa, así que de los tres costes el más traicionero —compilar en caliente— prácticamente
desaparece, y quedan dos que sí se dejan medir y limitar bien.

**La caché con desalojo.** Hoy está puesta para no soltar nada jamás, que es correcto cuando
la zona es finita y errado cuando no lo es. Pasa a tener un presupuesto de memoria real, y
lo que dejas atrás se libera. No es higiene: cuantos menos tiles vivos, más barato el
recorrido del árbol, así que el desalojo es también lo que sostiene el rendimiento.

**Sin colisiones.** En este modo no se construye la rejilla de vóxeles. Es una decisión
explícita del dueño del repositorio —en exploración las colisiones dan igual— y de paso
elimina la parte más cara del arranque, así que despegas bastante antes. El dron atraviesa
edificios y terreno.

## Qué cambia en el fichero de configuración

Un bloque nuevo. Los tres números llevan su rango en `ui` y su deslizador, como todo lo
demás; `enabled` es un interruptor:

```js
stream: {
    enabled:  false,   // modo exploración
    interval: 1.0,     // s entre recorridos del árbol
    budgetMs: 3,       // techo de trabajo por frame
    memoryMb: 1500,    // presupuesto de caché
},
```

La distancia mínima que hay que recorrer para que un turno cuente es una constante en
código, no un deslizador: nadie va a querer tocarla y el menú ya tiene bastantes.

El interruptor vive junto a `radius` y `quality`, que es donde se decide qué mundo cargas.

## Errores

**Un tile que falla no puede tumbar el vuelo.** Hoy un error de carga aborta con un mensaje
de diagnóstico, y está bien porque estás en la pantalla de carga y aún no ha pasado nada. En
vuelo es inaceptable: un 500 suelto o un corte de wifi de dos segundos no puede echarte.
Pasa a ser un apunte y a seguir volando; como mucho ese trozo se ve basto. El diagnóstico
duro —API key, facturación, restricciones de la clave— se queda donde está, en el arranque,
que es cuando de verdad significa algo.

**La sesión caduca en vuelos largos.** El refresco automático de la credencial ya existe y
funciona, pero hasta ahora sólo se ha ejercitado durante una carga de minutos. Media hora de
vuelo lo pone a prueba de otra manera.

**Quedarse sin memoria.** El presupuesto de desalojo es la única defensa y tiene dos formas
de estar mal puesto: corto, y descarta cosas que sigues viendo para volver a pedirlas en
bucle; largo, y crece hasta morir. Va al OSD como número visible, porque a ojo no se acierta.

**Agujeros por delante.** El telón de fondo alcanza 22 km, así que el terreno nuevo entra en
la esfera 22 km antes de que llegues: a 40 m/s son nueve minutos de margen. No debería haber
vacíos.

## El riesgo conocido

El recorrido del árbol no se puede trocear. Si con la zona cargada cuesta 8 ms, hay un pico
de 8 ms cada segundo —un tirón por segundo, exactamente lo que se quería evitar— y no lo
arregla ningún presupuesto.

Cuánto cuesta de verdad depende de cuántos tiles haya vivos y no se sabe hasta medirlo. Por
eso el coste del recorrido sale al OSD junto al contador de tirones que ya está. Si resulta
caro, la conversación pasa a ser cuánto se baja el radio o cada cuánto se refresca, y eso se
decide con un número delante en vez de a ojo.

## Qué se verifica

Con `npm test`, en Node y sin navegador:

- **El reloj de refresco.** Dado tiempo transcurrido y distancia recorrida, ¿toca turno o se
  salta? Incluido el caso de quedarse quieto, que no debe costar nada.
- **El goteo con presupuesto.** Dados N pendientes y un techo de X ms, ¿para dentro del
  presupuesto y retoma exactamente donde iba? Se falsea el reloj, igual que ya se falsean los
  turnos de carga en `tests/schedule.test.mjs`.
- **El recentrado.** Posición del dron → marco del tileset → centro de las esferas. Es
  aritmética determinista.
- **Los ajustes nuevos**, con sus sabotajes, en `tests/config.test.mjs`: rangos coherentes,
  valor de partida dentro del suyo, ningún literal colado en `menu.js`, y que borrar o
  corromper cada clave dé un error que **nombre esa ruta**.

Sólo se ve volando, y lo verifica el dueño del repositorio:

- Que el contador de tirones siga en cero tras un vuelo largo.
- Que la memoria se estabilice en vez de subir sin parar.
- Cuánto cuesta de verdad el recorrido del árbol con la zona cargada.
- Si a toda velocidad en línea recta el detalle aguanta o vuelas hacia una papilla.
- Que un corte de red y una sesión caducada no echen del vuelo.

## Qué queda fuera

**El origen flotante.** Este diseño da vuelo continuo mientras el marco local plano siga
valiendo, es decir, decenas de kilómetros: a 50 km el suelo ha caído casi 200 m respecto al
plano tangente y la vertical se ha girado medio grado. Llegar a cualquier punto del planeta
exige re-anclar el mundo cada pocos kilómetros reorientando la gravedad, y eso toca a la vez
el estado de la física, la cámara y el cielo. Es un segundo proyecto, con su propia spec, y
no sirve de nada sin este.

**Las colisiones durante el streaming.** Construir la rejilla por trozos y coserlos en
caliente es más trabajo que el streaming entero. Queda descartado mientras las colisiones en
exploración sigan dando igual.

**La cuadrícula de celdas.** La idea original era dividir el mundo en celdas tipo Minecraft y
subir de calidad la contigua al entrar en ella. Se descarta por tres razones: el paso de
«ponerle las texturas buenas» a una celda ya cargada no existe —en 3D Tiles subir detalle es
bajar un nivel del árbol, o sea nodos nuevos con su geometría y su textura, una redescarga
completa—; los bordes rectos crean costuras de calidad visibles que una esfera no tiene; y el
tileset ya trae su propia jerarquía espacial, así que una rejilla encima es contabilidad sin
premio.
