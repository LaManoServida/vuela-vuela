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
