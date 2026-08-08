# Ver la rejilla de colisiones

## El problema

La rejilla de colisiones es invisible. Cuando el dron rebota donde no hay nada, o atraviesa
una pared, no hay forma de mirar contra qué está chocando de verdad: `voxels.js` construye
una ocupación en bits y el vuelo la consulta, pero nadie la dibuja. Tampoco hay manera de
saber si `voxelSize` está bien elegido para una zona sin adivinarlo por el comportamiento.

Google no da malla de colisión —los Photorealistic 3D Tiles son glTF para pintar, sin
semántica ni física—, así que lo que hay que enseñar es lo que nos inventamos nosotros.

## Qué se construye

Una vista de depuración que dibuja las celdas sólidas alrededor del dron, encendible y
apagable en vuelo.

**Ventana, no rejilla entera.** Una zona de 1100 m de radio tiene millones de vóxeles
marcados: dibujarlos todos no cabe en ninguna GPU. Se dibuja un cubo de radio configurable
centrado en el dron —50 m por defecto—, que es la distancia a la que se ve algo útil.

**Sólo la piel.** Una celda con las seis vecinas sólidas no se ve nunca y en un material
translúcido además ensucia. Se descartan. En la práctica quita poco —los tiles de Google
son cáscara, no volumen— pero limpia el interior del terreno.

**Cubos rojos translúcidos.** Es lo único que deja ver la fachada por debajo, que es la
mitad de para qué sirve la vista: comprobar si la rejilla se pega a la geometría o va
desplazada. A unos pocos miles de cubos el coste de la transparencia no se mide, así que el
rendimiento no decide aquí. Los cubos van ligeramente encogidos respecto a la celda: sin
eso, sus caras quedan coplanares con la fachada y aparece z-fighting.

**Se reconstruye al cruzar de celda.** Volando recto eso es una vez cada pocas décimas;
parado, nunca. El buffer de instancias se reserva una vez al máximo de la ventana y se
reusa: ni una asignación por frame.

**Apagada no cuesta nada.** La malla no existe hasta que se enciende.

## Piezas

`src/gridView.js`, módulo nuevo:

- `collectSurfaceCells( grid, center, radius, out )` — función pura sobre una `VoxelGrid`:
  recorre la ventana, filtra por piel y escribe los centros de celda en un buffer que
  recibe. Devuelve cuántos escribió. Es lo que se prueba.
- `createGridView( { grid, scene, config } )` — el objeto de vista: `update( position )`,
  `setVisible( on )`, `dispose()`. Encapsula el `InstancedMesh` y el seguimiento de la
  celda actual.

`vuela.config.js` y el contrato de `config.js`: dos claves nuevas, `showGrid` (bool) y
`gridRadius` (m).

`menu.js`: casilla «Ver la rejilla» junto a «Colisiones», en el menú principal y en la
pausa —encenderla sin aterrizar es justo el caso de uso.

`main.js`: crea la vista tras construir la rejilla, la actualiza en cada frame con la
posición del dron, la conmuta desde `onLiveSettingChange` y la libera en `teardownWorld`.

## Qué se verifica

Con `npm test`, en `tests/world.test.mjs` y sobre la rejilla real de la ciudad de demo:

- La ventana no se sale de su radio y sus celdas son todas sólidas.
- El filtro de piel no deja pasar ninguna celda con las seis vecinas sólidas, y no descarta
  ninguna que tenga al menos una vecina de aire.
- Un dron dentro de la ciudad ve celdas; uno a 400 m de altura no ve ninguna.
- El buffer nunca se desborda aunque la ventana esté llena.

Volando lo verifica el dueño: que los cubos coincidan con las fachadas, que se vea la
textura entre ellos y que encender y apagar en pausa no cueste un tirón.
