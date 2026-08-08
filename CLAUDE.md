# Trabajar en este repositorio

- Verifica antes de dar nada por bueno. Verificado, commitea sin esperar a que te lo pidan:
  commits atómicos, uno por cambio con sentido propio. Y **haz push**, sin esperar tampoco.
- Lo que se comprueba con `npm test` o leyendo el código lo verificas tú. Lo que sólo se ve
  volando lo verifica el dueño del repositorio, pero eso ya no retiene el push.
- Al terminar, di qué queda pendiente de esa verificación y qué hay que mirar exactamente.
- Sus ajustes a mano en `vuela.config.js` van en su propio commit, nunca sepultados en uno de
  refactor. Si una tarea toca ese fichero: `git stash push -- vuela.config.js` y devolverlo.
- «Recuerda X» significa apuntar X aquí, en este fichero.
- Al informar, quédate en qué cambia y por qué. Los detalles de implementación —nombres de
  funciones, campos, líneas, estructuras internas— sólo si los pide.

## Pendiente de verificar volando

**Vista de la rejilla de colisiones** (`showGrid`, desde el 08/08/2026). Está hecha y
pusheada, pero nadie la ha visto todavía. Recordárselo al dueño y preguntar por esto:

1. Que los cubos caen **sobre** las fachadas, ni medio vóxel adentro ni afuera. Es la razón
   de ser de la vista: un desfase se ve como una capa roja flotando delante o hundida en la
   pared, y significaría que el vuelo choca donde no toca.
2. Que se lee: rojo a 0,35 de opacidad, sin niebla, cubos al 90 % de la celda para que se
   vea la textura por las juntas. Sobre ladrillo rojo o al atardecer puede perderse.
3. Que encender y apagar en pausa no cuesta un tirón al reanudar (al apagar se destruye la
   malla; al encender se reconstruye entera).
4. Si 50 m (`gridRadius`) es la distancia útil, y si una reconstrucción por segundo
   (`gridRefresh`) descentra la ventana de forma molesta a velocidad alta.
