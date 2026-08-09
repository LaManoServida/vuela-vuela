# Las magnitudes acopladas se derivan

## El problema

El panel «Aparato» dice de sí mismo que sus deslizadores son magnitudes físicas, «así que
cambiarlas cambia el vuelo por la vía correcta: más masa es menos empuje/peso y más inercia,
no un número de "agilidad" bajado a mano». La primera mitad es cierta. La segunda no: **la
inercia no se deriva de la masa**, es un valor aparte que se queda donde estaba.

No es el único. Siete de los once deslizadores del aparato mueven algo cuya consecuencia
física se queda congelada:

| Mueves | Se queda quieto | Y debería salir de |
| --- | --- | --- |
| Masa | `frame.inertia` | la masa |
| Longitud de brazo | `frame.inertia`, `frame.dragArea` | el brazo |
| KV | `motor.resistance` | el KV |
| Diámetro de hélice | `prop.chordMm`, `prop.inertia` | el diámetro |
| Palas | `prop.inertia` | el número de palas |
| Celdas y capacidad | `frame.mass` | el pack, que pesa |

El porqué es que los números se copiaron uno a uno de la base de datos de componentes de
Velocidrone. Cada uno es un valor medido de *ese* aparato, no una fórmula. Perfecto para
reproducir el TBS Oblivion clavado, y falso en cuanto tocas un deslizador.

Se nota: a 250 g el aparato giraba con el tensor de inercia de uno de 529, y a 3800 KV el
motor arrastraba la resistencia de uno de 1428 —tres veces la que le toca—, que lo hunde de
tensión en cuanto pide corriente.

## El principio

**Mover el brazo escala el aparato entero.** No es «el mismo dron con brazos más largos», es
«un dron más grande». De ahí sale que el brazo mande a la vez sobre la inercia y sobre el
área de arrastre, que hoy van cada uno por su lado.

## Las fórmulas

Cada una se ancla en los números medidos del Oblivion, de modo que **en el punto de
referencia —529 g, 110 mm de brazo, 1428 KV, 5,1" de 3 palas, 4S 1300— todas devuelven
exactamente lo que hoy está escrito en el fichero.** Eso es lo que hace que esto no cambie
cómo vuela nada: sólo cambia qué pasa cuando te mueves de ahí.

**Inercia.** El radio de giro es una fracción fija del brazo, y la inercia va con la masa por
su cuadrado:

    inercia = masa · (0.5229 · brazo)²

El 0.5229 sale de despejar con los valores medidos: 0.00175 = 0.529 · (α · 0.110)². Con el
brazo de referencia da un radio de giro de 57,5 mm, entre los 110 de los motores en la punta
y los ~47 de la masa central. Los tres ejes comparten valor, como hasta ahora.

**Resistencia del motor.** Para un motor del mismo tamaño, la resistencia escala con el
inverso del cuadrado del KV —menos vueltas por voltio es más espiras, y más espiras es más
cobre en serie—:

    resistencia = 0.1270 Ω · (1428 / KV)²

**Cuerda de la pala.** Semejanza geométrica: una hélice mayor es la misma hélice más grande.

    cuerda = 15 mm · (diámetro / 5.1")

**Inercia de la hélice.** Con semejanza geométrica la masa de una pala va con el cubo del
diámetro y su brazo con el diámetro, así que la inercia va con la quinta potencia. Y con el
número de palas, linealmente:

    inercia de hélice = 2.8e-6 · (diámetro / 5.1")⁵ · (palas / 3)

**Área de arrastre.** Un área escala con el cuadrado de la longitud:

    arrastre = arrastre declarado · (brazo / 0.110 m)²

Los tres ejes con el mismo factor: el aparato crece entero, no se estira por un lado.

**Masa del pack.** La energía de un pack va con celdas por amperios-hora, y la energía por
kilo de un LiPo es aproximadamente constante:

    masa del pack = 176 g · (celdas / 4) · (Ah / 1.3)
    masa total    = masa en seco + masa del pack

Los 176 g son los que el fichero ya declara para el 4S 1300; los 353 g en seco son la ficha
del Oblivion sin batería, que es como Velocidrone la publica.

## Qué cambia en el fichero

**Cuatro valores desaparecen**, porque pasan a calcularse: `frame.inertia`,
`motor.resistance`, `prop.chordMm` y `prop.inertia`. Dejarlos escritos sin efecto sería
exactamente la clase de mentira que este cambio viene a quitar.

**Dos cambian de significado.** `frame.dragArea` pasa a ser el arrastre del aparato de
referencia, y el de verdad sale de escalarlo con el brazo. Y `frame.mass` se parte en
`frame.dryMass` más el pack derivado.

El contrato de `config.js` se mueve con ellos: fuera las cuatro claves derivadas, y `mass`
pasa a ser `dryMass`.

## Dónde vive

Una función pura, `deriveAircraft( flight )`, en `src/flight/derive.js`. Recibe el bloque de
vuelo y devuelve el mismo bloque con las magnitudes derivadas puestas. No toca el DOM, no
guarda estado, no depende de three.js: se prueba entera en Node, que es donde vive el resto
del modelo de vuelo.

La llaman dos sitios, y sólo dos:

- La carga de configuración, para que lo que arranca ya esté completo.
- `Quad.refresh()`, que es el que ya corre al soltar un deslizador del panel «Aparato». Así
  mover la masa o el brazo recalcula la inercia en el acto, sin recargar nada.

Las constantes calibradas viven en ese módulo, cada una con la aritmética de su calibración
al lado. No son ajustes: son la forma del modelo, y por eso no van al menú ni al fichero de
configuración.

## Qué se ve en el menú

Dos deslizadores dicen ahora algo distinto de lo que se les pide, así que lo enseñan, con el
mismo patrón que ya usa el de resolución de rejilla —lo pedido y lo que sale de verdad—:

- **Arrastre frontal**: `38 cm² → 61 cm² con este brazo`, cuando el brazo no es el de
  referencia.
- **Masa**: pasa a llamarse «Masa en seco» y su nota dice el total con el pack puesto.

La nota del panel deja de prometer de más: ahora es verdad que cambiar una magnitud cambia el
vuelo por la vía correcta, y las que arrastran a otras lo dicen.

## Qué se verifica

Con `npm test`, en `tests/flight.test.mjs`:

- **La calibración es correcta**: con los valores de referencia del Oblivion, cada fórmula
  devuelve el número que hoy está escrito a mano en el fichero, hasta la precisión con que
  está escrito. Es la prueba que sostiene todas las demás.
- **Las leyes se cumplen**: doblar el brazo cuadruplica la inercia y el área de arrastre;
  doblar el KV divide la resistencia por cuatro; doblar el diámetro multiplica por 32 la
  inercia de la hélice y por 2 la cuerda; doblar las celdas dobla la masa del pack.
- **Nada de esto cambia cómo vuela el aparato de referencia**: el suite entero sigue verde
  sin tocar ningún umbral. Si alguno se mueve, la calibración está mal.
- **Se aplica en caliente**: cambiar masa o brazo y llamar a `refresh()` cambia la inercia sin
  teletransportar el dron ni parar los rotores.
- **Y ahora la masa sí llega a la inercia**: el mismo aparato con el doble de masa tarda más
  en llegar al rate que pide el stick. Antes esta prueba no podía existir.

Mirando lo verifica el dueño del repositorio: que el deslizador de arrastre y el de masa en
seco digan lo que sale de verdad, y que mover masa, brazo o hélice en la pausa se sienta al
reanudar.
