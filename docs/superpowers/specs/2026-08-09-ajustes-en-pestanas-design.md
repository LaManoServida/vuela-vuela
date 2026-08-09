# Los ajustes, en pestañas

## El problema

Hay un solo constructor de ajustes y lo usan el menú de arranque y la pausa, que es lo
correcto. Pero vuelca sus siete bloques uno detrás de otro, y desde que ningún ajuste vive
sólo en el fichero eso son más de setenta controles en una tira vertical. Para tocar el
FOV hay que pasar por delante de los cinco PID del limitador de RPM.

El bloque de mando y controlador es el peor: treinta y tantos deslizadores seguidos —rates,
PID, filtros, curva de gas, limitador— sin más separación que dos o tres notas sueltas.

Lo que se busca no es esconder ajustes. Se buscó lo contrario a propósito: que se vea que
existen. Lo que hace falta es que estén repartidos donde uno los va a buscar.

## Qué se construye

Seis pestañas sobre el contenido de ajustes: **Zona · Mando · Vuelo · Aparato · Juego ·
Imagen**.

| Pestaña | Qué lleva |
| --- | --- |
| Zona | Cuenta de Google (API key) y zona de vuelo |
| Mando | Calibración del gamepad y zona muerta de los sticks |
| Vuelo | Rates, PID, ajuste fino, gas y ralentí, limitador de RPM |
| Aparato | Masa, motor, hélice, batería, arrastre, gravedad |
| Juego | Colisiones, rejilla, choques, reaparición |
| Imagen | FOV, cámara, escala de render, niebla, antialiasing |

Ningún ajuste cambia de nombre, de recorrido ni de momento de aplicación, y `vuela.config.js`
no se toca. Es un reparto, no un rediseño.

**El panel de mando entra en las pestañas.** Hoy se monta aparte: en el menú se cuelga al
final del cuerpo, en la pausa tiene su propio hueco en el HTML. Pasa a ser el contenido de
la pestaña «Mando», junto a la zona muerta, que es lo único de entrada que había suelto en
otro bloque. El hueco `#pause-gamepad` desaparece.

Sigue estando en la pausa por la razón de siempre: llegar al menú desde el vuelo es «Cambiar
de zona», que descarga el mundo, y quedarse sin mando no puede costar una descarga entera.

**«Vuelo» se parte por dentro.** Cinco bloques con título —Rates, PID, Ajuste fino, Gas y
ralentí, Limitador de RPM— en lugar de una tirada con notas intercaladas. Los mismos
controles en el mismo orden; lo que cambia es que ahora se ve dónde empieza y acaba cada
cosa. Es el único bloque que lo necesita: los demás caben de un vistazo.

**Se montan las seis, se enseña una.** Cambiar de pestaña no reconstruye nada: se esconde y
se enseña. Así los controles conservan su estado, y sobre todo el panel de mando sigue
leyendo el gamepad sin cortes —tiene un bucle de lectura por frame, y destruirlo y rehacerlo
a cada clic partiría una calibración en curso—.

Esto le da un dueño a ese bucle que antes no tenía aquí: el constructor de ajustes pasa a
devolver con qué pararlo. Hoy la pausa reconstruye el panel de mando en cada apertura y lo
para explícitamente; cuando el panel vive dentro de los ajustes, sin ese cabo suelto se
quedaría un bucle vivo por cada pausa abierta.

## Qué pestaña sale abierta

El menú de arranque abre en «Zona», que es a lo que va, y se queda donde lo dejes: se monta
una vez al cargar la página y ya no se vuelve a montar.

La pausa recuerda la última que tocaste, mientras dure la página. Si estabas afinando el
PID, reanudas y vuelves a pausar, sigues en «Vuelo». Al recargar se olvida.

Dos avisos que ya existen dejan de ser ciertos con las pestañas puestas, y por eso las
fuerzan:

- **Pausa sin mando.** El aviso dice «mapea los cuatro ejes aquí abajo». Si la pausa abriera
  en la pestaña recordada, ahí abajo no habría nada. Sin mando, la pausa abre en «Mando».
- **Cargar zona sin API key.** El aviso sale al pie del menú con el campo a la vista. Si el
  campo está detrás de otra pestaña, el aviso manda a un sitio que no se ve. Al fallar por
  eso, el menú salta a «Zona».

## Aspecto

Barra horizontal encima del contenido, la activa marcada con el color de acento y una línea
inferior. Botones de verdad, con `aria-selected`, recorribles con teclado.

Las seis etiquetas caben de sobra en los 760 px del panel. Si la ventana se estrecha, la
barra hace scroll horizontal en vez de partirse en dos filas: una barra de pestañas que se
reordena sola cambia de sitio las cosas entre visitas.

## Piezas

`src/menu.js`: el constructor de ajustes monta barra y contenido en vez de encadenar
bloques, y expone qué pestaña enseñar. Los constructores de vuelo, aparato y juego que ya
existen pasan a ser el contenido de su pestaña sin más cambio que, en el de vuelo, repartir
sus controles en cinco bloques.

`src/gamepadPanel.js`: sin cambios de comportamiento; lo que cambia es dónde lo cuelgan.

`src/main.js`: deja de montar el panel de mando por su cuenta en el menú y en la pausa, para
el bucle de lectura al cerrar la pausa, y fuerza la pestaña en los dos casos de arriba.

`src/styles.css`: barra de pestañas, pestaña activa, scroll horizontal.

`index.html`: fuera el hueco `#pause-gamepad`.

## Qué se verifica

Con `npm test`. El guardián que ya hay —«todos los rangos de ui se usan en el menú»— es
justo el que caza el fallo propio de este cambio: si al repartir controles entre pestañas se
pierde uno por el camino, falla. Se comprueba también que el resto de la batería sigue en
verde, que ninguna prueba dependía del hueco que se quita.

Mirando lo verifica el dueño del repositorio:

- Que las seis pestañas se pinten bien y que ninguna se haya quedado vacía o con algo que no
  le toca.
- Que la pausa vuelva a la pestaña donde la dejaste, y que sin mando conectado abra en
  «Mando».
- Que el mando se siga leyendo al entrar en la pestaña «Mando» desde otra, y que una
  calibración empezada no se corte al pasear por las demás.
- Que abrir y cerrar la pausa varias veces seguidas no vaya degradando los fps: es lo que
  delataría un bucle de lectura sin parar.
