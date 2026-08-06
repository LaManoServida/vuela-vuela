# Trabajar en este repositorio

## Cómo se cierran los cambios

Verifica antes de dar nada por bueno. Una vez verificado, **commitea sin esperar a que te lo
pidan**, en commits atómicos: uno por cambio con sentido propio, no un commit-cajón al final.

Quién puede verificar qué es lo que decide cuándo se hace push:

- Lo que se comprueba con `npm test` o leyendo el código lo verificas tú, y ahí mismo
  commiteas.
- Lo que sólo se ve corriendo el juego —volar, mirar el HUD, ver la pantalla de carga— lo
  verifica el dueño del repositorio. En ese caso **espera su confirmación y entonces haz push**, no antes:
  publicar algo que todavía no se sabe si sirve es justo lo que se quiere evitar.

Al terminar, di explícitamente qué queda pendiente de su verificación y qué hay que mirar,
con el detalle suficiente para poder hacerlo sin volver a preguntar.

Los ajustes que el dueño del repositorio haya hecho a mano en `vuela.config.js` van **en su propio commit**,
nunca sepultados dentro de uno de refactor. Si una tarea toca ese fichero, aparta su cambio
con `git stash push -- vuela.config.js` y devuélvelo al terminar.
