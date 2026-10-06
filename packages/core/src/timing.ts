/**
 * Pause de frappe (spec Formulaire §3.2, §4.2) : l'état est relu 1 s après la dernière frappe,
 * ou à la sortie du champ. Environ 3 fois l'intervalle moyen entre deux touches sur mobile (330 ms).
 */
export const TYPING_PAUSE = 1000;
